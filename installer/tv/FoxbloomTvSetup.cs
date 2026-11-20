// FoxbloomTVSetup.exe: finds Samsung TVs and Android TVs / Google TVs on the network and installs the Foxbloom TV app.
//
// Built by installer\tv\build.ps1 with the .NET Framework C# compiler (no NuGet).
//   Samsung: find (TvDiscovery.cs), Developer Mode help, certificate (SamsungCert.cs), signing (WgtSigner.cs),
//            sdb install (Sdb.cs) - InstallOn().
//   Android: find (AndroidDiscovery.cs: Wireless debugging over mDNS, Network debugging on port 5555), pairing,
//            adb install of the embedded Foxbloom.apk (Adb.cs) - InstallOnAndroid().
// Command line: FoxbloomTVSetup.exe --tv <ip> (or <ip>:<port> for an Android TV) skips the list (for development).
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: AssemblyTitle("Foxbloom TV Setup")]
[assembly: AssemblyProduct("Foxbloom")]
[assembly: AssemblyDescription("Installs the Foxbloom app on a Samsung TV or an Android TV")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

static class Program
{
    [DllImport("user32.dll")]
    static extern bool SetProcessDPIAware();

    [STAThread]
    static void Main(string[] args)
    {
        try { SetProcessDPIAware(); } catch { }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        string tv = null;
        for (int i = 0; i < args.Length - 1; i++) if (args[i] == "--tv") tv = args[i + 1].Trim();
        Application.Run(new TvSetupForm(tv));
    }
}

/** Same family as the server installer: midnight blue with the rose accent. */
static class Theme
{
    public static readonly Color Bg = Color.FromArgb(22, 28, 50);
    public static readonly Color Panel = Color.FromArgb(29, 36, 64);
    public static readonly Color Raised = Color.FromArgb(38, 47, 82);
    public static readonly Color LineStrong = Color.FromArgb(66, 77, 122);
    public static readonly Color Text = Color.FromArgb(238, 240, 247);
    public static readonly Color Muted = Color.FromArgb(160, 168, 192);
    public static readonly Color Accent = Color.FromArgb(242, 167, 195);
    public static readonly Color AccentHover = Color.FromArgb(247, 191, 212);
    public static readonly Color AccentInk = Color.FromArgb(58, 20, 40);
    public static readonly Color Danger = Color.FromArgb(242, 109, 109);
    public static readonly Color Ok = Color.FromArgb(76, 195, 138);

    public static Font Body(float size) { return new Font("Segoe UI", size); }
    public static Font Bold(float size) { return new Font("Segoe UI Semibold", size); }

    public static GraphicsPath Rounded(RectangleF r, float radius)
    {
        var p = new GraphicsPath();
        float d = Math.Min(radius * 2, Math.Min(r.Width, r.Height));
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }

    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    public static void DarkTitleBar(IntPtr hwnd)
    {
        int on = 1;
        try { if (DwmSetWindowAttribute(hwnd, 20, ref on, 4) != 0) DwmSetWindowAttribute(hwnd, 19, ref on, 4); } catch { }
    }
}

/** The Foxbloom fox (same drawing as installer\MediarrSetup.cs, the web logo and the tray icon), on a 64-unit grid. */
class Logo : Control
{
    public Logo() { SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor, true); BackColor = Color.Transparent; }

    static void Poly(Graphics g, Brush b, params float[] p)
    {
        var pts = new PointF[p.Length / 2];
        for (int i = 0; i < pts.Length; i++) pts[i] = new PointF(p[2 * i], p[2 * i + 1]);
        g.FillPolygon(b, pts);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.ScaleTransform(Width / 64f, Height / 64f);
        using (var tile = Theme.Rounded(new RectangleF(0, 0, 64, 64), 16))
        using (var night = new SolidBrush(Color.FromArgb(29, 36, 64)))
        using (var pink = new SolidBrush(Color.FromArgb(244, 143, 174)))
        using (var shade = new SolidBrush(Color.FromArgb(226, 118, 154)))
        using (var dark = new SolidBrush(Color.FromArgb(59, 21, 48)))
        using (var cream = new SolidBrush(Color.FromArgb(255, 244, 247)))
        using (var white = new SolidBrush(Color.White))
        {
            g.FillPath(night, tile);
            Poly(g, pink, 12, 4, 28, 18, 14, 26);
            Poly(g, shade, 52, 4, 36, 18, 50, 26);
            Poly(g, dark, 12, 4, 17.4f, 8.8f, 13.2f, 11.6f);
            Poly(g, dark, 52, 4, 46.6f, 8.8f, 50.8f, 11.6f);
            Poly(g, cream, 14.8f, 12.4f, 23.4f, 19.2f, 16, 23.4f);
            Poly(g, cream, 49.2f, 12.4f, 40.6f, 19.2f, 48, 23.4f);
            using (var head = new GraphicsPath())
            {
                head.AddBezier(16, 18, 24, 14, 40, 14, 48, 18);
                head.AddLines(new[] { new PointF(48, 18), new PointF(52, 28), new PointF(60, 34), new PointF(50, 37), new PointF(45, 45), new PointF(32, 54), new PointF(19, 45), new PointF(14, 37), new PointF(4, 34), new PointF(12, 28), new PointF(16, 18) });
                head.CloseFigure();
                g.FillPath(pink, head);
            }
            using (var brow = new GraphicsPath())
            {
                brow.AddLine(26.6f, 16.8f, 32, 22.6f); brow.AddLine(32, 22.6f, 37.4f, 16.8f);
                brow.AddBezier(37.4f, 16.8f, 34, 16, 30, 16, 26.6f, 16.8f);
                brow.CloseFigure();
                g.FillPath(shade, brow);
            }
            using (var face = new GraphicsPath())
            {
                face.AddLine(5, 34, 14, 32.6f);
                face.AddBezier(14, 32.6f, 19, 38.6f, 25, 41.4f, 32, 42.6f);
                face.AddBezier(32, 42.6f, 39, 41.4f, 45, 38.6f, 50, 32.6f);
                face.AddLines(new[] { new PointF(50, 32.6f), new PointF(59, 34), new PointF(50, 37.6f), new PointF(45, 45), new PointF(32, 54), new PointF(19, 45), new PointF(14, 37.6f) });
                face.CloseFigure();
                g.FillPath(cream, face);
            }
            using (var nose = new GraphicsPath())
            {
                nose.AddBezier(29.4f, 49.4f, 29.4f, 47.8f, 34.6f, 47.8f, 34.6f, 49.4f);
                nose.AddBezier(34.6f, 49.4f, 34.6f, 51, 33, 52.4f, 32, 52.4f);
                nose.AddBezier(32, 52.4f, 31, 52.4f, 29.4f, 51, 29.4f, 49.4f);
                nose.CloseFigure();
                g.FillPath(dark, nose);
            }
            g.FillEllipse(dark, 20.3f, 26.8f, 6.6f, 7.6f);
            g.FillEllipse(dark, 37.1f, 26.8f, 6.6f, 7.6f);
            g.FillEllipse(white, 23.55f, 27.95f, 2.5f, 2.5f);
            g.FillEllipse(white, 40.35f, 27.95f, 2.5f, 2.5f);
        }
    }
}

