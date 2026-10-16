using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;

namespace TiboReset;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        var data = Path.TrimEndingDirectorySeparator(Path.GetFullPath(Environment.GetEnvironmentVariable("TIBO_RESET_DATA_DIR") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TiboReset")));
        var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(data.ToLowerInvariant()))).ToLowerInvariant()[..24];
        using var mutex = new Mutex(false, @"Local\TiboReset-" + key);
        var owns = false;
        try {
            try { owns = mutex.WaitOne(0); } catch (AbandonedMutexException) { owns = true; }
            if (!owns) {
                try { using var show = EventWaitHandle.OpenExisting(@"Local\TiboReset.Show-" + key); show.Set(); }
                catch { MessageBox.Show("旧后台仍在运行，请先运行新版本的 install.cmd 完成升级。", "Tibo Reset"); }
                return;
            }
            Directory.CreateDirectory(data);
            File.Delete(Path.Combine(data, "stop.request"));
            var acl = new DirectorySecurity(); acl.SetAccessRuleProtection(true, false);
            foreach (var sid in new[] { WindowsIdentity.GetCurrent().User!, new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null) })
                acl.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
            new DirectoryInfo(data).SetAccessControl(acl);
            Application.Run(new TrayContext(data, key, args));
        } catch (Exception error) { MessageBox.Show("无法启动 Tibo Reset：" + error.Message, "Tibo Reset"); Environment.ExitCode = 1; }
        finally { if (owns) mutex.ReleaseMutex(); }
    }
}

