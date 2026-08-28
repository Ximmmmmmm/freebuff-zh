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
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
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
        private NotifyIcon tray;

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        public MainForm()
        {
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

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            if (WindowState == FormWindowState.Minimized) Hide();
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
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

            var hint = new Label();
            hint.Text = "管理多开的 Freebuff 实例 · 每个槽位可以用不同账号登录 · 双击行直接启动";
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
            btnRefresh.Click += delegate { RefreshGrid(); };

            BuildTray();

            var t = new System.Windows.Forms.Timer();
            t.Interval = 3000;
            t.Tick += delegate { RefreshGrid(); };
            t.Start();

            RefreshGrid();
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

            string[] headers = { "实例", "状态", "账号" };
            int[] weights = { 16, 20, 64 };
            for (int c = 0; c < 3; c++)
            {
                int index = grid.Columns.Add("c" + c, headers[c]);
                grid.Columns[index].FillWeight = weights[c];
                grid.Columns[index].SortMode = DataGridViewColumnSortMode.NotSortable;
                grid.Columns[index].DefaultCellStyle.Padding = new Padding(12, 0, 0, 0);
            }

            for (int i = 0; i <= MaxSlot; i++)
            {
                string name = (i == 0) ? "主实例" : ("槽位 " + i);
                grid.Rows.Add(name, "…", "…");
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
            caption.Text = "启动方式（对未初始化的槽位生效）";
            caption.Bounds = new Rectangle(16, 7, 400, 16);
            caption.ForeColor = ColSub;
            caption.Font = new Font("Microsoft YaHei UI", 8.5f);
            panel.Controls.Add(caption);

            rbFresh = new RadioButton();
            rbFresh.Text = "全新登录（每个窗口可登录不同账号）";
            rbFresh.Bounds = new Rectangle(16, 26, 330, 20);
            rbFresh.ForeColor = ColText;
            rbFresh.BackColor = ColPanel;
            rbFresh.AutoSize = false;
            rbFresh.Checked = true;
            panel.Controls.Add(rbFresh);

            rbCopy = new RadioButton();
            rbCopy.Text = "复制主实例账号";
            rbCopy.Bounds = new Rectangle(370, 26, 160, 20);
            rbCopy.ForeColor = ColText;
            rbCopy.BackColor = ColPanel;
            rbCopy.AutoSize = false;
            panel.Controls.Add(rbCopy);

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

        private void RefreshGrid()
        {
            bool mainRunning;
            HashSet<int> slots = QueryRunning(out mainRunning);
            for (int i = 0; i <= MaxSlot; i++)
            {
                bool run = (i == 0) ? mainRunning : slots.Contains(i);
                string acct = (i == 0) ? AccountForState(DefaultState)
                                       : AccountForState(SlotStatePath(i));
                DataGridViewRow row = grid.Rows[i];
                row.Cells[1].Value = run ? "● 运行中" : "○ 已停止";
                row.Cells[1].Style.ForeColor = run ? ColGreen : ColSub;
                row.Cells[2].Value = acct;
                row.Cells[2].Style.ForeColor = acct.StartsWith("(") ? ColSub : ColText;
            }
        }

        // 0 = main instance row, 1..9 = slot, -999 = nothing selected
        private int SelectedIndex()
        {
            if (grid.CurrentCell == null) return -999;
            return grid.CurrentCell.RowIndex;
        }

        private static void Info(string text)
        {
            MessageBox.Show(text, "Freebuff 多开控制器",
                MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        private static bool Confirm(string text)
        {
            return MessageBox.Show(text, "确认操作",
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
                action();
            };
            t.Start();
        }

        private void LaunchIndex(int rowIndex)
        {
            if (rowIndex == 0)
            {
                StartMain();
            }
            else
            {
                StartSlot(rowIndex, rbCopy.Checked);
                if (!File.Exists(SlotStatePath(rowIndex)) && rbFresh.Checked)
                {
                    Info(string.Format(
                        "槽位 {0} 将以全新状态启动，请在窗口内登录该窗口要用的账号。", rowIndex));
                }
            }
            Delay(800, RefreshGrid);
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
            KillInstance(idx == 0 ? "main" : idx.ToString());
            Delay(900, RefreshGrid);
        }

        private void OnStopAll()
        {
            KillInstance("main");
            for (int i = 1; i <= MaxSlot; i++) KillInstance(i.ToString());
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
                "确定清空槽位 {0} 吗？\r\n该槽位的登录和浏览数据会被删除，下次启动需要重新登录。", idx));
            if (!yes) return;
            KillInstance(idx.ToString());
            Delay(1200, delegate
            {
                TryDeleteDir(SlotStateDir(idx));
                TryDeleteDir(SlotUserData(idx));
                RefreshGrid();
            });
        }

        private static void TryDeleteDir(string dir)
        {
            try
            {
                if (Directory.Exists(dir)) Directory.Delete(dir, true);
            }
            catch { }
        }

        private static void StartMain()
        {
            Process.Start(new ProcessStartInfo(FreebuffExe) { UseShellExecute = true });
        }

        private static void StartSlot(int n, bool copyAccount)
        {
            string state = SlotStatePath(n);
            if (!File.Exists(state))
            {
                Directory.CreateDirectory(Path.GetDirectoryName(state));
                if (copyAccount && File.Exists(DefaultState)) File.Copy(DefaultState, state);
            }
            var psi = new ProcessStartInfo();
            psi.FileName = FreebuffExe;
            psi.UseShellExecute = false;
            psi.EnvironmentVariables["FREEBUFF_DESKTOP_STATE_PATH"] = state;
            Process.Start(psi);
        }

        private static void KillInstance(string target)
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
                        bool match = (target == "main")
                            ? !m.Success
                            : (m.Success && m.Groups[1].Value == target);
                        if (match) pids.Add((int)(uint)o["ProcessId"]);
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
