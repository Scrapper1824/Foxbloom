// Tests for Sdb: the exact command lines it runs (through a fake runner) and the plain messages it gives for
// sdb's known failure outputs.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

static partial class Tests
{
    sealed class FakeSdb : ISdbRunner
    {
        public readonly List<string> Calls = new List<string>();
        public readonly List<byte[]> Pushed = new List<byte[]>();
        public Func<string, SdbResult> Reply = a => new SdbResult(0, "");
        public SdbResult Run(string[] args)
        {
            string line = string.Join(" ", args);
            Calls.Add(line);
            if (args.Length > 2 && args[2] == "push") Pushed.Add(File.ReadAllBytes(args[3]));
            return Reply(line);
        }
    }

    static FakeSdb HappySdb()
    {
        var f = new FakeSdb();
        f.Reply = a =>
        {
            if (a.StartsWith("connect")) return new SdbResult(0, "connected to 192.168.1.50:26101");
            if (a.EndsWith("getduid")) return new SdbResult(0, "ABCDEFGHIJKLM\r\n");
            if (a.Contains(" push ")) return new SdbResult(0, "1 file pushed. 2 KB/s (3 bytes in 0.001s)");
            if (a.Contains("vd_appinstall")) return new SdbResult(0, "app_id[FoxbloomTV.foxbloom] install success[0]");
            if (a.Contains("was_execute")) return new SdbResult(0, "launch app: FoxbloomTV.foxbloom");
            return new SdbResult(0, "");
        };
        return f;
    }

