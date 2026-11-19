// Finds Samsung TVs on the local network and reads their Developer Mode state.
//
// How: an SSDP M-SEARCH for DIAL devices goes out on every IPv4 interface; each answer's LOCATION host is a
// candidate. If nobody answers within 3 s, a sweep of port 8001 on the PC's /24 networks looks for TVs that
// ignore SSDP. A candidate counts as a TV only if GET http://ip:8001/api/v2/ returns Samsung's device JSON
// (a Roku or Chromecast answers DIAL too, but has no such endpoint, so it is left out).
//
// JSON: System.Web.Extensions' JavaScriptSerializer (part of .NET Framework 4, no NuGet).
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

public class TvInfo
{
    public string Ip, Name, Model, Duid;
    public bool DeveloperMode;
    public string DeveloperIp;
}

public static class TvDiscovery
{
    public const int TvPort = 8001;

    /** Every Samsung TV that answers within about `timeout`. Never blocks much longer than that. */
    public static List<TvInfo> Find(TimeSpan timeout)
    {
        var started = DateTime.UtcNow;
        Func<TimeSpan> left = () => timeout - (DateTime.UtcNow - started);
        var locals = LocalIPv4().ToList();

        var hosts = Ssdp(locals, Min(TimeSpan.FromSeconds(3), left()));
        var tvs = Resolve(hosts, delegate (string ip) { return Describe(ip); });
        if (tvs.Count == 0 && left() > TimeSpan.FromMilliseconds(600))
            tvs = Resolve(Sweep(locals, left()), delegate (string ip) { return Describe(ip); });
        return tvs;
    }

    /** The TV at `ip` (from GET http://ip:8001/api/v2/), or null if it isn't a reachable Samsung TV. */
    public static TvInfo Describe(string ip) { return Describe(ip, TvPort, 2500); }

