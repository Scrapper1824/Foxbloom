// Samsung author / distributor certificates for installing Foxbloom on a TV in Developer Mode.
//
// ---- Research (Task 11b, step 0; read-only, no code copied) ----------------------------------------------------
// Sources read on 2026-11-18/19:
//   * Jellyfin2Samsung / "Apps2Samsung" installer, https://github.com/Jellyfin2Samsung/Samsung-Jellyfin-Installer
//     Licence: GPL-3.0-only (releases up to v3.2.1 were MIT). We read it for facts only; nothing here is copied.
//     Files read: Apps2Samsung.Core/Samsung/SamsungOAuth.cs, Apps2Samsung.Cli/BrowserSamsungLogin.cs,
//     Apps2Samsung.Core/Certificate/TizenCertificateService.cs, .../CertificateEndpoints.cs,
//     Apps2Samsung.Core/Models/SamsungAuth.cs, .../TizenDuid.cs, Apps2Samsung.Core/Sdb/TizenDuidReader.cs,
//     Apps2Samsung.Core/Core/Constants.cs. That project mirrors what Tizen Studio's "Samsung Certificate Extension"
//     does (the extension itself is a closed Eclipse plug-in; its docs:
//     https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html,
//     https://developer.samsung.com/smarttv/develop/tools/additional-tools/vscode/creating-certificates.html).
//
// Sign-in (Samsung account "SignInGate", in the user's own browser):
//   GET https://account.samsung.com/accounts/be1dce529476c1a6d407c4c7578c31bd/signInGate
//       ?locale=&clientId=v285zxnl3h&redirect_uri=<urlencoded http://localhost:4794/signin/callback>
//       &state=accountcheckdogeneratedstatetext&tokenType=TOKEN
//   After sign-in the page POSTs (application/x-www-form-urlencoded) to redirect_uri with
//     state=<the state sent>  and  code=<URL-encoded JSON>,
//   the JSON holding access_token, token_type, access_token_expires_in, refresh_token, userId, client_id,
//   inputEmailID (the account e-mail), api_server_url, auth_server_url, state.
//   The client id, the localhost:4794 redirect and that fixed state string are what Samsung's own extension
//   registers; whether SignInGate accepts any other redirect host/port or a random state is NOT confirmed, so we
//   send exactly these values and check the state that comes back against them.
//
// Certificate requests (multipart/form-data POSTs, response body = the issued certificate, PEM or DER):
//   author:      https://svdca.samsungqbe.com/apis/v3/authors
//                fields access_token, user_id, platform=VD, csr (file "author.csr", PEM PKCS#10)
//   distributor: https://svdca.samsungqbe.com/apis/v1/distributors   (answers a device-profile XML; not needed)
//                then https://svdca.samsungqbe.com/apis/v3/distributors (answers the certificate)
//                fields access_token, user_id, privilege_level=public (lower case), developer_type=Individual,
//                platform=VD, csr (file "distributor.csr")
//   Author CSR: RSA 2048, SHA256withRSA, subject just a CN (the developer name).
//   Distributor CSR: RSA 2048, SHA256withRSA, subject CN=TizenSDK + emailAddress=<account e-mail>, and an
//   extensionRequest with subjectAltName URIs "URN:tizen:packageid=" (empty) plus one
//   "URN:tizen:deviceid=<DUID>" per TV (the other project caps this at 10 DUIDs, unconfirmed).
//   Why both v1 and v3 for the distributor is not documented; we follow the observed order.
//
// DUID: the certificate DUID is what `sdb shell 0 getduid` prints on the TV (letters and digits, e.g.
//   "2DCKJITTLDPSA"; some firmware prints a warning line before it). It is NOT the "duid" ("uuid:...") in the TV's
//   http://<tv>:8001/api/v2/ reply, so Ensure() rejects anything that is not letters/digits (see IsValidDuid).
//
// CA chain: each .p12 holds the issued certificate + its Samsung intermediate CA, and the signature's KeyInfo
//   lists [leaf, intermediate] (the root stays on the TV). The intermediates (public certificates that ship with
//   Samsung's Certificate Extension, under tizen-studio-data/.../ca):
//     vd_tizen_dev_author_ca.cer  CN=Samsung VD Author CA, issued by CN=Tizen Developers Root Class
//                                 SHA-1 85206CDB1CFD4E56B63E9F6901056722FD6FCA76, valid to 2040-06-19
//     vd_tizen_dev_public2.crt    CN=VD DEVELOPER Public CA Class, issued by CN=VD DEVELOPER Public Root Class
//                                 SHA-1 1DC8103EA0242B3DFB96D874108F5E2DC3D4DD02, valid to 2029-06-16
//   (vd_tizen_dev_partner2.crt is the partner-level one; we only request public-level certificates.)
//   They are embedded as resources (see SamsungCertService.ResourceAuthorCa / ResourceDistributorCa) and pinned
//   by thumbprint here.
// ------------------------------------------------------------------------------------------------------------------
//
// Security: the access token lives only in memory (SamsungAccount; its ToString hides it) and is sent only in POST
// bodies over https. Private keys never leave the .p12 files, which are encrypted with random passwords; the
// passwords are stored with ProtectedData (CurrentUser). Nothing here logs. The sign-in listener binds 127.0.0.1
// only, answers one callback path, checks state and Host, and stops after one callback or the timeout.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

