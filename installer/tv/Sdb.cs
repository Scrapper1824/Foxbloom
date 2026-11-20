// Sdb: talks to a Samsung TV in Developer Mode through Samsung's sdb.exe (Smart Development Bridge, Apache-2.0,
// see THIRD-PARTY.txt). sdb.exe is embedded in FoxbloomTVSetup.exe as a resource, copied to a temp folder when needed.
//   connect <ip>:26101
//   -s <ip>:26101 shell 0 getduid                     the TV's certificate DUID (not the uuid from /api/v2/)
//   -s <ip>:26101 push <file> /home/owner/share/tmp/sdk_tools/Foxbloom.wgt
//   -s <ip>:26101 shell 0 vd_appinstall <appId> <path>
//   -s <ip>:26101 shell 0 was_execute <appId>
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;

public class TvInstallException : Exception
{
    public TvInstallException(string message) : base(message) { }
    public TvInstallException(string message, Exception inner) : base(message, inner) { }
}

public struct SdbResult
{
    public readonly int ExitCode;
    public readonly string Output;
    public SdbResult(int exitCode, string output) { ExitCode = exitCode; Output = output ?? ""; }
}

public interface ISdbRunner
{
    /** Runs sdb with these arguments and returns its exit code and everything it printed. */
    SdbResult Run(string[] args);
}

/** Runs the real sdb.exe, hidden, with a time limit. */
public sealed class SdbProcessRunner : ISdbRunner
{
    readonly string sdbPath;
    readonly TimeSpan timeout, drain;
    public SdbProcessRunner(string sdbPath, TimeSpan timeout) : this(sdbPath, timeout, TimeSpan.FromSeconds(3)) { }
    /** `drain`: how long to wait for the output pipes to close after sdb exits. sdb's background server can keep them open. */
    public SdbProcessRunner(string sdbPath, TimeSpan timeout, TimeSpan drain) { this.sdbPath = sdbPath; this.timeout = timeout; this.drain = drain; }

    public SdbResult Run(string[] args)
    {
        var psi = new ProcessStartInfo(sdbPath)
        {
            Arguments = string.Join(" ", Array.ConvertAll(args, Quote)),
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
        };
        var text = new StringBuilder();
        using (var p = new Process { StartInfo = psi })
        {
            var outDone = new System.Threading.ManualResetEvent(false);
            var errDone = new System.Threading.ManualResetEvent(false);
            p.OutputDataReceived += (s, e) => { if (e.Data != null) lock (text) text.AppendLine(e.Data); else outDone.Set(); };
            p.ErrorDataReceived += (s, e) => { if (e.Data != null) lock (text) text.AppendLine(e.Data); else errDone.Set(); };
            try { p.Start(); }
            catch (Exception e) { throw new TvInstallException("The TV tool (sdb.exe) couldn't start: " + e.Message, e); }
            p.BeginOutputReadLine(); p.BeginErrorReadLine();
            if (!p.WaitForExit((int)timeout.TotalMilliseconds))
            {
                try { p.Kill(); } catch { }
                throw new TvInstallException("The TV didn't answer in time. Check that it is switched on, then try again.");
            }
            // Wait for both streams to reach end-of-stream so the last lines are kept, but never longer than `drain`:
            // sdb's background server can hold the pipes open forever.
            // (Single-handle waits against one deadline: WaitAll on several handles throws on an STA thread.)
            var deadline = DateTime.UtcNow + drain;
            outDone.WaitOne(Math.Max(0, (int)(deadline - DateTime.UtcNow).TotalMilliseconds));
            errDone.WaitOne(Math.Max(0, (int)(deadline - DateTime.UtcNow).TotalMilliseconds));
            lock (text) return new SdbResult(p.ExitCode, text.ToString());
        }
    }

    static string Quote(string a) { return a.IndexOfAny(new[] { ' ', '\t', '"' }) < 0 ? a : "\"" + a.Replace("\"", "\\\"") + "\""; }
}