/** Rounded button: the rose one is the main action, the other is quiet. */
class ThemedButton : Button
{
    public bool Primary;
    bool hover, down;

    public ThemedButton(string text, bool primary)
    {
        Text = text;
        Primary = primary;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
        Font = Theme.Bold(10f);
        Cursor = Cursors.Hand;
    }

    protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hover = false; down = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnMouseDown(MouseEventArgs e) { down = true; Invalidate(); base.OnMouseDown(e); }
    protected override void OnMouseUp(MouseEventArgs e) { down = false; Invalidate(); base.OnMouseUp(e); }
    protected override void OnEnabledChanged(EventArgs e) { Invalidate(); base.OnEnabledChanged(e); }
    protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
    protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.Clear(Parent != null ? Parent.BackColor : Theme.Bg);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        Color fill, text, border;
        if (Primary)
        {
            fill = hover ? Theme.AccentHover : Theme.Accent;
            if (down) fill = ControlPaint.Dark(fill, 0.05f);
            text = Theme.AccentInk;
            border = fill;
        }
        else
        {
            fill = hover ? Theme.LineStrong : Theme.Raised;
            text = Theme.Text;
            border = Theme.LineStrong;
        }
        if (!Enabled) { fill = Color.FromArgb(Primary ? 110 : 255, fill); text = Theme.Muted; }
        using (var path = Theme.Rounded(new RectangleF(1, 1, Width - 3, Height - 3), 9))
        {
            using (var b = new SolidBrush(fill)) g.FillPath(b, path);
            using (var p = new Pen(border)) g.DrawPath(p, path);
        }
        if (Focused && ShowFocusCues)
            using (var path = Theme.Rounded(new RectangleF(0, 0, Width - 1, Height - 1), 10))
            using (var p = new Pen(Theme.AccentHover, 1.5f)) g.DrawPath(p, path);
        TextRenderer.DrawText(g, Text, Font, ClientRectangle, text, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
    }
}

/** A rose stripe that slides along while something is happening. */
class Activity : Control
{
    readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = 16 };
    float pos;
    public Activity()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
        Height = 6;
        timer.Tick += delegate { pos += 0.012f; if (pos > 1.3f) pos = -0.3f; Invalidate(); };
    }
    protected override void OnVisibleChanged(EventArgs e) { timer.Enabled = Visible; base.OnVisibleChanged(e); }
    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.Clear(Parent != null ? Parent.BackColor : Theme.Bg);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using (var path = Theme.Rounded(new RectangleF(0, 0, Width - 1, Height - 1), 3))
        using (var b = new SolidBrush(Theme.Raised)) g.FillPath(b, path);
        float w = Width * 0.3f, x = pos * Width;
        var seg = RectangleF.Intersect(new RectangleF(x, 0, w, Height - 1), new RectangleF(0, 0, Width - 1, Height - 1));
        if (seg.Width > 2)
            using (var path = Theme.Rounded(seg, 3))
            using (var b = new SolidBrush(Theme.Accent)) g.FillPath(b, path);
    }
    protected override void Dispose(bool disposing) { if (disposing) timer.Dispose(); base.Dispose(disposing); }
}

/**
 * One TV in the list. Samsung: name, "Samsung TV", model and whether Developer Mode is on. Android: "Android TV", its
 * address and which kind of debugging it was found by. Click, or Enter / Space, picks it.
 */
class TvRow : Control
{
    public readonly TvInfo Tv;               // a Samsung TV, or null
    public readonly AndroidTarget Android;   // an Android TV, or null
    readonly string title, detail, pill;
    readonly bool pillOk;
    bool hover;

    public TvRow(TvInfo tv)
        : this(DisplayName(tv), "Samsung TV  ·  " + (string.IsNullOrEmpty(tv.Model) ? "" : tv.Model + "  ·  ") + tv.Ip,
               tv.DeveloperMode ? "Developer Mode on" : "Developer Mode off", tv.DeveloperMode)
    { Tv = tv; }

    public TvRow(AndroidTarget tv)
        : this("Android TV", "Android TV  ·  " + tv.Ip, tv.Wireless ? "Wireless debugging on" : "Network debugging on", true)
    { Android = tv; }