public class SamsungCertException : Exception
{
    public SamsungCertException(string message) : base(message) { }
    public SamsungCertException(string message, Exception inner) : base(message, inner) { }
}

public enum CertStatus { Ok, Missing, Expired, NeedsNewDistributor }

/** A signed-in Samsung account. Kept in memory only. */
public sealed class SamsungAccount
{
    public string AccessToken;
    public string UserId;
    public string Email;
    public override string ToString() { return "SamsungAccount(" + UserId + ")"; }   // never the token
}

/** Signs in to a Samsung account (real: SamsungSignIn). */
public interface ISamsungSignIn
{
    SamsungAccount SignIn(Action<string> openBrowser);
}

/** Samsung's certificate service (real: SamsungCertService). Requests return the issued certificate (PEM or DER). */
public interface ISamsungCertService
{
    byte[] RequestAuthor(SamsungAccount account, string csrPem);
    byte[] RequestDistributor(SamsungAccount account, string csrPem);
    X509Certificate2 AuthorCa();
    X509Certificate2 DistributorCa();
}

/** The author and distributor certificates (with private keys) and their CA certificates. */
public sealed class CertBundle
{
    public X509Certificate2 Author;
    public X509Certificate2[] AuthorChain = new X509Certificate2[0];
    public X509Certificate2 Distributor;
    public X509Certificate2[] DistributorChain = new X509Certificate2[0];
    public List<string> Duids { get { return Distributor == null ? new List<string>() : SamsungCert.DuidsOf(Distributor); } }

    /** Reads a .p12: the certificate with a private key, and the others as its chain. Keys stay in memory. */
    internal static void Read(byte[] p12, string password, out X509Certificate2 leaf, out X509Certificate2[] chain)
    {
        var all = new X509Certificate2Collection();
        all.Import(p12, password, X509KeyStorageFlags.EphemeralKeySet);
        leaf = all.Cast<X509Certificate2>().FirstOrDefault(c => c.HasPrivateKey);
        if (leaf == null) throw new CryptographicException("no private key in the .p12");
        var l = leaf;
        chain = all.Cast<X509Certificate2>().Where(c => c != l).ToArray();
    }
}

/** The saved bundle under %APPDATA%\Foxbloom\tv-cert: author/distributor .p12 + their DPAPI-protected passwords. */
public sealed class CertStore
{
    internal static readonly byte[] Entropy = Encoding.UTF8.GetBytes("Foxbloom TV certificate password v1");
    public readonly string Dir;

    public CertStore(string dir) { Dir = dir; }

    public static CertStore Default
    {
        get
        {
            return new CertStore(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Foxbloom", "tv-cert"));
        }
    }

    public void SaveAuthor(byte[] p12, string password) { Save("author", p12, password); }
    public void SaveDistributor(byte[] p12, string password) { Save("distributor", p12, password); }

    void Save(string name, byte[] p12, string password)
    {
        Directory.CreateDirectory(Dir);
        byte[] blob = ProtectedData.Protect(Encoding.UTF8.GetBytes(password), Entropy, DataProtectionScope.CurrentUser);
        WriteReplacing(Path.Combine(Dir, name + ".p12"), p12);
        WriteReplacing(Path.Combine(Dir, name + ".pwd"), blob);
    }

    static void WriteReplacing(string path, byte[] data)
    {
        string tmp = path + ".tmp";
        File.WriteAllBytes(tmp, data);
        if (File.Exists(path)) File.Delete(path);
        File.Move(tmp, path);
    }

    /** The saved bundle, or null when there is none or it can't be read. A readable author without a usable
     *  distributor comes back with Distributor == null (so only the distributor is renewed). */
    public CertBundle Load()
    {
        var b = new CertBundle();
        if (!TryRead("author", out b.Author, out b.AuthorChain)) return null;
        if (!TryRead("distributor", out b.Distributor, out b.DistributorChain)) b.Distributor = null;
        return b;
    }

    bool TryRead(string name, out X509Certificate2 leaf, out X509Certificate2[] chain)
    {
        leaf = null; chain = new X509Certificate2[0];
        try
        {
            string p12 = Path.Combine(Dir, name + ".p12"), pwd = Path.Combine(Dir, name + ".pwd");
            if (!File.Exists(p12) || !File.Exists(pwd)) return false;
            string password = Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(pwd), Entropy, DataProtectionScope.CurrentUser));
            CertBundle.Read(File.ReadAllBytes(p12), password, out leaf, out chain);
            return true;
        }
        catch (CryptographicException) { return false; }
        catch (IOException) { return false; }
        catch (UnauthorizedAccessException) { return false; }
    }
}