internal sealed class TrayContext : ApplicationContext
{
    private readonly string data, bundle = AppContext.BaseDirectory;
    private readonly Popup popup = new();
    private readonly NotifyIcon tray;
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 2000 };
    private readonly EventWaitHandle showEvent;
    private readonly RegisteredWaitHandle showWait;
    private readonly ToolStripMenuItem startup = new("登录时启动"), notifications = new("新公告系统通知");
    private readonly string? selfTest;
    private Process? backend;
    private Snapshot snapshot = Snapshot.Empty;
    private DateTime lastMessage = DateTime.UtcNow, restartAt = DateTime.MaxValue;
    private int failures;
    private bool quitting, notifying;
    private string backendError = "", noticeKey = "";
    private string StartupFile => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "Tibo Reset Monitor.lnk");
    public TrayContext(string data, string key, string[] args)
    {
        this.data = data;
        var test = Array.IndexOf(args, "--self-test"); selfTest = test >= 0 && args.Length > test + 1 ? args[test + 1] : null;
        popup.CreateControl(); _ = popup.Handle;
        showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\TiboReset.Show-" + key);
        showWait = ThreadPool.RegisterWaitForSingleObject(showEvent, (_, _) => UI(ShowPopup), null, -1, false);
        tray = new NotifyIcon { Text = "Tibo Reset", Icon = CreateIcon(), Visible = true };
        var menu = new ContextMenuStrip();
        menu.Items.Add("查看公告", null, (_, _) => ShowPopup());
        menu.Items.Add("立即检查", null, (_, _) => Send("refresh"));
        menu.Items.Add("连接 / 查看 X…", null, (_, _) => Action("connect"));
        menu.Items.Add(new ToolStripSeparator());
        startup.Checked = File.Exists(StartupFile); startup.Click += (_, _) => SetStartup(!startup.Checked); menu.Items.Add(startup);
        try { using var settings = JsonDocument.Parse(File.ReadAllText(Path.Combine(data, "tray-settings.json"))); notifying = settings.RootElement.GetProperty("notifications").GetBoolean(); } catch { }
        notifications.Checked = notifying; notifications.Click += (_, _) => {
            notifying = !notifying; notifications.Checked = notifying;
            try { var target = Path.Combine(data, "tray-settings.json"); File.WriteAllText(target + ".tmp", JsonSerializer.Serialize(new { notifications = notifying })); File.Move(target + ".tmp", target, true); }
            catch { popup.SetError("无法保存通知设置，请重试。"); }
        }; menu.Items.Add(notifications);
        menu.Items.Add("全部标为已读", null, (_, _) => Send("read"));
        menu.Items.Add("断开 X 并清除登录…", null, (_, _) => Action("disconnect"));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("退出 Tibo Reset", null, async (_, _) => await Quit());
        tray.ContextMenuStrip = menu; tray.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) { if (popup.Visible) popup.Hide(); else ShowPopup(); } };
        tray.BalloonTipClicked += (_, _) => ShowPopup();
        popup.OnAction = Action; popup.OnMenu = control => menu.Show(control, new Point(0, -menu.PreferredSize.Height));
        timer.Tick += async (_, _) => {
            if (quitting || selfTest != null) return;
            if (File.Exists(Path.Combine(data, "stop.request"))) { await Quit(); return; }
            if (backend is null && DateTime.UtcNow >= restartAt) StartBackend();
            if (backend is { HasExited: false } && DateTime.UtcNow - lastMessage > TimeSpan.FromSeconds(30)) {
                backendError = "后台暂未响应，请尝试退出后重新打开；已有登录与公告保留。"; popup.SetError(backendError);
            }
        }; timer.Start();
        SystemEvents.PowerModeChanged += PowerChanged;
        if (selfTest != null) RunSelfTest(); else StartBackend();
    }
    private void UI(Action action) { if (!popup.IsDisposed) try { popup.BeginInvoke(action); } catch (InvalidOperationException) { } }
    private void PowerChanged(object sender, PowerModeChangedEventArgs e) { if (e.Mode == PowerModes.Resume) UI(() => { lastMessage = DateTime.UtcNow; Send("wake"); }); }
    private void ShowPopup() { popup.UpdateSnapshot(snapshot, backendError); popup.OpenAt(Cursor.Position); if (snapshot.Unread.Length > 0) Send("read"); }
    private void StartBackend()
    {
        if (quitting || backend is not null) return;
        try {
            var node = Path.Combine(bundle, "runtime", "node.exe");
            if (!File.Exists(node)) node = Path.Combine(data, "runtime", "node.exe");
            if (!File.Exists(node)) throw new FileNotFoundException("缺少内置 Node，请从完整安装包启动。");
            var info = new ProcessStartInfo(node) { WorkingDirectory = data, UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
            info.ArgumentList.Add(Path.Combine(bundle, "app.cjs")); info.ArgumentList.Add("--stdio"); info.ArgumentList.Add("--standalone");
            info.Environment["TIBO_RESET_DATA_DIR"] = data;
            var process = new Process { StartInfo = info, EnableRaisingEvents = true };
            backend = process;
            process.OutputDataReceived += (_, e) => {
                if (e.Data is not { Length: > 0 and < 4194304 } line) return;
                try { using var value = JsonDocument.Parse(line); if (JsonValue.String(value.RootElement, "type") != "snapshot") return;
                    var next = Snapshot.Parse(value.RootElement); UI(() => { if (backend == process) Receive(next); });
                } catch (JsonException) { }
            };
            process.ErrorDataReceived += (_, _) => { }; // Do not copy credentials or arbitrary CLI output to a log.
            process.Exited += (_, _) => UI(() => {
                if (backend != process || quitting) return;
                backend = null; process.Dispose(); failures++; restartAt = DateTime.UtcNow.AddSeconds(Math.Min(60, Math.Pow(2, Math.Min(failures, 6))));
                backendError = "后台已暂停，稍后自动重启；登录与公告仍保留。"; popup.SetError(backendError);
            });
            lastMessage = DateTime.UtcNow; process.Start(); process.BeginOutputReadLine(); process.BeginErrorReadLine();
        } catch (Exception error) {
            backend?.Dispose(); backend = null; restartAt = DateTime.UtcNow.AddSeconds(60); backendError = error.Message; popup.SetError(backendError);
        }
    }
    private void Receive(Snapshot next)
    {
        snapshot = next; lastMessage = DateTime.UtcNow; failures = 0; backendError = "";
        var title = "Tibo Reset · " + next.StateTitle + (next.Unread.Length > 0 ? $" · {next.Unread.Length} 条未读" : "");
        tray.Text = title[..Math.Min(63, title.Length)];
        if (popup.Visible) { popup.UpdateSnapshot(next, ""); if (next.Unread.Length > 0) Send("read"); }
        if (next.NoticeKey.Length > 0 && next.NoticeKey != noticeKey) {
            noticeKey = next.NoticeKey;
            if (notifying && !popup.Visible && Math.Abs(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - next.NoticeAt) < 60000)
                tray.ShowBalloonTip(10000, "Tibo 有新的重置消息", next.NoticeText, ToolTipIcon.Info);
        }
    }
    private void Send(string action)
    {
        if (backend is not { HasExited: false } process) return;
        try { process.StandardInput.WriteLine(JsonSerializer.Serialize(new { action })); process.StandardInput.Flush(); } catch (IOException) { }
    }
    private void Action(string action)
    {
        if (action == "disconnect") {
            if (MessageBox.Show("将清除此 App 的专用 X 登录。已保存的公开公告会保留。网络故障可以先尝试立即检查。", "断开 X 并清除登录？", MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) return;
        }
        if (action == "connect") popup.Hide();
        if (backend is null && action != "disconnect") StartBackend();
        Send(action);
    }
    private async Task Quit()
    {
        if (quitting) return; quitting = true;
        try {
            if (backend is { HasExited: false } process) {
                Send("stop"); process.StandardInput.Close();
                await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(18));
            }
            Cleanup(); ExitThread();
        } catch (TimeoutException) {
            quitting = false; backendError = "专用 X 浏览器尚未正常退出。请关闭该专用窗口后重试退出。"; popup.SetError(backendError);
            if (!File.Exists(Path.Combine(data, "stop.request"))) MessageBox.Show(backendError, "Tibo Reset");
        }
    }
    private void SetStartup(bool enabled)
    {
        object? shellObject = null, linkObject = null;
        try {
            shellObject = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")!);
            dynamic shell = shellObject!; linkObject = shell.CreateShortcut(StartupFile); dynamic link = linkObject;
            if (File.Exists(StartupFile) && (string)link.Description != "Tibo Reset") throw new IOException("启动快捷方式名称已被其他程序使用。");
            if (enabled) { link.TargetPath = Environment.ProcessPath!; link.WorkingDirectory = bundle; link.Arguments = ""; link.Description = "Tibo Reset"; link.Save(); }
            else File.Delete(StartupFile);
            startup.Checked = enabled;
        } catch (Exception error) { MessageBox.Show("无法更改登录启动设置：" + error.Message, "Tibo Reset"); }
        finally { if (linkObject is not null) Marshal.FinalReleaseComObject(linkObject); if (shellObject is not null) Marshal.FinalReleaseComObject(shellObject); }
    }
    private void Cleanup()
    {
        timer.Stop(); timer.Dispose(); SystemEvents.PowerModeChanged -= PowerChanged;
        showWait.Unregister(null); showEvent.Dispose(); tray.Visible = false; tray.Icon?.Dispose(); tray.Dispose(); popup.Dispose(); backend?.Dispose();
    }
    protected override void ExitThreadCore() { base.ExitThreadCore(); }
    [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr icon);
    private static Icon CreateIcon()
    {
        using var bitmap = new Bitmap(32, 32); using var graphics = Graphics.FromImage(bitmap);
        var light = false; try { light = (int?)Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "SystemUsesLightTheme", 0) == 1; } catch { }
        graphics.SmoothingMode = SmoothingMode.AntiAlias; using var pen = new Pen(light ? Color.FromArgb(48, 48, 48) : Color.FromArgb(230, 230, 230), 3);
        graphics.DrawArc(pen, 5, 5, 22, 22, 40, 290); graphics.DrawLines(pen, [new Point(20, 4), new Point(27, 7), new Point(23, 14)]);
        var handle = bitmap.GetHicon(); try { using var source = Icon.FromHandle(handle); return (Icon)source.Clone(); } finally { DestroyIcon(handle); }
    }
    private async void RunSelfTest()
    {
        try {
            using var fixture = JsonDocument.Parse(JsonSerializer.Serialize(new { xState = "ready", records = Enumerable.Range(1000, 11).Select(id => new {
                id = id.ToString(), url = $"https://x.com/thsottiaux/status/{id}", text = string.Concat(Enumerable.Repeat("Public reset fixture. ", 40)),
                publishedAt = "2026-10-16T01:03:59Z", status = "scheduled", parserState = "done", threadContext = new[] { new { text = "Public parent fixture." } }
            }) }));
            snapshot = Snapshot.Parse(fixture.RootElement); ShowPopup(); await Task.Delay(300);
            var report = popup.LayoutReport(); File.WriteAllText(selfTest!, JsonSerializer.Serialize(report));
            if (!report.InsideScreen || !report.HeaderVisible || !report.FooterVisible || !report.ConnectionVisible) Environment.ExitCode = 1;
        } catch { Environment.ExitCode = 1; }
        finally { Cleanup(); ExitThread(); }
    }
}

