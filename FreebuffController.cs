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
        private RadioButton rbFresh;
        private RadioButton rbCopy;
        private ComboBox copySource;
        private NotifyIcon tray;
        private Label statusLabel;
        private System.Windows.Forms.Timer statusRevertTimer;
        private System.Windows.Forms.Timer refreshTimer;
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
            tray.Visible = false;
            tray.Dispose();
            base.OnFormClosed(e);
        }

        // ---------- UI ----------

        private void BuildUi()
        {
            Text = "Freebuff 多开控制器";
            ClientSize = new Size(580, 556);
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
            BuildModePanel();

            Button btnLaunch = MakeButton("启动", 20, 104, ColAccent, ColAccentHover);
            btnLaunch.Click += delegate { OnLaunch(); };

            Button btnStop = MakeButton("停止", 134, 104, ColNeutral, ColNeutralHover);
            btnStop.Click += delegate { OnStop(); };

            Button btnReset = MakeButton("重置账号", 248, 104, ColNeutral, ColNeutralHover);
            btnReset.Click += delegate { OnReset(); };

            Button btnStopAll = MakeButton("停止全部", 362, 104, ColNeutral, ColNeutralHover);
            btnStopAll.Click += delegate { OnStopAll(); };

            Button btnRefresh = MakeButton("刷新", 476, 84, ColNeutral, ColNeutralHover);
            btnRefresh.Click += delegate { SetStatus("正在刷新…"); RefreshGrid(); FetchQuotasAsync(true); };

            BuildTray();

            statusLabel = new Label();
            statusLabel.Text = ReadyStatus();
            statusLabel.Bounds = new Rectangle(22, 534, 330, 16);
            statusLabel.ForeColor = ColSub;
            statusLabel.Font = new Font("Microsoft YaHei UI", 8.5f);
            Controls.Add(statusLabel);

            versionLink = new Label();
            versionLink.Text = string.IsNullOrEmpty(installedVersion)
                ? "Freebuff 版本未知 · 检查更新"
                : "Freebuff v" + installedVersion + " · 检查更新";
            versionLink.Bounds = new Rectangle(354, 534, 206, 16);
            versionLink.ForeColor = ColSub;
            versionLink.Font = new Font("Microsoft YaHei UI", 8.5f);
            versionLink.TextAlign = ContentAlignment.MiddleRight;
            versionLink.Cursor = Cursors.Hand;
            versionLink.Click += delegate { OnVersionLinkClick(); };
            Controls.Add(versionLink);

            refreshTimer = new System.Windows.Forms.Timer();
            refreshTimer.Interval = 3000;
            refreshTimer.Tick += delegate { RefreshGrid(); };
            refreshTimer.Start();

            var quotaTimer = new System.Windows.Forms.Timer();
            quotaTimer.Interval = 300000;
            quotaTimer.Tick += delegate { FetchQuotasAsync(false); };
            quotaTimer.Start();

            var versionTimer = new System.Windows.Forms.Timer();
            versionTimer.Interval = 1800000; // every 30 minutes
            versionTimer.Tick += delegate { CheckVersionAsync(); };
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

        private void BuildModePanel()
        {
            var panel = new Panel();
            panel.Bounds = new Rectangle(20, 428, 540, 52);
            panel.BackColor = ColPanel;
            RoundControl(panel, 10);

            var caption = new Label();
            caption.Text = "启动方式（对未初始化的实例生效）";
            caption.Bounds = new Rectangle(16, 7, 400, 16);
            caption.ForeColor = ColSub;
            caption.Font = new Font("Microsoft YaHei UI", 8.5f);
            panel.Controls.Add(caption);

            rbFresh = new RadioButton();
            rbFresh.Text = "全新登录（每个窗口可登录不同账号）";
            rbFresh.Bounds = new Rectangle(16, 26, 252, 20);
            rbFresh.ForeColor = ColText;
            rbFresh.BackColor = ColPanel;
            rbFresh.AutoSize = false;
            rbFresh.Checked = true;
            panel.Controls.Add(rbFresh);

            rbCopy = new RadioButton();
            rbCopy.Text = "复制账号";
            rbCopy.Bounds = new Rectangle(274, 26, 84, 20);
            rbCopy.ForeColor = ColText;
            rbCopy.BackColor = ColPanel;
            rbCopy.AutoSize = false;
            panel.Controls.Add(rbCopy);

            // Account source for rbCopy: any initialized instance, not just
            // the main one.
            copySource = new ComboBox();
            copySource.DropDownStyle = ComboBoxStyle.DropDownList;
            copySource.Bounds = new Rectangle(362, 23, 162, 24);
            copySource.BackColor = ColNeutral;
            copySource.ForeColor = ColText;
            copySource.Font = new Font("Microsoft YaHei UI", 9f);
            copySource.Items.Add("主实例");
            for (int i = 1; i <= MaxSlot; i++) copySource.Items.Add("实例 " + i);
            copySource.SelectedIndex = 0;
            copySource.Enabled = false;
            rbCopy.CheckedChanged += delegate { copySource.Enabled = rbCopy.Checked; };
            panel.Controls.Add(copySource);

            Controls.Add(panel);
        }

        private Button MakeButton(string text, int x, int width, Color back, Color hover)
        {
            var b = new Button();
            b.Text = text;
            b.Bounds = new Rectangle(x, 494, width, 36);
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
        // Shows the tightest remaining allowance across models.
        private static string FetchQuota(string token)
        {
            try
            {
                ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
                var req = (HttpWebRequest)WebRequest.Create(QuotaApiUrl);
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
                return "获取失败";
            }
            catch { return "获取失败"; }
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
        // body fallback below.
        private static string FetchLatestVersion(string feedUrl)
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
                using (var resp = (HttpWebResponse)req.GetResponse())
                {
                    int code = (int)resp.StatusCode;
                    if (code >= 300 && code < 400)
                    {
                        Match m = LooseVersionRegex.Match(resp.Headers["Location"] ?? "");
                        return m.Success ? m.Value : null;
                    }
                    using (var sr = new StreamReader(resp.GetResponseStream()))
                    {
                        Match m = YamlVersionRegex.Match(sr.ReadToEnd());
                        return m.Success ? m.Groups[1].Value.Trim() : null;
                    }
                }
            }
            catch { return null; }
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
                        latestVersion = latest;
                        ApplyVersionUi(false);
                        if (UpdateAvailable() && !updateStarted)
                            SetStatus("Freebuff 发布了新版本 v" + latestVersion +
                                "，点击右下角“点击更新”直接下载安装。");
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
                versionLink.Text = "安装包已启动 · 按提示完成安装";
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
                try
                {
                    // latest.yml gives the exact file name + SHA512. If it
                    // can't be fetched we still try the official download
                    // link, just without hash verification.
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
                        if (sm.Success) shaB64 = sm.Groups[1].Value.Trim();
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
        // Machines with a half-working system proxy often fail exactly on
        // the GitHub hop, so the second attempt bypasses the proxy.
        private static string FetchYamlBody(string url)
        {
            for (int attempt = 0; attempt < 2; attempt++)
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
                    if (attempt == 1) req.Proxy = null;
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

        // Tries every candidate URL, each first through the system proxy and
        // then direct: whichever path the machine needs for GitHub, one of
        // them gets through.
        private static void DownloadFirstAvailable(IList<string> urls, string dest,
                                                   string shaB64, Action<long, long> progress)
        {
            Exception last = null;
            foreach (string url in urls)
            {
                for (int attempt = 0; attempt < 2; attempt++)
                {
                    try
                    {
                        DownloadOnce(url, dest, shaB64, progress, attempt == 1);
                        return;
                    }
                    catch (Exception ex) { last = ex; }
                }
            }
            throw last;
        }

        private static void DownloadOnce(string url, string dest, string shaB64,
                                         Action<long, long> progress, bool direct)
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.Method = "GET";
            req.AllowAutoRedirect = true;
            req.Timeout = 30000;
            req.ReadWriteTimeout = 30000;
            req.UserAgent = "FreebuffMultiOpenController/1.0";
            if (direct) req.Proxy = null;
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
            try
            {
                if (rowIndex == 0) StartMain();
                else StartSlot(rowIndex, rbCopy.Checked ? Math.Max(copySource.SelectedIndex, 0) : -1);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, what + " 启动失败：\n" + ex.Message,
                    "启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            SetStatus(what + " 启动中…（几秒后自动确认）");
            if (rowIndex != 0 && rbFresh.Checked && !File.Exists(SlotStatePath(rowIndex)))
            {
                Info(string.Format(
                    "实例 {0} 将以全新状态启动，请在窗口内登录该窗口要用的账号。", rowIndex));
            }
            Delay(6000, delegate { VerifyLaunched(rowIndex, what); });
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
            Process.Start(new ProcessStartInfo(FreebuffExe) { UseShellExecute = true });
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
    }
}