    static void SdbTests()
    {
        const string Remote = "/home/owner/share/tmp/sdk_tools/Foxbloom.wgt";

        Test("Sdb.Install runs connect, push, vd_appinstall and was_execute with the exact command lines", delegate
        {
            var f = HappySdb();
            new Sdb(f).InstallTo("192.168.1.50", new byte[] { 1, 2, 3 }, Sdb.DefaultAppId);
            Eq(4, f.Calls.Count, "number of sdb calls");
            Eq("connect 192.168.1.50:26101", f.Calls[0], "connect");
            True(f.Calls[1].StartsWith("-s 192.168.1.50:26101 push ") && f.Calls[1].EndsWith(" " + Remote), "push: " + f.Calls[1]);
            Eq("-s 192.168.1.50:26101 shell 0 vd_appinstall FoxbloomTV.foxbloom " + Remote, f.Calls[2], "install");
            Eq("-s 192.168.1.50:26101 shell 0 was_execute FoxbloomTV.foxbloom", f.Calls[3], "launch");
            Eq("1,2,3", string.Join(",", f.Pushed[0].Select(b => b.ToString()).ToArray()), "pushed bytes");
        });

        Test("Sdb.Install uses the app id it is given", delegate
        {
            var f = HappySdb();
            new Sdb(f).InstallTo("10.0.0.5", new byte[] { 9 }, "Other.app");
            True(f.Calls[2].Contains("vd_appinstall Other.app "), f.Calls[2]);
            Eq("-s 10.0.0.5:26101 shell 0 was_execute Other.app", f.Calls[3], "launch");
        });

        Test("Sdb.GetDuid connects, asks the TV and returns the trimmed DUID", delegate
        {
            var f = HappySdb();
            Eq("ABCDEFGHIJKLM", new Sdb(f).GetDuid("192.168.1.50"), "duid");
            Eq("connect 192.168.1.50:26101", f.Calls[0], "connect");
            Eq("-s 192.168.1.50:26101 shell 0 getduid", f.Calls[1], "getduid");
        });

        Test("Sdb.GetDuid rejects an answer that is not a DUID", delegate
        {
            var f = HappySdb();
            var inner = f.Reply;
            f.Reply = a => a.EndsWith("getduid") ? new SdbResult(0, "error: closed") : inner(a);
            Throws<TvInstallException>(delegate { new Sdb(f).GetDuid("192.168.1.50"); }, "Developer Mode", "bad duid");
        });

        Test("a TV that refuses the connection gives a plain message and nothing else runs", delegate
        {
            foreach (var output in new[] { "failed to connect to 192.168.1.50:26101", "cannot connect to 192.168.1.50:26101", "error: cannot connect" })
            {
                var f = HappySdb();
                f.Reply = a => new SdbResult(0, output);
                Throws<TvInstallException>(delegate { new Sdb(f).InstallTo("192.168.1.50", new byte[] { 1 }, Sdb.DefaultAppId); }, "Developer Mode", "output: " + output);
                Eq(1, f.Calls.Count, "stopped after connect");
            }
        });

        Test("a failed push is reported", delegate
        {
            var f = HappySdb();
            var inner = f.Reply;
            f.Reply = a => a.Contains(" push ") ? new SdbResult(1, "failed to copy 'x' to '" + Remote + "': Permission denied") : inner(a);
            Throws<TvInstallException>(delegate { new Sdb(f).InstallTo("192.168.1.50", new byte[] { 1 }, Sdb.DefaultAppId); }, "copy", "push failure");
            Eq(2, f.Calls.Count, "stopped after push");
        });

        Test("install failure with a code is turned into a plain message that includes the code", delegate
        {
            var f = HappySdb();
            var inner = f.Reply;
            f.Reply = a => a.Contains("vd_appinstall") ? new SdbResult(0, "app_id[FoxbloomTV.foxbloom] install failed[118, -12], reason: Check certificate error : :Invalid certificate chain with no root") : inner(a);
            try { new Sdb(f).InstallTo("192.168.1.50", new byte[] { 1 }, Sdb.DefaultAppId); throw new Exception("expected TvInstallException"); }
            catch (TvInstallException e)
            {
                True(e.Message.Contains("certificate"), "mentions the certificate: " + e.Message);
                True(e.Message.Contains("118"), "includes the code: " + e.Message);
            }
            Eq(3, f.Calls.Count, "never launched");
        });

        Test("an unrecognised install failure still reports sdb's own words", delegate
        {
            var f = HappySdb();
            var inner = f.Reply;
            f.Reply = a => a.Contains("vd_appinstall") ? new SdbResult(0, "app_id[FoxbloomTV.foxbloom] install failed[22, -1], reason: something odd") : inner(a);
            try { new Sdb(f).InstallTo("192.168.1.50", new byte[] { 1 }, Sdb.DefaultAppId); throw new Exception("expected TvInstallException"); }
            catch (TvInstallException e) { True(e.Message.Contains("22") && e.Message.Contains("something odd"), e.Message); }
        });

        Test("an install with no success line is a failure", delegate
        {
            var f = HappySdb();
            var inner = f.Reply;
            f.Reply = a => a.Contains("vd_appinstall") ? new SdbResult(0, "") : inner(a);
            Throws<TvInstallException>(delegate { new Sdb(f).InstallTo("192.168.1.50", new byte[] { 1 }, Sdb.DefaultAppId); }, "didn't confirm", "silent install");
        });

        Test("a launch failure is reported, though the app is installed", delegate
        {
            var f = HappySdb();
            var inner = f.Reply;
            f.Reply = a => a.Contains("was_execute") ? new SdbResult(1, "launch failed") : inner(a);
            Throws<TvInstallException>(delegate { new Sdb(f).InstallTo("192.168.1.50", new byte[] { 1 }, Sdb.DefaultAppId); }, "installed", "launch failure");
        });

        Test("an address that is not an IP is refused before sdb runs", delegate
        {
            var f = HappySdb();
            Throws<TvInstallException>(delegate { new Sdb(f).InstallTo("192.168.1.50 && calc", new byte[] { 1 }, Sdb.DefaultAppId); }, "address", "bad ip");
            Eq(0, f.Calls.Count, "nothing run");
        });

        Test("InstallAndStop stops the sdb server after a successful install", delegate
        {
            var f = HappySdb();
            new Sdb(f).InstallAndStop("192.168.1.50", new byte[] { 1 }, Sdb.DefaultAppId);
            Eq("kill-server", f.Calls[f.Calls.Count - 1], "last call");
        });

        Test("InstallAndStop stops the sdb server after a failed install too", delegate
        {
            var f = HappySdb();
            f.Reply = a => new SdbResult(0, "failed to connect");
            Throws<TvInstallException>(delegate { new Sdb(f).InstallAndStop("192.168.1.50", new byte[] { 1 }, Sdb.DefaultAppId); }, "connect", "failure");
            Eq("kill-server", f.Calls[f.Calls.Count - 1], "last call");
        });

        Test("a failing kill-server does not hide the install result", delegate
        {
            var f = HappySdb();
            var inner = f.Reply;
            f.Reply = a => { if (a == "kill-server") throw new TvInstallException("boom"); return inner(a); };
            new Sdb(f).InstallAndStop("192.168.1.50", new byte[] { 1 }, Sdb.DefaultAppId);
        });

        Test("sdb.exe extraction reuses only a byte-identical file", delegate
        {
            string dir = Path.Combine(Path.GetTempPath(), "foxbloom-sdb-test-" + Guid.NewGuid().ToString("N"));
            try
            {
                var data = new byte[] { 1, 2, 3, 4, 5 };
                string a = Sdb.Extract(data, dir);
                Eq(true, File.ReadAllBytes(a).SequenceEqual(data), "first extraction");
                Eq(a, Sdb.Extract(data, dir), "reused path");
                File.WriteAllBytes(a, new byte[] { 9, 9 });   // a stale or damaged copy
                string b = Sdb.Extract(data, dir);
                Eq(true, File.ReadAllBytes(b).SequenceEqual(data), "damaged copy replaced");
                string c = Sdb.Extract(new byte[] { 7, 7, 7 }, dir);
                True(c != a, "different sdb gets its own file");
            }
            finally { try { Directory.Delete(dir, true); } catch { } }
        });

        Test("the process runner returns even when a grandchild keeps the pipes open", delegate
        {
            // cmd starts a background ping that inherits cmd's redirected output, then cmd exits at once.
            var runner = new SdbProcessRunner(Path.Combine(Environment.SystemDirectory, "cmd.exe"), TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(1));
            var sw = System.Diagnostics.Stopwatch.StartNew();
            runner.Run(new[] { "/c", "start", "/b", "ping", "-n", "12", "127.0.0.1" });
            sw.Stop();
            True(sw.Elapsed < TimeSpan.FromSeconds(6), "took " + sw.Elapsed.TotalSeconds + " s");
        });
    }
}
