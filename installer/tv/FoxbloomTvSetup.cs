// FoxbloomTVSetup.exe: finds a Samsung TV on the network and installs the Foxbloom TV app on it.
//
// Built by installer\tv\build.ps1 with the .NET Framework C# compiler (no NuGet).
//   Task 11a (this file): find the TVs, show the list, walk through Developer Mode, reach "Ready to install".
//   Task 11b: certificate (SamsungCert.cs) and signing (WgtSigner.cs) - called from InstallOn().
//   Task 11c: sdb install (Sdb.cs) and the progress / done screens - called from InstallOn().
// Command line: FoxbloomTVSetup.exe --tv <ip> skips the list (for development).
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
[assembly: AssemblyDescription("Installs the Foxbloom app on a Samsung TV")]
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

/** One TV in the list: name, model and whether Developer Mode is on. Click, or Enter / Space, picks it. */
class TvRow : Control
{
    public readonly TvInfo Tv;
    bool hover;

    public TvRow(TvInfo tv)
    {
        Tv = tv;
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
            TextRenderer.DrawText(g, DisplayName(Tv), f, new Rectangle(pad, (int)(8 * s), Width - 2 * pad - (int)(190 * s), (int)(26 * s)), Theme.Text, TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine);
        using (var f = Theme.Body(9f))
            TextRenderer.DrawText(g, (string.IsNullOrEmpty(Tv.Model) ? "" : Tv.Model + "  ·  ") + Tv.Ip, f, new Rectangle(pad, (int)(34 * s), Width - 2 * pad - (int)(190 * s), (int)(22 * s)), Theme.Muted, TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine);
        // Developer Mode pill on the right.
        string pill = Tv.DeveloperMode ? "Developer Mode on" : "Developer Mode off";
        Color c = Tv.DeveloperMode ? Theme.Ok : Theme.Muted;
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
        Controls.Add(Label("Foxbloom for Samsung TV", Theme.Bold(15f), Theme.Text, 84, 22, 500, 30));
        Controls.Add(Label("Put Foxbloom on your TV", Theme.Body(9.5f), Theme.Muted, 85, 50, 500, 20));

        body.Location = new Point(0, P(88));
        body.Size = new Size(P(640), P(640 - 88));
        body.BackColor = Theme.Bg;
        W = P(640 - 56);
        Controls.Add(body);
    }

    protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); Theme.DarkTitleBar(Handle); }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        if (startIp != null) Contact(startIp, false); else StartScan();
    }

    // ---- building blocks ----

    Label Label(string text, Font font, Color color, int x, int y, int w, int h)
    {
        return new Label { Text = text, Font = font, ForeColor = color, BackColor = Color.Transparent, AutoSize = false, Location = new Point(P(x), P(y)), Size = new Size(P(w), P(h)), UseCompatibleTextRendering = false };
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
        Add(Label("Looking for Samsung TVs…", Theme.Bold(14f), Theme.Text, 28, 20, 580, 34));
        Add(Label("Make sure your TV is switched on and on the same network as this PC. This takes a few seconds.", Theme.Body(10f), Theme.Muted, 28, 60, 580, 48));
        Add(new Activity { Location = new Point(P(28), P(120)), Size = new Size(W, P(6)) });
        Task.Factory.StartNew(delegate ()
        {
            List<TvInfo> tvs;
            try { tvs = TvDiscovery.Find(TimeSpan.FromSeconds(9)); } catch (Exception) { tvs = new List<TvInfo>(); }
            OnUi(delegate { if (mine == scan) ShowList(tvs); });
        });
    }

    void OnUi(Action a)
    {
        if (IsDisposed || !IsHandleCreated) return;
        try { BeginInvoke(a); } catch (InvalidOperationException) { }
    }

    // ---- TV list / none found ----

    void ShowList(List<TvInfo> tvs)
    {
        NewPage();
        if (tvs.Count == 0)
        {
            Add(Label("No TVs found", Theme.Bold(14f), Theme.Text, 28, 20, 580, 34));
            Add(Label("Check that the TV is switched on (not just in standby) and on the same Wi-Fi or network as this PC.\n\nOr type the TV's address yourself. You can find it on the TV under Settings > General > Network > Network Status > IP Settings.", Theme.Body(10f), Theme.Muted, 28, 62, 580, 130));
            Add(Button("Enter an address", true, 28, 210, 200, delegate { ShowAddress(null, ""); }));
            Add(Button("Scan again", false, 240, 210, 160, delegate { StartScan(); }));
            return;
        }
        Add(Label(tvs.Count == 1 ? "Found your TV" : "Found " + tvs.Count + " TVs", Theme.Bold(14f), Theme.Text, 28, 20, 580, 34));
        Add(Label("Pick the one to put Foxbloom on.", Theme.Body(10f), Theme.Muted, 28, 56, 580, 24));
        int y = 92;
        foreach (var tv in tvs.Take(6))
        {
            var row = new TvRow(tv) { Location = new Point(P(28), P(y)), Size = new Size(W, P(64)) };
            var picked = tv;
            row.Click += delegate { Chosen(picked); };
            Add(row);
            y += 72;
        }
        y += 8;
        Add(Button("Enter an address", false, 28, y, 200, delegate { ShowAddress(null, ""); }));
        Add(Button("Scan again", false, 240, y, 160, delegate { StartScan(); }));
    }

    // ---- enter an address ----

    void ShowAddress(string error, string prefill)
    {
        NewPage();
        Add(Label("Enter the TV's address", Theme.Bold(14f), Theme.Text, 28, 20, 580, 34));
        Add(Label("On the TV: Settings > General > Network > Network Status > IP Settings. It looks like 192.168.1.50.", Theme.Body(10f), Theme.Muted, 28, 60, 580, 48));

        var box = new TextBox { Text = prefill, Font = Theme.Body(14f), BorderStyle = BorderStyle.FixedSingle, BackColor = Theme.Raised, ForeColor = Theme.Text, Location = new Point(P(28), P(118)), Size = new Size(P(260), P(34)), MaxLength = 45 };
        Add(box);
        var err = Label(error ?? "", Theme.Body(10f), Theme.Danger, 28, 164, 580, 48);
        Add(err);
        EventHandler go = delegate
        {
            var ip = box.Text.Trim();
            System.Net.IPAddress parsed;
            if (!System.Net.IPAddress.TryParse(ip, out parsed)) { err.Text = "That doesn't look like an address. It should be four numbers separated by dots, like 192.168.1.50."; return; }
            Contact(ip, true);
        };
        var cont = Button("Continue", true, 28, 220, 160, go);
        Add(cont);
        Add(Button("Back", false, 200, 220, 120, delegate { StartScan(); }));
        AcceptButton = cont;
        box.Focus();
    }

    /** Asks the TV at `ip` who it is, then carries on like a TV picked from the list. */
    void Contact(string ip, bool fromAddressPage)
    {
        NewPage();
        int mine = scan;
        AcceptButton = null;
        Add(Label("Contacting " + ip + "…", Theme.Bold(14f), Theme.Text, 28, 20, 580, 34));
        Add(new Activity { Location = new Point(P(28), P(70)), Size = new Size(W, P(6)) });
        Task.Factory.StartNew(delegate ()
        {
            TvInfo tv = TvDiscovery.Describe(ip);
            OnUi(delegate
            {
                if (mine != scan) return;
                if (tv == null) ShowAddress("No Samsung TV answered at " + ip + ". Check the address, and that the TV is switched on and on the same network as this PC.", ip);
                else Chosen(tv);
            });
        });
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

    // ---- ready to install (11b and 11c fill this in) ----

    void ShowReady(TvInfo tv)
    {
        NewPage();
        AcceptButton = null;
        Add(Label("Ready to install on " + TvRow.DisplayName(tv), Theme.Bold(14f), Theme.Text, 28, 20, 580, 34));
        Add(Label("Developer Mode is on and set up for this PC.\n\nInstalling isn't available in this version of the setup yet.", Theme.Body(10f), Theme.Muted, 28, 62, 580, 90));
        var install = Button("Install", true, 28, 170, 160, delegate { InstallOn(tv); });
        install.Enabled = false;   // TODO(11c): enable once InstallOn does the work.
        Add(install);
        Add(Button("Choose another TV", false, 200, 170, 200, delegate { StartScan(); }));
    }

    /**
     * The seam for the rest of the installer.
     * Ready (11b): SamsungCert.Ensure(new[] { duid }, SamsungCert.OpenInBrowser) off the UI thread, then
     *   WgtSigner.Sign(unsigned wgt, cert). The duid must be the one `sdb shell 0 getduid` prints (11c), NOT
     *   tv.Duid ("uuid:..." from /api/v2/), which Ensure rejects. SamsungCert.Status(...) != Ok means a sign-in.
     * TODO(11c): Sdb.Install(tv.Ip, signedWgt), with "Signing in to Samsung…" / "Installing on <name>…" / "Done" screens.
     */
    void InstallOn(TvInfo tv)
    {
    }
}