internal sealed record LayoutCheck(bool InsideScreen, bool HeaderVisible, bool FooterVisible, bool ConnectionVisible, int Cards);

internal sealed class Popup : Form
{
    public Action<string> OnAction = _ => { };
    public Action<Control> OnMenu = _ => { };
    private readonly Panel header = new(), connection = new(), footer = new();
    private readonly FlowLayoutPanel cards = new() { FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true, Dock = DockStyle.Fill };
    private readonly Label state = new(), checkedAt = new(), error = new(), unread = new();
    private readonly ToolTip tips = new();
    private readonly Color background, surface, foreground, muted;
    private readonly Font bodyFont = new("Segoe UI", 9), boldFont = new("Segoe UI", 9, FontStyle.Bold), titleFont = new("Segoe UI", 12, FontStyle.Bold), quoteFont = new("Georgia", 10, FontStyle.Italic);
    private Snapshot snapshot = Snapshot.Empty;
    private string rendered = "";
    private bool all;
    private Point anchor;
    public Popup()
    {
        var dark = false; try { dark = (int?)Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1) == 0; } catch { }
        background = dark ? Color.FromArgb(34, 34, 34) : Color.FromArgb(248, 248, 248);
        surface = dark ? Color.FromArgb(43, 43, 43) : Color.FromArgb(239, 239, 239);
        foreground = dark ? Color.FromArgb(238, 238, 238) : Color.FromArgb(40, 40, 40);
        muted = dark ? Color.FromArgb(171, 171, 171) : Color.FromArgb(104, 104, 104);
        BackColor = background; ForeColor = foreground; Font = bodyFont; AutoScaleDimensions = new SizeF(96, 96); AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(380, 554); header.Width = connection.Width = footer.Width = 380;
        FormBorderStyle = FormBorderStyle.FixedToolWindow; ShowInTaskbar = false; Text = "Tibo Reset"; StartPosition = FormStartPosition.Manual; TopMost = true;
        header.Dock = DockStyle.Top; header.Height = 64;
        header.Controls.Add(new Label { Text = "Tibo Reset", Font = titleFont, AutoSize = true, Location = new Point(14, 9) });
        header.Controls.Add(new Label { Text = "@thsottiaux · 重置公告", ForeColor = muted, AutoSize = true, Location = new Point(14, 36) });
        var refresh = Button("↻", () => OnAction("refresh")); refresh.Width = 32; refresh.Anchor = AnchorStyles.Right | AnchorStyles.Top; refresh.Location = new Point(330, 15); refresh.AccessibleName = "立即检查"; header.Controls.Add(refresh);
        unread.AutoSize = true; unread.ForeColor = muted; unread.Anchor = AnchorStyles.Top | AnchorStyles.Right; unread.Location = new Point(250, 23); header.Controls.Add(unread);
        connection.Dock = DockStyle.Top; connection.Height = 70;
        state.AutoSize = true; state.Location = new Point(14, 4); checkedAt.AutoSize = true; checkedAt.Location = new Point(14, 27); checkedAt.ForeColor = muted;
        error.Location = new Point(14, 49); error.ForeColor = muted; error.AutoSize = false; error.Size = new Size(340, 48); error.AutoEllipsis = true;
        connection.Controls.AddRange([state, checkedAt, error]);
        footer.Dock = DockStyle.Bottom; footer.Height = 45;
        var connect = Button("连接 / 查看 X…", () => OnAction("connect")); connect.Location = new Point(12, 8); connect.Width = 165; footer.Controls.Add(connect);
        var menu = Button("•••", () => { }); menu.Click += (_, _) => OnMenu(menu); menu.Location = new Point(324, 8); menu.Width = 40; menu.Anchor = AnchorStyles.Right | AnchorStyles.Top; footer.Controls.Add(menu);
        Controls.Add(cards); Controls.Add(connection); Controls.Add(header); Controls.Add(footer);
        Deactivate += (_, _) => Hide(); FormClosing += (_, e) => { if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); } };
        Resize += (_, _) => { if (Visible) RenderCards(); }; KeyPreview = true;
        DpiChanged += (_, _) => { if (Visible) { FitToScreen(); RenderCards(); } };
        KeyDown += (_, e) => { if (e.KeyCode == Keys.Escape) Hide(); else if (e.Control && e.KeyCode == Keys.R) { OnAction("refresh"); e.Handled = true; } };
    }
    private Button Button(string text, Action action)
    {
        var button = new Button { Text = text, Height = 29, FlatStyle = FlatStyle.Flat, BackColor = background, ForeColor = foreground };
        button.FlatAppearance.BorderSize = 0; button.Click += (_, _) => action(); return button;
    }
    public void OpenAt(Point anchor)
    {
        this.anchor = anchor; FitToScreen(); Show(); Activate(); FitToScreen(); RenderCards();
    }
    private void FitToScreen()
    {
        var work = Screen.FromPoint(anchor).WorkingArea; var scale = DeviceDpi / 96f;
        Size = new Size(Math.Min((int)(400 * scale), work.Width - 24), Math.Min((int)(600 * scale), work.Height - 24));
        Location = new Point(Math.Clamp(anchor.X - Width, work.Left + 8, Math.Max(work.Left + 8, work.Right - Width - 8)),
            Math.Clamp(anchor.Y - Height, work.Top + 8, Math.Max(work.Top + 8, work.Bottom - Height - 8)));
    }
    public void SetError(string message) { UpdateSnapshot(snapshot, message); }
    public void UpdateSnapshot(Snapshot next, string backendError)
    {
        snapshot = next; state.Text = backendError.Length > 0 ? "后台正在恢复" : next.StateTitle;
        state.ForeColor = next.State == "ready" && backendError.Length == 0 ? Color.SeaGreen : foreground;
        checkedAt.Text = next.CheckedAt.HasValue ? "上次成功检查 " + Presentation.Clock(next.CheckedAt.Value, next.Zone) : "登录后自动检查主帖与回复";
        error.Text = backendError.Length > 0 ? backendError : next.Error; tips.SetToolTip(error, error.Text);
        connection.Height = (int)((error.Text.Length > 0 ? 106 : 56) * DeviceDpi / 96f);
        unread.Text = next.Unread.Length > 0 ? $"{next.Unread.Length} 条未读" : "";
        if (rendered != next.RecordKey) { rendered = next.RecordKey; RenderCards(); }
    }
    private void RenderCards()
    {
        if (cards.ClientSize.Width <= 0) return;
        var scroll = -cards.AutoScrollPosition.Y; cards.SuspendLayout();
        foreach (Control control in cards.Controls.Cast<Control>().ToArray()) { cards.Controls.Remove(control); control.Dispose(); }
        var width = Math.Max(100, cards.ClientSize.Width - SystemInformation.VerticalScrollBarWidth - 18);
        if (snapshot.Records.Length == 0) cards.Controls.Add(new Label { Text = snapshot.State == "ready" ? "最近 14 天暂无重置公告" : "等候下一条重置公告", Width = width, Height = 90, TextAlign = ContentAlignment.MiddleCenter, ForeColor = muted });
        foreach (var post in snapshot.Records.Take(all ? 60 : 5)) cards.Controls.Add(Card(post, width));
        if (snapshot.Records.Length > 5) { var more = Button(all ? "仅显示最近 5 条" : $"查看全部 {snapshot.Records.Length} 条公告", () => { all = !all; RenderCards(); }); more.Width = width; cards.Controls.Add(more); }
        cards.ResumeLayout(true); cards.AutoScrollPosition = new Point(0, scroll);
    }
    private Control Card(Announcement post, int width)
    {
        var panel = new TableLayoutPanel { ColumnCount = 1, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Width = width, BackColor = surface, Padding = new Padding(12), Margin = new Padding(8, 5, 5, 5) };
        var inner = width - 24;
        void Add(Control control) { control.Margin = new Padding(0, 0, 0, 7); panel.RowStyles.Add(new RowStyle(SizeType.AutoSize)); panel.Controls.Add(control, 0, panel.RowCount++); }
        Label TextLabel(string text, Color color, FontStyle font = FontStyle.Regular) => new() { Text = text, ForeColor = color, Font = font == FontStyle.Bold ? boldFont : bodyFont, AutoSize = true, MaximumSize = new Size(inner, 0) };
        Add(TextLabel(post.Heading, post.Status == "completed" ? Color.SeaGreen : foreground, FontStyle.Bold));
        if (post.Timing(snapshot.Zone) is { } timing) Add(TextLabel(timing, foreground));
        var quoteBoxes = new List<(TextBox Box, int Collapsed, int Full)>();
        void Quote(string label, string text) {
            Add(TextLabel(label, muted));
            var full = TextRenderer.MeasureText(text, quoteFont, new Size(inner, int.MaxValue), TextFormatFlags.WordBreak).Height + 10;
            var collapsed = Math.Min(full, (int)Math.Ceiling(quoteFont.GetHeight(DeviceDpi) * 3) + 8);
            var box = new TextBox { Text = text, Multiline = true, ReadOnly = true, BorderStyle = BorderStyle.None, BackColor = surface, ForeColor = foreground,
                Font = quoteFont, Width = inner, Height = collapsed };
            quoteBoxes.Add((box, collapsed, full)); Add(box);
        }
        Quote("原文", post.Text); foreach (var parent in post.Parents) Quote("前文", parent);
        if (quoteBoxes.Any(item => item.Full > item.Collapsed)) {
            var expanded = false; var expand = Button("展开原文与前文", () => { }); expand.Width = inner; expand.BackColor = surface;
            expand.Click += (_, _) => { expanded = !expanded; expand.Text = expanded ? "收起原文" : "展开原文与前文";
                foreach (var item in quoteBoxes) { item.Box.Height = expanded ? Math.Min((int)(360 * DeviceDpi / 96f), item.Full) : item.Collapsed; item.Box.ScrollBars = expanded ? ScrollBars.Vertical : ScrollBars.None; }
            }; Add(expand);
        }
        var source = new LinkLabel { Text = "查看原帖 ↗", LinkColor = Color.DodgerBlue, AutoSize = true };
        source.LinkClicked += (_, _) => Process.Start(new ProcessStartInfo(post.Url) { UseShellExecute = true }); Add(source);
        if (DateTimeOffset.TryParse(post.PublishedAt, out var published)) Add(TextLabel("发布于 " + Presentation.Clock(published, snapshot.Zone) + "（" + Presentation.ZoneLabel(snapshot.Zone) + "）", muted));
        if (post.ParserState == "failed") Add(TextLabel("解释暂不可用，点击刷新可重试", muted));
        return panel;
    }
    public LayoutCheck LayoutReport()
    {
        bool Fits(Control control) => ClientRectangle.Contains(RectangleToClient(control.RectangleToScreen(control.ClientRectangle)));
        return new(Screen.FromControl(this).WorkingArea.Contains(Bounds), Fits(header), Fits(footer), Fits(connection), cards.Controls.Count);
    }
    protected override void Dispose(bool disposing) { base.Dispose(disposing); if (disposing) { tips.Dispose(); bodyFont.Dispose(); boldFont.Dispose(); titleFont.Dispose(); quoteFont.Dispose(); } }
}