public static class SamsungCert
{
    const string DeviceIdUri = "URN:tizen:deviceid=";
    static readonly Regex DuidShape = new Regex("^[A-Za-z0-9]{8,64}$");

    /**
     * The certificates for installing on the TVs with these DUIDs (from `sdb shell 0 getduid`): the saved bundle
     * when it is valid and covers them, otherwise a Samsung sign-in in the user's browser (openBrowser gets the
     * https sign-in URL; pass SamsungCert.OpenInBrowser) and new certificates, saved for next time.
     * Blocks (up to the sign-in timeout); call it off the UI thread. Throws SamsungCertException with a plain message.
     */
    public static CertBundle Ensure(IEnumerable<string> duids, Action<string> openBrowser)
    {
        return Ensure(duids, openBrowser, CertStore.Default, new SamsungSignIn(), new SamsungCertService(), DateTime.UtcNow);
    }

    /** What Ensure would do for these DUIDs: Ok means no sign-in is needed. */
    public static CertStatus Status(IEnumerable<string> duids)
    {
        return Check(CertStore.Default.Load(), duids, DateTime.UtcNow);
    }

    public static CertBundle Ensure(IEnumerable<string> duids, Action<string> openBrowser, CertStore store,
        ISamsungSignIn signIn, ISamsungCertService service, DateTime nowUtc)
    {
        var wanted = (duids ?? new string[0]).Select(d => (d ?? "").Trim()).Distinct(StringComparer.Ordinal).ToList();
        if (wanted.Count == 0) throw new SamsungCertException("No TV DUID was given, so a distributor certificate can't be made.");
        foreach (var d in wanted)
            if (!IsValidDuid(d)) throw new SamsungCertException("\"" + d + "\" is not a TV DUID (letters and digits, from the TV's getduid).");

        var bundle = store.Load();
        var status = Check(bundle, wanted, nowUtc);
        if (status == CertStatus.Ok) return bundle;

        var account = signIn.SignIn(openBrowser);
        if (account == null || string.IsNullOrEmpty(account.AccessToken) || string.IsNullOrEmpty(account.UserId))
            throw new SamsungCertException("Samsung did not return a sign-in. Please try again.");
        if (string.IsNullOrEmpty(account.Email))
            throw new SamsungCertException("Your Samsung account has no e-mail address. Add one at account.samsung.com, then try again.");

        if (status != CertStatus.NeedsNewDistributor)
        {
            using (var key = new RSACng(2048))
            {
                byte[] issued = service.RequestAuthor(account, BuildAuthorCsr(key));
                string password;
                byte[] p12 = Pkcs12(issued, key, service.AuthorCa(), "author", out password);
                store.SaveAuthor(p12, password);
            }
        }
        else
        {
            // Keep the TVs the current distributor already covers, so the other TVs keep working.
            var kept = bundle.Duids;
            wanted = kept.Concat(wanted.Where(d => !kept.Contains(d))).ToList();
        }

        using (var key = new RSACng(2048))
        {
            byte[] issued = service.RequestDistributor(account, BuildDistributorCsr(key, account.Email, wanted));
            string password;
            byte[] p12 = Pkcs12(issued, key, service.DistributorCa(), "distributor", out password);
            store.SaveDistributor(p12, password);
        }

        var saved = store.Load();
        if (Check(saved, wanted, nowUtc) != CertStatus.Ok)
            throw new SamsungCertException("Samsung's new certificates don't cover this TV or have already expired. Please try again later.");
        return saved;
    }

    /** Missing: nothing usable saved. Expired: the author certificate is out of date (start over).
     *  NeedsNewDistributor: the distributor is missing, out of date, or lacks one of the DUIDs. */
    public static CertStatus Check(CertBundle bundle, IEnumerable<string> duids, DateTime nowUtc)
    {
        if (bundle == null || bundle.Author == null) return CertStatus.Missing;
        if (!Current(bundle.Author, nowUtc)) return CertStatus.Expired;
        if (bundle.Distributor == null || !Current(bundle.Distributor, nowUtc)) return CertStatus.NeedsNewDistributor;
        var have = DuidsOf(bundle.Distributor);
        foreach (var d in duids) if (!have.Contains(d)) return CertStatus.NeedsNewDistributor;
        return CertStatus.Ok;
    }

