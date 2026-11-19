// Tests for WgtSigner: a small test .wgt signed with throwaway test certificates (made by the fake Samsung in
// SamsungCertTests.cs) must carry author-signature.xml and signature1.xml whose signatures verify and whose
// references list every file with its SHA-256.
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Security.Cryptography.Xml;
using System.Text;
using System.Xml;

static partial class Tests
{
    const string Ds = "http://www.w3.org/2000/09/xmldsig#";

    static byte[] Zip(params KeyValuePair<string, byte[]>[] entries)
    {
        var ms = new MemoryStream();
        using (var z = new ZipArchive(ms, ZipArchiveMode.Create, true))
        {
            foreach (var e in entries)
            {
                var entry = z.CreateEntry(e.Key);
                if (e.Value != null) using (var s = entry.Open()) s.Write(e.Value, 0, e.Value.Length);
            }
        }
        return ms.ToArray();
    }
    static KeyValuePair<string, byte[]> F(string name, string text)
    {
        return new KeyValuePair<string, byte[]>(name, text == null ? null : Encoding.UTF8.GetBytes(text));
    }

    static Dictionary<string, byte[]> Unzip(byte[] zip)
    {
        var d = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        using (var z = new ZipArchive(new MemoryStream(zip), ZipArchiveMode.Read))
            foreach (var e in z.Entries)
            {
                var ms = new MemoryStream();
                using (var s = e.Open()) s.CopyTo(ms);
                d.Add(e.FullName, ms.ToArray());
            }
        return d;
    }

    static string Sha256(byte[] b) { using (var h = SHA256.Create()) return Convert.ToBase64String(h.ComputeHash(b)); }

    /**
     * Checks one Tizen signature file the way the TV does, independently of how WgtSigner built it:
     * - SignedXml loads it and computes the "#prop" reference (C14N of the Object) itself;
     * - the SignatureValue verifies over the exclusive-C14N SignedInfo with the first KeyInfo certificate;
     * - every other reference is a package file whose SHA-256 matches, and every expected file is referenced.
     * (SignedXml.CheckSignature itself cannot be used: .NET Framework refuses external file references,
     * which a widget signature consists of, unless a machine-wide registry key allows them.)
     */
    static void VerifyTizenSignature(byte[] xml, string id, string role, Dictionary<string, byte[]> package,
        IEnumerable<string> expectedFiles, X509Certificate2 expectedLeaf, X509Certificate2 expectedCa)
    {
        var doc = new XmlDocument { PreserveWhitespace = true };
        doc.LoadXml(Encoding.UTF8.GetString(xml));
        var ns = new XmlNamespaceManager(doc.NameTable);
        ns.AddNamespace("ds", Ds);
        ns.AddNamespace("dsp", "http://www.w3.org/2009/xmldsig-properties");
        var sig = doc.DocumentElement;
        Eq("Signature", sig.LocalName, "root");
        Eq(Ds, sig.NamespaceURI, "namespace");
        Eq(id, sig.GetAttribute("Id"), "Id");

        var sx = new SignedXml(doc);
        sx.LoadXml(sig);
        Eq("http://www.w3.org/2001/10/xml-exc-c14n#", sx.SignedInfo.CanonicalizationMethod, "canonicalization");
        Eq("http://www.w3.org/2001/04/xmldsig-more#rsa-sha256", sx.SignedInfo.SignatureMethod, "signature method");

        // Certificates: the signer's, then its CA.
        var certs = sig.SelectNodes("ds:KeyInfo/ds:X509Data/ds:X509Certificate", ns).Cast<XmlNode>()
            .Select(n => new X509Certificate2(Convert.FromBase64String(n.InnerText.Trim()))).ToList();
        Eq(2, certs.Count, "KeyInfo certificates");
        Eq(expectedLeaf.Thumbprint, certs[0].Thumbprint, "KeyInfo leaf");
        Eq(expectedCa.Thumbprint, certs[1].Thumbprint, "KeyInfo CA");

        // Properties: profile, role, identifier, each targeting this signature.
        string target = "#" + id;
        True(sig.SelectSingleNode("ds:Object[@Id='prop']/ds:SignatureProperties/ds:SignatureProperty[@Id='profile'][@Target='" + target +
            "']/dsp:Profile[@URI='http://www.w3.org/ns/widgets-digsig#profile']", ns) != null, "profile property");
        True(sig.SelectSingleNode("ds:Object[@Id='prop']/ds:SignatureProperties/ds:SignatureProperty[@Id='role'][@Target='" + target +
            "']/dsp:Role[@URI='http://www.w3.org/ns/widgets-digsig#" + role + "']", ns) != null, "role property");
        True(sig.SelectSingleNode("ds:Object[@Id='prop']/ds:SignatureProperties/ds:SignatureProperty[@Id='identifier'][@Target='" + target +
            "']/dsp:Identifier", ns) != null, "identifier property");

        // References.
        var refs = sx.SignedInfo.References.Cast<Reference>().ToList();
        var fileRefs = refs.Where(r => !r.Uri.StartsWith("#")).ToList();
        foreach (var r in refs)
            Eq("http://www.w3.org/2001/04/xmlenc#sha256", r.DigestMethod, "digest method of " + r.Uri);
        var listed = fileRefs.Select(r => Uri.UnescapeDataString(r.Uri)).OrderBy(n => n, StringComparer.Ordinal).ToArray();
        Eq(string.Join(",", expectedFiles.OrderBy(n => n, StringComparer.Ordinal).ToArray()), string.Join(",", listed), "referenced files");
        foreach (var r in fileRefs)
        {
            Eq(0, r.TransformChain.Count, "no transforms on " + r.Uri);
            True(r.Uri.IndexOf('/') < 0 && r.Uri.IndexOf(' ') < 0, "URI is percent-encoded: " + r.Uri);
            Eq(Sha256(package[Uri.UnescapeDataString(r.Uri)]), Convert.ToBase64String(r.DigestValue), "SHA-256 of " + r.Uri);
        }
        var prop = refs.Single(r => r.Uri == "#prop");
        Eq(1, prop.TransformChain.Count, "#prop transforms");
        Eq("http://www.w3.org/2006/12/xml-c14n11", prop.TransformChain[0].Algorithm, "#prop transform");

        // "#prop" digest, computed by SignedXml over this document (C14N 1.0 = C14N 1.1 here: no xml:* attributes).
        var check = new SignedXml(doc) { SigningKey = new RSACng(2048) };
        var again = new Reference("#prop") { DigestMethod = "http://www.w3.org/2001/04/xmlenc#sha256" };
        again.AddTransform(new XmlDsigC14NTransform());
        check.AddReference(again);
        check.ComputeSignature();
        Eq(Convert.ToBase64String(check.SignedInfo.References.Cast<Reference>().Single().DigestValue),
            Convert.ToBase64String(prop.DigestValue), "#prop digest");

        // SignatureValue over the canonical SignedInfo, with the certificate in KeyInfo.
        var t = new XmlDsigExcC14NTransform();
        var si = new XmlDocument { PreserveWhitespace = true };
        si.AppendChild(si.ImportNode(sig.SelectSingleNode("ds:SignedInfo", ns), true));
        si.DocumentElement.SetAttribute("xmlns", Ds);   // the in-scope namespace a subset canonicalization renders
        t.LoadInput(si);
        byte[] canonical = ((MemoryStream)t.GetOutput(typeof(Stream))).ToArray();
        True(certs[0].GetRSAPublicKey().VerifyData(canonical, sx.Signature.SignatureValue, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1),
            "SignatureValue does not verify");
        var tampered = (byte[])canonical.Clone();
        tampered[tampered.Length / 2] ^= 1;
        True(!certs[0].GetRSAPublicKey().VerifyData(tampered, sx.Signature.SignatureValue, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1),
            "a changed SignedInfo still verifies");
    }

