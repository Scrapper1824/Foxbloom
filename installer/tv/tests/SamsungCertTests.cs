// Tests for SamsungCert: the saved bundle, the DUID check, Ensure() with a fake Samsung, the sign-in callback
// listener and the certificate requests' form fields. Every certificate here is a throwaway made in the test.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Threading;

static partial class Tests
{
    // ---- test-only certificates -------------------------------------------------------------------------

    /** A self-signed test CA (with its key) that plays Samsung's author or distributor CA. */
    internal sealed class TestCa
    {
        public readonly RSA Key = new RSACng(2048);
        public readonly X509Certificate2 Cert;
        public TestCa(string name)
        {
            var req = new CertificateRequest("CN=" + name + " (Foxbloom test only)", Key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
            req.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
            Cert = req.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(5));
        }

        /** Issues a certificate for a CSR (PEM), keeping the CSR's subject and requested extensions (the SAN). */
        public byte[] Issue(string csrPem, DateTimeOffset notAfter)
        {
            byte[] der = PemBody(csrPem, "CERTIFICATE REQUEST");
            var root = Der.Read(der, 0);
            var info = Der.Children(der, root)[0];
            var parts = Der.Children(der, info);   // version, subject, spki, [0] attributes
            var subject = new X500DistinguishedName(Der.Whole(der, parts[1]));
            var spki = Der.Children(der, parts[2]);
            var alg = Der.Children(der, spki[0]);
            byte[] bits = Der.Content(der, spki[1]);
            var keyBits = new byte[bits.Length - 1];
            Array.Copy(bits, 1, keyBits, 0, keyBits.Length);      // drop the BIT STRING's unused-bits byte
            byte[] algParams = alg.Count > 1 ? Der.Whole(der, alg[1]) : new byte[] { 5, 0 };
            var pub = new PublicKey(new Oid("1.2.840.113549.1.1.1"), new AsnEncodedData(algParams), new AsnEncodedData(keyBits));
            var req = new CertificateRequest(subject, pub, HashAlgorithmName.SHA256);
            if (parts.Count > 3)
            {
                foreach (var attr in Der.Children(der, parts[3]))
                {
                    var a = Der.Children(der, attr);
                    if (Der.OidString(der, a[0]) != "1.2.840.113549.1.9.14") continue;   // extensionRequest
                    var exts = Der.Children(der, Der.Children(der, a[1])[0]);
                    foreach (var ext in exts)
                    {
                        var e = Der.Children(der, ext);
                        req.CertificateExtensions.Add(new X509Extension(Der.OidString(der, e[0]), Der.Content(der, e[e.Count - 1]), false));
                    }
                }
            }
            var serial = new byte[8];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(serial);
            serial[0] &= 0x7f;
            var cert = req.Create(Cert.SubjectName, X509SignatureGenerator.CreateForRSA(Key, RSASignaturePadding.Pkcs1),
                DateTimeOffset.UtcNow.AddHours(-1), notAfter, serial);
            return cert.RawData;
        }
    }

    static byte[] PemBody(string pem, string label)
    {
        string begin = "-----BEGIN " + label + "-----", end = "-----END " + label + "-----";
        int a = pem.IndexOf(begin, StringComparison.Ordinal), b = pem.IndexOf(end, StringComparison.Ordinal);
        if (a < 0 || b < 0) throw new Exception("not a PEM " + label + ": " + pem);
        return Convert.FromBase64String(pem.Substring(a + begin.Length, b - a - begin.Length).Trim());
    }

    /** A Samsung stand-in: issues certificates from two test CAs and counts the requests. */
    internal sealed class FakeSamsung : ISamsungCertService, ISamsungSignIn
    {
        public readonly TestCa AuthorCaKey = new TestCa("Test Author CA"), DistributorCaKey = new TestCa("Test Distributor CA");
        public int SignIns, AuthorRequests, DistributorRequests;
        public DateTimeOffset NotAfter = DateTimeOffset.UtcNow.AddYears(2);
        public string LastDistributorCsr;