    static bool Current(X509Certificate2 c, DateTime nowUtc)
    {
        return c.NotBefore.ToUniversalTime() <= nowUtc && nowUtc < c.NotAfter.ToUniversalTime();
    }

    public static bool IsValidDuid(string duid) { return duid != null && DuidShape.IsMatch(duid); }

    /** The DUIDs in a distributor certificate: its subjectAltName URIs "URN:tizen:deviceid=<DUID>". */
    public static List<string> DuidsOf(X509Certificate2 cert)
    {
        var list = new List<string>();
        var ext = cert.Extensions["2.5.29.17"];
        if (ext == null) return list;
        byte[] der = ext.RawData;
        foreach (var name in Der.Children(der, Der.Read(der, 0)))
        {
            if (name.Tag != 0x86) continue;   // [6] uniformResourceIdentifier
            string uri = Encoding.ASCII.GetString(der, name.Start, name.Length);
            if (uri.StartsWith(DeviceIdUri, StringComparison.OrdinalIgnoreCase) && uri.Length > DeviceIdUri.Length)
                list.Add(uri.Substring(DeviceIdUri.Length));
        }
        return list;
    }

    // ---- CSRs and .p12 ---------------------------------------------------------------------------------------

    public static string BuildAuthorCsr(RSA key)
    {
        var req = new CertificateRequest(new X500DistinguishedName("CN=Foxbloom"), key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        return Pem("CERTIFICATE REQUEST", req.CreateSigningRequest());
    }

    public static string BuildDistributorCsr(RSA key, string email, IEnumerable<string> duids)
    {
        if (email.Any(ch => ch < 0x20 || ch > 0x7e)) throw new SamsungCertException("Your Samsung account's e-mail address can't be used in a certificate.");
        // CN=TizenSDK (UTF8String), emailAddress (IA5String), built directly so any address round-trips.
        byte[] subject = Der.Tlv(0x30,
            Der.Tlv(0x31, Der.Tlv(0x30, Der.OidCommonName, Der.Tlv(0x0c, Encoding.UTF8.GetBytes("TizenSDK")))),
            Der.Tlv(0x31, Der.Tlv(0x30, Der.OidEmail, Der.Tlv(0x16, Encoding.ASCII.GetBytes(email)))));
        var req = new CertificateRequest(new X500DistinguishedName(subject), key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        req.CertificateExtensions.Add(new X509Extension("2.5.29.17", DistributorSan(duids), false));
        return Pem("CERTIFICATE REQUEST", req.CreateSigningRequest());
    }

    /** subjectAltName: URN:tizen:packageid= (empty) and URN:tizen:deviceid=<DUID> for each TV. */
    public static byte[] DistributorSan(IEnumerable<string> duids)
    {
        var names = new List<byte[]> { Der.Tlv(0x86, Encoding.ASCII.GetBytes("URN:tizen:packageid=")) };
        foreach (var d in duids) names.Add(Der.Tlv(0x86, Encoding.ASCII.GetBytes(DeviceIdUri + d)));
        return Der.Tlv(0x30, names.ToArray());
    }

    /** The issued certificate + our key + the CA, as a .p12 under a fresh random password. */
    static byte[] Pkcs12(byte[] issued, RSA key, X509Certificate2 ca, string what, out string password)
    {
        X509Certificate2 cert;
        try { cert = new X509Certificate2(issued); }
        catch (CryptographicException e) { throw new SamsungCertException("Samsung's reply was not a " + what + " certificate.", e); }

        var mine = key.ExportParameters(false);
        var theirs = cert.GetRSAPublicKey();
        if (theirs == null || !theirs.ExportParameters(false).Modulus.SequenceEqual(mine.Modulus))
            throw new SamsungCertException("Samsung's " + what + " certificate is not for the key Foxbloom made.");
        if (!IssuedBy(cert, ca))
            throw new SamsungCertException("Samsung's " + what + " certificate does not come from " + ca.GetNameInfo(X509NameType.SimpleName, false) + ".");

        var withKey = cert.CopyWithPrivateKey(key);
        var bytes = new byte[32];
        using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes);
        password = Convert.ToBase64String(bytes);
        return new X509Certificate2Collection(new[] { withKey, new X509Certificate2(ca.RawData) }).Export(X509ContentType.Pkcs12, password);
    }

    /** True when the CA's key signed this certificate (checked offline, no chain building or downloads). */
    internal static bool IssuedBy(X509Certificate2 cert, X509Certificate2 ca)
    {
        if (cert.IssuerName.RawData.Length == 0 || !cert.IssuerName.RawData.SequenceEqual(ca.SubjectName.RawData)) return false;
        byte[] der = cert.RawData;
        var parts = Der.Children(der, Der.Read(der, 0));   // tbsCertificate, signatureAlgorithm, signatureValue
        if (parts.Count != 3) return false;
        string alg = Der.OidString(der, Der.Children(der, parts[1])[0]);
        HashAlgorithmName hash;
        if (alg == "1.2.840.113549.1.1.11") hash = HashAlgorithmName.SHA256;
        else if (alg == "1.2.840.113549.1.1.12") hash = HashAlgorithmName.SHA384;
        else if (alg == "1.2.840.113549.1.1.13") hash = HashAlgorithmName.SHA512;
        else if (alg == "1.2.840.113549.1.1.5") hash = HashAlgorithmName.SHA1;
        else return false;
        byte[] bits = Der.Content(der, parts[2]);
        var sig = new byte[bits.Length - 1];
        Array.Copy(bits, 1, sig, 0, sig.Length);
        var rsa = ca.GetRSAPublicKey();
        return rsa != null && rsa.VerifyData(Der.Whole(der, parts[0]), sig, hash, RSASignaturePadding.Pkcs1);
    }

    public static string Pem(string label, byte[] der)
    {
        string b64 = Convert.ToBase64String(der);
        var sb = new StringBuilder("-----BEGIN " + label + "-----\n");
        for (int i = 0; i < b64.Length; i += 64) sb.Append(b64.Substring(i, Math.Min(64, b64.Length - i))).Append('\n');
        return sb.Append("-----END " + label + "-----\n").ToString();
    }

    /** Opens an https URL in the user's default browser (never an embedded one, which could see the password). */
    public static void OpenInBrowser(string url)
    {
        Uri u;
        if (!Uri.TryCreate(url, UriKind.Absolute, out u) || u.Scheme != Uri.UriSchemeHttps)
            throw new ArgumentException("Only https addresses are opened.");
        Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true });
    }
}

