// Adb: talks to an Android TV / Google TV through Google's adb.exe (Android platform-tools, Apache-2.0, see
// THIRD-PARTY.txt). adb.exe and its two DLLs are embedded in FoxbloomTVSetup.exe as resources and copied to one temp folder.
//   pair <ip>:<pairingPort> <code>                    Android 11+ wireless debugging only (one-time)
//   connect <ip>:<port>                               5555 for Network debugging, or the Wireless debugging port
//   -s <target> shell getprop ro.product.manufacturer | ro.product.model | ro.build.version.sdk
//   -s <target> install -r <apk>                      -r keeps the app's data when updating
//   -s <target> shell am start -n org.foxbloom.tv/.MainActivity
// Reuses Sdb.cs's ISdbRunner / SdbProcessRunner / SdbResult / TvInstallException (they just run an exe and capture output).
// adb often exits 0 even when it failed, so every decision here is made from the text it prints.
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text.RegularExpressions;

public class AndroidTvInfo
{
    /** "ip:port", the form adb uses to pick a device. */
    public string Target;
    /** What to show the person, for example "Google Chromecast". */
    public string Name;
    public string Model;
    /** Android API level (24 = Android 7). */
    public int Sdk;
}

public sealed class Adb
{
    public const string PackageName = "org.foxbloom.tv";
    public const string Activity = "org.foxbloom.tv/.MainActivity";
    public static readonly string[] ResourceNames = { "adb.exe", "AdbWinApi.dll", "AdbWinUsbApi.dll" };

