// Console test runner for the TV installer (TvDiscovery here; SamsungCert and WgtSigner in their own files).
// No test framework: each Test() prints PASS/FAIL, exit code 1 if any failed.
// Usage: TvTests.exe <fixtures folder>
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;
using System.Threading;

static partial class Tests
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
            Eq(false, TvDiscovery.NeedsDeveloperSetup(tv, "192.168.1.20"), "needs setup");
        });

        Test("parses a TV with Developer Mode off", delegate
        {
            var tv = TvDiscovery.ParseDevice(Read("tv-devmode-off.json"), "192.168.1.51");
            True(tv != null, "TV was not parsed");
            Eq("[TV] Bedroom", tv.Name, "Name");
            Eq("QE65Q80T", tv.Model, "Model");
            Eq(false, tv.DeveloperMode, "DeveloperMode");
            Eq("", tv.DeveloperIp, "DeveloperIp");
            Eq(true, TvDiscovery.NeedsDeveloperSetup(tv, "192.168.1.20"), "needs setup");
        });

        Test("a TV whose developerIP is another PC needs setup", delegate
        {
            var tv = TvDiscovery.ParseDevice(Read("tv-other-pc.json"), "192.168.1.52");
            True(tv != null, "TV was not parsed");
            Eq(true, tv.DeveloperMode, "DeveloperMode");
            Eq("192.168.1.99", tv.DeveloperIp, "DeveloperIp");
            Eq(true, TvDiscovery.NeedsDeveloperSetup(tv, "192.168.1.20"), "needs setup (another PC)");
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

        Test("developerIP must equal the route address; blank or missing means not set", delegate
        {
            var on = TvDiscovery.ParseDevice(Read("tv-devmode-on.json"), "192.168.1.50");   // developerIP 192.168.1.20
            Eq(false, TvDiscovery.NeedsDeveloperSetup(on, "192.168.1.20"), "matching");
            Eq(true, TvDiscovery.NeedsDeveloperSetup(on, "172.28.0.1"), "a Hyper-V/WSL address is not the route address");
            Eq(true, TvDiscovery.NeedsDeveloperSetup(on, ""), "no route address");
            on.DeveloperIp = null;
            Eq(true, TvDiscovery.NeedsDeveloperSetup(on, "192.168.1.20"), "null developerIP");
            on.DeveloperIp = "  ";
            Eq(true, TvDiscovery.NeedsDeveloperSetup(on, "192.168.1.20"), "blank developerIP");
        });

        Test("RouteAddress asks the routing table which local address reaches the TV", delegate
        {
            Eq("127.0.0.1", TvDiscovery.RouteAddress("127.0.0.1"), "loopback route");
        });

        Test("sweep adapters: real LAN adapters only, ones with a gateway first", delegate
        {
            Func<string, string, string, NetworkInterfaceType, bool, TvDiscovery.AdapterInfo> A = (name, desc, ip, t, gw) =>
                new TvDiscovery.AdapterInfo { Name = name, Description = desc, Ip = ip, Type = t, HasGateway = gw };
            var list = new List<TvDiscovery.AdapterInfo>
            {
                A("vEthernet (WSL)", "Hyper-V Virtual Ethernet Adapter", "172.28.0.1", NetworkInterfaceType.Ethernet, false),
                A("vEthernet (Default Switch)", "Hyper-V Virtual Ethernet Adapter #2", "172.29.0.1", NetworkInterfaceType.Ethernet, false),
                A("Ethernet 2", "VirtualBox Host-Only Ethernet Adapter", "192.168.56.1", NetworkInterfaceType.Ethernet, false),
                A("VMware Network Adapter VMnet8", "VMware Virtual Ethernet Adapter for VMnet8", "192.168.100.1", NetworkInterfaceType.Ethernet, false),
                A("Docker", "Docker Desktop Network", "10.0.75.1", NetworkInterfaceType.Ethernet, false),
                A("Ethernet", "Realtek PCIe GbE Family Controller", "192.168.50.7", NetworkInterfaceType.Ethernet, false),
                A("Wi-Fi", "Intel(R) Wi-Fi 6 AX201", "192.168.1.20", NetworkInterfaceType.Wireless80211, true),
                A("Mobile", "Some PPP link", "10.9.9.9", NetworkInterfaceType.Ppp, true),
            };
            var picked = TvDiscovery.SelectSweepAdapters(list);
            Eq("192.168.1.20,192.168.50.7", string.Join(",", picked.ToArray()), "picked");
            var onlyVirtual = list.Take(5).ToList();
            Eq(5, TvDiscovery.SelectSweepAdapters(onlyVirtual).Count, "falls back to everything rather than nothing");
        });

        Test("sweep reaches a TV that is the last of 200 silent hosts within the budget", delegate
        {
            var l = new TcpListener(IPAddress.Parse("127.0.0.200"), 0);
            l.Start();
            try
            {
                int port = ((IPEndPoint)l.LocalEndpoint).Port;
                var hosts = new List<string>();
                for (int i = 1; i <= 200; i++) hosts.Add("192.0.2." + i);   // TEST-NET-1: nothing answers
                hosts.Add("127.0.0.200");
                var sw = System.Diagnostics.Stopwatch.StartNew();
                var open = TvDiscovery.ProbeOpen(hosts, port, TimeSpan.FromSeconds(3));
                sw.Stop();
                Eq("127.0.0.200", string.Join(",", open.ToArray()), "open hosts");
                True(sw.Elapsed < TimeSpan.FromSeconds(2), "took " + sw.Elapsed.TotalSeconds + " s");
            }
            finally { l.Stop(); }
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

        SamsungCertTests();
        WgtSignerTests();

        Console.WriteLine();
        Console.WriteLine(passed + " passed, " + failed + " failed");
        return failed == 0 ? 0 : 1;
    }
}
