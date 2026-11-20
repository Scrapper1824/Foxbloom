// Tests for Adb: the exact command lines it runs (through a fake runner) and the plain messages it gives for
// adb's known failure outputs. adb often exits 0 on failure, so most cases here reply with exit code 0.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

static partial class Tests
{
    sealed class FakeAdb : ISdbRunner
    {
        public readonly List<string> Calls = new List<string>();
        public Func<string, SdbResult> Reply = a => new SdbResult(0, "");
        public SdbResult Run(string[] args) { string line = string.Join(" ", args); Calls.Add(line); return Reply(line); }
    }

    static FakeAdb HappyAdb()
    {
        var f = new FakeAdb();
        f.Reply = a =>
        {
            if (a.StartsWith("pair ")) return new SdbResult(0, "Successfully paired to 192.168.1.20:37123 [guid=adb-ABC-xyz]");
            if (a.StartsWith("connect ")) return new SdbResult(0, "connected to 192.168.1.20:5555");
            if (a.EndsWith("ro.product.manufacturer")) return new SdbResult(0, "Google\r\n");
            if (a.EndsWith("ro.product.model")) return new SdbResult(0, "Chromecast\r\n");
            if (a.EndsWith("ro.build.version.sdk")) return new SdbResult(0, "34\r\n");
            if (a.Contains(" install ")) return new SdbResult(0, "Performing Streamed Install\r\nSuccess\r\n");
            if (a.Contains(" am start ")) return new SdbResult(0, "Starting: Intent { cmp=org.foxbloom.tv/.MainActivity }");
            return new SdbResult(0, "");
        };
        return f;
    }