    static readonly Regex HostPort = new Regex(@"^(\d{1,3}\.){3}\d{1,3}:\d{1,5}$");
    static readonly Regex InstallFailed = new Regex(@"Failure \[(?<code>[A-Za-z0-9_]+)(?::\s*(?<detail>[^\]]*))?\]");
    static readonly Regex InstallSuccess = new Regex(@"^\s*Success\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase);

    readonly ISdbRunner runner, installRunner;
    public Adb(ISdbRunner runner) : this(runner, runner) { }
    /** `installRunner` runs only `adb install` (copying a few MB to a slow TV can take minutes); `runner` runs the rest. */
    public Adb(ISdbRunner runner, ISdbRunner installRunner) { this.runner = runner; this.installRunner = installRunner; }

    /** The real thing: extracts the embedded adb.exe (and the DLLs it needs beside it) and runs it. */
    public static Adb Embedded()
    {
        var files = new Dictionary<string, byte[]>();
        var asm = Assembly.GetExecutingAssembly();
        foreach (string name in ResourceNames)
        {
            using (var s = asm.GetManifestResourceStream(name))
            {
                if (s == null) throw new TvInstallException("This copy of Foxbloom TV Setup can't install on Android TV: it was built without the Android TV tool (" + name + "). Download the latest FoxbloomTVSetup.exe from the Foxbloom releases page.");
                var ms = new MemoryStream();
                s.CopyTo(ms);
                files[name] = ms.ToArray();
            }
        }
        string path = Extract(files, Path.Combine(Path.GetTempPath(), "foxbloom-tv-adb"));
        return new Adb(new SdbProcessRunner(path, TimeSpan.FromSeconds(90)), new SdbProcessRunner(path, TimeSpan.FromMinutes(5)));
    }

    /**
     * Writes the adb files together into a folder under `dir` named from their content hash and returns the path of
     * adb.exe. Existing files are reused only when byte-identical; otherwise they are rewritten, or (if one is locked,
     * for example by a still-running adb server) a fresh folder is used.
     */
    public static string Extract(IDictionary<string, byte[]> files, string dir)
    {
        string hash;
        using (var sha = System.Security.Cryptography.SHA256.Create())
        {
            var all = new MemoryStream();
            var names = new List<string>(files.Keys);
            names.Sort(StringComparer.Ordinal);
            foreach (string n in names)
            {
                var nb = System.Text.Encoding.UTF8.GetBytes(n + "\n" + files[n].Length + "\n");
                all.Write(nb, 0, nb.Length);
                all.Write(files[n], 0, files[n].Length);
            }
            hash = BitConverter.ToString(sha.ComputeHash(all.ToArray()), 0, 6).Replace("-", "").ToLowerInvariant();
        }
        string folder = Path.Combine(dir, "adb-" + hash);
        try { return WriteAll(files, folder); }
        catch (IOException) { return WriteAll(files, folder + "-" + Guid.NewGuid().ToString("N").Substring(0, 8)); }
    }

    static string WriteAll(IDictionary<string, byte[]> files, string folder)
    {
        Directory.CreateDirectory(folder);
        foreach (var kv in files)
        {
            string p = Path.Combine(folder, kv.Key);
            if (File.Exists(p) && Sdb.SameBytes(File.ReadAllBytes(p), kv.Value)) continue;
            File.WriteAllBytes(p, kv.Value);
        }
        return Path.Combine(folder, "adb.exe");
    }

    /** Stops adb's background server so it doesn't linger or clash with Android Studio's. Never throws. */
    public void Stop()
    {
        try { runner.Run(new[] { "kill-server" }); } catch { }
    }

    /** `adb mdns services`: the TVs advertising wireless debugging on this network. "" if adb can't say. Never throws. */
    public string MdnsServices()
    {
        try { return runner.Run(new[] { "mdns", "services" }).Output ?? ""; } catch { return ""; }
    }

    /** One-time pairing (Android 11+ "Wireless debugging"): `hostPort` and `code` are both shown on the TV. */
    public void Pair(string hostPort, string code)
    {
        Check(hostPort);
        if (string.IsNullOrWhiteSpace(code) || !Regex.IsMatch(code.Trim(), @"^\d+$"))
            throw new TvInstallException("The pairing code should be just the numbers shown on the TV.");
        var r = runner.Run(new[] { "pair", hostPort, code.Trim() });
        if (r.Output.IndexOf("Successfully paired", StringComparison.OrdinalIgnoreCase) < 0)
            throw new TvInstallException("That code didn't work. Codes change each time you open the pairing screen; open it again and type the new one.");
    }

    public void Connect(string hostPort)
    {
        Check(hostPort);
        var r = runner.Run(new[] { "connect", hostPort });
        if (IsUnauthorized(r.Output)) throw new TvInstallException(NotAllowed);
        string o = r.Output.ToLowerInvariant();
        bool ok = (o.Contains("connected to") && !o.Contains("failed") && !o.Contains("cannot")) || o.Contains("already connected");
        if (!ok) throw new TvInstallException(NoAnswer(hostPort));
    }

    /** Reads the TV's maker, model and Android version. The TV must already be connected. */
    public AndroidTvInfo Describe(string hostPort)
    {
        Check(hostPort);
        string maker = Prop(hostPort, "ro.product.manufacturer");
        string model = Prop(hostPort, "ro.product.model");
        string sdkText = Prop(hostPort, "ro.build.version.sdk");
        int sdk;
        if (model.Length == 0 || !int.TryParse(sdkText, out sdk)) throw new TvInstallException(NoAnswer(hostPort));
        string name = maker.Length == 0 || model.StartsWith(maker, StringComparison.OrdinalIgnoreCase) ? model : maker + " " + model;
        return new AndroidTvInfo { Target = hostPort, Name = name, Model = model, Sdk = sdk };
    }

    /** Installs the APK (keeping the app's data if it is already there) and starts the app. */
    public void Install(string hostPort, string apkPath)
    {
        Check(hostPort);
        var inst = installRunner.Run(new[] { "-s", hostPort, "install", "-r", apkPath });
        if (IsUnauthorized(inst.Output)) throw new TvInstallException(NotAllowed);
        var m = InstallFailed.Match(inst.Output);
        if (m.Success) throw new TvInstallException(InstallFailure(m.Groups["code"].Value, m.Groups["detail"].Value.Trim()));
        if (!InstallSuccess.IsMatch(inst.Output))
            throw new TvInstallException("The TV didn't confirm the install. " + Tail(inst.Output));

        var run = runner.Run(new[] { "-s", hostPort, "shell", "am", "start", "-n", Activity });
        if (run.ExitCode != 0 || run.Output.IndexOf("Error", StringComparison.OrdinalIgnoreCase) >= 0)
            throw new TvInstallException("Foxbloom is installed on the TV, but it didn't start on its own. Open it from the TV's Apps list. " + Tail(run.Output));
    }

    /** The message when the TV hasn't (yet) accepted this PC; the setup waits on its "Allow on the TV" page for it. */
    public const string NotAllowed = "The TV hasn't allowed this PC yet. Choose Allow (tick Always allow) on the TV, then try again.";

    static string NoAnswer(string hostPort)
    {
        return "The TV didn't answer at " + hostPort + ". Check Wireless debugging (or Network debugging) is still on and the address matches the TV's screen.";
    }

    static bool IsUnauthorized(string output)
    {
        return output.IndexOf("unauthorized", StringComparison.OrdinalIgnoreCase) >= 0 ||
               output.IndexOf("failed to authenticate", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    string Prop(string hostPort, string name)
    {
        var r = runner.Run(new[] { "-s", hostPort, "shell", "getprop", name });
        if (IsUnauthorized(r.Output)) throw new TvInstallException(NotAllowed);
        return r.ExitCode != 0 ? "" : r.Output.Trim();
    }

    // The address goes onto a command line, so only ip:port is accepted.
    static void Check(string hostPort)
    {
        if (string.IsNullOrWhiteSpace(hostPort) || !HostPort.IsMatch(hostPort))
            throw new TvInstallException("That isn't a valid TV address.");
    }

    static string InstallFailure(string code, string detail)
    {
        switch (code)
        {
            case "INSTALL_FAILED_UPDATE_INCOMPATIBLE":
                return "This TV already has a Foxbloom signed by someone else (for example a test build). Remove Foxbloom from the TV (Settings > Apps), then try again.";
            case "INSTALL_FAILED_OLDER_SDK":
                return "This TV's Android is too old for Foxbloom (it needs Android 7 or newer).";
            case "INSTALL_FAILED_INSUFFICIENT_STORAGE":
                return "The TV is out of space. Remove an app you don't use, then try again.";
            default:
                return "The TV refused to install the app. (error " + code + (detail.Length > 0 ? ": " + detail : "") + ")";
        }
    }

    static string Tail(string output)
    {
        string t = (output ?? "").Trim();
        if (t.Length > 300) t = t.Substring(t.Length - 300);
        return t.Length == 0 ? "" : "(" + t.Replace("\r", " ").Replace("\n", " ") + ")";
    }
}
