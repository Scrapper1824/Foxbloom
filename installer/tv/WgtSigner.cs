// Tizen widget signing: adds author-signature.xml and signature1.xml to an unsigned .wgt (a zip).
//
// ---- Research (Task 11b, step 0) --------------------------------------------------------------------------------
// Sources: W3C "XML Digital Signatures for Widgets" (https://www.w3.org/TR/2013/REC-widgets-digsig-20130418/),
// which Tizen's signing follows (https://docs.tizen.org/application/web/tutorials/sign-certificate, now
// redirected; https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html),
// and real Tizen Studio output in Samsung's own sample repo, e.g.
// https://github.com/Samsung/TizenTVApps/blob/master/TVDemoAvPlayer/.sign/signature1.xml (and author-signature.xml).
// What Tizen Studio writes, and so what we write:
//   * <Signature xmlns="http://www.w3.org/2000/09/xmldsig#" Id="AuthorSignature">   (author-signature.xml)
//     <Signature ... Id="DistributorSignature">                                     (signature1.xml)
//   * CanonicalizationMethod http://www.w3.org/2001/10/xml-exc-c14n#
//     SignatureMethod        http://www.w3.org/2001/04/xmldsig-more#rsa-sha256
//   * one <Reference URI="..."> per file in the package, no transforms, DigestMethod
//     http://www.w3.org/2001/04/xmlenc#sha256 over the raw file bytes. The URI is the zip path percent-encoded
//     as a whole ("/" becomes %2F, e.g. "js%2Fmain.js"). Directories are not listed.
//     The author signature lists every file except the signature files; the distributor signature lists every
//     file including author-signature.xml (but not signature*.xml).
//   * a last <Reference URI="#prop"> with one Transform http://www.w3.org/2006/12/xml-c14n11, sha256.
//   * <SignatureValue>, then <KeyInfo><X509Data> with the signer's certificate followed by its intermediate CA.
//   * <Object Id="prop"><SignatureProperties xmlns:dsp="http://www.w3.org/2009/xmldsig-properties"> with three
//     SignatureProperty elements, each Target="#<signature Id>":
//       Id="profile"    <dsp:Profile URI="http://www.w3.org/ns/widgets-digsig#profile">
//       Id="role"       <dsp:Role URI="http://www.w3.org/ns/widgets-digsig#role-author"> (or #role-distributor)
//       Id="identifier" <dsp:Identifier> (empty)
//   * RSA-SHA256 with SHA-256 digests is what Tizen Studio uses for TV packages (SHA-512 is allowed by the W3C
//     spec but not needed).
// Why this is built by hand rather than with SignedXml.ComputeSignature: .NET Framework (4.6.2+) refuses to digest
// external references (the files) unless a machine-wide registry key allows detached signatures, and it has no
// C14N 1.1 transform. C14N 1.1 differs from C14N 1.0 only for xml:id/xml:base/xml:* attributes, which our #prop
// Object never has, so the C14N 1.0 transform gives the bytes a C14N 1.1 implementation (the TV's) gives. We
// register that as the c14n11 URI so SignedXml can still load and check our files (the tests do).
// ------------------------------------------------------------------------------------------------------------------
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Security.Cryptography.Xml;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;

/** The http://www.w3.org/2006/12/xml-c14n11 transform, as C14N 1.0 (identical for what Tizen signatures hold). */
public class XmlDsigC14N11Transform : XmlDsigC14NTransform
{
    public const string Uri = "http://www.w3.org/2006/12/xml-c14n11";
    public XmlDsigC14N11Transform() { Algorithm = Uri; }
}

public static class WgtSigner
{
    const string Ds = "http://www.w3.org/2000/09/xmldsig#";
    const string ExcC14N = "http://www.w3.org/2001/10/xml-exc-c14n#";
    const string RsaSha256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
    const string Sha256Uri = "http://www.w3.org/2001/04/xmlenc#sha256";
    public const string AuthorFile = "author-signature.xml";
    public const string DistributorFile = "signature1.xml";
    static readonly Regex DistributorSignatureName = new Regex("^signature[1-9][0-9]*\\.xml$", RegexOptions.IgnoreCase);

