// Console test runner for TvDiscovery. No test framework: each Test() prints PASS/FAIL, exit code 1 if any failed.
// Usage: TvTests.exe <fixtures folder>
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;

static class Tests
{
    static int failed, passed;
    static string fx;

    static void Test(string name, Action body)
    {
        try { body(); passed++; Console.WriteLine("PASS  " + name); }
        catch (Exception e) { failed++; Console.WriteLine("FAIL  " + name + "\n      " + e.GetType().Name + ": " + e.Message); }
    }
    static void Eq(object expected, object actual, string what)
    {
        if (!object.Equals(expected, actual)) throw new Exception(what + ": expected <" + expected + "> but was <" + actual + ">");
    }
    static void True(bool v, string what) { if (!v) throw new Exception(what); }
    static string Read(string name) { return File.ReadAllText(Path.Combine(fx, name)); }

    static int Main(string[] args)
    {
        fx = args.Length > 0 ? args[0] : Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "fixtures");

        Test("parses a TV with Developer Mode on for this PC", delegate
        {
            var tv = TvDiscovery.ParseDevice(Read("tv-devmode-on.json"), "192.168.1.50");
            True(tv != null, "TV was not parsed");
            Eq("192.168.1.50", tv.Ip, "Ip");
            Eq("[TV] Living Room", tv.Name, "Name");
            Eq("UE55TU8000", tv.Model, "Model");
            Eq("uuid:11111111-2222-3333-4444-555555555501", tv.Duid, "Duid");
            Eq(true, tv.DeveloperMode, "DeveloperMode");
            Eq("192.168.1.20", tv.DeveloperIp, "DeveloperIp");
            Eq(false, TvDiscovery.NeedsDeveloperSetup(tv, new[] { "10.0.0.5", "192.168.1.20" }), "needs setup");
        });

        Test("parses a TV with Developer Mode off", delegate
        {
            var tv = TvDiscovery.ParseDevice(Read("tv-devmode-off.json"), "192.168.1.51");
            True(tv != null, "TV was not parsed");
            Eq("[TV] Bedroom", tv.Name, "Name");
            Eq("QE65Q80T", tv.Model, "Model");
            Eq(false, tv.DeveloperMode, "DeveloperMode");
            Eq("", tv.DeveloperIp, "DeveloperIp");
            Eq(true, TvDiscovery.NeedsDeveloperSetup(tv, new[] { "192.168.1.20" }), "needs setup");
        });

        Test("a TV whose developerIP is another PC needs setup", delegate
        {
            var tv = TvDiscovery.ParseDevice(Read("tv-other-pc.json"), "192.168.1.52");
            True(tv != null, "TV was not parsed");
            Eq(true, tv.DeveloperMode, "DeveloperMode");
            Eq("192.168.1.99", tv.DeveloperIp, "DeveloperIp");
            Eq(true, TvDiscovery.NeedsDeveloperSetup(tv, new[] { "192.168.1.20", "10.0.0.5" }), "needs setup");
        });

        Test("non-Samsung and malformed replies parse to null", delegate
        {
            True(TvDiscovery.ParseDevice(Read("not-samsung.html"), "192.168.1.77") == null, "html page");
            True(TvDiscovery.ParseDevice("", "192.168.1.77") == null, "empty");
            True(TvDiscovery.ParseDevice("{\"device\":", "192.168.1.77") == null, "truncated json");
            True(TvDiscovery.ParseDevice("{\"hello\":1}", "192.168.1.77") == null, "json without device");
            True(TvDiscovery.ParseDevice("[1,2]", "192.168.1.77") == null, "json array");
        });

        Test("SSDP response: LOCATION host", delegate
        {
            Eq("192.168.1.50", TvDiscovery.ParseSsdpHost(Read("ssdp-samsung.txt")), "samsung");
            Eq("192.168.1.77", TvDiscovery.ParseSsdpHost(Read("ssdp-roku.txt")), "roku (mixed-case header)");
            Eq((string)null, TvDiscovery.ParseSsdpHost(Read("ssdp-bad.txt")), "no LOCATION");
            Eq((string)null, TvDiscovery.ParseSsdpHost(null), "null");
        });

        Test("a DIAL device without /api/v2/ is left out of the list", delegate
        {
            var samsung = Read("tv-devmode-on.json");
            var ips = new[] { "192.168.1.50", "192.168.1.77", "192.168.1.50", "192.168.1.88" };
            var list = TvDiscovery.Resolve(ips, ip =>
            {
                if (ip == "192.168.1.50") return TvDiscovery.ParseDevice(samsung, ip);
                if (ip == "192.168.1.77") return TvDiscovery.ParseDevice(Read("not-samsung.html"), ip);
                throw new WebException("timed out");
            });
            Eq(1, list.Count, "count (roku, unreachable and duplicate dropped)");
            Eq("192.168.1.50", list[0].Ip, "Ip");
        });

        Test("PC address: the one on the TV's network is preferred", delegate
        {
            Eq("192.168.1.20", TvDiscovery.PickPcIp("192.168.1.50", new[] { "10.0.0.5", "192.168.1.20" }), "same /24");
            Eq("10.0.0.5", TvDiscovery.PickPcIp("172.16.0.9", new[] { "10.0.0.5", "192.168.1.20" }), "fallback first");
        });

        Test("Describe over HTTP: reads /api/v2/; a closed port gives null", delegate
        {
            string body = Read("tv-devmode-off.json");
            var l = new HttpListener();
            int port = 18000 + new Random().Next(1000);
            l.Prefixes.Add("http://127.0.0.1:" + port + "/");
            l.Start();
            var t = new Thread(delegate ()
            {
                try
                {
                    var c = l.GetContext();
                    if (c.Request.Url.AbsolutePath == "/api/v2/")
                    {
                        var b = Encoding.UTF8.GetBytes(body);
                        c.Response.ContentType = "application/json";
                        c.Response.OutputStream.Write(b, 0, b.Length);
                    }
                    else c.Response.StatusCode = 404;
                    c.Response.Close();
                }
                catch { }
            });
            t.IsBackground = true; t.Start();
            try
            {
                var tv = TvDiscovery.Describe("127.0.0.1", port, 2000);
                True(tv != null, "TV was not read");
                Eq("[TV] Bedroom", tv.Name, "Name");
                Eq("127.0.0.1", tv.Ip, "Ip");
            }
            finally { l.Stop(); }
            True(TvDiscovery.Describe("127.0.0.1", 1, 500) == null, "closed port should give null");
        });

        Console.WriteLine();
        Console.WriteLine(passed + " passed, " + failed + " failed");
        return failed == 0 ? 0 : 1;
    }
}