    static void WgtSignerTests()
    {
        var samsung = new FakeSamsung();
        var dir = NewTempDir();
        var cert = MakeTestBundle(samsung, dir, DuidA);
        Directory.Delete(dir, true);

        var unsigned = Zip(
            F("config.xml", "<?xml version=\"1.0\"?><widget xmlns=\"http://www.w3.org/ns/widgets\" id=\"http://foxbloom/tv\"/>"),
            F("icon.png", "not really a png"),
            F("index.html", "<!doctype html><title>Foxbloom</title>"),
            F("js/", null),
            F("js/main.js", "console.log('hi')"),
            F("images/My Icon (1).png", "spaces and brackets"),
            F("signature1.xml", "<stale/>"),
            F("author-signature.xml", "<stale/>"));
        var appFiles = new[] { "config.xml", "icon.png", "index.html", "js/main.js", "images/My Icon (1).png" };

        Test("WgtSigner: author-signature.xml covers every app file and verifies", delegate
        {
            var package = Unzip(WgtSigner.Sign(unsigned, cert));
            True(package.ContainsKey("author-signature.xml"), "author-signature.xml missing");
            VerifyTizenSignature(package["author-signature.xml"], "AuthorSignature", "role-author", package,
                appFiles, cert.Author, cert.AuthorChain[0]);
        });

        Test("WgtSigner: signature1.xml also covers author-signature.xml and verifies", delegate
        {
            var package = Unzip(WgtSigner.Sign(unsigned, cert));
            True(package.ContainsKey("signature1.xml"), "signature1.xml missing");
            VerifyTizenSignature(package["signature1.xml"], "DistributorSignature", "role-distributor", package,
                appFiles.Concat(new[] { "author-signature.xml" }), cert.Distributor, cert.DistributorChain[0]);
        });

        Test("WgtSigner: the package keeps every app file unchanged, old signatures replaced", delegate
        {
            var before = Unzip(unsigned);
            var after = Unzip(WgtSigner.Sign(unsigned, cert));
            foreach (var f in appFiles) Eq(Sha256(before[f]), Sha256(after[f]), "content of " + f);
            var names = after.Keys.Where(k => !k.EndsWith("/")).OrderBy(k => k, StringComparer.Ordinal).ToArray();
            Eq(string.Join(",", appFiles.Concat(new[] { "author-signature.xml", "signature1.xml" }).OrderBy(k => k, StringComparer.Ordinal).ToArray()),
                string.Join(",", names), "entries");
            True(Encoding.UTF8.GetString(after["signature1.xml"]) != "<stale/>", "old signature1.xml kept");
        });

        Test("WgtSigner: refuses a package without config.xml, with unsafe paths, or a bundle without keys", delegate
        {
            Throws<InvalidDataException>(delegate { WgtSigner.Sign(Zip(F("index.html", "x")), cert); }, "config.xml", "no config.xml");
            Throws<InvalidDataException>(delegate { WgtSigner.Sign(Zip(F("config.xml", "x"), F("../evil.js", "x")), cert); }, "evil", "dot-dot");
            Throws<InvalidDataException>(delegate { WgtSigner.Sign(Zip(F("config.xml", "x"), F("/abs.js", "x")), cert); }, "abs", "absolute");
            Throws<InvalidDataException>(delegate { WgtSigner.Sign(Encoding.ASCII.GetBytes("not a zip"), cert); }, null, "not a zip");
            var noDistributor = new CertBundle { Author = cert.Author, AuthorChain = cert.AuthorChain };
            Throws<ArgumentException>(delegate { WgtSigner.Sign(unsigned, noDistributor); }, "distributor", "no distributor");
        });
    }
}
