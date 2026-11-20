// AndroidDiscovery: finds Android TVs / Google TVs on the network.
//   1. `adb mdns services` lists TVs with Wireless debugging on (connect port and pairing port change each time).
//   2. A sweep of this PC's /24 networks for hosts answering on port 5555 (Network debugging / older Android).
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

public class AndroidTarget
{
    public string Ip;
    /** 0 when unknown (for example only the pairing service has been seen). */
    public int ConnectPort;
    /** 0 when unknown. */
    public int PairPort;
    /** false = classic adb over TCP (port 5555), no pairing. */
    public bool Wireless;
}

public static class AndroidDiscovery
{
    public const int ClassicPort = 5555;
    static readonly Regex Svc = new Regex(@"(?<type>_adb-tls-connect\._tcp|_adb-tls-pairing\._tcp|_adb\._tcp)\.?\s+(?<ip>(\d{1,3}\.){3}\d{1,3}):(?<port>\d{1,5})\s*$");

    /** Reads `adb mdns services` output, merging the connect and pairing entries of each TV by IP. */
    public static List<AndroidTarget> ParseMdns(string output)
    {
        var list = new List<AndroidTarget>();
        foreach (string raw in (output ?? "").Split('\n'))
        {
            var m = Svc.Match(raw.Trim());
            if (!m.Success) continue;
            int port;
            if (!int.TryParse(m.Groups["port"].Value, out port) || port < 1 || port > 65535) continue;
            string ip = m.Groups["ip"].Value;
            if (ip.Split('.').Any(o => int.Parse(o) > 255)) continue;
            string type = m.Groups["type"].Value;
            var t = list.FirstOrDefault(x => x.Ip == ip);
            if (t == null) { t = new AndroidTarget { Ip = ip }; list.Add(t); }
            if (type == "_adb-tls-pairing._tcp") { t.PairPort = port; t.Wireless = true; }
            else if (type == "_adb-tls-connect._tcp") { t.ConnectPort = port; t.Wireless = true; }
            else if (t.ConnectPort == 0) t.ConnectPort = port; // classic _adb._tcp: Wireless stays as it was
        }
        return list;
    }

    /** mDNS targets first, then port-5555 hosts not already listed (by IP). */
    public static List<AndroidTarget> Merge(List<AndroidTarget> mdns, IEnumerable<string> port5555Hosts)
    {
        var list = new List<AndroidTarget>(mdns);
        foreach (string ip in port5555Hosts)
            if (!list.Any(t => t.Ip == ip)) list.Add(new AndroidTarget { Ip = ip, ConnectPort = ClassicPort, Wireless = false });
        return list;
    }

    /** Every Android TV found within about `timeout`. Never throws. */
    public static List<AndroidTarget> Find(Adb adb, TimeSpan timeout)
    {
        var started = DateTime.UtcNow;
        var mdns = new List<AndroidTarget>();
        var open = new List<string>();
        // The first call also starts adb's server, whose mDNS browser has usually seen nothing yet; ask again after
        // the sweep and keep both answers (the later one wins for a TV in both).
        string early = "";
        try { early = adb.MdnsServices(); } catch (Exception) { }
        try
        {
            var left = timeout - (DateTime.UtcNow - started);
            if (left > TimeSpan.FromMilliseconds(300))
            {
                var locals = TvDiscovery.SelectSweepAdapters(TvDiscovery.LocalAdapters());
                open = TvDiscovery.ProbeOpen(TvDiscovery.SweepHosts(locals), ClassicPort, left);
            }
        }
        catch (Exception) { }
        string late = "";
        try { late = adb.MdnsServices(); } catch (Exception) { }
        mdns = ParseMdns(early + "\n" + late);
        return Merge(mdns, open);
    }
}