    TvRow(string title, string detail, string pill, bool pillOk)
    {
        this.title = title; this.detail = detail; this.pill = pill; this.pillOk = pillOk;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.Selectable, true);
        TabStop = true;
        Cursor = Cursors.Hand;
    }

    public static string DisplayName(TvInfo tv)
    {
        var n = (tv.Name ?? "").Trim();
        if (n.StartsWith("[TV] ")) n = n.Substring(5);
        return n.Length > 0 ? n : "Samsung TV";
    }

    protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
    protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }
    protected override bool IsInputKey(Keys k) { return k == Keys.Enter || k == Keys.Space || base.IsInputKey(k); }
    protected override void OnKeyDown(KeyEventArgs e)
    {
        if (e.KeyCode == Keys.Enter || e.KeyCode == Keys.Space) { e.Handled = true; OnClick(EventArgs.Empty); }
        base.OnKeyDown(e);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.Clear(Parent != null ? Parent.BackColor : Theme.Bg);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using (var path = Theme.Rounded(new RectangleF(1, 1, Width - 3, Height - 3), 10))
        {
            using (var b = new SolidBrush(hover ? Theme.LineStrong : Theme.Raised)) g.FillPath(b, path);
            using (var p = new Pen(Theme.LineStrong)) g.DrawPath(p, path);
        }
        if (Focused && ShowFocusCues)
            using (var path = Theme.Rounded(new RectangleF(0, 0, Width - 1, Height - 1), 11))
            using (var p = new Pen(Theme.AccentHover, 1.5f)) g.DrawPath(p, path);
        float s = Width / 560f;
        int pad = (int)(16 * s);
        using (var f = Theme.Bold(11f))
            TextRenderer.DrawText(g, title, f, new Rectangle(pad, (int)(8 * s), Width - 2 * pad - (int)(190 * s), (int)(26 * s)), Theme.Text, TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine);
        using (var f = Theme.Body(9f))
            TextRenderer.DrawText(g, detail, f, new Rectangle(pad, (int)(34 * s), Width - 2 * pad - (int)(190 * s), (int)(22 * s)), Theme.Muted, TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine);
        // Developer Mode / debugging pill on the right.
        Color c = pillOk ? Theme.Ok : Theme.Muted;
        using (var f = Theme.Body(9f))
        {
            var sz = TextRenderer.MeasureText(pill, f);
            var r = new RectangleF(Width - pad - sz.Width - 20 * s, Height / 2f - 12 * s, sz.Width + 20 * s, 24 * s);
            using (var path = Theme.Rounded(r, 12 * s))
            using (var p = new Pen(c)) g.DrawPath(p, path);
            TextRenderer.DrawText(g, pill, f, Rectangle.Round(r), c, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
        }
    }
}

class TvSetupForm : Form
{
    readonly string startIp;
    readonly Panel body = new Panel();
    float dpi = 1f;
    int scan;           // bumped on every new page so a late scan result can't replace a newer screen
    int W;              // body width in pixels

    int P(int v) { return (int)Math.Round(v * dpi); }

    public TvSetupForm(string startIp)
    {
        this.startIp = string.IsNullOrEmpty(startIp) ? null : startIp;
        using (var g = CreateGraphics()) dpi = g.DpiX / 96f;
        Text = "Foxbloom TV Setup";
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Theme.Bg;
        ForeColor = Theme.Text;
        Font = Theme.Body(10f);
        ClientSize = new Size(P(640), P(640));

        var logo = new Logo { Location = new Point(P(28), P(24)), Size = new Size(P(44), P(44)) };
        Controls.Add(logo);
        Controls.Add(Label("Foxbloom for Samsung and Android TV", Theme.Bold(15f), Theme.Text, 84, 22, 430, 30));
        Controls.Add(Label("Put Foxbloom on your TV", Theme.Body(9.5f), Theme.Muted, 85, 50, 500, 20));
        var licences = new LinkLabel
        {
            Text = "Licences", Font = Theme.Body(9f), AutoSize = false, TextAlign = ContentAlignment.MiddleRight,
            Location = new Point(P(520), P(28)), Size = new Size(P(92), P(20)), BackColor = Color.Transparent,
            LinkColor = Theme.Muted, ActiveLinkColor = Theme.Accent, VisitedLinkColor = Theme.Muted, LinkBehavior = LinkBehavior.HoverUnderline,
        };
        licences.LinkClicked += delegate { ShowLicences(); };
        Controls.Add(licences);

        body.Location = new Point(0, P(88));
        body.Size = new Size(P(640), P(640 - 88));
        body.BackColor = Theme.Bg;
        W = P(640 - 56);
        Controls.Add(body);
    }