/**
 * The Samsung account sign-in: the user's browser opens SignInGate, and Samsung's page POSTs the result to a
 * listener on 127.0.0.1:4794/signin/callback (see the research notes at the top).
 */
public sealed class SamsungSignIn : ISamsungSignIn
{
    public const string SignInGate = "https://account.samsung.com/accounts/be1dce529476c1a6d407c4c7578c31bd/signInGate";
    public const string ClientId = "v285zxnl3h";
    public const string State = "accountcheckdogeneratedstatetext";   // the value Samsung's extension uses (see notes)
    public const string CallbackPath = "/signin/callback";
    public int Port = 4794;
    public TimeSpan Timeout = TimeSpan.FromMinutes(5);
    const int MaxHeader = 16 * 1024, MaxBody = 64 * 1024;

    public string SignInUrl()
    {
        return SignInGate + "?locale=&clientId=" + ClientId +
            "&redirect_uri=" + Uri.EscapeDataString("http://localhost:" + Port + CallbackPath) +
            "&state=" + State + "&tokenType=TOKEN";
    }

    public SamsungAccount SignIn(Action<string> openBrowser)
    {
        var listener = new TcpListener(IPAddress.Loopback, Port);
        try { listener.Start(1); }
        catch (SocketException e)
        {
            throw new SamsungCertException("Port " + Port + " on this PC is in use, so the Samsung sign-in can't come back. " +
                "Close Tizen Studio or any other Samsung TV installer, then try again.", e);
        }
        try
        {
            openBrowser(SignInUrl());
            var deadline = DateTime.UtcNow + Timeout;
            while (true)
            {
                var left = deadline - DateTime.UtcNow;
                var pending = left > TimeSpan.Zero ? listener.BeginAcceptTcpClient(null, null) : null;
                if (pending == null || !pending.AsyncWaitHandle.WaitOne(left))
                    throw new SamsungCertException("No sign-in arrived within " + Describe(Timeout) +
                        ". If the Samsung page is still open, close it and click Install to try again.");
                using (var client = listener.EndAcceptTcpClient(pending))
                {
                    var account = Handle(client);
                    if (account != null) return account;
                }
            }
        }
        finally { listener.Stop(); }
    }

    static string Describe(TimeSpan t)
    {
        return t.TotalMinutes >= 1 ? Math.Round(t.TotalMinutes) + " minutes" : Math.Round(t.TotalSeconds, 1) + " seconds";
    }