    static void AdbTests()
    {
        const string Tv = "192.168.1.20:5555";

        Test("Adb.Pair runs adb pair with the address and code", delegate
        {
            var f = HappyAdb();
            new Adb(f).Pair("192.168.1.20:37123", "123456");
            Eq("pair 192.168.1.20:37123 123456", f.Calls[0], "pair");
        });

        Test("a pairing that fails (even with exit code 0) says the code didn't work", delegate
        {
            foreach (var output in new[] { "Failed: Unable to start pairing client.", "error: protocol fault (couldn't read status): Success", "Failed: Wrong password or connection was dropped." })
            {
                var f = HappyAdb();
                f.Reply = a => new SdbResult(0, output);
                Throws<TvInstallException>(delegate { new Adb(f).Pair("192.168.1.20:37123", "000000"); }, "That code didn't work", output);
            }
        });

        Test("Adb.Connect runs adb connect and accepts 'connected' and 'already connected'", delegate
        {
            foreach (var output in new[] { "connected to 192.168.1.20:5555", "already connected to 192.168.1.20:5555" })
            {
                var f = HappyAdb();
                f.Reply = a => new SdbResult(0, output);
                new Adb(f).Connect(Tv);
                Eq("connect " + Tv, f.Calls[0], "connect");
            }
        });

        Test("a TV that refuses the connection gives a plain message naming the address", delegate
        {
            foreach (var output in new[] { "failed to connect to '192.168.1.20:5555': Connection refused", "cannot connect to 192.168.1.20:5555: No connection could be made", "error: connection refused" })
            {
                var f = HappyAdb();
                f.Reply = a => new SdbResult(0, output);
                Throws<TvInstallException>(delegate { new Adb(f).Connect(Tv); }, "didn't answer at " + Tv, output);
            }
        });

        Test("a TV that hasn't allowed this PC gives the Allow message", delegate
        {
            foreach (var output in new[] { "failed to authenticate to 192.168.1.20:5555", "error: device unauthorized.\r\nThis adbd's $ADB_VENDOR_KEYS is not set", "192.168.1.20:5555 unauthorized" })
            {
                var f = HappyAdb();
                f.Reply = a => new SdbResult(0, output);
                Throws<TvInstallException>(delegate { new Adb(f).Connect(Tv); }, "hasn't allowed this PC", output);
            }
        });

        Test("Adb.Describe asks for the three properties and builds a name", delegate
        {
            var f = HappyAdb();
            var info = new Adb(f).Describe(Tv);
            Eq("-s " + Tv + " shell getprop ro.product.manufacturer", f.Calls[0], "manufacturer");
            Eq("-s " + Tv + " shell getprop ro.product.model", f.Calls[1], "model");
            Eq("-s " + Tv + " shell getprop ro.build.version.sdk", f.Calls[2], "sdk");
            Eq(Tv, info.Target, "target");
            Eq("Google Chromecast", info.Name, "name");
            Eq("Chromecast", info.Model, "model");
            Eq(34, info.Sdk, "sdk");
        });

        Test("Adb.Describe doesn't repeat the maker when the model already starts with it", delegate
        {
            var f = HappyAdb();
            var inner = f.Reply;
            f.Reply = a => a.EndsWith("ro.product.manufacturer") ? new SdbResult(0, "Sony\r\n") : a.EndsWith("ro.product.model") ? new SdbResult(0, "Sony BRAVIA 4K\r\n") : inner(a);
            Eq("Sony BRAVIA 4K", new Adb(f).Describe(Tv).Name, "name");
        });

        Test("Adb.Describe on an unauthorized device gives the Allow message", delegate
        {
            var f = HappyAdb();
            f.Reply = a => new SdbResult(1, "error: device unauthorized.");
            Throws<TvInstallException>(delegate { new Adb(f).Describe(Tv); }, "hasn't allowed this PC", "unauthorized");
        });

        Test("Adb.Describe with no usable answer is a plain failure", delegate
        {
            var f = HappyAdb();
            f.Reply = a => new SdbResult(1, "error: device offline");
            Throws<TvInstallException>(delegate { new Adb(f).Describe(Tv); }, "didn't answer", "offline");
        });

        Test("Adb.Install runs install -r then starts the app", delegate
        {
            var f = HappyAdb();
            new Adb(f).Install(Tv, @"C:\tmp\Foxbloom.apk");
            Eq(2, f.Calls.Count, "calls");
            Eq("-s " + Tv + @" install -r C:\tmp\Foxbloom.apk", f.Calls[0], "install");
            Eq("-s " + Tv + " shell am start -n org.foxbloom.tv/.MainActivity", f.Calls[1], "launch");
        });

        Test("only adb install goes through the install runner (it has the longer time limit)", delegate
        {
            var quick = HappyAdb();
            var slow = HappyAdb();
            var adb = new Adb(quick, slow);
            adb.Connect(Tv);
            adb.Install(Tv, @"C:\tmp\Foxbloom.apk");
            Eq(1, slow.Calls.Count, "install runner calls");
            Eq("-s " + Tv + @" install -r C:\tmp\Foxbloom.apk", slow.Calls[0], "install");
            Eq(2, quick.Calls.Count, "other calls");
            Eq("connect " + Tv, quick.Calls[0], "connect");
            Eq("-s " + Tv + " shell am start -n org.foxbloom.tv/.MainActivity", quick.Calls[1], "launch");
        });

        Test("install failures map to plain messages and the app isn't launched", delegate
        {
            var cases = new Dictionary<string, string>
            {
                { "Performing Streamed Install\r\nadb: failed to install x.apk: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package org.foxbloom.tv signatures do not match]", "signed by someone else" },
                { "Failure [INSTALL_FAILED_OLDER_SDK]", "Android 7 or newer" },
                { "Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]", "out of space" },
                { "Failure [INSTALL_FAILED_SOMETHING_ELSE: odd]", "INSTALL_FAILED_SOMETHING_ELSE" },
                { "error: device unauthorized.", "hasn't allowed this PC" },
                { "", "didn't confirm" },
            };
            foreach (var c in cases)
            {
                var f = HappyAdb();
                f.Reply = a => new SdbResult(0, c.Key);
                Throws<TvInstallException>(delegate { new Adb(f).Install(Tv, "x.apk"); }, c.Value, c.Key);
                Eq(1, f.Calls.Count, "never launched: " + c.Key);
            }
        });

        Test("a launch failure is reported, though the app is installed", delegate
        {
            var f = HappyAdb();
            var inner = f.Reply;
            f.Reply = a => a.Contains(" am start ") ? new SdbResult(0, "Error: Activity class {org.foxbloom.tv/org.foxbloom.tv.MainActivity} does not exist.") : inner(a);
            Throws<TvInstallException>(delegate { new Adb(f).Install(Tv, "x.apk"); }, "installed", "launch failure");
        });

        Test("addresses that aren't host:port are refused before adb runs", delegate
        {
            var f = HappyAdb();
            Throws<TvInstallException>(delegate { new Adb(f).Connect("192.168.1.20:5555 && calc"); }, "address", "injection");
            Throws<TvInstallException>(delegate { new Adb(f).Pair("192.168.1.20", "123456"); }, "address", "no port");
            Throws<TvInstallException>(delegate { new Adb(f).Pair("192.168.1.20:37123", "12 34"); }, "code", "bad code");
            Eq(0, f.Calls.Count, "nothing run");
        });

        Test("Adb.Stop runs kill-server and never throws", delegate
        {
            var f = HappyAdb();
            f.Reply = a => { throw new TvInstallException("boom"); };
            new Adb(f).Stop();
            Eq("kill-server", f.Calls[0], "kill");
        });

        Test("adb extraction puts all files side by side and reuses only identical ones", delegate
        {
            string dir = Path.Combine(Path.GetTempPath(), "foxbloom-adb-test-" + Guid.NewGuid().ToString("N"));
            try
            {
                var files = new Dictionary<string, byte[]> { { "adb.exe", new byte[] { 1, 2 } }, { "AdbWinApi.dll", new byte[] { 3 } }, { "AdbWinUsbApi.dll", new byte[] { 4, 5 } } };
                string a = Adb.Extract(files, dir);
                Eq("adb.exe", Path.GetFileName(a), "name");
                foreach (var kv in files) Eq(true, File.ReadAllBytes(Path.Combine(Path.GetDirectoryName(a), kv.Key)).SequenceEqual(kv.Value), kv.Key);
                Eq(a, Adb.Extract(files, dir), "reused path");
                File.WriteAllBytes(Path.Combine(Path.GetDirectoryName(a), "AdbWinApi.dll"), new byte[] { 9 });
                string b = Adb.Extract(files, dir);
                Eq(true, File.ReadAllBytes(Path.Combine(Path.GetDirectoryName(b), "AdbWinApi.dll")).SequenceEqual(files["AdbWinApi.dll"]), "damaged dll replaced");
                files["adb.exe"] = new byte[] { 7 };
                True(Path.GetDirectoryName(Adb.Extract(files, dir)) != Path.GetDirectoryName(a), "different adb gets its own folder");
            }
            finally { try { Directory.Delete(dir, true); } catch { } }
        });
    }
}
