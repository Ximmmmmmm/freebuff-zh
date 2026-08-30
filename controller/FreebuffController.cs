// Freebuff 多开控制器 — native single-file build (csc.exe, .NET Framework).
// Dark-themed WinForms UI. Each slot (1-9) is an independent Freebuff
// instance: its own Chromium profile (--user-data-dir) and its own
// orchestrator state file (FREEBUFF_DESKTOP_STATE_PATH), so every window can
// stay logged in to a different account.
//
// Rebuild: run build.bat in this folder.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Management;
using System.Net;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace FreebuffController
{
    internal static class Program
    {
        internal static Mutex SingleMutex;

        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [STAThread]
        private static void Main()
        {
            SetProcessDPIAware();

            bool createdNew;
            SingleMutex = new Mutex(true, "FreebuffMultiOpenController", out createdNew);
            if (!createdNew)
            {
                MessageBox.Show("Freebuff 多开控制器已经在运行了。", "提示",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += delegate(object s, System.Threading.ThreadExceptionEventArgs e)
            {
                try
                {
                    File.AppendAllText(
                        Path.Combine(Path.GetTempPath(), "freebuff-controller-error.log"),
                        DateTime.Now + "  " + e.Exception + Environment.NewLine);
                }
                catch { }
                MessageBox.Show("控制器出错: " + e.Exception.Message, "错误",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            };
            try
            {
                Application.Run(new MainForm());
            }
            catch (Exception ex)
            {
                try
                {
                    File.AppendAllText(
                        Path.Combine(Path.GetTempPath(), "freebuff-controller-error.log"),
                        DateTime.Now + "  " + ex + Environment.NewLine);
                }
                catch { }
                MessageBox.Show("控制器出错: " + ex.Message, "错误",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }

            try { SingleMutex.ReleaseMutex(); } catch { }
        }
    }

    public class MainForm : Form
    {
        private const int MaxSlot = 9;

        private static readonly string FreebuffExe = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Programs\\@codebufffreebuff-desktop\\Freebuff.exe");

        private static readonly string DefaultState = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".config\\freebuff-desktop\\state.json");

        private static readonly Regex SlotRegex = new Regex("Freebuff-slot-(\\d)(?!\\d)");
        private static readonly Regex EmailRegex = new Regex("\"email\"\\s*:\\s*\"([^\"]+)\"");
        private static readonly Regex FeedUrlRegex = new Regex("(?m)^\\s*url:\\s*(\\S+)");
        private static readonly Regex YamlVersionRegex = new Regex("(?m)^\\s*version:\\s*'?([^'\"\\r\\n]+)");
        private static readonly Regex YamlPathRegex = new Regex("(?m)^\\s*path:\\s*(\\S+)");
        private static readonly Regex YamlShaRegex = new Regex("(?m)^\\s*sha512:\\s*(\\S+)");
        private static readonly Regex LooseVersionRegex = new Regex("(\\d+)\\.(\\d+)(?:\\.(\\d+))?");

        // palette
        private static readonly Color ColBg = Color.FromArgb(24, 26, 32);
        private static readonly Color ColPanel = Color.FromArgb(33, 36, 45);
        private static readonly Color ColRow = Color.FromArgb(30, 33, 41);
        private static readonly Color ColLine = Color.FromArgb(41, 45, 55);
        private static readonly Color ColText = Color.FromArgb(232, 235, 240);
        private static readonly Color ColSub = Color.FromArgb(140, 150, 168);
        private static readonly Color ColAccent = Color.FromArgb(59, 130, 246);
        private static readonly Color ColAccentHover = Color.FromArgb(77, 145, 255);
        private static readonly Color ColNeutral = Color.FromArgb(50, 54, 66);
        private static readonly Color ColNeutralHover = Color.FromArgb(64, 69, 84);
        private static readonly Color ColGreen = Color.FromArgb(52, 199, 110);
        private static readonly Color ColHeader = Color.FromArgb(17, 19, 24);
        private static readonly Color ColSelect = Color.FromArgb(44, 50, 66);

        private DataGridView grid;
        private NotifyIcon tray;
        private Label statusLabel;
        private System.Windows.Forms.Timer statusRevertTimer;
        private System.Windows.Forms.Timer refreshTimer;
        private System.Windows.Forms.Timer quotaTimer;
        private System.Windows.Forms.Timer versionTimer;
        private int refreshBusy;
        private int quotaBusy;
        private DateTime lastQuotaFetch = DateTime.MinValue;
        private readonly string[] quotaTexts = new string[MaxSlot + 1];

        private const string QuotaApiUrl = "https://www.codebuff.com/api/v1/freebuff/session";

        // Version check: the feed URL is normally read from the installed
        // app's resources/app-update.yml; this is only the fallback.
        private const string FallbackUpdateFeed =
            "https://freebuff.com/api/desktop/updates/win-x64/latest.yml";
        private const string ReleasesPageUrl =
            "https://github.com/CodebuffAI/codebuff-community/releases/latest";
        // The same endpoint the freebuff.com download button uses; always
        // redirects to the newest installer.
        private const string OfficialDownloadUrl =
            "https://freebuff.com/api/desktop/download/windows";
        private static readonly Color ColNewVersion = Color.FromArgb(245, 185, 66);

        private Label versionLink;
        private string installedVersion;
        private string latestVersion; // null until a check succeeds; null also = failed
        private int versionCheckBusy;
        private int updateBusy;      // 1 while an installer download is running
        private bool updateStarted;  // installer was downloaded and launched
        private bool updateFailed;   // last download failed; next click opens the page

        // ---------- 汉化 (hanhua) integration ----------
        // The sibling hanhua/ repo builds a localized app.asar + ui/ into its
        // output/. Freebuff's auto-update overwrites those patched files, so
        // the controller surfaces the status and can apply / restore them —
        // same files and backup scheme as hanhua's apply.sh / restore.sh.
        private static readonly string FreebuffResources =
            Path.Combine(Path.GetDirectoryName(FreebuffExe), "resources");
        private static readonly string InstalledUiIndex =
            Path.Combine(FreebuffResources, "orchestrator\\ui\\index.html");
        private const string HanhuaMarker = "<html lang=\"zh-CN\">";
        private static readonly Regex ManifestVersionRegex =
            new Regex("\"targetVersion\"\\s*:\\s*\"([^\"]+)\"");
        private static readonly string HanhuaConfigFile = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "FreebuffController\\hanhua-path.txt");

        private Label hanhuaLabel;
        private Button btnHanhuaApply;
        private Button btnHanhuaRestore;
        private string hanhuaDir; // located hanhua/ repo; null = not found yet
        private int hanhuaBusy;

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        public MainForm()
        {
            if (!File.Exists(FreebuffExe))
                throw new ApplicationException(
                    "未找到 Freebuff 桌面版：\n" + FreebuffExe + "\n\n请先安装 Freebuff。");
            installedVersion = ReadInstalledVersion();
            BuildUi();
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            try
            {
                int on = 1; // DWMWA_USE_IMMERSIVE_DARK_MODE
                DwmSetWindowAttribute(Handle, 20, ref on, 4);
            }
            catch { }
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            if (statusRevertTimer != null) statusRevertTimer.Dispose();
            if (refreshTimer != null) refreshTimer.Dispose();
            if (quotaTimer != null) quotaTimer.Dispose();
            if (versionTimer != null) versionTimer.Dispose();
            tray.Visible = false;
            tray.Dispose();
            base.OnFormClosed(e);
        }

        // ---------- UI ----------

        private void BuildUi()
        {
            Text = "Freebuff 多开控制器";
            ClientSize = new Size(580, 546);
            BackColor = ColBg;
            ForeColor = ColText;
            Font = new Font("Microsoft YaHei UI", 9.75f);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            // The exe already embeds app.ico as its Win32 icon; surface it in
            // the title bar / taskbar too, which need this explicit assignment.
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);

            var hint = new Label();
            hint.Text = "管理多开的 Freebuff 实例 · 每个实例可以用不同账号登录 · 双击行直接启动";
            hint.Bounds = new Rectangle(22, 14, 540, 20);
            hint.ForeColor = ColSub;
            Controls.Add(hint);

            BuildGrid();

            Button btnLaunch = MakeButton("启动", 20, 436, 104, ColAccent, ColAccentHover);
            btnLaunch.Click += delegate { OnLaunch(); };

            Button btnStop = MakeButton("停止", 134, 436, 104, ColNeutral, ColNeutralHover);
            btnStop.Click += delegate { OnStop(); };

            Button btnReset = MakeButton("重置账号", 248, 436, 104, ColNeutral, ColNeutralHover);
            btnReset.Click += delegate { OnReset(); };

            Button btnStopAll = MakeButton("停止全部", 362, 436, 104, ColNeutral, ColNeutralHover);
            btnStopAll.Click += delegate { OnStopAll(); };

            Button btnRefresh = MakeButton("刷新", 476, 436, 84, ColNeutral, ColNeutralHover);
            btnRefresh.Click += delegate { SetStatus("正在刷新…"); RefreshGrid(); FetchQuotasAsync(true); };

            hanhuaLabel = new Label();
            hanhuaLabel.Bounds = new Rectangle(22, 494, 324, 16);
            hanhuaLabel.ForeColor = ColSub;
            hanhuaLabel.Font = new Font("Microsoft YaHei UI", 8.5f);
            Controls.Add(hanhuaLabel);

            btnHanhuaApply = MakeButton("应用汉化", 354, 484, 100, ColNeutral, ColNeutralHover);
            btnHanhuaApply.Click += delegate { OnHanhuaApply(); };

            btnHanhuaRestore = MakeButton("还原英文", 460, 484, 100, ColNeutral, ColNeutralHover);
            btnHanhuaRestore.Click += delegate { OnHanhuaRestore(); };

            BuildTray();

            statusLabel = new Label();
            statusLabel.Text = ReadyStatus();
            statusLabel.Bounds = new Rectangle(22, 524, 330, 16);
            statusLabel.ForeColor = ColSub;
            statusLabel.Font = new Font("Microsoft YaHei UI", 8.5f);
            Controls.Add(statusLabel);

            versionLink = new Label();
            versionLink.Text = string.IsNullOrEmpty(installedVersion)
                ? "Freebuff 版本未知 · 检查更新"
                : "Freebuff v" + installedVersion + " · 检查更新";
            versionLink.Bounds = new Rectangle(354, 524, 206, 16);
            versionLink.ForeColor = ColSub;
            versionLink.Font = new Font("Microsoft YaHei UI", 8.5f);
            versionLink.TextAlign = ContentAlignment.MiddleRight;
            versionLink.Cursor = Cursors.Hand;
            versionLink.Click += delegate { OnVersionLinkClick(); };
            Controls.Add(versionLink);

            // High-DPI displays: this layout is authored at 96 DPI and the
            // process is DPI-aware (no OS bitmap scaling), so every fixed
            // bound must be scaled up or the text clips on 125%/150% screens.
            float uiScale = DpiScale();
            ScaleUi(this, uiScale);
            try
            {
                Font mf = tray.ContextMenuStrip.Font;
                tray.ContextMenuStrip.Font = new Font(mf.FontFamily, mf.Size * uiScale, mf.Style);
            }
            catch { }

            hanhuaDir = FindHanhuaDir();
            RefreshHanhuaUi();

            refreshTimer = new System.Windows.Forms.Timer();
            refreshTimer.Interval = 3000;
            refreshTimer.Tick += delegate { RefreshGrid(); };
            refreshTimer.Start();

            quotaTimer = new System.Windows.Forms.Timer();
            quotaTimer.Interval = 300000;
            quotaTimer.Tick += delegate { FetchQuotasAsync(false); };
            quotaTimer.Start();

            versionTimer = new System.Windows.Forms.Timer();
            versionTimer.Interval = 1800000; // every 30 minutes
            versionTimer.Tick += delegate
            {
                RefreshInstalledVersion(); // app may have updated meanwhile
                CheckVersionAsync();
                RefreshHanhuaUi();
            };
            versionTimer.Start();

            ComputeAndApply();
            FetchQuotasAsync(true);
            CheckVersionAsync();
        }

        // The standing status line spells out the two refresh cycles so the
        // label never leaves the user guessing what "刷新" covers.
        private static string ReadyStatus()
        {
            return "每 3 秒刷新运行状态和账号 · 额度每 5 分钟刷新";
        }

        // Transient messages (启动中…、已重置 ✓ …) fall back to the standing
        // status line after a few seconds; setting the standing text cancels.
        private void SetStatus(string text)
        {
            if (statusLabel == null) return;
            statusLabel.Text = text;
            if (text == ReadyStatus())
            {
                if (statusRevertTimer != null) statusRevertTimer.Stop();
                return;
            }
            if (statusRevertTimer == null)
            {
                statusRevertTimer = new System.Windows.Forms.Timer();
                statusRevertTimer.Interval = 8000;
                statusRevertTimer.Tick += delegate
                {
                    statusRevertTimer.Stop();
                    if (!IsDisposed && statusLabel != null)
                        statusLabel.Text = ReadyStatus();
                };
            }
            statusRevertTimer.Stop();
            statusRevertTimer.Start();
        }

        private void BuildGrid()
        {
            grid = new DataGridView();
            grid.Location = new Point(20, 44);
            grid.Size = new Size(540, 378); // exactly 38px header + 10 * 34px rows
            grid.ScrollBars = ScrollBars.None;
            grid.ReadOnly = true;
            grid.AllowUserToAddRows = false;
            grid.AllowUserToDeleteRows = false;
            grid.AllowUserToResizeRows = false;
            grid.AllowUserToOrderColumns = false;
            grid.AllowUserToResizeColumns = false;
            grid.RowHeadersVisible = false;
            grid.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
            grid.MultiSelect = false;
            grid.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill;
            grid.BorderStyle = BorderStyle.None;
            grid.CellBorderStyle = DataGridViewCellBorderStyle.SingleHorizontal;
            grid.GridColor = ColLine;
            grid.BackgroundColor = ColRow;
            grid.EnableHeadersVisualStyles = false;
            grid.ColumnHeadersBorderStyle = DataGridViewHeaderBorderStyle.None;
            grid.ColumnHeadersHeightSizeMode = DataGridViewColumnHeadersHeightSizeMode.DisableResizing;
            grid.ColumnHeadersHeight = 38;

            DataGridViewCellStyle hs = grid.ColumnHeadersDefaultCellStyle;
            hs.BackColor = ColHeader;
            hs.ForeColor = ColSub;
            hs.SelectionBackColor = ColHeader;
            hs.SelectionForeColor = ColSub;
            hs.Font = new Font("Microsoft YaHei UI", 9f);
            hs.Padding = new Padding(10, 0, 0, 0);

            DataGridViewCellStyle cs = grid.DefaultCellStyle;
            cs.BackColor = ColRow;
            cs.ForeColor = ColText;
            cs.SelectionBackColor = ColSelect;
            cs.SelectionForeColor = Color.White;
            cs.Font = new Font("Microsoft YaHei UI", 9.75f);
            grid.RowTemplate.Height = 34;

            string[] headers = { "实例", "状态", "账号", "额度" };
            int[] weights = { 14, 16, 46, 24 };
            for (int c = 0; c < headers.Length; c++)
            {
                int index = grid.Columns.Add("c" + c, headers[c]);
                grid.Columns[index].FillWeight = weights[c];
                grid.Columns[index].SortMode = DataGridViewColumnSortMode.NotSortable;
                grid.Columns[index].DefaultCellStyle.Padding = new Padding(12, 0, 0, 0);
            }

            for (int i = 0; i <= MaxSlot; i++)
            {
                string name = (i == 0) ? "主实例" : ("实例 " + i);
                grid.Rows.Add(name, "…", "…", "…");
            }
            grid.ClearSelection();
            grid.CurrentCell = null;
            grid.CellDoubleClick += delegate(object sender, DataGridViewCellEventArgs e)
            {
                if (e.RowIndex >= 0) LaunchIndex(e.RowIndex);
            };

            Controls.Add(grid);
        }

        private Button MakeButton(string text, int x, int y, int width, Color back, Color hover)
        {
            var b = new Button();
            b.Text = text;
            b.Bounds = new Rectangle(x, y, width, 36);
            b.FlatStyle = FlatStyle.Flat;
            b.FlatAppearance.BorderSize = 0;
            b.FlatAppearance.MouseOverBackColor = hover;
            b.FlatAppearance.MouseDownBackColor = hover;
            b.BackColor = back;
            b.ForeColor = Color.White;
            b.Font = new Font("Microsoft YaHei UI", 9.75f);
            b.Cursor = Cursors.Hand;
            RoundControl(b, 10);
            Controls.Add(b);
            return b;
        }

        private void BuildTray()
        {
            tray = new NotifyIcon();
            tray.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            tray.Text = "Freebuff 多开控制器";
            tray.Visible = true;

            var menu = new ContextMenuStrip();
            menu.Items.Add("打开", null, delegate { ShowUp(); });
            menu.Items.Add("退出", null, delegate { Close(); });
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += delegate { ShowUp(); };
        }

        private void ShowUp()
        {
            Show();
            WindowState = FormWindowState.Normal;
            Activate();
        }

        private static void RoundControl(Control c, int radius)
        {
            var path = new GraphicsPath();
            int d = radius * 2;
            path.AddArc(0, 0, d, d, 180, 90);
            path.AddArc(c.Width - d - 1, 0, d, d, 270, 90);
            path.AddArc(c.Width - d - 1, c.Height - d - 1, d, d, 0, 90);
            path.AddArc(0, c.Height - d - 1, d, d, 90, 90);
            path.CloseFigure();
            c.Region = new Region(path);
            path.Dispose();
        }

        // Real system DPI relative to the 96 DPI the layout is authored at.
        // The process is DPI-aware, so this reads the true value.
        private static float DpiScale()
        {
            try
            {
                using (var g = Graphics.FromHwnd(IntPtr.Zero))
                    return g.DpiX / 96f;
            }
            catch { return 1f; }
        }

        // Multiply the fixed 96-DPI layout by the scale factor: every bound,
        // every font, the grid's fixed metrics. No-op at 100% scaling.
        private static void ScaleUi(Form f, float s)
        {
            if (s < 1.01f) return;
            f.ClientSize = new Size(
                (int)Math.Round(f.ClientSize.Width * s),
                (int)Math.Round(f.ClientSize.Height * s));
            foreach (Control c in f.Controls) ScaleControlTree(c, s);
        }

        private static void ScaleControlTree(Control c, float s)
        {
            c.Bounds = new Rectangle(
                (int)Math.Round(c.Left * s), (int)Math.Round(c.Top * s),
                (int)Math.Round(c.Width * s), (int)Math.Round(c.Height * s));
            if (c.Font != null)
                c.Font = new Font(c.Font.FontFamily, c.Font.Size * s, c.Font.Style);
            if (c is Button) RoundControl(c, (int)Math.Max(2, (int)Math.Round(10 * s)));
            DataGridView dgv = c as DataGridView;
            if (dgv != null)
            {
                int header = (int)Math.Round(38 * s);
                int row = (int)Math.Round(34 * s);
                dgv.ColumnHeadersHeight = header;
                dgv.RowTemplate.Height = row;
                foreach (DataGridViewRow r in dgv.Rows) r.Height = row;
                DataGridViewCellStyle hs2 = dgv.ColumnHeadersDefaultCellStyle;
                if (hs2.Font != null)
                    hs2.Font = new Font(hs2.Font.FontFamily, hs2.Font.Size * s, hs2.Font.Style);
                hs2.Padding = new Padding((int)Math.Round(10 * s), 0, 0, 0);
                DataGridViewCellStyle cs2 = dgv.DefaultCellStyle;
                if (cs2.Font != null)
                    cs2.Font = new Font(cs2.Font.FontFamily, cs2.Font.Size * s, cs2.Font.Style);
                foreach (DataGridViewColumn col in dgv.Columns)
                    col.DefaultCellStyle.Padding = new Padding((int)Math.Round(12 * s), 0, 0, 0);
                // keep the exact fit (header + 10 rows, scrollbars disabled)
                dgv.Height = header + row * dgv.Rows.Count;
            }
            foreach (Control child in c.Controls) ScaleControlTree(child, s);
        }

        // ---------- logic ----------

        private static string SlotStatePath(int n)
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                ".config\\freebuff-desktop\\slots\\slot-" + n + "\\state.json");
        }

        private static string SlotStateDir(int n)
        {
            return Path.GetDirectoryName(SlotStatePath(n));
        }

        private static string SlotUserData(int n)
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "Freebuff-slot-" + n);
        }

        private static HashSet<int> QueryRunning(out bool mainRunning)
        {
            var slots = new HashSet<int>();
            mainRunning = false;
            try
            {
                using (var searcher = new ManagementObjectSearcher(
                    "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='Freebuff.exe'"))
                {
                    foreach (ManagementObject o in searcher.Get())
                    {
                        string cl = o["CommandLine"] as string;
                        if (string.IsNullOrEmpty(cl)) continue;
                        Match m = SlotRegex.Match(cl);
                        if (m.Success)
                        {
                            int n;
                            if (int.TryParse(m.Groups[1].Value, out n)) slots.Add(n);
                        }
                        else
                        {
                            mainRunning = true;
                        }
                    }
                }
            }
            catch { }
            return slots;
        }

        private static string AccountForState(string statePath)
        {
            if (!File.Exists(statePath)) return "(未初始化)";
            try
            {
                string json = File.ReadAllText(statePath);
                Match m = EmailRegex.Match(json);
                if (m.Success) return m.Groups[1].Value;
                return "(未登录)";
            }
            catch
            {
                return "(读取中)";
            }
        }

        // One-time synchronous refresh while building the UI (still on the UI thread).
        private void ComputeAndApply()
        {
            bool mainRunning;
            HashSet<int> slots = QueryRunning(out mainRunning);
            string[] accounts = new string[MaxSlot + 1];
            for (int i = 0; i <= MaxSlot; i++)
                accounts[i] = (i == 0) ? AccountForState(DefaultState)
                                       : AccountForState(SlotStatePath(i));
            ApplyToGrid(mainRunning, slots, accounts);
        }

        // ---------- proxy ----------

        // Network attempts, most preferred first. Many machines reach GitHub
        // only through a local proxy client that is NOT the system proxy (a
        // loopback port), so it is probed before the system default — a dead
        // loopback port is refused instantly, so the extra attempt is free,
        // while a live one is the only route through. null = system default,
        // "" = force direct. proxy.txt overrides the loopback address or
        // ("off") disables it.
        private static readonly string LocalProxyConfigFile = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "FreebuffController\\proxy.txt");
        // The local proxy URL, or null when disabled ("off") / misconfigured.
        private static readonly string LocalProxyUrl = BuildLocalProxyUrl();
        private static readonly string[] ProxyCandidates = BuildProxyCandidates();

        private static string BuildLocalProxyUrl()
        {
            try
            {
                if (File.Exists(LocalProxyConfigFile))
                {
                    string t = File.ReadAllText(LocalProxyConfigFile).Trim();
                    if (t.Length > 0 && !t.Equals("off", StringComparison.OrdinalIgnoreCase))
                        return t;
                    return null;
                }
                // Common loopback entry of local proxy clients.
                return "http://127.0.0.1:10808";
            }
            catch { return null; }
        }

        private static string[] BuildProxyCandidates()
        {
            var list = new List<string>();
            Uri u;
            if (LocalProxyUrl != null && Uri.TryCreate(LocalProxyUrl, UriKind.Absolute, out u))
                list.Add(LocalProxyUrl);
            list.Add(null); // system default proxy
            list.Add("");   // explicit direct
            return list.ToArray();
        }

        private static void ApplyProxy(HttpWebRequest req, string candidate)
        {
            if (candidate == null) return; // leave the system default in place
            req.Proxy = (candidate.Length == 0) ? null : new WebProxy(candidate);
        }

        // True when the local proxy is actually listening. Loopback connects
        // resolve instantly (refused or accepted), so probing at launch time
        // is free; the 500 ms cap only matters for a remote proxy address.
        private static bool ProxyAlive(string url)
        {
            try
            {
                var u = new Uri(url);
                using (var c = new System.Net.Sockets.TcpClient())
                {
                    IAsyncResult ar = c.BeginConnect(u.Host, u.Port, null, null);
                    if (!ar.AsyncWaitHandle.WaitOne(500)) return false;
                    c.EndConnect(ar);
                    return true;
                }
            }
            catch { return false; }
        }

        // The proxy handed to launched Freebuff instances: the same local
        // proxy the controller's own requests prefer — but only when it is
        // actually listening, because with --proxy-server set a dead proxy
        // would leave the instance without any working route. null = launch
        // exactly as before; the app falls back to the system proxy itself.
        private static string LaunchProxyUrl()
        {
            string url = LocalProxyUrl;
            if (url == null || !ProxyAlive(url)) return null;
            return url;
        }

        // --proxy-server covers the Chromium side (UI, electron-updater);
        // the HTTP(S)_PROXY env vars are inherited by child processes (the
        // orchestrator) that consult them. Loopback stays direct: Chromium
        // bypasses it implicitly and NO_PROXY says so for the children.
        private static void ApplyLaunchProxy(ProcessStartInfo psi, string url)
        {
            psi.Arguments = (psi.Arguments.Length > 0 ? psi.Arguments + " " : "")
                + "--proxy-server=" + url;
            psi.EnvironmentVariables["HTTP_PROXY"] = url;
            psi.EnvironmentVariables["HTTPS_PROXY"] = url;
            psi.EnvironmentVariables["NO_PROXY"] = "localhost,127.0.0.1";
        }

        // ---------- quota ----------

        // Fetch remaining daily quota for every account. Runs off the UI
        // thread; at most one cycle at a time; at most one cycle per 5
        // minutes unless forced (刷新 button / startup).
        private void FetchQuotasAsync(bool force)
        {
            if (!force && (DateTime.Now - lastQuotaFetch).TotalMinutes < 5) return;
            if (Interlocked.CompareExchange(ref quotaBusy, 1, 0) != 0) return;
            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    for (int i = 0; i <= MaxSlot; i++)
                    {
                        if (IsDisposed) return;
                        string token = ReadTokenFor(i);
                        quotaTexts[i] = (token == null) ? "—" : FetchQuota(token);
                    }
                }
                catch { }
                finally
                {
                    lastQuotaFetch = DateTime.Now;
                    Interlocked.Exchange(ref quotaBusy, 0);
                }
                if (IsDisposed || !IsHandleCreated) return;
                try
                {
                    BeginInvoke((MethodInvoker)delegate
                    {
                        if (!IsDisposed)
                        {
                            ApplyQuotaColumn();
                            if (force) SetStatus("额度已刷新 ✓");
                        }
                    });
                }
                catch { }
            });
        }

        private void ApplyQuotaColumn()
        {
            for (int i = 0; i <= MaxSlot; i++)
            {
                string q = quotaTexts[i] ?? "…";
                bool usedUp = q.StartsWith("剩 0/");
                Color color = usedUp
                    ? System.Drawing.Color.FromArgb(230, 90, 90)
                    : (q.StartsWith("剩") ? ColGreen : ColSub);
                SetCell(grid.Rows[i], 3, q, color);
            }
        }

        // Writes a cell only when text or color actually changed, so the
        // 3-second poll doesn't repaint the grid when nothing moved.
        private static void SetCell(DataGridViewRow row, int col, string text, Color color)
        {
            DataGridViewCell cell = row.Cells[col];
            if (string.Equals(cell.Value as string, text, StringComparison.Ordinal)
                && cell.Style.ForeColor.ToArgb() == color.ToArgb()) return;
            cell.Value = text;
            cell.Style.ForeColor = color;
        }

        // The login token of instance i lives in its state file (main reads
        // the default one). Returns null when there is nothing to query.
        private static string ReadTokenFor(int i)
        {
            string path = (i == 0) ? DefaultState : SlotStatePath(i);
            if (!File.Exists(path)) return null;
            try
            {
                var state = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(
                    File.ReadAllText(path));
                if (state == null || !state.ContainsKey("authSessions")) return null;
                var auth = state["authSessions"] as Dictionary<string, object>;
                if (auth == null || auth.Count == 0) return null;
                var enumerator = auth.Values.GetEnumerator();
                if (!enumerator.MoveNext()) return null;
                var entry = enumerator.Current as Dictionary<string, object>;
                if (entry == null || !entry.ContainsKey("token")) return null;
                return entry["token"] as string;
            }
            catch { return null; }
        }

        // GET the session endpoint and summarize the premium-pool quota.
        // Shows the tightest remaining allowance across models. Routes are
        // tried in ProxyCandidates order; only a route-level failure moves
        // on to the next one.
        private static string FetchQuota(string token)
        {
            foreach (string candidate in ProxyCandidates)
            {
                string result = TryFetchQuota(token, candidate);
                if (result != null) return result;
            }
            return "获取失败";
        }

        // One network attempt; null = the route itself failed.
        private static string TryFetchQuota(string token, string proxyCandidate)
        {
            try
            {
                ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
                var req = (HttpWebRequest)WebRequest.Create(QuotaApiUrl);
                ApplyProxy(req, proxyCandidate);
                req.Method = "GET";
                req.Timeout = 8000;
                req.ReadWriteTimeout = 8000;
                req.Headers["Authorization"] = "Bearer " + token;
                req.UserAgent = "FreebuffMultiOpenController/1.0";
                using (var resp = (HttpWebResponse)req.GetResponse())
                using (var sr = new System.IO.StreamReader(resp.GetResponseStream()))
                {
                    var body = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(sr.ReadToEnd());
                    if (body == null || !body.ContainsKey("rateLimitsByModel")) return "—";
                    var models = body["rateLimitsByModel"] as Dictionary<string, object>;
                    if (models == null || models.Count == 0) return "无限制";

                    double bestRemaining = double.MaxValue, bestLimit = 0;
                    bool found = false;
                    foreach (var m in models.Values)
                    {
                        var q = m as Dictionary<string, object>;
                        if (q == null || !q.ContainsKey("limit") || !q.ContainsKey("recentCount")) continue;
                        double limit = Convert.ToDouble(q["limit"]);
                        double used = Convert.ToDouble(q["recentCount"]);
                        double remaining = limit - used;
                        if (remaining < bestRemaining)
                        {
                            bestRemaining = remaining;
                            bestLimit = limit;
                            found = true;
                        }
                    }
                    if (!found) return "—";
                    if (bestRemaining <= 0) return "剩 0/" + bestLimit + " 已用完";
                    return "剩 " + bestRemaining + "/" + bestLimit;
                }
            }
            catch (WebException wex)
            {
                var resp = wex.Response as HttpWebResponse;
                if (resp != null && (int)resp.StatusCode == 401) return "登录过期";
                return null; // network-level failure — try the next route
            }
            catch { return null; }
        }

        // ---------- version check ----------

        private static string ReadInstalledVersion()
        {
            try
            {
                string v = FileVersionInfo.GetVersionInfo(FreebuffExe).FileVersion;
                if (!string.IsNullOrEmpty(v)) return v.Trim();
            }
            catch { }
            return null;
        }

        // The app can update underneath us — possibly via the installer this
        // controller itself launched — so every version comparison (update
        // banner, hanhua dict-age guard) must re-read this instead of trusting
        // the value from startup.
        private void RefreshInstalledVersion()
        {
            string v = ReadInstalledVersion();
            if (!string.IsNullOrEmpty(v)) installedVersion = v;
        }

        // electron-updater's generic provider config ships with the app and
        // points at the same feed the official updater polls.
        private static string ReadUpdateFeedUrl()
        {
            try
            {
                string yml = Path.Combine(
                    Path.GetDirectoryName(FreebuffExe), "resources\\app-update.yml");
                if (File.Exists(yml))
                {
                    Match m = FeedUrlRegex.Match(File.ReadAllText(yml));
                    if (m.Success)
                        return m.Groups[1].Value.Trim().TrimEnd('/') + "/latest.yml";
                }
            }
            catch { }
            return FallbackUpdateFeed;
        }

        // latest.yml is the file electron-updater itself reads. The feed
        // answers with a 302 whose Location (the GitHub release asset URL)
        // already carries the latest version, so we read just that header
        // instead of following to GitHub, which can be slow or unreachable.
        // A feed that ever serves the file directly still works via the
        // body fallback below. Routes are tried in ProxyCandidates order.
        private static string FetchLatestVersion(string feedUrl)
        {
            foreach (string candidate in ProxyCandidates)
            {
                try
                {
                    ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
                    var req = (HttpWebRequest)WebRequest.Create(feedUrl);
                    req.Method = "GET";
                    req.AllowAutoRedirect = false;
                    req.Timeout = 10000;
                    req.ReadWriteTimeout = 10000;
                    req.UserAgent = "FreebuffMultiOpenController/1.0";
                    ApplyProxy(req, candidate);
                    using (var resp = (HttpWebResponse)req.GetResponse())
                    {
                        int code = (int)resp.StatusCode;
                        if (code >= 300 && code < 400)
                        {
                            Match m = LooseVersionRegex.Match(resp.Headers["Location"] ?? "");
                            if (m.Success) return m.Value;
                        }
                        else
                        {
                            using (var sr = new StreamReader(resp.GetResponseStream()))
                            {
                                Match m = YamlVersionRegex.Match(sr.ReadToEnd());
                                if (m.Success) return m.Groups[1].Value.Trim();
                            }
                        }
                    }
                }
                catch { }
            }
            return null;
        }

        // "0.0.76.0" (exe) and "0.0.76" (feed) must compare equal, so only
        // major.minor.build are kept. Returns null when unparsable.
        private static Version ParseLooseVersion(string s)
        {
            if (string.IsNullOrEmpty(s)) return null;
            Match m = LooseVersionRegex.Match(s);
            if (!m.Success) return null;
            int build;
            int.TryParse(m.Groups[3].Value, out build);
            return new Version(
                int.Parse(m.Groups[1].Value),
                int.Parse(m.Groups[2].Value),
                build);
        }

        private bool UpdateAvailable()
        {
            var installed = ParseLooseVersion(installedVersion);
            var latest = ParseLooseVersion(latestVersion);
            return installed != null && latest != null
                && latest.CompareTo(installed) > 0;
        }

        // Runs on a background thread; at most one check at a time.
        private void CheckVersionAsync()
        {
            if (Interlocked.CompareExchange(ref versionCheckBusy, 1, 0) != 0) return;
            ApplyVersionUi(true);
            ThreadPool.QueueUserWorkItem(delegate
            {
                string latest = null;
                try { latest = FetchLatestVersion(ReadUpdateFeedUrl()); }
                catch { }
                Interlocked.Exchange(ref versionCheckBusy, 0);

                if (IsDisposed || !IsHandleCreated) return;
                try
                {
                    BeginInvoke((MethodInvoker)delegate
                    {
                        if (IsDisposed) return;
                        RefreshInstalledVersion();
                        latestVersion = latest;
                        // The installer this controller launched may have
                        // finished meanwhile: once the installed version
                        // catches up with the feed, the "安装包已启动" banner
                        // and the failed-download fallback are stale.
                        var inst = ParseLooseVersion(installedVersion);
                        var lat = ParseLooseVersion(latest);
                        if (inst != null && lat != null && inst.CompareTo(lat) >= 0)
                        {
                            updateStarted = false;
                            updateFailed = false;
                        }
                        ApplyVersionUi(false);
                        if (UpdateAvailable() && !updateStarted)
                        {
                            string after = (HanhuaApplied() && HanhuaBuildDir(hanhuaDir) != null)
                                ? " 更新会覆盖汉化，装完点“应用汉化”恢复中文。"
                                : "";
                            SetStatus("Freebuff 发布了新版本 v" + latestVersion +
                                "，点击右下角“点击更新”直接下载安装。" + after);
                        }
                    });
                }
                catch { }
            });
        }

        private void ApplyVersionUi(bool checking)
        {
            if (versionLink == null) return;
            // While a download runs its worker owns the label.
            if (Interlocked.CompareExchange(ref updateBusy, 0, 0) == 1) return;
            if (checking)
            {
                versionLink.Text = "检查更新中…";
                versionLink.ForeColor = ColSub;
                return;
            }
            if (updateStarted)
            {
                versionLink.Text = (HanhuaBuildDir(hanhuaDir) != null)
                    ? "安装包已启动 · 装完点“应用汉化”"
                    : "安装包已启动 · 按提示完成安装";
                versionLink.ForeColor = ColSub;
                return;
            }
            if (updateFailed)
            {
                versionLink.Text = "下载失败 · 再点打开下载页";
                versionLink.ForeColor = ColNewVersion;
                return;
            }
            if (UpdateAvailable())
            {
                versionLink.Text = "发现新版本 v" + latestVersion + " · 点击更新";
                versionLink.ForeColor = ColNewVersion;
                return;
            }
            if (string.IsNullOrEmpty(latestVersion))
            {
                versionLink.Text = "检查更新失败 · 点击重试";
                versionLink.ForeColor = ColSub;
                return;
            }
            versionLink.Text = (string.IsNullOrEmpty(installedVersion)
                    ? "Freebuff 版本未知"
                    : "Freebuff v" + installedVersion) + " · 已是最新";
            versionLink.ForeColor = ColSub;
        }

        private void UiSafe(MethodInvoker action)
        {
            if (IsDisposed || !IsHandleCreated) return;
            try { BeginInvoke(action); } catch { }
        }

        // Click behavior by state: installing -> explain; download previously
        // failed -> fall back to the browser download page; newer release
        // known -> start the download; otherwise -> (re)run the check.
        private void OnVersionLinkClick()
        {
            if (updateStarted)
            {
                Info("安装包已启动，请按安装程序的提示完成更新。\r\n" +
                    "若提示 Freebuff 正在运行，请先在列表里“停止全部”。");
                return;
            }
            if (updateFailed)
            {
                updateFailed = false;
                try { Process.Start(ReleasesPageUrl); } catch { }
                ApplyVersionUi(false);
                return;
            }
            if (UpdateAvailable())
            {
                StartUpdateDownload();
                return;
            }
            CheckVersionAsync();
        }

        // Downloads the installer from the same feed the official updater
        // uses, verifies its SHA512 against latest.yml, then runs it. GitHub
        // must be reachable for the big file itself; if anything fails the
        // link falls back to opening the release page.
        private void StartUpdateDownload()
        {
            if (Interlocked.CompareExchange(ref updateBusy, 1, 0) != 0) return;
            versionLink.Text = "准备下载…";
            versionLink.ForeColor = ColNewVersion;
            SetStatus("正在下载 Freebuff v" + latestVersion + " 安装包…");
            ThreadPool.QueueUserWorkItem(delegate
            {
                Exception error = null;
                bool shaVerified = false;
                try
                {
                    // latest.yml gives the exact file name + SHA512. If it
                    // can't be fetched we still try the official download
                    // link, just without hash verification — and say so in
                    // the status line once the installer is launched.
                    string file = "Freebuff-setup.exe";
                    string shaB64 = null;
                    string derivedUrl = null;
                    string yml = FetchYamlBody(ReadUpdateFeedUrl());
                    if (yml != null)
                    {
                        Match pm = YamlPathRegex.Match(yml);
                        if (pm.Success)
                        {
                            file = pm.Groups[1].Value.Trim();
                            derivedUrl = FeedBase() + "/" + file;
                        }
                        Match sm = YamlShaRegex.Match(yml);
                        if (sm.Success)
                        {
                            shaB64 = sm.Groups[1].Value.Trim();
                            shaVerified = true;
                        }
                    }
                    string dest = Path.Combine(Path.GetTempPath(), file);
                    var candidates = new List<string>();
                    candidates.Add(OfficialDownloadUrl);
                    if (derivedUrl != null) candidates.Add(derivedUrl);
                    DownloadFirstAvailable(candidates, dest, shaB64,
                        delegate(long done, long total)
                        {
                            long d = done, t = total;
                            UiSafe(delegate
                            {
                                if (versionLink == null || IsDisposed) return;
                                versionLink.Text = t > 0
                                    ? ("下载中 " + (d * 100 / t) + "%")
                                    : ("已下载 " + (d >> 20) + " MB");
                            });
                        });
                    try { Process.Start(dest); }
                    catch (Exception launchEx)
                    {
                        throw new ApplicationException("安装包已下载但无法启动：" + launchEx.Message);
                    }
                }
                catch (Exception ex) { error = ex; }
                Interlocked.Exchange(ref updateBusy, 0);

                if (error == null)
                {
                    UiSafe(delegate
                    {
                        if (IsDisposed) return;
                        updateStarted = true;
                        ApplyVersionUi(false);
                        SetStatus("Freebuff 安装包已下载并启动，按提示完成安装。" +
                            (shaVerified ? "" : "（本次未取得 latest.yml，跳过了 SHA512 校验）") +
                            "若提示 Freebuff 正在运行，请先“停止全部”。");
                    });
                }
                else
                {
                    UiSafe(delegate
                    {
                        if (IsDisposed) return;
                        updateFailed = true;
                        ApplyVersionUi(false);
                        SetStatus("下载更新失败：" + error.Message);
                    });
                }
            });
        }

        // Full latest.yml body; follows the feed's redirect to GitHub, which
        // is fine here because the installer itself lives on GitHub anyway.
        // Routes are tried in ProxyCandidates order — machines with a
        // half-working system proxy often fail exactly on the GitHub hop,
        // and machines without a system proxy need the loopback one first.
        private static string FetchYamlBody(string url)
        {
            foreach (string candidate in ProxyCandidates)
            {
                try
                {
                    ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
                    var req = (HttpWebRequest)WebRequest.Create(url);
                    req.Method = "GET";
                    req.AllowAutoRedirect = true;
                    req.Timeout = 15000;
                    req.ReadWriteTimeout = 15000;
                    req.UserAgent = "FreebuffMultiOpenController/1.0";
                    ApplyProxy(req, candidate);
                    using (var resp = (HttpWebResponse)req.GetResponse())
                    using (var sr = new StreamReader(resp.GetResponseStream()))
                    {
                        return sr.ReadToEnd();
                    }
                }
                catch { }
            }
            return null;
        }

        private static string FeedBase()
        {
            string feed = ReadUpdateFeedUrl();
            return feed.EndsWith("/latest.yml")
                ? feed.Substring(0, feed.Length - "/latest.yml".Length)
                : feed;
        }

        // Tries every candidate URL over every route in ProxyCandidates
        // order (local proxy, system proxy, direct): whichever path the
        // machine needs for GitHub, one of them gets through.
        private static void DownloadFirstAvailable(IList<string> urls, string dest,
                                                   string shaB64, Action<long, long> progress)
        {
            Exception last = null;
            foreach (string url in urls)
            {
                foreach (string candidate in ProxyCandidates)
                {
                    try
                    {
                        DownloadOnce(url, dest, shaB64, progress, candidate);
                        return;
                    }
                    catch (Exception ex) { last = ex; }
                }
            }
            throw last;
        }

        private static void DownloadOnce(string url, string dest, string shaB64,
                                         Action<long, long> progress, string proxyCandidate)
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.Method = "GET";
            req.AllowAutoRedirect = true;
            req.Timeout = 30000;
            req.ReadWriteTimeout = 30000;
            req.UserAgent = "FreebuffMultiOpenController/1.0";
            ApplyProxy(req, proxyCandidate);
            using (var resp = (HttpWebResponse)req.GetResponse())
            using (var rs = resp.GetResponseStream())
            using (var fs = new FileStream(dest, FileMode.Create, FileAccess.Write))
            {
                long total = resp.ContentLength;
                long done = 0;
                var buf = new byte[65536];
                var sha = System.Security.Cryptography.SHA512.Create();
                byte[] got;
                try
                {
                    DateTime lastUi = DateTime.MinValue;
                    int n;
                    while ((n = rs.Read(buf, 0, buf.Length)) > 0)
                    {
                        fs.Write(buf, 0, n);
                        sha.TransformBlock(buf, 0, n, null, 0);
                        done += n;
                        if (progress != null && (DateTime.Now - lastUi).TotalMilliseconds >= 300)
                        {
                            lastUi = DateTime.Now;
                            progress(done, total);
                        }
                    }
                    sha.TransformFinalBlock(buf, 0, 0);
                    got = sha.Hash;
                }
                finally { ((IDisposable)sha).Dispose(); }
                if (!string.IsNullOrEmpty(shaB64))
                {
                    byte[] want = Convert.FromBase64String(shaB64);
                    bool ok = want.Length == got.Length;
                    if (ok)
                    {
                        for (int i = 0; i < want.Length; i++)
                        {
                            if (want[i] != got[i]) { ok = false; break; }
                        }
                    }
                    if (!ok)
                    {
                        try { File.Delete(dest); } catch { }
                        throw new ApplicationException("安装包 SHA512 校验失败");
                    }
                }
            }
        }

        // Background refresh: WMI + file reads never block the UI thread.
        private void RefreshGrid()
        {
            if (Interlocked.CompareExchange(ref refreshBusy, 1, 0) != 0) return;
            ThreadPool.QueueUserWorkItem(delegate
            {
                bool mainRunning = false;
                HashSet<int> slots = new HashSet<int>();
                string[] accounts = new string[MaxSlot + 1];
                try
                {
                    slots = QueryRunning(out mainRunning);
                    for (int i = 0; i <= MaxSlot; i++)
                        accounts[i] = (i == 0) ? AccountForState(DefaultState)
                                               : AccountForState(SlotStatePath(i));
                }
                catch { }
                finally { Interlocked.Exchange(ref refreshBusy, 0); }

                if (IsDisposed || !IsHandleCreated) return;
                try
                {
                    BeginInvoke((MethodInvoker)delegate
                    {
                        if (IsDisposed) return;
                        ApplyToGrid(mainRunning, slots, accounts);
                    });
                }
                catch { }
            });
        }

        private void ApplyToGrid(bool mainRunning, HashSet<int> slots, string[] accounts)
        {
            for (int i = 0; i <= MaxSlot; i++)
            {
                bool run = (i == 0) ? mainRunning : slots.Contains(i);
                string acct = accounts[i] ?? "…";
                DataGridViewRow row = grid.Rows[i];
                SetCell(row, 1, run ? "● 运行中" : "○ 已停止", run ? ColGreen : ColSub);
                SetCell(row, 2, acct, acct.StartsWith("(") ? ColSub : ColText);
            }
        }

        // 0 = main instance row, 1..9 = slot, -999 = nothing selected
        private int SelectedIndex()
        {
            if (grid.CurrentCell == null) return -999;
            return grid.CurrentCell.RowIndex;
        }

        private void Info(string text)
        {
            MessageBox.Show(this, text, "Freebuff 多开控制器",
                MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        private bool Confirm(string text)
        {
            return MessageBox.Show(this, text, "确认操作",
                MessageBoxButtons.YesNo, MessageBoxIcon.Warning)
                == DialogResult.Yes;
        }

        private void Delay(int ms, Action action)
        {
            var t = new System.Windows.Forms.Timer();
            t.Interval = ms;
            t.Tick += delegate
            {
                t.Stop();
                t.Dispose();
                if (IsDisposed) return;
                action();
            };
            t.Start();
        }

        private void LaunchIndex(int rowIndex)
        {
            string what = (rowIndex == 0) ? "主实例" : ("实例 " + rowIndex);
            // -1 = fresh login; the init dialog decides for never-used slots.
            int copyFrom = -1;
            if (rowIndex != 0 && !File.Exists(SlotStatePath(rowIndex)))
            {
                using (InitModeDialog dlg = new InitModeDialog(rowIndex))
                {
                    if (dlg.ShowDialog(this) != DialogResult.OK) return;
                    copyFrom = dlg.CopyFrom;
                }
            }
            try
            {
                if (rowIndex == 0) StartMain();
                else StartSlot(rowIndex, copyFrom);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, what + " 启动失败：\n" + ex.Message,
                    "启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            SetStatus(what + " 启动中…（几秒后自动确认）");
            Delay(6000, delegate { VerifyLaunched(rowIndex, what); });
        }

        // Asked when a never-initialized instance is launched: the fresh vs.
        // copy choice only matters at that moment, so it lives here instead
        // of a permanently visible panel that users must interpret upfront.
        private class InitModeDialog : Form
        {
            private readonly RadioButton rbFresh = new RadioButton();
            private readonly RadioButton rbCopy = new RadioButton();
            private readonly ComboBox source = new ComboBox();
            private readonly List<int> sourceIndex = new List<int>();

            public InitModeDialog(int slot)
            {
                Text = "启动 实例 " + slot;
                ClientSize = new Size(426, 246);
                BackColor = ColPanel;
                ForeColor = ColText;
                Font = new Font("Microsoft YaHei UI", 9.75f);
                FormBorderStyle = FormBorderStyle.FixedDialog;
                MinimizeBox = false;
                MaximizeBox = false;
                ShowInTaskbar = false;
                StartPosition = FormStartPosition.CenterParent;

                var q = new Label();
                q.Text = "实例 " + slot + " 还没有登录过，这次要如何启动？";
                q.Bounds = new Rectangle(16, 14, 394, 20);
                Controls.Add(q);

                rbFresh.Text = "全新登录";
                rbFresh.Bounds = new Rectangle(16, 48, 180, 20);
                rbFresh.ForeColor = ColText;
                rbFresh.BackColor = ColPanel;
                rbFresh.Checked = true;
                Controls.Add(rbFresh);

                var subFresh = new Label();
                subFresh.Text = "打开后在窗口里登录该实例要用的账号，每个窗口可用不同账号";
                subFresh.Bounds = new Rectangle(38, 70, 372, 18);
                subFresh.ForeColor = ColSub;
                subFresh.Font = new Font("Microsoft YaHei UI", 8.5f);
                Controls.Add(subFresh);

                rbCopy.Text = "复制已有实例的账号";
                rbCopy.Bounds = new Rectangle(16, 100, 200, 20);
                rbCopy.ForeColor = ColText;
                rbCopy.BackColor = ColPanel;
                Controls.Add(rbCopy);

                // Only instances that are actually logged in can be cloned —
                // anything else would silently fall back to a fresh login.
                // The account email is shown so it's obvious who is cloned.
                source.DropDownStyle = ComboBoxStyle.DropDownList;
                source.Bounds = new Rectangle(38, 124, 300, 24);
                source.BackColor = ColNeutral;
                source.ForeColor = ColText;
                source.Font = new Font("Microsoft YaHei UI", 9f);
                for (int i = 0; i <= MaxSlot; i++)
                {
                    if (i == slot) continue; // can't copy from the target itself
                    if (ReadTokenFor(i) == null) continue; // not logged in
                    string label = (i == 0) ? "主实例" : ("实例 " + i);
                    string acct = AccountForState((i == 0) ? DefaultState : SlotStatePath(i));
                    if (!acct.StartsWith("(")) label += "（" + acct + "）";
                    source.Items.Add(label);
                    sourceIndex.Add(i);
                }
                if (source.Items.Count > 0) source.SelectedIndex = 0;
                source.Enabled = false;
                Controls.Add(source);

                var subCopy = new Label();
                subCopy.Text = "把来源实例的登录状态原样克隆到实例 " + slot +
                    "，打开后无需再登录。\r\n注意：同一账号多开会共享每日额度。";
                subCopy.Bounds = new Rectangle(38, 154, 372, 34);
                subCopy.ForeColor = ColSub;
                subCopy.Font = new Font("Microsoft YaHei UI", 8.5f);
                Controls.Add(subCopy);

                rbCopy.CheckedChanged += delegate { source.Enabled = rbCopy.Checked; };

                // No logged-in instance to copy from: offer fresh login only.
                int buttonY = 202;
                int height = 246;
                if (source.Items.Count == 0)
                {
                    rbCopy.Visible = false;
                    source.Visible = false;
                    subCopy.Visible = false;
                    buttonY = 96;
                    height = 140;
                }
                ClientSize = new Size(426, height);

                Button cancel = MakeDialogButton("取消", 198, ColNeutral, ColNeutralHover, buttonY);
                cancel.DialogResult = DialogResult.Cancel;
                Button ok = MakeDialogButton("启动", 310, ColAccent, ColAccentHover, buttonY);
                ok.DialogResult = DialogResult.OK;
                AcceptButton = ok;
                CancelButton = cancel;

                // Same 96-DPI-authored layout as the main window.
                ScaleUi(this, DpiScale());
            }

            // -1 fresh, otherwise the chosen source (0 = main instance).
            public int CopyFrom
            {
                get
                {
                    return rbCopy.Checked && source.SelectedIndex >= 0
                        ? sourceIndex[source.SelectedIndex]
                        : -1;
                }
            }

            private Button MakeDialogButton(string text, int x, Color back, Color hover, int y)
            {
                var b = new Button();
                b.Text = text;
                b.Bounds = new Rectangle(x, y, 100, 32);
                b.FlatStyle = FlatStyle.Flat;
                b.FlatAppearance.BorderSize = 0;
                b.FlatAppearance.MouseOverBackColor = hover;
                b.FlatAppearance.MouseDownBackColor = hover;
                b.BackColor = back;
                b.ForeColor = Color.White;
                b.Cursor = Cursors.Hand;
                RoundControl(b, 10);
                Controls.Add(b);
                return b;
            }

            protected override void OnHandleCreated(EventArgs e)
            {
                base.OnHandleCreated(e);
                try
                {
                    int on = 1; // DWMWA_USE_IMMERSIVE_DARK_MODE
                    DwmSetWindowAttribute(Handle, 20, ref on, 4);
                }
                catch { }
            }
        }

        // After a launch, confirm on a background thread that the process is
        // still alive, so "nothing happened" always comes with an explanation.
        private void VerifyLaunched(int rowIndex, string what)
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                bool ok;
                try
                {
                    bool mainRunning;
                    HashSet<int> slots = QueryRunning(out mainRunning);
                    ok = (rowIndex == 0) ? mainRunning : slots.Contains(rowIndex);
                }
                catch { ok = true; }

                if (IsDisposed || !IsHandleCreated) return;
                try
                {
                    BeginInvoke((MethodInvoker)delegate
                    {
                        if (IsDisposed) return;
                        RefreshGrid();
                        if (ok) SetStatus(what + " 已运行 ✓");
                        else
                        {
                            SetStatus(what + " 启动异常");
                            MessageBox.Show(this,
                                what + " 的进程发出启动命令后没有保持运行。\n\n" +
                                "常见原因：\n" +
                                "· Freebuff 正在退出中（等几秒再试）\n" +
                                "· 该实例数据目录被占用\n" +
                                "· 杀毒软件拦截了 Freebuff 启动",
                                "启动结果", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                        }
                    });
                }
                catch { }
            });
        }

        private void OnLaunch()
        {
            int idx = SelectedIndex();
            if (idx == -999)
            {
                Info("请先点击选中一行。");
                return;
            }
            LaunchIndex(idx);
        }

        private void OnStop()
        {
            int idx = SelectedIndex();
            if (idx == -999)
            {
                Info("请先点击选中一行。");
                return;
            }
            try { KillInstances(idx == 0 ? "main" : idx.ToString()); }
            catch (Exception ex)
            {
                MessageBox.Show(this, "停止失败：\n" + ex.Message,
                    "停止失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            SetStatus("已发出停止命令…");
            Delay(900, RefreshGrid);
        }

        private void OnStopAll()
        {
            try
            {
                string[] all = new string[MaxSlot + 1];
                all[0] = "main";
                for (int i = 1; i <= MaxSlot; i++) all[i] = i.ToString();
                KillInstances(all);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "停止失败：\n" + ex.Message,
                    "停止失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            SetStatus("已发出全部停止命令…");
            Delay(900, RefreshGrid);
        }

        private void OnReset()
        {
            int idx = SelectedIndex();
            if (idx == -999)
            {
                Info("请先点击选中一行。");
                return;
            }
            if (idx == 0)
            {
                Info("主实例的账号不在控制器里重置。");
                return;
            }
            bool yes = Confirm(string.Format(
                "确定清空实例 {0} 吗？\r\n该实例的登录和浏览数据会被删除，下次启动需要重新登录。", idx));
            if (!yes) return;
            KillInstances(idx.ToString());
            SetStatus("正在重置实例 " + idx + "…");
            Delay(1200, delegate { TryDeleteWithRetry(idx, 3); });
        }

        private static void TryDeleteDir(string dir)
        {
            try
            {
                if (Directory.Exists(dir)) Directory.Delete(dir, true);
            }
            catch { }
        }

        // Chromium can hold profile files open for a moment after the browser
        // process dies, so give deletion a few tries before giving up.
        private void TryDeleteWithRetry(int idx, int attemptsLeft)
        {
            TryDeleteDir(SlotStateDir(idx));
            TryDeleteDir(SlotUserData(idx));
            bool clean = !Directory.Exists(SlotStateDir(idx))
                      && !Directory.Exists(SlotUserData(idx));
            if (clean || attemptsLeft <= 1)
            {
                SetStatus(clean
                    ? ("实例 " + idx + " 已重置 ✓")
                    : ("实例 " + idx + " 有文件被占用，稍后再点一次重置即可"));
                RefreshGrid();
                return;
            }
            Delay(1500, delegate { TryDeleteWithRetry(idx, attemptsLeft - 1); });
        }

        private static void StartMain()
        {
            string url = LaunchProxyUrl();
            if (url == null)
            {
                Process.Start(new ProcessStartInfo(FreebuffExe) { UseShellExecute = true });
                return;
            }
            var psi = new ProcessStartInfo(FreebuffExe) { UseShellExecute = false };
            ApplyLaunchProxy(psi, url);
            Process.Start(psi);
        }

        // copyFrom: -1 = fresh login, 0 = main instance, 1..9 = that slot.
        // Only matters when the slot has no state yet.
        private static void StartSlot(int n, int copyFrom)
        {
            string state = SlotStatePath(n);
            if (!File.Exists(state))
            {
                Directory.CreateDirectory(Path.GetDirectoryName(state));
                string source = (copyFrom <= 0) ? DefaultState : SlotStatePath(copyFrom);
                if (copyFrom >= 0 && File.Exists(source))
                {
                    try
                    {
                        File.Copy(source, state);
                    }
                    catch
                    {
                        // Source state was likely mid-write; fall back to a
                        // fresh state rather than seeding a corrupt copy.
                        try { File.Delete(state); } catch { }
                    }
                }
            }
            var psi = new ProcessStartInfo();
            psi.FileName = FreebuffExe;
            psi.UseShellExecute = false;
            psi.Arguments = "--user-data-dir=\"" + SlotUserData(n) + "\"";
            psi.EnvironmentVariables["FREEBUFF_DESKTOP_STATE_PATH"] = state;
            ApplyLaunchProxy(psi, LaunchProxyUrl());
            Process.Start(psi);
        }

        // One WMI pass for however many targets we are stopping, so
        // "stop all" never blocks the UI thread on ten sequential queries.
        private static void KillInstances(params string[] targets)
        {
            var pids = new List<int>();
            try
            {
                using (var searcher = new ManagementObjectSearcher(
                    "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='Freebuff.exe'"))
                {
                    foreach (ManagementObject o in searcher.Get())
                    {
                        string cl = o["CommandLine"] as string;
                        if (string.IsNullOrEmpty(cl)) continue;
                        Match m = SlotRegex.Match(cl);
                        string id = m.Success ? m.Groups[1].Value : "main";
                        foreach (string t in targets)
                        {
                            if (t == id)
                            {
                                pids.Add((int)(uint)o["ProcessId"]);
                                break;
                            }
                        }
                    }
                }
            }
            catch { }
            pids.Sort();
            foreach (int pid in pids)
            {
                try
                {
                    using (var p = Process.GetProcessById(pid))
                    {
                        p.Kill();
                    }
                }
                catch { }
            }
        }

        // ---------- 汉化 (hanhua) ----------

        // Status text mirrors the state machine of hanhua's apply.sh: applied
        // (zh-CN marker present), not applied, and whether output/ is usable.
        private void RefreshHanhuaUi()
        {
            if (hanhuaLabel == null) return;
            if (Interlocked.CompareExchange(ref hanhuaBusy, 0, 0) == 1)
            {
                btnHanhuaApply.Enabled = false;
                btnHanhuaRestore.Enabled = false;
                return;
            }
            bool applied = HanhuaApplied();
            string build = HanhuaBuildDir(hanhuaDir);
            string tv = HanhuaTargetVersion(hanhuaDir);
            var inst = ParseLooseVersion(installedVersion);
            var target = ParseLooseVersion(tv);
            bool outdated = inst != null && target != null && inst.CompareTo(target) > 0;
            string tag = (tv == null) ? "" : "（词典 v" + tv + (outdated ? "，已过时" : "") + "）";

            if (applied)
                hanhuaLabel.Text = (build != null) ? ("汉化：已应用" + tag) : "汉化：已应用";
            else if (build != null)
                hanhuaLabel.Text = "汉化：未应用 · 可一键应用" + tag;
            else if (hanhuaDir != null)
                hanhuaLabel.Text = "汉化：未应用 · 缺少构建（先运行 build.sh）";
            else
                hanhuaLabel.Text = "汉化：未应用 · 未找到仓库（点「应用汉化」定位）";
            hanhuaLabel.ForeColor = (applied || build == null) ? ColSub : ColGreen;
            // "应用汉化" is only meaningful while the app is still English
            // (either never applied, or Freebuff's auto-update reverted it).
            // Once applied there is nothing to do — leave it disabled, exactly
            // like 还原英文 before any backup exists. Repo-not-found keeps it
            // clickable so OnHanhuaApply can pop the folder picker.
            btnHanhuaApply.Enabled = !applied && (build != null || hanhuaDir == null);
            btnHanhuaRestore.Enabled = applied && LatestHanhuaBackup() != null;
        }

        // exe-adjacent probes → config (the order the README documents). A
        // hanhua/ sitting next to the exe is almost certainly the one to use;
        // the remembered path only rescues a controller exe that lives
        // somewhere else, so it must not override a real sibling directory.
        private string FindHanhuaDir()
        {
            try
            {
                string exeDir = Path.GetDirectoryName(Application.ExecutablePath);
                string[] probes = new string[]
                {
                    Path.Combine(exeDir, "hanhua"),
                    Path.GetFullPath(Path.Combine(exeDir, "..\\hanhua"))
                };
                foreach (string p in probes)
                    if (IsValidHanhuaDir(p)) return p;
            }
            catch { }
            string fromConfig = ReadHanhuaConfig();
            if (IsValidHanhuaDir(fromConfig)) return fromConfig;
            return null;
        }

        // Ask once and remember; apply/restore are useless without the repo.
        private bool TryResolveHanhuaDir()
        {
            if (IsValidHanhuaDir(hanhuaDir)) return true;
            using (var dlg = new FolderBrowserDialog())
            {
                dlg.Description = "选择工具包里的 hanhua 目录（含 dict.json 与 output/）";
                dlg.ShowNewFolderButton = false;
                if (dlg.ShowDialog(this) != DialogResult.OK) return false;
                if (!IsValidHanhuaDir(dlg.SelectedPath))
                {
                    Info("所选目录不是汉化仓库（缺少 dict.json）。");
                    return false;
                }
                hanhuaDir = dlg.SelectedPath;
                SaveHanhuaConfig(hanhuaDir);
                return true;
            }
        }

        private static string ReadHanhuaConfig()
        {
            try
            {
                if (!File.Exists(HanhuaConfigFile)) return null;
                string p = File.ReadAllText(HanhuaConfigFile).Trim();
                return (p.Length > 0) ? p : null;
            }
            catch { return null; }
        }

        private static void SaveHanhuaConfig(string dir)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(HanhuaConfigFile));
                File.WriteAllText(HanhuaConfigFile, dir);
            }
            catch { }
        }

        private static bool IsValidHanhuaDir(string dir)
        {
            if (string.IsNullOrEmpty(dir)) return false;
            return File.Exists(Path.Combine(dir, "dict.json"))
                && Directory.Exists(Path.Combine(dir, "tools"));
        }

        // output/app.asar + output/ui/index.html exist → usable build.
        private static string HanhuaBuildDir(string dir)
        {
            if (string.IsNullOrEmpty(dir)) return null;
            string outDir = Path.Combine(dir, "output");
            if (File.Exists(Path.Combine(outDir, "app.asar"))
                && File.Exists(Path.Combine(outDir, "ui\\index.html"))) return outDir;
            return null;
        }

        private static string HanhuaTargetVersion(string dir)
        {
            try
            {
                if (string.IsNullOrEmpty(dir)) return null;
                string manifest = Path.Combine(dir, "manifest.json");
                if (!File.Exists(manifest)) return null;
                Match m = ManifestVersionRegex.Match(File.ReadAllText(manifest));
                return m.Success ? m.Groups[1].Value : null;
            }
            catch { return null; }
        }

        // Same sentinel hanhua's apply.sh / postbuild.js check.
        private static bool HanhuaApplied()
        {
            try
            {
                return File.Exists(InstalledUiIndex)
                    && File.ReadAllText(InstalledUiIndex).Contains(HanhuaMarker);
            }
            catch { return false; }
        }

        // Timestamped names sort lexicographically; newest backup wins.
        // Only complete backups (app.asar + ui/index.html) qualify — restoring
        // from a half-written one would leave asar and ui out of sync.
        private static string LatestHanhuaBackup()
        {
            try
            {
                if (!Directory.Exists(FreebuffResources)) return null;
                string best = null;
                foreach (string d in Directory.GetDirectories(FreebuffResources, "hanhua-backup-*"))
                    if (File.Exists(Path.Combine(d, "app.asar"))
                        && File.Exists(Path.Combine(d, "ui\\index.html"))
                        && (best == null || string.CompareOrdinal(d, best) > 0)) best = d;
                return best;
            }
            catch { return null; }
        }

        private static string HanhuaErrorText(Exception ex)
        {
            if (ex is IOException || ex is UnauthorizedAccessException)
                return "文件被占用或无权限，请先关闭所有 Freebuff 窗口再试（" + ex.Message + "）";
            return ex.Message;
        }

        private static void CopyDir(string src, string dst)
        {
            Directory.CreateDirectory(dst);
            foreach (string file in Directory.GetFiles(src))
                File.Copy(file, Path.Combine(dst, Path.GetFileName(file)), true);
            foreach (string sub in Directory.GetDirectories(src))
                CopyDir(sub, Path.Combine(dst, Path.GetFileName(sub)));
        }

        // Clean-replace orchestrator/ui with srcUi — the same end state as
        // restore.sh's "rm -rf + cp -r". Freebuff is stopped by the preflight,
        // so removing the old directory first is safe, and a merge-copy would
        // let stale hashed assets pile up across versions. srcUi is validated
        // before anything is touched so a broken source can't half-apply.
        private static void ReplaceUiDir(string srcUi)
        {
            if (!Directory.Exists(srcUi))
                throw new ApplicationException("缺少 ui 目录：" + srcUi);
            string dst = Path.Combine(FreebuffResources, "orchestrator\\ui");
            if (Directory.Exists(dst)) Directory.Delete(dst, true);
            CopyDir(srcUi, dst);
        }

        // Common preflight for apply/restore: Freebuff must not hold the
        // files open. Offers to stop everything first; false = user canceled.
        private bool ConfirmStopAllThenRun(Action action)
        {
            bool mainRunning;
            HashSet<int> slots = QueryRunning(out mainRunning);
            if (!mainRunning && slots.Count == 0)
            {
                action();
                return true;
            }
            if (!Confirm("检测到 Freebuff 正在运行，替换文件可能失败。\r\n先停止全部实例再继续吗？"))
                return false;
            string[] all = new string[MaxSlot + 1];
            all[0] = "main";
            for (int i = 1; i <= MaxSlot; i++) all[i] = i.ToString();
            KillInstances(all);
            SetStatus("已停止全部实例，稍候继续…");
            Delay(2000, action);
            return true;
        }

        private void OnHanhuaApply()
        {
            if (Interlocked.CompareExchange(ref hanhuaBusy, 1, 0) != 0) return;
            if (!TryResolveHanhuaDir()) { Interlocked.Exchange(ref hanhuaBusy, 0); return; }
            string build = HanhuaBuildDir(hanhuaDir);
            if (build == null)
            {
                Interlocked.Exchange(ref hanhuaBusy, 0);
                Info("汉化仓库里缺少构建产物 output\\app.asar。\r\n请先在仓库目录运行：bash hanhua/build.sh");
                RefreshHanhuaUi();
                return;
            }
            // Dict older than the installed app → the build likely misses new
            // strings; let the user back out instead of half-localizing.
            // Re-read first: the classic flow is "controller downloads the
            // update → user installs → clicks 应用汉化 without restarting us".
            RefreshInstalledVersion();
            string tv = HanhuaTargetVersion(hanhuaDir);
            var inst = ParseLooseVersion(installedVersion);
            var target = ParseLooseVersion(tv);
            if (inst != null && target != null && inst.CompareTo(target) > 0
                && !Confirm("当前 Freebuff v" + installedVersion + " 比词典适配的 v" + tv +
                    " 新，现有构建可能缺少新版本的新增文案。\r\n建议先更新词典并重新构建。仍要继续应用吗？"))
            {
                Interlocked.Exchange(ref hanhuaBusy, 0);
                return;
            }
            if (!ConfirmStopAllThenRun(delegate { ApplyHanhuaBuild(build); }))
                Interlocked.Exchange(ref hanhuaBusy, 0);
        }

        // Runs on the UI thread (possibly via Delay), does the file work on
        // a worker: back up the pristine English files once, then copy over —
        // the same flow as hanhua's apply.sh.
        private void ApplyHanhuaBuild(string build)
        {
            SetStatus("正在应用汉化…");
            ThreadPool.QueueUserWorkItem(delegate
            {
                Exception error = null;
                try
                {
                    BackupPristineIfNeeded();
                    File.Copy(Path.Combine(build, "app.asar"),
                        Path.Combine(FreebuffResources, "app.asar"), true);
                    ReplaceUiDir(Path.Combine(build, "ui"));
                }
                catch (Exception ex) { error = ex; }
                Interlocked.Exchange(ref hanhuaBusy, 0);
                UiSafe(delegate
                {
                    if (IsDisposed) return;
                    SetStatus(error == null
                        ? "汉化已应用 ✓ 重启 Freebuff 生效。"
                        : "应用汉化失败：" + HanhuaErrorText(error));
                    RefreshHanhuaUi();
                });
            });
        }

        private static void BackupPristineIfNeeded()
        {
            if (HanhuaApplied()) return; // keep the existing pristine backup
            string bk = Path.Combine(FreebuffResources,
                "hanhua-backup-" + DateTime.Now.ToString("yyyyMMdd-HHmmss"));
            Directory.CreateDirectory(bk);
            File.Copy(Path.Combine(FreebuffResources, "app.asar"), Path.Combine(bk, "app.asar"), true);
            CopyDir(Path.Combine(FreebuffResources, "orchestrator\\ui"), Path.Combine(bk, "ui"));
        }

        private void OnHanhuaRestore()
        {
            if (Interlocked.CompareExchange(ref hanhuaBusy, 1, 0) != 0) return;
            string bk = LatestHanhuaBackup();
            if (bk == null)
            {
                Interlocked.Exchange(ref hanhuaBusy, 0);
                Info("没有找到英文原版备份（resources\\hanhua-backup-*）。\r\n应用汉化时会自动创建。");
                return;
            }
            if (!ConfirmStopAllThenRun(delegate { RestoreHanhuaBackup(bk); }))
                Interlocked.Exchange(ref hanhuaBusy, 0);
        }

        private void RestoreHanhuaBackup(string bk)
        {
            SetStatus("正在还原英文原版…");
            ThreadPool.QueueUserWorkItem(delegate
            {
                Exception error = null;
                try
                {
                    File.Copy(Path.Combine(bk, "app.asar"),
                        Path.Combine(FreebuffResources, "app.asar"), true);
                    ReplaceUiDir(Path.Combine(bk, "ui"));
                }
                catch (Exception ex) { error = ex; }
                Interlocked.Exchange(ref hanhuaBusy, 0);
                UiSafe(delegate
                {
                    if (IsDisposed) return;
                    SetStatus(error == null
                        ? "已还原英文原版 ✓ 重启 Freebuff 生效。"
                        : "还原失败：" + HanhuaErrorText(error));
                    RefreshHanhuaUi();
                });
            });
        }
    }
}