    /** One request: anything other than the callback gets a 404 and we keep waiting; a callback ends the wait. */
    SamsungAccount Handle(TcpClient client)
    {
        var stream = client.GetStream();
        stream.ReadTimeout = 10000;
        stream.WriteTimeout = 10000;
        string method, path, host, body;
        try
        {
            if (!ReadRequest(stream, out method, out path, out host, out body)) { Reply(stream, 400, "Bad request."); return null; }
        }
        catch (IOException) { return null; }

        string query = "";
        int q = path.IndexOf('?');
        if (q >= 0) { query = path.Substring(q + 1); path = path.Substring(0, q); }
        if (path != CallbackPath) { Reply(stream, 404, "Not found."); return null; }

        SamsungAccount account = null;
        bool hostOk = host == "localhost:" + Port || host == "127.0.0.1:" + Port;
        if (hostOk && (method == "POST" || method == "GET"))
            account = ParseCallback(method == "POST" ? body : query);
        if (account == null)
        {
            Reply(stream, 400, "This sign-in reply was not valid. Go back to Foxbloom TV Setup and try again.");
            throw new SamsungCertException("The Samsung sign-in reply was not valid. Please try again.");
        }
        Reply(stream, 200, "Signed in to Samsung. You can close this tab and go back to Foxbloom TV Setup.");
        return account;
    }

    /** "code=<URL-encoded JSON>&state=..." to an account, or null when the state is wrong or a field is missing. */
    public static SamsungAccount ParseCallback(string form)
    {
        string code = null, state = null;
        foreach (var part in (form ?? "").Split('&'))
        {
            int eq = part.IndexOf('=');
            if (eq <= 0) continue;
            string k = part.Substring(0, eq), v = Uri.UnescapeDataString(part.Substring(eq + 1).Replace('+', ' '));
            if (k == "code") code = v;
            else if (k == "state") state = v;
        }
        if (state != State || string.IsNullOrEmpty(code)) return null;
        try
        {
            var json = new JavaScriptSerializer().DeserializeObject(code) as Dictionary<string, object>;
            if (json == null) return null;
            var a = new SamsungAccount { AccessToken = Str(json, "access_token"), UserId = Str(json, "userId"), Email = Str(json, "inputEmailID") };
            return string.IsNullOrEmpty(a.AccessToken) || string.IsNullOrEmpty(a.UserId) ? null : a;
        }
        catch (ArgumentException) { return null; }
        catch (InvalidOperationException) { return null; }
    }

    static string Str(Dictionary<string, object> d, string key)
    {
        object v;
        return d.TryGetValue(key, out v) && v != null ? v.ToString() : null;
    }

    static bool ReadRequest(NetworkStream s, out string method, out string path, out string host, out string body)
    {
        method = path = host = body = null;
        var buf = new MemoryStream();
        var one = new byte[4096];
        int headerEnd = -1;
        while (headerEnd < 0)
        {
            int n = s.Read(one, 0, one.Length);
            if (n <= 0) return false;
            buf.Write(one, 0, n);
            headerEnd = IndexOf(buf.GetBuffer(), (int)buf.Length, new byte[] { 13, 10, 13, 10 });
            if (headerEnd < 0 && buf.Length > MaxHeader) return false;
        }
        string head = Encoding.ASCII.GetString(buf.GetBuffer(), 0, headerEnd);
        var lines = head.Split(new[] { "\r\n" }, StringSplitOptions.None);
        var first = lines[0].Split(' ');
        if (first.Length != 3) return false;
        method = first[0]; path = first[1];
        int length = 0;
        foreach (var line in lines.Skip(1))
        {
            int c = line.IndexOf(':');
            if (c <= 0) continue;
            string name = line.Substring(0, c).Trim().ToLowerInvariant(), value = line.Substring(c + 1).Trim();
            if (name == "host") host = value.ToLowerInvariant();
            else if (name == "content-length" && (!int.TryParse(value, out length) || length < 0 || length > MaxBody)) return false;
        }
        var rest = new MemoryStream();
        rest.Write(buf.GetBuffer(), headerEnd + 4, (int)buf.Length - headerEnd - 4);
        while (rest.Length < length)
        {
            int n = s.Read(one, 0, one.Length);
            if (n <= 0) return false;
            rest.Write(one, 0, n);
        }
        body = Encoding.UTF8.GetString(rest.GetBuffer(), 0, Math.Min(length, (int)rest.Length));
        return true;
    }

    static int IndexOf(byte[] hay, int len, byte[] needle)
    {
        for (int i = 0; i + needle.Length <= len; i++)
        {
            int j = 0;
            while (j < needle.Length && hay[i + j] == needle[j]) j++;
            if (j == needle.Length) return i;
        }
        return -1;
    }