    volatile Sdb activeSdb;   // the sdb in use by a running install, so closing the window can stop its server
    volatile Adb activeAdb;   // the same for adb (a scan, an address lookup or an Android install)

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        var sdb = activeSdb;
        var adb = activeAdb;
        // Off the UI thread so closing the window never waits on sdb / adb; the process stays alive until the thread ends.
        if (sdb != null || adb != null)
        {
            var t = new Thread(delegate () { if (sdb != null) sdb.Stop(); if (adb != null) adb.Stop(); });
            t.IsBackground = false;
            t.Start();
        }
        base.OnFormClosed(e);
    }

    protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); Theme.DarkTitleBar(Handle); }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        if (startIp != null) Contact(startIp); else StartScan();
    }

    /** The third-party notices (THIRD-PARTY.txt) and licence texts (LICENSES.txt) embedded by build.ps1. */
    void ShowLicences()
    {
        // A TextBox needs CRLF line breaks; the files may come with LF only.
        string text = (Resource("THIRD-PARTY.txt") + "\n\n" + Resource("LICENSES.txt")).Replace("\r\n", "\n").Replace("\n", "\r\n");
        using (var f = new Form())
        {
            f.Text = "Foxbloom TV Setup - licences";
            f.StartPosition = FormStartPosition.CenterParent;
            f.ClientSize = new Size(P(620), P(520));
            f.MinimizeBox = false;
            f.ShowInTaskbar = false;
            f.BackColor = Theme.Bg;
            try { f.Icon = Icon; } catch { }
            var box = new TextBox
            {
                Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, WordWrap = true, Dock = DockStyle.Fill,
                Font = new Font("Consolas", 9f), BackColor = Theme.Panel, ForeColor = Theme.Text, BorderStyle = BorderStyle.None,
                Text = text,
            };
            f.Controls.Add(box);
            f.HandleCreated += delegate { Theme.DarkTitleBar(f.Handle); };
            f.Shown += delegate { box.SelectionLength = 0; box.SelectionStart = 0; };
            f.ShowDialog(this);
        }
    }

    static string Resource(string name)
    {
        using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
        {
            if (s == null) return "(" + name + " is missing from this build.)";
            using (var r = new System.IO.StreamReader(s, System.Text.Encoding.UTF8)) return r.ReadToEnd();
        }
    }

    // ---- building blocks ----

    Label Label(string text, Font font, Color color, int x, int y, int w, int h)
    {
        return new Label { Text = text, Font = font, ForeColor = color, BackColor = Color.Transparent, AutoSize = false, Location = new Point(P(x), P(y)), Size = new Size(P(w), P(h)), UseCompatibleTextRendering = false, UseMnemonic = false };
    }

    ThemedButton Button(string text, bool primary, int x, int y, int w, EventHandler click)
    {
        var b = new ThemedButton(text, primary) { Location = new Point(P(x), P(y)), Size = new Size(P(w), P(40)) };
        b.Click += click;
        return b;
    }

    /** Clears the page and returns the body so the caller can add controls (coordinates are 96-dpi pixels from the body's top-left). */
    Panel NewPage()
    {
        scan++;
        foreach (Control c in body.Controls.Cast<Control>().ToList()) { body.Controls.Remove(c); c.Dispose(); }
        return body;
    }

    void Add(Control c) { body.Controls.Add(c); }

    // ---- scanning ----

    void StartScan()
    {
        NewPage();
        int mine = scan;
        Add(Label("Looking for TVs…", Theme.Bold(14f), Theme.Text, 28, 20, 580, 34));
        Add(Label("Make sure your TV is switched on and on the same network as this PC. This takes a few seconds.", Theme.Body(10f), Theme.Muted, 28, 60, 580, 48));
        Add(new Activity { Location = new Point(P(28), P(120)), Size = new Size(W, P(6)) });
        Task.Factory.StartNew(delegate ()
        {
            // Samsung and Android at the same time, each with the same time limit.
            var samsung = Task.Factory.StartNew(delegate ()
            {
                try { return TvDiscovery.Find(TimeSpan.FromSeconds(9)); } catch (Exception) { return new List<TvInfo>(); }
            });
            List<AndroidTarget> androids;
            Adb adb = null;
            try
            {
                // Without the embedded adb (a -NoVendor build) only the port-5555 sweep runs.
                try { if (AndroidPackaged()) { adb = Adb.Embedded(); activeAdb = adb; } } catch (TvInstallException) { }
                androids = AndroidDiscovery.Find(adb, TimeSpan.FromSeconds(9));
            }
            catch (Exception) { androids = new List<AndroidTarget>(); }
            finally { if (adb != null) adb.Stop(); activeAdb = null; }
            var tvs = samsung.Result;
            androids.RemoveAll(a => tvs.Any(t => t.Ip == a.Ip));
            OnUi(delegate { if (mine == scan) ShowList(tvs, androids); });
        });
    }

    void OnUi(Action a)
    {
        if (IsDisposed || !IsHandleCreated) return;
        try { BeginInvoke(a); } catch (InvalidOperationException) { }
    }

    // ---- TV list / none found ----

    void ShowList(List<TvInfo> tvs, List<AndroidTarget> androids)
    {
        NewPage();
        AcceptButton = null;
        int count = tvs.Count + androids.Count;
        if (count == 0)
        {
            Add(Label("No TVs found", Theme.Bold(14f), Theme.Text, 28, 20, 580, 34));
            Add(Label("Check that the TV is switched on (not just in standby) and on the same Wi-Fi or network as this PC.\n\nOr type the TV's address yourself. On a Samsung TV you can find it under Settings > General > Network > Network Status > IP Settings.\n\nAndroid TV or Google TV? It only shows up once Wireless debugging (or, on older TVs, Network debugging) is on.", Theme.Body(10f), Theme.Muted, 28, 62, 580, 180));
            Add(Button("Enter an address", true, 28, 256, 200, delegate { ShowAddress(null, ""); }));
            Add(Button("Scan again", false, 240, 256, 160, delegate { StartScan(); }));
            Add(Button("Android TV help", false, 412, 256, 172, delegate { ShowAndroidHelp(); }));
            return;
        }
        Add(Label(count == 1 ? "Found your TV" : "Found " + count + " TVs", Theme.Bold(14f), Theme.Text, 28, 20, 580, 34));
        Add(Label("Pick the one to put Foxbloom on.", Theme.Body(10f), Theme.Muted, 28, 56, 580, 24));
        int y = 92;
        var rows = tvs.Select(t => new TvRow(t)).Concat(androids.Select(a => new TvRow(a))).ToList();
        foreach (var row in rows.Take(5))   // five fit above the buttons; any others: Enter an address
        {
            row.Location = new Point(P(28), P(y));
            row.Size = new Size(W, P(64));
            var picked = row;
            row.Click += delegate { if (picked.Tv != null) Chosen(picked.Tv); else ChosenAndroid(picked.Android); };
            Add(row);
            y += 72;
        }
        foreach (var unused in rows.Skip(5)) unused.Dispose();
        y += 8;
        Add(Button("Enter an address", false, 28, y, 200, delegate { ShowAddress(null, ""); }));
        Add(Button("Scan again", false, 240, y, 160, delegate { StartScan(); }));
    }

    // ---- enter an address ----

    void ShowAddress(string error, string prefill)
    {
        NewPage();
        Add(Label("Enter the TV's address", Theme.Bold(14f), Theme.Text, 28, 20, 580, 34));
        Add(Label("Samsung TV: Settings > General > Network > Network Status > IP Settings. It looks like 192.168.1.50.\n\nAndroid TV: the IP address & Port under Developer options > Wireless debugging, like 192.168.1.50:37000. Or just the address, like 192.168.1.50.", Theme.Body(10f), Theme.Muted, 28, 60, 580, 92));

        var box = new TextBox { Text = prefill, Font = Theme.Body(14f), BorderStyle = BorderStyle.FixedSingle, BackColor = Theme.Raised, ForeColor = Theme.Text, Location = new Point(P(28), P(162)), Size = new Size(P(300), P(34)), MaxLength = 45 };
        Add(box);
        var err = Label(error ?? "", Theme.Body(10f), Theme.Danger, 28, 208, 580, 48);
        Add(err);
        EventHandler go = delegate
        {
            string address = ParseAddress(box.Text);
            if (address == null) { err.Text = "That doesn't look like an address. It should be four numbers separated by dots, like 192.168.1.50 (an Android TV's may end in a port, like 192.168.1.50:37000)."; return; }
            Contact(address);
        };
        var cont = Button("Continue", true, 28, 264, 160, go);
        Add(cont);
        Add(Button("Back", false, 200, 264, 120, delegate { StartScan(); }));
        AcceptButton = cont;
        box.Focus();
    }

    /** "192.168.1.50" or "192.168.1.50:37000", tidied; null if it is neither. */
    static string ParseAddress(string text)
    {
        string t = (text ?? "").Trim();
        int port = 0;
        int colon = t.IndexOf(':');
        if (colon >= 0)
        {
            if (!int.TryParse(t.Substring(colon + 1), System.Globalization.NumberStyles.None, null, out port) || port < 1 || port > 65535) return null;
            t = t.Substring(0, colon);
        }
        System.Net.IPAddress parsed;
        if (t.Split('.').Length != 4 || !System.Net.IPAddress.TryParse(t, out parsed) || parsed.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork) return null;
        return parsed.ToString() + (port > 0 ? ":" + port : "");
    }

    /**
     * `ip:port` is an Android TV. A plain `ip` is asked whether it is a Samsung TV, then whether it has Network
     * debugging (port 5555) or Wireless debugging (mDNS); then it carries on like a TV picked from the list.
     */
    void Contact(string address)
    {
        string tidy = ParseAddress(address);
        if (tidy == null) { ShowAddress("That doesn't look like an address: " + address, address); return; }
        address = tidy;
        int colon = address.IndexOf(':');
        if (colon >= 0)
        {
            int port = int.Parse(address.Substring(colon + 1));
            ChosenAndroid(new AndroidTarget { Ip = address.Substring(0, colon), ConnectPort = port, Wireless = port != AndroidDiscovery.ClassicPort });
            return;
        }
        string ip = address;
        NewPage();
        int mine = scan;
        AcceptButton = null;
        Add(Label("Contacting " + ip + "…", Theme.Bold(14f), Theme.Text, 28, 20, 580, 34));
        Add(new Activity { Location = new Point(P(28), P(70)), Size = new Size(W, P(6)) });
        Task.Factory.StartNew(delegate ()
        {
            TvInfo tv = null;
            AndroidTarget android = null;
            try
            {
                tv = TvDiscovery.Describe(ip);
                if (tv == null && TvDiscovery.ProbeOpen(new[] { ip }, AndroidDiscovery.ClassicPort, TimeSpan.FromSeconds(2)).Count > 0)
                    android = new AndroidTarget { Ip = ip, ConnectPort = AndroidDiscovery.ClassicPort, Wireless = false };
                if (tv == null && android == null) android = WirelessAt(ip);
            }
            catch (Exception) { }
            OnUi(delegate
            {
                if (mine != scan) return;
                if (tv != null) Chosen(tv);
                else if (android != null) ChosenAndroid(android);
                else ShowUnsupported(ip);
            });
        });
    }

    /** Asks adb's mDNS browser, for a few seconds, whether the TV at `ip` has Wireless debugging on. null if not (or no adb). */
    AndroidTarget WirelessAt(string ip)
    {
        if (!AndroidPackaged()) return null;
        Adb adb = null;
        try
        {
            adb = Adb.Embedded();
            activeAdb = adb;
            var until = DateTime.UtcNow.AddSeconds(6);
            while (true)
            {
                var t = AndroidDiscovery.ParseMdns(adb.MdnsServices()).FirstOrDefault(x => x.Ip == ip && x.Wireless);
                if (t != null || DateTime.UtcNow > until) return t;
                Thread.Sleep(1000);
            }
        }
        catch (Exception) { return null; }
        finally { if (adb != null) adb.Stop(); activeAdb = null; }
    }

    // ---- after a TV is chosen ----

    void Chosen(TvInfo tv)
    {
        string pc = TvDiscovery.RouteAddress(tv.Ip);
        if (TvDiscovery.NeedsDeveloperSetup(tv, pc)) ShowDeveloperHelp(tv, pc, null);
        else ShowReady(tv);
    }

    void ShowDeveloperHelp(TvInfo tv, string pc, string note)
    {
        NewPage();
        AcceptButton = null;
        string why = !tv.DeveloperMode
            ? "Developer Mode is off on " + TvRow.DisplayName(tv) + "."
            : "Developer Mode on " + TvRow.DisplayName(tv) + (string.IsNullOrWhiteSpace(tv.DeveloperIp) ? " has no PC address set." : " is set up for a different PC (" + tv.DeveloperIp + ").");
        Add(Label("Turn on Developer Mode", Theme.Bold(14f), Theme.Text, 28, 16, 580, 32));
        Add(Label(why, Theme.Body(10f), Theme.Muted, 28, 50, 580, 24));
        Add(Label("1.  On the TV, open Apps.\n2.  On the remote, press 1 2 3 4 5 one after the other.\n3.  Switch Developer Mode to On.\n4.  In Host PC IP, type this PC's address:\n", Theme.Body(10.5f), Theme.Text, 28, 82, 580, 104));

        var ipLabel = Label(pc, Theme.Bold(30f), Theme.Accent, 28, 188, 580, 56);
        Add(ipLabel);
        Add(Label("5.  Press OK, then restart the TV (hold the power button until it switches off and on).", Theme.Body(10.5f), Theme.Text, 28, 284, 580, 48));

        var status = Label(note ?? "", Theme.Body(10f), Theme.Danger, 28, 342, 580, 44);
        Add(status);
        Button check = null;
        check = Button("Check again", true, 28, 400, 160, delegate
        {
            check.Enabled = false;
            status.ForeColor = Theme.Muted;
            status.Text = "Checking " + tv.Ip + "…";
            int mine = scan;
            Task.Factory.StartNew(delegate ()
            {
                TvInfo now = TvDiscovery.Describe(tv.Ip);
                OnUi(delegate
                {
                    if (mine != scan) return;
                    if (now == null) { check.Enabled = true; status.ForeColor = Theme.Danger; status.Text = "The TV isn't answering. If you just restarted it, give it a minute and try again."; return; }
                    string pcNow = TvDiscovery.RouteAddress(now.Ip);
                    if (TvDiscovery.NeedsDeveloperSetup(now, pcNow))
                        ShowDeveloperHelp(now, pcNow, !now.DeveloperMode ? "Developer Mode is still off. Switch it on, enter the address above, press OK and restart the TV." : "Developer Mode points at " + now.DeveloperIp + ", not this PC (" + pcNow + "). Enter the address above, press OK and restart the TV.");
                    else ShowReady(now);
                });
            });
        });
        Add(check);
        Add(Button("Choose another TV", false, 200, 400, 200, delegate { StartScan(); }));
        check.Focus();
    }

    // ---- ready to install ----

    void ShowReady(TvInfo tv)
    {
        NewPage();
        AcceptButton = null;
        Add(Label("Ready to install on " + TvRow.DisplayName(tv), Theme.Bold(14f), Theme.Text, 28, 20, 580, 34));
        Add(Label("Developer Mode is on and set up for this PC.\n\nThe first time, you'll be asked to sign in with a Samsung account in your browser. It's free, and it's what lets the TV trust Foxbloom.", Theme.Body(10f), Theme.Muted, 28, 62, 580, 110));
        var install = Button("Install", true, 28, 190, 160, delegate { InstallOn(tv); });
        Add(install);
        Add(Button("Choose another TV", false, 200, 190, 200, delegate { StartScan(); }));
        install.Focus();
    }

    /**
     * Connect, ask the TV for its certificate ID (DUID), make sure there is a certificate for it (Samsung sign-in the
     * first time), sign the app, install it and start it. All off the UI thread; every failure ends on a screen with
     * a plain message and "Try again". Nothing secret is ever shown.
     */
    void InstallOn(TvInfo tv)
    {
        string name = TvRow.DisplayName(tv);
        NewPage();
        int mine = scan;
        AcceptButton = null;
        Add(Label("Installing on " + name + "…", Theme.Bold(14f), Theme.Text, 28, 20, 580, 34));
        var status = Label("Connecting to the TV…", Theme.Body(10.5f), Theme.Muted, 28, 66, 580, 110);
        Add(status);
        Add(new Activity { Location = new Point(P(28), P(190)), Size = new Size(W, P(6)) });
        Action<string> say = delegate (string text) { OnUi(delegate { if (mine == scan) status.Text = text; }); };

        Task.Factory.StartNew(delegate ()
        {
            string failure = null;
            Sdb sdb = null;
            try
            {
                sdb = Sdb.Embedded();
                activeSdb = sdb;
                string duid = sdb.GetDuid(tv.Ip);
                if (SamsungCert.Status(new[] { duid }) != CertStatus.Ok)
                    say("Signing in to Samsung…\n\nYour browser has opened. Sign in there with your Samsung account and come back here. This can take a minute.");
                else say("Getting the app ready…");
                CertBundle cert = SamsungCert.Ensure(new[] { duid }, SamsungCert.OpenInBrowser);
                say("Signing the app…");
                byte[] signed = WgtSigner.Sign(EmbeddedWgt(), cert);
                say("Installing on " + name + "…\n\nThis takes about a minute. Don't switch the TV off.");
                sdb.InstallTo(tv.Ip, signed, Sdb.DefaultAppId);
            }
            catch (TvInstallException e) { failure = e.Message; }
            catch (SamsungCertException e) { failure = e.Message; }
            catch (Exception e) { failure = "Something unexpected went wrong: " + e.Message; }
            finally { if (sdb != null) sdb.Stop(); activeSdb = null; }
            OnUi(delegate { if (mine == scan) { if (failure == null) ShowDone(tv); else ShowInstallFailed(tv, failure); } });
        });
    }

    static byte[] EmbeddedWgt()
    {
        using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("Foxbloom.wgt"))
        {
            if (s == null) throw new TvInstallException("This copy of Foxbloom TV Setup was built without the app inside it. Download the latest FoxbloomTVSetup.exe from the Foxbloom releases page.");
            var ms = new System.IO.MemoryStream();
            s.CopyTo(ms);
            return ms.ToArray();
        }
    }

    void ShowInstallFailed(TvInfo tv, string message)
    {
        NewPage();
        AcceptButton = null;
        Add(Label("Couldn't install on " + TvRow.DisplayName(tv), Theme.Bold(14f), Theme.Text, 28, 20, 580, 34));
        Add(Label(message, Theme.Body(10.5f), Theme.Danger, 28, 66, 580, 170));
        Add(Label("There's a troubleshooting guide at github.com/Scrapper1824/Foxbloom (tv/README.md).", Theme.Body(9.5f), Theme.Muted, 28, 244, 580, 44));
        var again = Button("Try again", true, 28, 300, 160, delegate { Chosen(tv); });
        Add(again);
        Add(Button("Choose another TV", false, 200, 300, 200, delegate { StartScan(); }));
        again.Focus();
    }

    void ShowDone(TvInfo tv)
    {
        NewPage();
        AcceptButton = null;
        Add(Label("Done — Foxbloom is on your TV", Theme.Bold(14f), Theme.Ok, 28, 20, 580, 34));
        Add(Label("Foxbloom is installed on " + TvRow.DisplayName(tv) + " and should open now. Next time, find it in the TV's Apps list.\n\nOpen it, enter your Foxbloom address, and sign in with the code it shows.", Theme.Body(10.5f), Theme.Muted, 28, 66, 580, 120));
        var another = Button("Install on another TV", false, 28, 200, 220, delegate { StartScan(); });
        Add(another);
        Add(Button("Close", true, 260, 200, 120, delegate { Close(); }));
    }

    // ==== Android TV / Google TV ====

    const string NoAndroidBuild = "This build can't install on Android TVs. Download the latest FoxbloomTVSetup.exe from the Foxbloom releases page.";
    static readonly System.Text.RegularExpressions.Regex HostPort = new System.Text.RegularExpressions.Regex(@"^(\d{1,3}\.){3}\d{1,3}:\d{1,5}$");

    /** True when build.ps1 embedded adb (with its DLLs) and the APK; a -NoVendor build has neither. */
    static bool AndroidPackaged()
    {
        var asm = Assembly.GetExecutingAssembly();
        return Adb.ResourceNames.Concat(new[] { "Foxbloom.apk" }).All(n => asm.GetManifestResourceInfo(n) != null);
    }

    /** Wireless debugging: pair (or connect, if paired before). Network debugging (port 5555): straight to the install. */
    void ChosenAndroid(AndroidTarget tv)
    {
        if (tv.Wireless) ShowPair(tv, null);
        else InstallOnAndroid(tv, null, null);
    }

    void ShowAndroidHelp()
    {
        NewPage();
        AcceptButton = null;
        Add(Label("Set up your Android TV", Theme.Bold(14f), Theme.Text, 28, 16, 580, 32));
        Add(Label("Foxbloom isn't in the Play Store, so the TV has to let this PC install it. Once, on the TV:", Theme.Body(10f), Theme.Muted, 28, 50, 580, 24));
        Add(Label("1.  Turn on Developer options: open Settings > System > About, select Build and press OK on it 7 times, until the TV says you're a developer.\n\n2.  Go back to Settings > System > Developer options and turn on Wireless debugging.\n\n3.  Choose Wireless debugging > Pair device with pairing code, and leave that screen open: it shows the code and address the setup asks for.", Theme.Body(10.5f), Theme.Text, 28, 84, 580, 196));
        Add(Label("Older TVs (Android 10 and earlier) have no Wireless debugging: in Developer options, turn on Network debugging (sometimes called ADB debugging) instead. The TV then asks you to allow this PC.\n\nOn some TVs, About is under Settings > Device Preferences.", Theme.Body(10f), Theme.Muted, 28, 286, 580, 100));
        var again = Button("Scan again", true, 28, 400, 160, delegate { StartScan(); });
        Add(again);
        Add(Button("Enter an address", false, 200, 400, 190, delegate { ShowAddress(null, ""); }));
        Add(Button("My TV has neither", false, 402, 400, 182, delegate { ShowUnsupported(null); }));
        again.Focus();
    }

    /** No way in: shown for "My TV has neither", and when nothing answered at a typed address (`ip`). */
    void ShowUnsupported(string ip)
    {
        NewPage();
        AcceptButton = null;
        Add(Label("Can't set up this TV", Theme.Bold(14f), Theme.Text, 28, 20, 580, 34));
        string why = "This TV can't be set up from the PC: it has neither Wireless debugging nor Network debugging.";
        if (ip != null)
            why = "No TV answered at " + ip + ": not as a Samsung TV, and not as an Android TV with Wireless debugging or Network debugging on.\n\n" +
                  "Check the address, and that the TV is switched on and on the same network as this PC. If it's an Android TV, switch one of them on first (Show me how).\n\n" +
                  "If its Developer options have neither, this TV can't be set up from the PC.";
        Add(Label(why, Theme.Body(10.5f), Theme.Muted, 28, 66, 580, 170));
        var how = Button("Show me how", ip != null, 28, 250, 160, delegate { ShowAndroidHelp(); });
        Add(how);
        Add(Button("Enter an address", false, 200, 250, 190, delegate { ShowAddress(null, ip ?? ""); }));
        Add(Button("Scan again", ip == null, 402, 250, 160, delegate { StartScan(); }));
        how.Focus();
    }

    TextBox Box(string text, int x, int y, int w, int maxLength)
    {
        return new TextBox { Text = text, Font = Theme.Body(13f), BorderStyle = BorderStyle.FixedSingle, BackColor = Theme.Raised, ForeColor = Theme.Text, Location = new Point(P(x), P(y)), Size = new Size(P(w), P(32)), MaxLength = maxLength };
    }

    /** Wireless debugging: the pairing code and the two addresses the TV shows (prefilled from what the scan saw). */
    void ShowPair(AndroidTarget tv, string error)
    {
        NewPage();
        Add(Label("Pair this PC with the TV", Theme.Bold(14f), Theme.Text, 28, 16, 580, 32));
        Add(Label("On the TV: Settings > System > Developer options > Wireless debugging > Pair device with pairing code. Type the code and the address it shows.", Theme.Body(10f), Theme.Muted, 28, 50, 580, 44));

        Add(Label("Pairing code", Theme.Body(10f), Theme.Text, 28, 102, 180, 22));
        var code = Box("", 28, 126, 160, 10);
        Add(code);
        Add(Label("Pairing address (on the pairing screen)", Theme.Body(10f), Theme.Text, 220, 102, 364, 22));
        var pairAt = Box(tv.Ip + ":" + (tv.PairPort > 0 ? tv.PairPort.ToString() : ""), 220, 126, 260, 21);
        Add(pairAt);
        Add(Label("Connection address (Wireless debugging screen, under IP address & Port)", Theme.Body(10f), Theme.Text, 28, 172, 556, 22));
        var connectAt = Box(tv.Ip + ":" + (tv.ConnectPort > 0 ? tv.ConnectPort.ToString() : ""), 28, 196, 260, 21);
        Add(connectAt);
        Add(Label("Paired this PC with the TV before and it's still listed under Paired devices? Leave the code empty.", Theme.Body(9.5f), Theme.Muted, 28, 238, 556, 40));

        var err = Label(error ?? "", Theme.Body(10f), Theme.Danger, 28, 282, 580, 66);
        Add(err);
        EventHandler go = delegate
        {
            string c = code.Text.Trim().Replace(" ", "");
            string p = pairAt.Text.Trim(), a = connectAt.Text.Trim();
            if (!HostPort.IsMatch(a)) { err.Text = "Type the connection address with its port, as the TV's Wireless debugging screen shows it, like 192.168.1.50:37000."; return; }
            if (c.Length > 0 && !System.Text.RegularExpressions.Regex.IsMatch(c, @"^\d+$")) { err.Text = "The pairing code should be just the numbers shown on the TV."; return; }
            if (c.Length > 0 && !HostPort.IsMatch(p)) { err.Text = "Type the pairing address with its port, as the pairing screen shows it, like 192.168.1.50:41234."; return; }
            int colon = a.IndexOf(':');
            int pp, cp = int.Parse(a.Substring(colon + 1));
            var updated = new AndroidTarget
            {
                Ip = a.Substring(0, colon), ConnectPort = cp, Wireless = true,
                PairPort = HostPort.IsMatch(p) && int.TryParse(p.Substring(p.IndexOf(':') + 1), out pp) ? pp : tv.PairPort,
            };
            InstallOnAndroid(updated, c.Length > 0 ? p : null, c.Length > 0 ? c : null);
        };
        var install = Button(error == null ? "Pair and install" : "Try again", true, 28, 360, 180, go);
        Add(install);
        Add(Button("Show me how", false, 220, 360, 160, delegate { ShowAndroidHelp(); }));
        Add(Button("Back", false, 392, 360, 120, delegate { StartScan(); }));
        AcceptButton = install;
        if (tv.ConnectPort > 0) code.Focus(); else connectAt.Focus();
    }

    /**
     * Pair (Wireless debugging, when a code was typed), connect, read the TV's name, install the embedded APK with
     * `install -r` (an update keeps the app's sign-in) and start it. Network debugging: while the TV hasn't allowed
     * this PC, the page turns into "Allow on the TV" and waits for it. adb's server is always stopped at the end.
     */
    void InstallOnAndroid(AndroidTarget tv, string pairAt, string code)
    {
        string connectAt = tv.Ip + ":" + (tv.ConnectPort > 0 ? tv.ConnectPort : AndroidDiscovery.ClassicPort);
        NewPage();
        int mine = scan;
        AcceptButton = null;
        var title = Label("Installing on your Android TV…", Theme.Bold(14f), Theme.Text, 28, 20, 580, 34);
        Add(title);
        var status = Label("Connecting to the TV…", Theme.Body(10.5f), Theme.Muted, 28, 66, 580, 110);
        Add(status);
        Add(new Activity { Location = new Point(P(28), P(190)), Size = new Size(W, P(6)) });
        Action<string, string> say = delegate (string heading, string text)
        {
            OnUi(delegate { if (mine == scan) { if (heading != null) title.Text = heading; status.Text = text; } });
        };

        Task.Factory.StartNew(delegate ()
        {
            string failure = null, apk = null;
            AndroidTvInfo info = null;
            Adb adb = null;
            try
            {
                if (!AndroidPackaged()) throw new TvInstallException(NoAndroidBuild);
                adb = Adb.Embedded();
                activeAdb = adb;
                if (code != null) { say(null, "Pairing with the TV…"); adb.Pair(pairAt, code); }
                try { adb.Connect(connectAt); }
                catch (TvInstallException e)
                {
                    // Network debugging: the TV is asking; DescribeOnceAllowed waits for the answer.
                    if (e.Message != Adb.NotAllowed) throw;
                    if (tv.Wireless) throw new TvInstallException(NotPaired);
                }
                info = DescribeOnceAllowed(adb, connectAt, tv.Wireless, say);
                say("Installing on " + info.Name + "…", "Copying Foxbloom to the TV and installing it. This can take a few minutes. Don't switch the TV off.");
                apk = WriteApk();
                adb.Install(connectAt, apk);
            }
            catch (TvInstallException e) { failure = e.Message; }
            catch (Exception e) { failure = "Something unexpected went wrong: " + e.Message; }
            finally
            {
                if (adb != null) adb.Stop();
                activeAdb = null;
                if (apk != null) try { System.IO.File.Delete(apk); } catch { }
            }
            string name = info != null ? info.Name : "your Android TV";
            OnUi(delegate { if (mine == scan) { if (failure == null) ShowAndroidDone(tv, name); else ShowAndroidFailed(tv, name, failure); } });
        });
    }

    const string NotPaired = "This PC isn't paired with the TV. On the TV, open Wireless debugging > Pair device with pairing code, and type the code and pairing address it shows.";

    /** Network debugging: until the person chooses Allow on the TV (up to two minutes), shows "Allow on the TV" and asks again. */
    static AndroidTvInfo DescribeOnceAllowed(Adb adb, string connectAt, bool wireless, Action<string, string> say)
    {
        var until = DateTime.UtcNow.AddMinutes(2);
        bool asked = false;
        while (true)
        {
            try { return adb.Describe(connectAt); }
            catch (TvInstallException e)
            {
                if (e.Message != Adb.NotAllowed) throw;
                if (wireless) throw new TvInstallException(NotPaired);
                if (DateTime.UtcNow > until) throw;
                if (!asked)
                {
                    say("Allow on the TV", "Choose Allow on the TV.\n\nThe TV is asking whether to allow debugging from this PC. Tick Always allow from this computer, then choose Allow. This page carries on by itself.");
                    asked = true;
                }
                Thread.Sleep(2000);
            }
        }
    }

    /** Copies the embedded APK to a temp file for `adb install` (the caller deletes it). */
    static string WriteApk()
    {
        using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("Foxbloom.apk"))
        {
            if (s == null) throw new TvInstallException(NoAndroidBuild);
            string dir = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "foxbloom-tv-adb");
            System.IO.Directory.CreateDirectory(dir);
            string path = System.IO.Path.Combine(dir, "Foxbloom-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".apk");
            using (var f = System.IO.File.Create(path)) s.CopyTo(f);
            return path;
        }
    }

    void ShowAndroidFailed(AndroidTarget tv, string name, string message)
    {
        NewPage();
        AcceptButton = null;
        Add(Label("Couldn't install on " + name, Theme.Bold(14f), Theme.Text, 28, 20, 580, 34));
        Add(Label(message, Theme.Body(10.5f), Theme.Danger, 28, 66, 580, 170));
        Add(Label("There's a troubleshooting guide at github.com/Scrapper1824/Foxbloom (tv/README.md).", Theme.Body(9.5f), Theme.Muted, 28, 244, 580, 44));
        var again = Button("Try again", true, 28, 300, 160, delegate { ChosenAndroid(tv); });
        Add(again);
        Add(Button("Choose another TV", false, 200, 300, 200, delegate { StartScan(); }));
        again.Focus();
    }

    void ShowAndroidDone(AndroidTarget tv, string name)
    {
        NewPage();
        AcceptButton = null;
        Add(Label("Done — Foxbloom is on your TV", Theme.Bold(14f), Theme.Ok, 28, 20, 580, 34));
        string off = tv.Wireless
            ? "You can turn Wireless debugging off again. Next time, turn Wireless debugging on again and type the new connection address."
            : "You can turn Network debugging off again; turn it back on for the next update.";
        Add(Label("Foxbloom is installed on " + name + " and should open now. Next time, find it in the TV's Apps list.\n\nOpen it, enter your Foxbloom address, and sign in with the code it shows.\n\n" + off, Theme.Body(10.5f), Theme.Muted, 28, 66, 580, 150));
        Add(Button("Install on another TV", false, 28, 230, 220, delegate { StartScan(); }));
        Add(Button("Close", true, 260, 230, 120, delegate { Close(); }));
    }
}