public sealed class Sdb
{
    public const string DefaultAppId = "FoxbloomTV.foxbloom";
    public const int Port = 26101;
    public const string RemotePath = "/home/owner/share/tmp/sdk_tools/Foxbloom.wgt";
    public const string ResourceName = "sdb.exe";

    static readonly Regex InstallFailed = new Regex(@"install failed\[(?<code>[^\]]*)\](?:,\s*reason:\s*(?<reason>.*))?", RegexOptions.IgnoreCase | RegexOptions.Singleline);

    readonly ISdbRunner runner;
    public Sdb(ISdbRunner runner) { this.runner = runner; }

    /** The real thing: extracts the embedded sdb.exe and runs it. Throws TvInstallException if this build has none. */
    public static Sdb Embedded()
    {
        using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream(ResourceName))
        {
            if (s == null) throw new TvInstallException("This copy of Foxbloom TV Setup can't install: it was built without the TV tool (sdb.exe). Download the latest FoxbloomTVSetup.exe from the Foxbloom releases page.");
            var ms = new MemoryStream();
            s.CopyTo(ms);
            string path = Extract(ms.ToArray(), Path.Combine(Path.GetTempPath(), "foxbloom-tv-sdb"));
            return new Sdb(new SdbProcessRunner(path, TimeSpan.FromSeconds(90)));
        }
    }

    /**
     * Writes sdb.exe into `dir` under a name made from its content hash and returns the path. An existing file is
     * reused only when it is byte-identical; otherwise it is rewritten, or (if it is locked) a fresh name is used.
     */
    public static string Extract(byte[] data, string dir)
    {
        Directory.CreateDirectory(dir);
        string hash;
        using (var sha = System.Security.Cryptography.SHA256.Create()) hash = BitConverter.ToString(sha.ComputeHash(data), 0, 6).Replace("-", "").ToLowerInvariant();
        string path = Path.Combine(dir, "sdb-" + hash + ".exe");
        try
        {
            if (File.Exists(path) && SameBytes(File.ReadAllBytes(path), data)) return path;
            File.WriteAllBytes(path, data);
            return path;
        }
        catch (IOException)
        {
            if (File.Exists(path)) { try { if (SameBytes(File.ReadAllBytes(path), data)) return path; } catch (IOException) { } }
            string alt = Path.Combine(dir, "sdb-" + hash + "-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".exe");
            File.WriteAllBytes(alt, data);
            return alt;
        }
    }

    static bool SameBytes(byte[] a, byte[] b)
    {
        if (a.Length != b.Length) return false;
        for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
        return true;
    }

    /** Installs and launches the app on the TV at `ip` using the embedded sdb.exe, then stops sdb's server. */
    public static void Install(string ip, byte[] signedWgt, string appId = DefaultAppId)
    {
        Embedded().InstallAndStop(ip, signedWgt, appId);
    }

    public void InstallAndStop(string ip, byte[] signedWgt, string appId)
    {
        try { InstallTo(ip, signedWgt, appId); }
        finally { Stop(); }
    }

    /** Stops the background sdb server (port 26099) so it doesn't linger or clash with a Tizen Studio sdb. Never throws. */
    public void Stop()
    {
        try { runner.Run(new[] { "kill-server" }); } catch { }
    }

    /** Connects to the TV and returns its DUID (what a developer certificate is made for). */
    public string GetDuid(string ip)
    {
        string target = Target(ip);
        Connect(target);
        var r = runner.Run(new[] { "-s", target, "shell", "0", "getduid" });
        string duid = (r.Output ?? "").Trim();
        if (r.ExitCode != 0 || !SamsungCert.IsValidDuid(duid))
            throw new TvInstallException("The TV wouldn't tell us its ID. Check that Developer Mode is on and the TV was restarted after entering this PC's address.");
        return duid;
    }

    public void InstallTo(string ip, byte[] signedWgt, string appId)
    {
        string target = Target(ip);
        if (signedWgt == null || signedWgt.Length == 0) throw new TvInstallException("There is no app package to install.");
        if (string.IsNullOrWhiteSpace(appId) || !Regex.IsMatch(appId, @"^[A-Za-z0-9._]+$")) throw new TvInstallException("The app's ID isn't valid.");
        Connect(target);

        string tmp = Path.Combine(Path.GetTempPath(), "Foxbloom-" + Guid.NewGuid().ToString("N") + ".wgt");
        try
        {
            File.WriteAllBytes(tmp, signedWgt);
            var push = runner.Run(new[] { "-s", target, "push", tmp, RemotePath });
            bool pushed = push.Output.IndexOf("file pushed", StringComparison.OrdinalIgnoreCase) >= 0;
            if (push.ExitCode != 0 || (!pushed && push.Output.IndexOf("fail", StringComparison.OrdinalIgnoreCase) >= 0))
                throw new TvInstallException("Couldn't copy the app to the TV. " + Tail(push.Output));
        }
        finally { try { File.Delete(tmp); } catch { } }

        var inst = runner.Run(new[] { "-s", target, "shell", "0", "vd_appinstall", appId, RemotePath });
        var m = InstallFailed.Match(inst.Output);
        if (m.Success) throw new TvInstallException(InstallFailure(m.Groups["code"].Value.Trim(), m.Groups["reason"].Value.Trim()));
        // Older TVs print "install success[0]"; newer ones (seen on a 2020s 7 Series) print "install completed".
        if (inst.Output.IndexOf("install success", StringComparison.OrdinalIgnoreCase) < 0 &&
            inst.Output.IndexOf("install completed", StringComparison.OrdinalIgnoreCase) < 0)
            throw new TvInstallException("The TV didn't confirm the install. " + Tail(inst.Output));

        var run = runner.Run(new[] { "-s", target, "shell", "0", "was_execute", appId });
        if (run.ExitCode != 0 || run.Output.IndexOf("fail", StringComparison.OrdinalIgnoreCase) >= 0)
            throw new TvInstallException("Foxbloom is installed on the TV, but it didn't start on its own. Open it from the TV's Apps list. " + Tail(run.Output));
    }

    void Connect(string target)
    {
        var r = runner.Run(new[] { "connect", target });
        string o = r.Output.ToLowerInvariant();
        bool ok = (o.Contains("connected to") && !o.Contains("failed") && !o.Contains("cannot")) || o.Contains("already connected");
        if (!ok)
            throw new TvInstallException("Couldn't connect to the TV. Check that Developer Mode is on, the Host PC IP is this PC's address, the TV was restarted afterwards, and the TV is on the same network.");
    }

    static string Target(string ip)
    {
        IPAddress parsed;
        if (string.IsNullOrWhiteSpace(ip) || !IPAddress.TryParse(ip.Trim(), out parsed) || parsed.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork)
            throw new TvInstallException("That isn't a valid TV address.");
        return parsed + ":" + Port;
    }

    static string InstallFailure(string code, string reason)
    {
        string r = reason ?? "";
        string plain;
        if (r.IndexOf("certificate", StringComparison.OrdinalIgnoreCase) >= 0)
            plain = "The TV didn't accept the app's certificate. It may be for a different TV, or out of date. Run the setup again; if it keeps failing, see the certificate section of the TV guide.";
        else if (r.IndexOf("space", StringComparison.OrdinalIgnoreCase) >= 0 || r.IndexOf("storage", StringComparison.OrdinalIgnoreCase) >= 0)
            plain = "The TV doesn't have enough free storage for the app.";
        else if (r.IndexOf("version", StringComparison.OrdinalIgnoreCase) >= 0)
            plain = "The TV says it can't run this version of the app.";
        else
            plain = "The TV refused to install the app.";
        return plain + " (error " + code + (r.Length > 0 ? ": " + r : "") + ")";
    }

    static string Tail(string output)
    {
        string t = (output ?? "").Trim();
        if (t.Length > 300) t = t.Substring(t.Length - 300);
        return t.Length == 0 ? "" : "(" + t.Replace("\r", " ").Replace("\n", " ") + ")";
    }
}