    static void Reply(NetworkStream s, int status, string text)
    {
        try
        {
            string html = "<!doctype html><meta charset=\"utf-8\"><title>Foxbloom</title>" +
                "<body style=\"font:18px Segoe UI,sans-serif;background:#1d2440;color:#fff;padding:48px\"><p>" +
                WebUtility.HtmlEncode(text) + "</p></body>";
            byte[] b = Encoding.UTF8.GetBytes(html);
            string reason = status == 200 ? "OK" : status == 404 ? "Not Found" : "Bad Request";
            byte[] h = Encoding.ASCII.GetBytes("HTTP/1.1 " + status + " " + reason + "\r\nContent-Type: text/html; charset=utf-8\r\n" +
                "Content-Length: " + b.Length + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n");
            s.Write(h, 0, h.Length);
            s.Write(b, 0, b.Length);
        }
        catch (IOException) { }
    }
}

/** Samsung's certificate service (endpoints and fields in the notes at the top). */
public sealed class SamsungCertService : ISamsungCertService
{
    public const string ResourceAuthorCa = "SamsungCA.vd_tizen_dev_author_ca.cer";
    public const string ResourceDistributorCa = "SamsungCA.vd_tizen_dev_public2.crt";
    const string AuthorCaSha1 = "85206CDB1CFD4E56B63E9F6901056722FD6FCA76";
    const string DistributorCaSha1 = "1DC8103EA0242B3DFB96D874108F5E2DC3D4DD02";

    readonly string authorUrl, distributorV1Url, distributorV3Url;

    public SamsungCertService()
        : this("https://svdca.samsungqbe.com/apis/v3/authors", "https://svdca.samsungqbe.com/apis/v1/distributors",
               "https://svdca.samsungqbe.com/apis/v3/distributors") { }

    public SamsungCertService(string authorUrl, string distributorV1Url, string distributorV3Url)
    {
        this.authorUrl = authorUrl; this.distributorV1Url = distributorV1Url; this.distributorV3Url = distributorV3Url;
    }

    public byte[] RequestAuthor(SamsungAccount account, string csrPem)
    {
        return Post(authorUrl, "author", new[] {
            Field("access_token", account.AccessToken), Field("user_id", account.UserId), Field("platform", "VD") }, "author.csr", csrPem);
    }

    public byte[] RequestDistributor(SamsungAccount account, string csrPem)
    {
        var fields = new[] {
            Field("access_token", account.AccessToken), Field("user_id", account.UserId), Field("privilege_level", "public"),
            Field("developer_type", "Individual"), Field("platform", "VD") };
        Post(distributorV1Url, "distributor", fields, "distributor.csr", csrPem);   // device profile; not used
        return Post(distributorV3Url, "distributor", fields, "distributor.csr", csrPem);
    }

    public X509Certificate2 AuthorCa() { return Embedded(ResourceAuthorCa, AuthorCaSha1); }
    public X509Certificate2 DistributorCa() { return Embedded(ResourceDistributorCa, DistributorCaSha1); }

    static X509Certificate2 Embedded(string name, string sha1)
    {
        using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
        {
            if (s == null) throw new SamsungCertException("This copy of Foxbloom TV Setup was built without Samsung's CA certificate (" + name + ").");
            var ms = new MemoryStream();
            s.CopyTo(ms);
            var cert = new X509Certificate2(ms.ToArray());
            if (!string.Equals(cert.Thumbprint, sha1, StringComparison.OrdinalIgnoreCase))
                throw new SamsungCertException("The Samsung CA certificate in this installer is not the expected one (" + name + ").");
            return cert;
        }
    }

    static KeyValuePair<string, string> Field(string k, string v) { return new KeyValuePair<string, string>(k, v ?? ""); }