    static WgtSigner()
    {
        CryptoConfig.AddAlgorithm(typeof(XmlDsigC14N11Transform), XmlDsigC14N11Transform.Uri);
    }

    /** The package signed for Developer Mode installs: author-signature.xml + signature1.xml added (old ones dropped). */
    public static byte[] Sign(byte[] unsignedWgt, CertBundle cert)
    {
        if (cert == null || cert.Author == null || !cert.Author.HasPrivateKey || cert.AuthorChain.Length == 0)
            throw new ArgumentException("The author certificate (with its key and CA) is missing.");
        if (cert.Distributor == null || !cert.Distributor.HasPrivateKey || cert.DistributorChain.Length == 0)
            throw new ArgumentException("The distributor certificate (with its key and CA) is missing.");

        var files = ReadPackage(unsignedWgt);
        byte[] author = BuildSignature("AuthorSignature", "role-author", files, cert.Author, cert.AuthorChain[0]);
        var withAuthor = new List<KeyValuePair<string, byte[]>> { new KeyValuePair<string, byte[]>(AuthorFile, author) };
        withAuthor.AddRange(files);
        byte[] distributor = BuildSignature("DistributorSignature", "role-distributor", withAuthor, cert.Distributor, cert.DistributorChain[0]);

        var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, true))
        {
            foreach (var f in files) Add(zip, f.Key, f.Value);
            Add(zip, AuthorFile, author);
            Add(zip, DistributorFile, distributor);
        }
        return ms.ToArray();
    }

    static void Add(ZipArchive zip, string name, byte[] data)
    {
        using (var s = zip.CreateEntry(name, CompressionLevel.Optimal).Open()) s.Write(data, 0, data.Length);
    }

    /** The package's files in zip order, without directories or old signatures. */
    static List<KeyValuePair<string, byte[]>> ReadPackage(byte[] wgt)
    {
        var files = new List<KeyValuePair<string, byte[]>>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            using (var zip = new ZipArchive(new MemoryStream(wgt), ZipArchiveMode.Read))
            {
                foreach (var e in zip.Entries)
                {
                    string name = e.FullName;
                    if (name.EndsWith("/")) continue;   // a directory
                    if (name.Length == 0 || name.StartsWith("/") || name.Contains("\\") || name.Contains(":") ||
                        name.Split('/').Any(part => part.Length == 0 || part == "." || part == ".."))
                        throw new InvalidDataException("The app package has an unsafe file name: " + name);
                    if (name.Equals(AuthorFile, StringComparison.OrdinalIgnoreCase) || DistributorSignatureName.IsMatch(name)) continue;
                    if (!seen.Add(name)) throw new InvalidDataException("The app package lists " + name + " twice.");
                    var ms = new MemoryStream();
                    using (var s = e.Open()) s.CopyTo(ms);
                    files.Add(new KeyValuePair<string, byte[]>(name, ms.ToArray()));
                }
            }
        }
        catch (InvalidDataException) { throw; }
        catch (Exception e)
        {
            if (e is IOException || e is ArgumentException || e is NotSupportedException)
                throw new InvalidDataException("The app package is not a readable .wgt (zip) file.", e);
            throw;
        }
        if (!files.Any(f => f.Key == "config.xml")) throw new InvalidDataException("The app package has no config.xml.");
        return files;
    }

    static string Sha256(byte[] data) { using (var h = SHA256.Create()) return Convert.ToBase64String(h.ComputeHash(data)); }

    static byte[] Canonical(string xml, Transform t)
    {
        var doc = new XmlDocument { PreserveWhitespace = true, XmlResolver = null };
        doc.LoadXml(xml);
        t.LoadInput(doc);
        return ((MemoryStream)t.GetOutput(typeof(Stream))).ToArray();
    }

    static string A(string s) { return SecurityElement.Escape(s); }

    /** One Tizen signature file (see the notes at the top), UTF-8 without a BOM. */
    static byte[] BuildSignature(string id, string role, IEnumerable<KeyValuePair<string, byte[]>> files, X509Certificate2 signer, X509Certificate2 ca)
    {
        string target = "#" + id;
        string props =
            "<SignatureProperties xmlns:dsp=\"http://www.w3.org/2009/xmldsig-properties\">" +
            "<SignatureProperty Id=\"profile\" Target=\"" + target + "\"><dsp:Profile URI=\"http://www.w3.org/ns/widgets-digsig#profile\"></dsp:Profile></SignatureProperty>" +
            "<SignatureProperty Id=\"role\" Target=\"" + target + "\"><dsp:Role URI=\"http://www.w3.org/ns/widgets-digsig#" + role + "\"></dsp:Role></SignatureProperty>" +
            "<SignatureProperty Id=\"identifier\" Target=\"" + target + "\"><dsp:Identifier></dsp:Identifier></SignatureProperty>" +
            "</SignatureProperties>";
        // The #prop node-set is the Object element in the Signature, where xmlns="...xmldsig#" is in scope.
        string propDigest = Sha256(Canonical("<Object xmlns=\"" + Ds + "\" Id=\"prop\">" + props + "</Object>", new XmlDsigC14NTransform()));

        var si = new StringBuilder();
        si.Append("\n<CanonicalizationMethod Algorithm=\"" + ExcC14N + "\"></CanonicalizationMethod>\n");
        si.Append("<SignatureMethod Algorithm=\"" + RsaSha256 + "\"></SignatureMethod>\n");
        foreach (var f in files)
        {
            si.Append("<Reference URI=\"" + A(Uri.EscapeDataString(f.Key)) + "\">\n");
            si.Append("<DigestMethod Algorithm=\"" + Sha256Uri + "\"></DigestMethod>\n");
            si.Append("<DigestValue>" + Sha256(f.Value) + "</DigestValue>\n</Reference>\n");
        }
        si.Append("<Reference URI=\"#prop\">\n<Transforms>\n<Transform Algorithm=\"" + XmlDsigC14N11Transform.Uri + "\"></Transform>\n</Transforms>\n");
        si.Append("<DigestMethod Algorithm=\"" + Sha256Uri + "\"></DigestMethod>\n");
        si.Append("<DigestValue>" + propDigest + "</DigestValue>\n</Reference>\n");
        string signedInfo = si.ToString();

        byte[] canonical = Canonical("<SignedInfo xmlns=\"" + Ds + "\">" + signedInfo + "</SignedInfo>", new XmlDsigExcC14NTransform());
        byte[] value;
        using (var key = signer.GetRSAPrivateKey())
            value = key.SignData(canonical, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);

        var xml = new StringBuilder();
        xml.Append("<Signature xmlns=\"" + Ds + "\" Id=\"" + id + "\">\n");
        xml.Append("<SignedInfo>" + signedInfo + "</SignedInfo>\n");
        xml.Append("<SignatureValue>\n" + Wrap(Convert.ToBase64String(value)) + "</SignatureValue>\n");
        xml.Append("<KeyInfo>\n<X509Data>\n");
        foreach (var c in new[] { signer, ca })
            xml.Append("<X509Certificate>\n" + Wrap(Convert.ToBase64String(c.RawData)) + "</X509Certificate>\n");
        xml.Append("</X509Data>\n</KeyInfo>\n");
        xml.Append("<Object Id=\"prop\">" + props + "</Object>\n");
        xml.Append("</Signature>");
        return new UTF8Encoding(false).GetBytes(xml.ToString());
    }

    static string Wrap(string b64)
    {
        var sb = new StringBuilder();
        for (int i = 0; i < b64.Length; i += 76) sb.Append(b64.Substring(i, Math.Min(76, b64.Length - i))).Append('\n');
        return sb.ToString();
    }
}