    public static TvInfo Describe(string ip, int port, int timeoutMs)
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create("http://" + ip + ":" + port + "/api/v2/");
            req.Timeout = timeoutMs;
            req.ReadWriteTimeout = timeoutMs;
            req.Proxy = null;
            using (var res = (HttpWebResponse)req.GetResponse())
            using (var rd = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                return ParseDevice(rd.ReadToEnd(), ip);
        }
        catch (Exception) { return null; }
    }

    /** Samsung's /api/v2/ JSON to a TvInfo; null for anything else (HTML, empty, other JSON). */
    public static TvInfo ParseDevice(string json, string ip)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            var root = new JavaScriptSerializer().DeserializeObject(json) as Dictionary<string, object>;
            if (root == null) return null;
            object d;
            var dev = root.TryGetValue("device", out d) ? d as Dictionary<string, object> : null;
            if (dev == null) return null;
            return new TvInfo
            {
                Ip = ip,
                Name = Str(dev, "name") != "" ? Str(dev, "name") : Str(root, "name"),
                Model = Str(dev, "modelName"),
                Duid = Str(dev, "duid"),
                DeveloperMode = Str(dev, "developerMode") == "1",
                DeveloperIp = Str(dev, "developerIP")
            };
        }
        catch (Exception) { return null; }
    }

    static string Str(Dictionary<string, object> d, string key)
    {
        object v;
        return d.TryGetValue(key, out v) && v != null ? Convert.ToString(v) : "";
    }

    /** The host of an SSDP response's LOCATION header, or null. */
    public static string ParseSsdpHost(string response)
    {
        if (response == null) return null;
        foreach (var raw in response.Split('\n'))
        {
            var line = raw.Trim();
            if (!line.StartsWith("location:", StringComparison.OrdinalIgnoreCase)) continue;
            Uri u;
            if (Uri.TryCreate(line.Substring(9).Trim(), UriKind.Absolute, out u) && u.Host.Length > 0) return u.Host;
        }
        return null;
    }

    /** Describes each distinct address in parallel; addresses that fail or aren't Samsung TVs are dropped. */
    public static List<TvInfo> Resolve(IEnumerable<string> ips, Func<string, TvInfo> describe)
    {
        var distinct = ips.Where(i => !string.IsNullOrEmpty(i)).Distinct().ToList();
        var tasks = distinct.Select(ip => Task.Factory.StartNew(delegate ()
        {
            try { return describe(ip); } catch (Exception) { return null; }
        })).ToArray();
        var result = new List<TvInfo>();
        foreach (var t in tasks) { var tv = t.Result; if (tv != null) result.Add(tv); }
        return result;
    }

    /** True when the TV can't accept an install from this PC yet: Developer Mode off, or set up for another PC. */
    public static bool NeedsDeveloperSetup(TvInfo tv, IEnumerable<string> pcIps)
    {
        return !tv.DeveloperMode || !pcIps.Contains(tv.DeveloperIp ?? "");
    }

    /** The PC address to show for the TV: the one on the TV's /24 if there is one, else the first. */
    public static string PickPcIp(string tvIp, IEnumerable<string> pcIps)
    {
        var all = pcIps.ToList();
        var prefix = tvIp.Substring(0, tvIp.LastIndexOf('.') + 1);
        return all.FirstOrDefault(i => i.StartsWith(prefix, StringComparison.Ordinal)) ?? all.FirstOrDefault() ?? "";
    }

    /** This PC's IPv4 addresses on connected, non-loopback interfaces. */
    public static IEnumerable<string> LocalIPv4()
    {
        var result = new List<string>();
        try
        {
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.OperationalStatus != OperationalStatus.Up) continue;
                if (nic.NetworkInterfaceType == NetworkInterfaceType.Loopback || nic.NetworkInterfaceType == NetworkInterfaceType.Tunnel) continue;
                foreach (var ua in nic.GetIPProperties().UnicastAddresses)
                {
                    if (ua.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                    var s = ua.Address.ToString();
                    if (!s.StartsWith("169.254.") && !result.Contains(s)) result.Add(s);
                }
            }
        }
        catch (Exception) { }
        return result;
    }

    static TimeSpan Min(TimeSpan a, TimeSpan b) { return a < b ? a : b; }

    /** SSDP M-SEARCH for DIAL devices on every interface; the hosts that answered. */
    static List<string> Ssdp(List<string> locals, TimeSpan wait)
    {
        var found = new List<string>();
        if (wait <= TimeSpan.Zero) return found;
        var msg = Encoding.ASCII.GetBytes("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: urn:dial-multiscreen-org:service:dial:1\r\n\r\n");
        var threads = new List<Thread>();
        foreach (var local in locals)
        {
            var ip = local;
            var t = new Thread(delegate ()
            {
                try
                {
                    using (var udp = new UdpClient(new IPEndPoint(IPAddress.Parse(ip), 0)))
                    {
                        udp.Client.ReceiveTimeout = 250;
                        var target = new IPEndPoint(IPAddress.Parse("239.255.255.250"), 1900);
                        udp.Send(msg, msg.Length, target);
                        udp.Send(msg, msg.Length, target);
                        var until = DateTime.UtcNow + wait;
                        while (DateTime.UtcNow < until)
                        {
                            try
                            {
                                IPEndPoint from = null;
                                var data = udp.Receive(ref from);
                                var host = ParseSsdpHost(Encoding.ASCII.GetString(data));
                                if (host != null) lock (found) found.Add(host);
                            }
                            catch (SocketException) { }
                        }
                    }
                }
                catch (Exception) { }
            });
            t.IsBackground = true;
            t.Start();
            threads.Add(t);
        }
        foreach (var t in threads) t.Join(wait + TimeSpan.FromSeconds(1));
        lock (found) return found.ToList();
    }

    /** Addresses on each of this PC's /24 networks that accept a connection on the TV port (300 ms each). */
    static List<string> Sweep(List<string> locals, TimeSpan budget)
    {
        var until = DateTime.UtcNow + budget;
        var open = new List<string>();
        var targets = new List<string>();
        foreach (var local in locals)
        {
            var prefix = local.Substring(0, local.LastIndexOf('.') + 1);
            for (int i = 1; i < 255; i++) { var h = prefix + i; if (h != local && !targets.Contains(h)) targets.Add(h); }
        }
        Parallel.ForEach(targets, new ParallelOptions { MaxDegreeOfParallelism = 64 }, delegate (string host)
        {
            if (DateTime.UtcNow > until) return;
            try
            {
                using (var c = new TcpClient())
                {
                    var ar = c.BeginConnect(host, TvPort, null, null);
                    if (ar.AsyncWaitHandle.WaitOne(300) && c.Connected) lock (open) open.Add(host);
                }
            }
            catch (Exception) { }
        });
        lock (open) return open.ToList();
    }
}