        public SamsungAccount SignIn(Action<string> openBrowser)
        {
            SignIns++;
            return new SamsungAccount { AccessToken = "test-token", UserId = "test-user", Email = "owner@example.com" };
        }
        public byte[] RequestAuthor(SamsungAccount account, string csrPem) { AuthorRequests++; return AuthorCaKey.Issue(csrPem, NotAfter); }
        public byte[] RequestDistributor(SamsungAccount account, string csrPem)
        {
            DistributorRequests++;
            LastDistributorCsr = csrPem;
            return DistributorCaKey.Issue(csrPem, NotAfter);
        }
        public X509Certificate2 AuthorCa() { return new X509Certificate2(AuthorCaKey.Cert.RawData); }
        public X509Certificate2 DistributorCa() { return new X509Certificate2(DistributorCaKey.Cert.RawData); }
    }

    /** A complete bundle for the given DUIDs, as Ensure would make it with the fake Samsung. */
    internal static CertBundle MakeTestBundle(FakeSamsung samsung, string dir, params string[] duids)
    {
        var store = new CertStore(dir);
        return SamsungCert.Ensure(duids, delegate { }, store, samsung, samsung, DateTime.UtcNow);
    }

    static string NewTempDir()
    {
        var d = Path.Combine(Path.GetTempPath(), "foxbloom-tv-tests", "cert-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(d);
        return d;
    }

    static void Throws<T>(Action body, string contains, string what) where T : Exception
    {
        try { body(); }
        catch (T e)
        {
            if (contains != null && e.Message.IndexOf(contains, StringComparison.OrdinalIgnoreCase) < 0)
                throw new Exception(what + ": message <" + e.Message + "> lacks <" + contains + ">");
            return;
        }
        throw new Exception(what + ": expected " + typeof(T).Name);
    }

    const string DuidA = "ABCDEFGHIJ1234", DuidB = "ZYXWVUTSRQ9876";

    static void SamsungCertTests()
    {
        Test("saved bundle round-trips through ProtectedData; passwords are not on disk in plain text", delegate
        {
            var dir = NewTempDir();
            var samsung = new FakeSamsung();
            var made = MakeTestBundle(samsung, dir, DuidA);
            var loaded = new CertStore(dir).Load();
            True(loaded != null, "bundle did not load");
            Eq(made.Author.Thumbprint, loaded.Author.Thumbprint, "author");
            Eq(made.Distributor.Thumbprint, loaded.Distributor.Thumbprint, "distributor");
            True(loaded.Author.HasPrivateKey && loaded.Distributor.HasPrivateKey, "private keys");
            Eq(samsung.AuthorCaKey.Cert.Thumbprint, loaded.AuthorChain[0].Thumbprint, "author chain");
            Eq(samsung.DistributorCaKey.Cert.Thumbprint, loaded.DistributorChain[0].Thumbprint, "distributor chain");
            Eq(DuidA, string.Join(",", loaded.Duids.ToArray()), "DUIDs");

            var files = Directory.GetFiles(dir).Select(Path.GetFileName).OrderBy(f => f, StringComparer.Ordinal).ToArray();
            Eq("author.p12,author.pwd,distributor.p12,distributor.pwd", string.Join(",", files), "files");
            foreach (var name in new[] { "author", "distributor" })
            {
                byte[] blob = File.ReadAllBytes(Path.Combine(dir, name + ".pwd"));
                string password = Encoding.UTF8.GetString(ProtectedData.Unprotect(blob, CertStore.Entropy, DataProtectionScope.CurrentUser));
                True(password.Length >= 32, name + " password too short");
                True(Encoding.UTF8.GetString(blob).IndexOf(password, StringComparison.Ordinal) < 0, name + " password stored in plain text");
                var p12 = new X509Certificate2Collection();
                p12.Import(File.ReadAllBytes(Path.Combine(dir, name + ".p12")), password, X509KeyStorageFlags.EphemeralKeySet);
                Eq(2, p12.Count, name + ".p12 holds the certificate and its CA");
                Throws<CryptographicException>(delegate
                {
                    new X509Certificate2Collection().Import(File.ReadAllBytes(Path.Combine(dir, name + ".p12")), "", X509KeyStorageFlags.EphemeralKeySet);
                }, null, name + ".p12 without the password");
            }
            Directory.Delete(dir, true);
        });

        Test("missing, unreadable or half-saved bundles load as null", delegate
        {
            var dir = NewTempDir();
            True(new CertStore(dir).Load() == null, "empty folder");
            True(new CertStore(Path.Combine(dir, "nope")).Load() == null, "no folder");
            MakeTestBundle(new FakeSamsung(), dir, DuidA);
            File.WriteAllBytes(Path.Combine(dir, "author.pwd"), new byte[] { 1, 2, 3 });
            True(new CertStore(dir).Load() == null, "a damaged password file");
            Directory.Delete(dir, true);
        });

        Test("Check: a bundle missing a DUID reports NeedsNewDistributor", delegate
        {
            var dir = NewTempDir();
            var bundle = MakeTestBundle(new FakeSamsung(), dir, DuidA);
            var now = DateTime.UtcNow;
            Eq(CertStatus.Ok, SamsungCert.Check(bundle, new[] { DuidA }, now), "same TV");
            Eq(CertStatus.NeedsNewDistributor, SamsungCert.Check(bundle, new[] { DuidB }, now), "another TV");
            Eq(CertStatus.NeedsNewDistributor, SamsungCert.Check(bundle, new[] { DuidA, DuidB }, now), "one of two TVs is new");
            Eq(CertStatus.Missing, SamsungCert.Check(null, new[] { DuidA }, now), "nothing saved");
            Eq(CertStatus.Expired, SamsungCert.Check(bundle, new[] { DuidA }, now.AddYears(3)), "both expired");
            bundle.Distributor = null;
            Eq(CertStatus.NeedsNewDistributor, SamsungCert.Check(bundle, new[] { DuidA }, now), "no distributor");
            Directory.Delete(dir, true);
        });

        Test("DUIDs come from the distributor certificate's URN:tizen:deviceid= names", delegate
        {
            var dir = NewTempDir();
            var samsung = new FakeSamsung();
            var bundle = MakeTestBundle(samsung, dir, DuidA, DuidB);
            Eq(DuidA + "," + DuidB, string.Join(",", SamsungCert.DuidsOf(bundle.Distributor).ToArray()), "DUIDs");
            Eq(0, SamsungCert.DuidsOf(bundle.Author).Count, "author has none");
            True(samsung.LastDistributorCsr.StartsWith("-----BEGIN CERTIFICATE REQUEST-----\n", StringComparison.Ordinal), "CSR is PEM");
            var subject = bundle.Distributor.SubjectName.Decode(X500DistinguishedNameFlags.UseNewLines);
            True(subject.Contains("CN=TizenSDK") && subject.Contains("owner@example.com"), "distributor subject: " + subject);
            Directory.Delete(dir, true);
        });

        Test("DUIDs are checked: a /api/v2/ uuid is not a certificate DUID", delegate
        {
            True(SamsungCert.IsValidDuid(DuidA), "letters and digits");
            True(!SamsungCert.IsValidDuid("uuid:11111111-2222-3333-4444-555555555501"), "uuid");
            True(!SamsungCert.IsValidDuid(""), "empty");
            True(!SamsungCert.IsValidDuid(null), "null");
            True(!SamsungCert.IsValidDuid("ABC DEF GHIJ"), "spaces");
            var samsung = new FakeSamsung();
            var dir = NewTempDir();
            Throws<SamsungCertException>(delegate
            {
                SamsungCert.Ensure(new[] { "uuid:1111" }, delegate { }, new CertStore(dir), samsung, samsung, DateTime.UtcNow);
            }, "DUID", "bad DUID");
            Directory.Delete(dir, true);
            Eq(0, samsung.SignIns, "no sign-in for a bad DUID");
        });

        Test("Ensure: signs in once, reuses the saved bundle, renews only the distributor for a new TV", delegate
        {
            var dir = NewTempDir();
            var store = new CertStore(dir);
            var samsung = new FakeSamsung();
            var now = DateTime.UtcNow;
            var first = SamsungCert.Ensure(new[] { DuidA }, delegate { }, store, samsung, samsung, now);
            Eq(1, samsung.SignIns, "first: sign-in");
            Eq(1, samsung.AuthorRequests, "first: author");
            Eq(1, samsung.DistributorRequests, "first: distributor");

            var again = SamsungCert.Ensure(new[] { DuidA }, delegate { }, store, samsung, samsung, now);
            Eq(1, samsung.SignIns, "same TV: no sign-in");
            Eq(first.Distributor.Thumbprint, again.Distributor.Thumbprint, "same TV: same distributor");

            var second = SamsungCert.Ensure(new[] { DuidB }, delegate { }, store, samsung, samsung, now);
            Eq(2, samsung.SignIns, "new TV: sign-in");
            Eq(1, samsung.AuthorRequests, "new TV: the author certificate is kept (app updates need the same author)");
            Eq(2, samsung.DistributorRequests, "new TV: new distributor");
            Eq(first.Author.Thumbprint, second.Author.Thumbprint, "author kept");
            Eq(DuidA + "," + DuidB, string.Join(",", second.Duids.ToArray()), "the new distributor keeps the old TV too");

            samsung.NotAfter = DateTimeOffset.UtcNow.AddYears(10);
            var renewed = SamsungCert.Ensure(new[] { DuidA }, delegate { }, store, samsung, samsung, now.AddYears(3));
            Eq(3, samsung.SignIns, "expired: sign-in");
            Eq(2, samsung.AuthorRequests, "expired: new author");
            True(renewed.Author.Thumbprint != first.Author.Thumbprint, "expired: author replaced");
            Directory.Delete(dir, true);
        });

        Test("Ensure: a certificate that does not chain to the CA is refused", delegate
        {
            var samsung = new FakeSamsung();
            var other = new TestCa("Someone else");
            var wrong = new WrongIssuer { Inner = samsung, Other = other };
            var dir = NewTempDir();
            Throws<SamsungCertException>(delegate
            {
                SamsungCert.Ensure(new[] { DuidA }, delegate { }, new CertStore(dir), samsung, wrong, DateTime.UtcNow);
            }, "certificate", "wrong issuer");
            Directory.Delete(dir, true);
        });

        Test("sign-in: URL, 127.0.0.1 listener, stray requests ignored, callback read once", delegate
        {
            int port = FreePort();
            var signIn = new SamsungSignIn { Port = port, Timeout = TimeSpan.FromSeconds(10) };
            string opened = null;
            int strayStatus = 0;
            var account = signIn.SignIn(delegate (string url)
            {
                opened = url;
                Background(delegate
                {
                    strayStatus = Post(port, "GET", "/favicon.ico", "", "localhost:" + port).Status;
                    string code = Uri.EscapeDataString("{\"access_token\":\"tok-123\",\"userId\":\"u-9\",\"inputEmailID\":\"me@example.com\"}");
                    Post(port, "POST", "/signin/callback", "code=" + code + "&state=" + SamsungSignIn.State, "localhost:" + port);
                });
            });
            Eq(404, strayStatus, "stray request");
            True(opened.StartsWith("https://account.samsung.com/", StringComparison.Ordinal), "sign-in URL: " + opened);
            True(opened.Contains("clientId=v285zxnl3h"), "client id");
            True(opened.Contains("redirect_uri=" + Uri.EscapeDataString("http://localhost:" + port + "/signin/callback")), "redirect: " + opened);
            Eq("tok-123", account.AccessToken, "token");
            Eq("u-9", account.UserId, "user");
            Eq("me@example.com", account.Email, "email");
            True(account.ToString().IndexOf("tok-123", StringComparison.Ordinal) < 0, "ToString must not show the token");
            Throws<SocketException>(delegate { Post(port, "GET", "/", "", "localhost"); }, null, "listener stopped after the callback");
        });

        Test("sign-in: idle browser connections (preconnects) don't hold up the callback", delegate
        {
            int port = FreePort();
            var signIn = new SamsungSignIn { Port = port, Timeout = TimeSpan.FromSeconds(20) };
            var idle = new List<TcpClient>();
            var sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                var account = signIn.SignIn(delegate
                {
                    for (int i = 0; i < 3; i++)   // like Chrome/Edge preconnect sockets: open, send nothing
                    {
                        var c = new TcpClient();
                        c.Connect(IPAddress.Loopback, port);
                        idle.Add(c);
                    }
                    string code = Uri.EscapeDataString("{\"access_token\":\"tok-idle\",\"userId\":\"u-1\",\"inputEmailID\":\"me@example.com\"}");
                    Background(delegate { Post(port, "POST", "/signin/callback", "code=" + code + "&state=" + SamsungSignIn.State, "localhost:" + port); });
                });
                sw.Stop();
                Eq("tok-idle", account.AccessToken, "token");
                True(sw.Elapsed < TimeSpan.FromSeconds(1.5), "took " + sw.Elapsed.TotalSeconds + " s with idle connections open");
            }
            finally { foreach (var c in idle) c.Close(); }
        });

        Test("sign-in: a callback with the wrong state, or another Host, is refused", delegate
        {
            int port = FreePort();
            var signIn = new SamsungSignIn { Port = port, Timeout = TimeSpan.FromSeconds(10) };
            string code = Uri.EscapeDataString("{\"access_token\":\"t\",\"userId\":\"u\",\"inputEmailID\":\"e@x.y\"}");
            Throws<SamsungCertException>(delegate
            {
                signIn.SignIn(delegate
                {
                    Background(delegate { Post(port, "POST", "/signin/callback", "code=" + code + "&state=forged", "localhost:" + port); });
                });
            }, "not valid", "wrong state");

            port = FreePort();
            signIn = new SamsungSignIn { Port = port, Timeout = TimeSpan.FromSeconds(10) };
            Throws<SamsungCertException>(delegate
            {
                signIn.SignIn(delegate
                {
                    Background(delegate { Post(port, "POST", "/signin/callback", "code=" + code + "&state=" + SamsungSignIn.State, "evil.example:" + port); });
                });
            }, "not valid", "rebinding Host");
        });

        Test("sign-in: no callback before the timeout gives a clear message and frees the port", delegate
        {
            int port = FreePort();
            var signIn = new SamsungSignIn { Port = port, Timeout = TimeSpan.FromMilliseconds(400) };
            Throws<SamsungCertException>(delegate { signIn.SignIn(delegate { }); }, "no sign-in", "timeout");
            var l = new TcpListener(IPAddress.Loopback, port);
            l.Start(); l.Stop();
        });

        Test("sign-in: a busy port and a non-https sign-in URL are reported", delegate
        {
            int port = FreePort();
            var busy = new TcpListener(IPAddress.Loopback, port);
            busy.Start();
            try
            {
                Throws<SamsungCertException>(delegate { new SamsungSignIn { Port = port }.SignIn(delegate { }); }, port.ToString(), "busy port");
            }
            finally { busy.Stop(); }
            Throws<ArgumentException>(delegate { SamsungCert.OpenInBrowser("http://example.com/"); }, null, "http");
            Throws<ArgumentException>(delegate { SamsungCert.OpenInBrowser("file:///C:/Windows/notepad.exe"); }, null, "file");
        });

        Test("certificate requests: multipart fields as Samsung's tools send them, token never in the URL", delegate
        {
            var seen = new List<string>();
            int port = FreePort();
            var l = new HttpListener();
            l.Prefixes.Add("http://127.0.0.1:" + port + "/");
            l.Start();
            var ca = new TestCa("Test CA");
            var t = new Thread(delegate ()
            {
                try
                {
                    for (int i = 0; i < 3; i++)
                    {
                        var c = l.GetContext();
                        string body = new StreamReader(c.Request.InputStream, Encoding.UTF8).ReadToEnd();
                        lock (seen) seen.Add(c.Request.HttpMethod + " " + c.Request.Url.PathAndQuery + "\n" + c.Request.ContentType + "\n" + body);
                        byte[] reply;
                        if (c.Request.Url.AbsolutePath.EndsWith("/v1/distributors")) reply = Encoding.UTF8.GetBytes("<profile/>");
                        else
                        {
                            int a = body.IndexOf("-----BEGIN CERTIFICATE REQUEST-----", StringComparison.Ordinal);
                            int b = body.IndexOf("-----END CERTIFICATE REQUEST-----", StringComparison.Ordinal) + 33;
                            reply = Encoding.ASCII.GetBytes(SamsungCert.Pem("CERTIFICATE", ca.Issue(body.Substring(a, b - a), DateTimeOffset.UtcNow.AddYears(1))));
                        }
                        c.Response.OutputStream.Write(reply, 0, reply.Length);
                        c.Response.Close();
                    }
                }
                catch { }
            });
            t.IsBackground = true; t.Start();
            try
            {
                string root = "http://127.0.0.1:" + port + "/apis";
                var service = new SamsungCertService(root + "/v3/authors", root + "/v1/distributors", root + "/v3/distributors");
                var account = new SamsungAccount { AccessToken = "secret-token", UserId = "user-1", Email = "me@example.com" };
                string csr;
                using (var key = new RSACng(2048)) csr = SamsungCert.BuildAuthorCsr(key);
                var author = new X509Certificate2(service.RequestAuthor(account, csr));
                True(author.Subject.Contains("CN="), "author certificate parsed");
                using (var key = new RSACng(2048)) csr = SamsungCert.BuildDistributorCsr(key, account.Email, new[] { DuidA });
                var dist = new X509Certificate2(service.RequestDistributor(account, csr));
                Eq(DuidA, string.Join(",", SamsungCert.DuidsOf(dist).ToArray()), "distributor DUIDs");
            }
            finally { l.Stop(); }
            Eq(3, seen.Count, "requests (author, distributor v1, distributor v3)");
            Func<string, string, bool> field = (req, name) => req.Contains("name=\"" + name + "\"");
            Func<string, string, string, bool> value = (req, name, v) =>
                req.Contains("name=\"" + name + "\"\r\n\r\n" + v + "\r\n");
            True(seen[0].StartsWith("POST /apis/v3/authors\n", StringComparison.Ordinal), "author path: " + seen[0].Split('\n')[0]);
            True(seen[1].StartsWith("POST /apis/v1/distributors\n", StringComparison.Ordinal), "v1 path");
            True(seen[2].StartsWith("POST /apis/v3/distributors\n", StringComparison.Ordinal), "v3 path");
            foreach (var req in seen)
            {
                True(req.Split('\n')[1].StartsWith("multipart/form-data; boundary=", StringComparison.Ordinal), "multipart");
                True(value(req, "access_token", "secret-token"), "access_token");
                True(value(req, "user_id", "user-1"), "user_id");
                True(value(req, "platform", "VD"), "platform");
                True(field(req, "csr") && req.Contains("filename=\""), "csr file");
                True(req.Split('\n')[0].IndexOf("secret-token", StringComparison.Ordinal) < 0, "token in URL");
            }
            True(value(seen[1], "privilege_level", "public") && value(seen[2], "privilege_level", "public"), "privilege_level");
            True(value(seen[1], "developer_type", "Individual") && value(seen[2], "developer_type", "Individual"), "developer_type");
            True(!field(seen[0], "privilege_level"), "author request has no privilege level");
        });

        Test("certificate requests: Samsung's error reply becomes a plain message without the token", delegate
        {
            int port = FreePort();
            var l = new HttpListener();
            l.Prefixes.Add("http://127.0.0.1:" + port + "/");
            l.Start();
            var t = new Thread(delegate ()
            {
                try
                {
                    var c = l.GetContext();
                    c.Response.StatusCode = 401;
                    var b = Encoding.UTF8.GetBytes("{\"message\":\"Invalid access token\"}");
                    c.Response.OutputStream.Write(b, 0, b.Length);
                    c.Response.Close();
                }
                catch { }
            });
            t.IsBackground = true; t.Start();
            try
            {
                string root = "http://127.0.0.1:" + port;
                var service = new SamsungCertService(root + "/a", root + "/b", root + "/c");
                var account = new SamsungAccount { AccessToken = "secret-token", UserId = "u", Email = "e@x.y" };
                try
                {
                    service.RequestAuthor(account, "csr");
                    throw new Exception("expected SamsungCertException");
                }
                catch (SamsungCertException e)
                {
                    True(e.Message.Contains("401") && e.Message.Contains("Invalid access token"), "message: " + e.Message);
                    True(e.ToString().IndexOf("secret-token", StringComparison.Ordinal) < 0, "token in the exception");
                }
            }
            finally { l.Stop(); }
        });
    }

