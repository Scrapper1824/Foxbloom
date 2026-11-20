// Tests for AndroidDiscovery's pure parts: reading `adb mdns services` and merging with 5555 hits. The sweep isn't tested.
using System;
using System.Collections.Generic;

static partial class Tests
{
    static void AndroidDiscoveryTests()
    {
        Test("ParseMdns merges connect and pairing services of one TV", delegate
        {
            var l = AndroidDiscovery.ParseMdns("List of discovered mdns services\r\nadb-1A2B-Xyz\t_adb-tls-connect._tcp\t192.168.1.20:37123\r\nadb-1A2B-Xyz\t_adb-tls-pairing._tcp\t192.168.1.20:41567\r\n");
            Eq(1, l.Count, "targets");
            Eq("192.168.1.20", l[0].Ip, "ip");
            Eq(37123, l[0].ConnectPort, "connect");
            Eq(41567, l[0].PairPort, "pair");
            Eq(true, l[0].Wireless, "wireless");
        });

        Test("ParseMdns accepts spaces, keeps separate TVs, and takes a pairing-only TV", delegate
        {
            var l = AndroidDiscovery.ParseMdns("adb-A  _adb-tls-connect._tcp  192.168.1.20:37123\nadb-B _adb-tls-pairing._tcp 192.168.1.30:40000\n");
            Eq(2, l.Count, "targets");
            Eq(0, l[1].PairPort == 40000 ? 0 : 1, "pair port");
            Eq(0, l[1].ConnectPort, "no connect yet");
        });

        Test("ParseMdns takes the classic _adb._tcp service as non-wireless", delegate
        {
            var l = AndroidDiscovery.ParseMdns("adb-A\t_adb._tcp\t192.168.1.20:5555");
            Eq(1, l.Count, "targets");
            Eq(5555, l[0].ConnectPort, "connect");
            Eq(false, l[0].Wireless, "wireless");
        });

        Test("ParseMdns ignores garbage, bad ports and IPv6", delegate
        {
            Eq(0, AndroidDiscovery.ParseMdns("").Count, "empty");
            Eq(0, AndroidDiscovery.ParseMdns(null).Count, "null");
            Eq(0, AndroidDiscovery.ParseMdns("hello\r\n\t\r\nx\t_adb-tls-connect._tcp\tnotanip:1\nx\t_adb-tls-connect._tcp\t192.168.1.2:99999\nx\t_adb-tls-connect._tcp\tfe80::1:5555\nx\t_other._tcp\t192.168.1.2:80").Count, "garbage");
        });

        Test("Merge de-duplicates by IP, preferring the wireless-debugging entry", delegate
        {
            var mdns = AndroidDiscovery.ParseMdns("a\t_adb-tls-connect._tcp\t192.168.1.20:37123");
            var l = AndroidDiscovery.Merge(mdns, new List<string> { "192.168.1.20", "192.168.1.21", "192.168.1.21" });
            Eq(2, l.Count, "targets");
            Eq(37123, l[0].ConnectPort, "mdns kept");
            Eq("192.168.1.21", l[1].Ip, "sweep");
            Eq(5555, l[1].ConnectPort, "5555");
            Eq(false, l[1].Wireless, "classic");
        });

        Test("Adb.MdnsServices runs adb mdns services and never throws", delegate
        {
            var f = new FakeAdb();
            f.Reply = a => new SdbResult(0, "x");
            Eq("x", new Adb(f).MdnsServices(), "output");
            Eq("mdns services", f.Calls[0], "command");
            f.Reply = a => { throw new TvInstallException("boom"); };
            Eq("", new Adb(f).MdnsServices(), "failure");
        });
    }
}