    static byte[] Post(string url, string what, KeyValuePair<string, string>[] fields, string fileName, string file)
    {
        // A csc-built exe without a TargetFramework attribute starts with legacy TLS defaults; Samsung needs 1.2+.
        ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
        string boundary = "----FoxbloomBoundary" + Guid.NewGuid().ToString("N");
        var body = new MemoryStream();
        Action<string> w = text => { byte[] b = Encoding.UTF8.GetBytes(text); body.Write(b, 0, b.Length); };
        foreach (var f in fields)
            w("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + f.Key + "\"\r\n\r\n" + f.Value + "\r\n");
        w("--" + boundary + "\r\nContent-Disposition: form-data; name=\"csr\"; filename=\"" + fileName + "\"\r\n" +
          "Content-Type: application/octet-stream\r\n\r\n" + file + "\r\n--" + boundary + "--\r\n");

        try
        {
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.Method = "POST";
            req.ContentType = "multipart/form-data; boundary=" + boundary;
            req.Timeout = 60000;
            req.ReadWriteTimeout = 60000;
            req.AllowAutoRedirect = false;
            byte[] bytes = body.ToArray();
            req.ContentLength = bytes.Length;
            using (var s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
            using (var resp = (HttpWebResponse)req.GetResponse())
            using (var rs = resp.GetResponseStream())
            {
                if ((int)resp.StatusCode / 100 != 2)
                    throw new SamsungCertException("Samsung refused the " + what + " certificate request (HTTP " + (int)resp.StatusCode + ").");
                var ms = new MemoryStream();
                rs.CopyTo(ms);
                return ms.ToArray();
            }
        }
        catch (WebException e)
        {
            var resp = e.Response as HttpWebResponse;
            if (resp == null)
                throw new SamsungCertException("Couldn't reach Samsung to request the " + what + " certificate. Check the internet connection and try again.");
            string detail = "";
            try { using (var r = new StreamReader(resp.GetResponseStream(), Encoding.UTF8)) detail = ErrorText(r.ReadToEnd()); }
            catch (IOException) { }
            throw new SamsungCertException("Samsung refused the " + what + " certificate request (HTTP " + (int)resp.StatusCode + ")" +
                (detail.Length > 0 ? ": " + detail : "."));
        }
    }

    /** A short, printable message from Samsung's error body (its "message" field when it is JSON). */
    static string ErrorText(string body)
    {
        string text = body ?? "";
        try
        {
            var json = new JavaScriptSerializer().DeserializeObject(text) as Dictionary<string, object>;
            object m;
            if (json != null && (json.TryGetValue("message", out m) || json.TryGetValue("error_description", out m) || json.TryGetValue("error", out m)) && m != null)
                text = m.ToString();
        }
        catch (ArgumentException) { }
        catch (InvalidOperationException) { }
        text = new string(text.Where(ch => ch >= 0x20 && ch < 0x7f).ToArray()).Trim();
        return text.Length > 200 ? text.Substring(0, 200) + "..." : text;
    }
}

/** Just enough DER to build a subject and SAN and to read SANs, CSRs and certificate signatures. */
internal struct DerNode
{
    public byte Tag;
    public int Header;   // where the tag starts
    public int Start;    // where the content starts
    public int Length;   // content length
    public int End { get { return Start + Length; } }
}

internal static class Der
{
    public static readonly byte[] OidCommonName = { 0x06, 0x03, 0x55, 0x04, 0x03 };
    public static readonly byte[] OidEmail = { 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x01 };

    public static DerNode Read(byte[] b, int pos)
    {
        var n = new DerNode { Header = pos, Tag = b[pos] };
        int p = pos + 1;
        int len = b[p++];
        if (len >= 0x80)
        {
            int count = len & 0x7f;
            if (count == 0 || count > 4) throw new FormatException("unsupported DER length");
            len = 0;
            for (int i = 0; i < count; i++) len = (len << 8) | b[p++];
        }
        n.Start = p; n.Length = len;
        if (len < 0 || n.End > b.Length) throw new FormatException("truncated DER");
        return n;
    }

    public static List<DerNode> Children(byte[] b, DerNode parent)
    {
        var list = new List<DerNode>();
        int p = parent.Start;
        while (p < parent.End) { var c = Read(b, p); list.Add(c); p = c.End; }
        return list;
    }

    public static byte[] Content(byte[] b, DerNode n) { var r = new byte[n.Length]; Array.Copy(b, n.Start, r, 0, n.Length); return r; }
    public static byte[] Whole(byte[] b, DerNode n) { var r = new byte[n.End - n.Header]; Array.Copy(b, n.Header, r, 0, r.Length); return r; }

    public static string OidString(byte[] b, DerNode n)
    {
        var parts = new List<string>();
        long v = 0;
        for (int i = n.Start; i < n.End; i++)
        {
            v = (v << 7) | (uint)(b[i] & 0x7f);
            if ((b[i] & 0x80) != 0) continue;
            if (parts.Count == 0) { parts.Add(Math.Min(v / 40, 2).ToString()); parts.Add((v - Math.Min(v / 40, 2) * 40).ToString()); }
            else parts.Add(v.ToString());
            v = 0;
        }
        return string.Join(".", parts.ToArray());
    }

    public static byte[] Tlv(byte tag, params byte[][] parts)
    {
        int len = parts.Sum(p => p.Length);
        var head = new List<byte> { tag };
        if (len < 0x80) head.Add((byte)len);
        else
        {
            var lb = new List<byte>();
            for (int l = len; l > 0; l >>= 8) lb.Insert(0, (byte)(l & 0xff));
            head.Add((byte)(0x80 | lb.Count));
            head.AddRange(lb);
        }
        var r = new byte[head.Count + len];
        head.CopyTo(r);
        int at = head.Count;
        foreach (var p in parts) { Array.Copy(p, 0, r, at, p.Length); at += p.Length; }
        return r;
    }
}