    /** Hands back distributor certificates issued by a CA other than the one it claims. */
    sealed class WrongIssuer : ISamsungCertService
    {
        public FakeSamsung Inner; public TestCa Other;
        public byte[] RequestAuthor(SamsungAccount a, string csr) { return Inner.RequestAuthor(a, csr); }
        public byte[] RequestDistributor(SamsungAccount a, string csr) { return Other.Issue(csr, DateTimeOffset.UtcNow.AddYears(1)); }
        public X509Certificate2 AuthorCa() { return Inner.AuthorCa(); }
        public X509Certificate2 DistributorCa() { return Inner.DistributorCa(); }
    }

    /** Runs a test helper off the main thread; a failure there shows up as the main thread timing out. */
    static void Background(Action body)
    {
        ThreadPool.QueueUserWorkItem(delegate { try { body(); } catch { } });
    }

    static int FreePort()
    {
        var l = new TcpListener(IPAddress.Loopback, 0);
        l.Start();
        int p = ((IPEndPoint)l.LocalEndpoint).Port;
        l.Stop();
        return p;
    }

    sealed class RawReply { public int Status; public string Body; }

    /** A raw HTTP/1.1 request to 127.0.0.1 (so the Host header can be anything). */
    static RawReply Post(int port, string method, string path, string body, string host)
    {
        using (var c = new TcpClient())
        {
            c.Connect(IPAddress.Loopback, port);
            var s = c.GetStream();
            s.ReadTimeout = 5000;
            byte[] b = Encoding.UTF8.GetBytes(body);
            string head = method + " " + path + " HTTP/1.1\r\nHost: " + host + "\r\n" +
                (method == "POST" ? "Content-Type: application/x-www-form-urlencoded\r\nContent-Length: " + b.Length + "\r\n" : "") +
                "Connection: close\r\n\r\n";
            byte[] h = Encoding.ASCII.GetBytes(head);
            s.Write(h, 0, h.Length);
            s.Write(b, 0, b.Length);
            string reply = new StreamReader(s, Encoding.UTF8).ReadToEnd();
            var r = new RawReply();
            var first = reply.Split('\n')[0].Split(' ');
            r.Status = first.Length > 1 ? int.Parse(first[1]) : 0;
            int i = reply.IndexOf("\r\n\r\n", StringComparison.Ordinal);
            r.Body = i >= 0 ? reply.Substring(i + 4) : "";
            return r;
        }
    }
}
