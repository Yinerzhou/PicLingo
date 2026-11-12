using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace PicLingo.Installation
{
    internal static class UninstallEngine
    {
        private static string pendingScript;
        private static string pendingSelf;
        private static string pendingRoot;
        private static InstallManifest pendingManifest;

        internal static bool Remove(Action<int, string> progress)
        {
            string root = Safety.CanonicalDirectory(Application.StartupPath);
            string self = Path.GetFullPath(Application.ExecutablePath);
            if (!String.Equals(self, Path.Combine(root, Product.Uninstaller), StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("请从 PicLingo 安装目录运行卸载程序。");
            Safety.NoReparsePoints(root);
            InstallManifest manifest = Safety.ReadManifest(root);
            progress(5, "正在检查安装文件…");
            foreach (string relative in manifest.Files)
            {
                string path = Safety.Child(root, relative);
                Safety.NoReparsePoints(path);
                if (Directory.Exists(path)) throw new InvalidOperationException("清单中的文件已变为文件夹，为保护数据已停止：" + path);
                if (!String.Equals(path, self, StringComparison.OrdinalIgnoreCase)) Safety.EnsureFileAvailable(path);
            }
            Safety.EnsureFileAvailable(Path.Combine(root, Product.Marker));

            int index = 0;
            foreach (string relative in manifest.Files)
            {
                string path = Safety.Child(root, relative);
                if (!String.Equals(path, self, StringComparison.OrdinalIgnoreCase) && File.Exists(path)) File.Delete(path);
                progress(10 + (int)(65.0 * (++index) / manifest.Files.Count), "正在移除程序文件…");
            }
            progress(80, "正在移除快捷方式…");
            if (manifest.DesktopShortcut) Shortcuts.RemoveOwned(Product.DesktopShortcut, root);
            if (manifest.StartMenuShortcut) Shortcuts.RemoveOwned(Product.MenuShortcut, root);
            try { if (Directory.Exists(Product.MenuDirectory) && !Directory.EnumerateFileSystemEntries(Product.MenuDirectory).Any()) Directory.Delete(Product.MenuDirectory, false); } catch { }
            progress(90, "正在清理卸载信息…");
            if (manifest.Registered) Registration.RemoveOwned(root);
            Safety.DeleteEmptyDirectories(root, manifest.Files);
            string cleanup = CreateCleanupScript();
            File.Delete(Path.Combine(root, Product.Marker));
            bool userFilesRemain = Directory.EnumerateFileSystemEntries(root).Any(path => !String.Equals(Path.GetFullPath(path), self, StringComparison.OrdinalIgnoreCase));
            pendingScript = cleanup;
            pendingSelf = self;
            pendingRoot = root;
            pendingManifest = manifest;
            progress(100, userFilesRemain ? "卸载完成。您另行放入的文件已保留。" : "卸载完成，感谢使用 PicLingo。");
            return userFilesRemain;
        }

        internal static void ScheduleCleanup()
        {
            if (pendingScript == null) return;
            try { StartCleanup(pendingScript, pendingSelf, pendingRoot); pendingScript = null; }
            catch
            {
                // Keep enough metadata for a retry if Windows cannot start its own cleanup process.
                File.WriteAllText(Path.Combine(pendingRoot, Product.Marker), new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(pendingManifest), new UTF8Encoding(false));
                throw;
            }
        }

        private static string CreateCleanupScript()
        {
            string path = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "PicLingo-Cleanup-" + Guid.NewGuid().ToString("N") + ".cmd"));
            // Paths are passed through process environment variables, so %, &, ^ and Unicode in user paths
            // are never interpolated into batch source. Delayed expansion and CALL are deliberately avoided.
            string script = "@echo off\r\n" +
                "setlocal DisableDelayedExpansion\r\n" +
                "for /L %%i in (1,1,90) do (\r\n" +
                "  del /f /q \"%PICLINGO_SELF_PATH%\" >nul 2>&1\r\n" +
                "  if not exist \"%PICLINGO_SELF_PATH%\" goto done\r\n" +
                "  ping -n 2 127.0.0.1 >nul 2>&1\r\n" +
                ")\r\n" +
                ":done\r\n" +
                "rmdir \"%PICLINGO_SELF_DIR%\" >nul 2>&1\r\n" +
                "del /f /q \"%PICLINGO_CLEANUP_SCRIPT%\" >nul 2>&1\r\n";
            File.WriteAllText(path, script, Encoding.ASCII);
            return path;
        }

        private static void StartCleanup(string script, string self, string root)
        {
            string canonicalSelf = Path.GetFullPath(self);
            string canonicalRoot = Safety.CanonicalDirectory(root);
            if (!String.Equals(canonicalSelf, Path.Combine(canonicalRoot, Product.Uninstaller), StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("卸载程序的自身路径校验失败。");
            ProcessStartInfo info = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "cmd.exe"), "/D /Q /C \"\"%PICLINGO_CLEANUP_SCRIPT%\"\"");
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.WindowStyle = ProcessWindowStyle.Hidden;
            info.EnvironmentVariables["PICLINGO_SELF_PATH"] = canonicalSelf;
            info.EnvironmentVariables["PICLINGO_SELF_DIR"] = canonicalRoot;
            info.EnvironmentVariables["PICLINGO_CLEANUP_SCRIPT"] = Path.GetFullPath(script);
            Process process = Process.Start(info);
            if (process == null) throw new InvalidOperationException("无法启动卸载清理。请稍后重试。");
            process.Dispose();
        }
    }

    internal sealed class UninstallForm : Form
    {
        private Button uninstall;
        private Button cancel;
        private ProgressBar progress;
        private Label status;
        private bool busy;
        private bool done;
        private readonly string log;

        internal UninstallForm(string log)
        {
            this.log = log;
            Text = Product.Name + " · 卸载";
            Font = new Font("Microsoft YaHei UI", 9);
            ClientSize = new Size(640, 335);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(248, 250, 253);
            AutoScaleMode = AutoScaleMode.Dpi;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            Controls.Add(new Label { Text = "卸载 PicLingo", Location = new Point(34, 29), AutoSize = true, Font = new Font("Microsoft YaHei UI", 22, FontStyle.Bold), ForeColor = Color.FromArgb(23, 38, 64) });
            Controls.Add(new Label { Text = "将移除程序文件、快捷图标和当前用户的卸载信息。\r\n安装目录中另行添加的个人文件会保留。", Location = new Point(37, 93), Size = new Size(567, 61), Font = new Font("Microsoft YaHei UI", 10), ForeColor = Color.FromArgb(85, 101, 124) });
            Controls.Add(new Label { Text = Application.StartupPath, Location = new Point(37, 167), Size = new Size(567, 40), ForeColor = Color.FromArgb(116, 128, 146), AutoEllipsis = true });
            progress = new ProgressBar { Location = new Point(39, 215), Size = new Size(564, 6) };
            status = new Label { Text = "请先关闭正在运行的 PicLingo。", Location = new Point(37, 230), Size = new Size(565, 30), ForeColor = Color.FromArgb(109, 122, 143) };
            Controls.Add(progress); Controls.Add(status);
            cancel = new Button { Text = "取消", Location = new Point(373, 275), Size = new Size(94, 36), FlatStyle = FlatStyle.Flat, BackColor = Color.White };
            uninstall = new Button { Text = "确认卸载", Location = new Point(483, 275), Size = new Size(120, 36), FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(25, 106, 229), ForeColor = Color.White };
            cancel.FlatAppearance.BorderColor = Color.FromArgb(216, 223, 232);
            uninstall.FlatAppearance.BorderSize = 0;
            cancel.Click += delegate { Close(); };
            uninstall.Click += delegate { if (done) Close(); else BeginRemoval(); };
            Controls.Add(cancel); Controls.Add(uninstall);
            FormClosing += delegate(object sender, FormClosingEventArgs args) { if (busy) args.Cancel = true; };
        }

        private void BeginRemoval()
        {
            busy = true;
            uninstall.Enabled = cancel.Enabled = false;
            uninstall.Text = "正在卸载…";
            Thread worker = new Thread(delegate()
            {
                try
                {
                    bool preserved = UninstallEngine.Remove(delegate(int value, string message) { BeginInvoke((Action)delegate { progress.Value = value; status.Text = message; }); });
                    Errors.Save(log, "UNINSTALL_SUCCESS\r\nPersonalFilesPreserved=" + preserved);
                    BeginInvoke((Action)delegate
                    {
                        busy = false; done = true;
                        uninstall.Enabled = true; uninstall.Text = "完成";
                        cancel.Visible = false;
                        status.ForeColor = Color.FromArgb(21, 126, 94);
                    });
                }
                catch (Exception ex)
                {
                    Errors.Save(log, "UNINSTALL_FAILED\r\n" + ex.ToString());
                    BeginInvoke((Action)delegate
                    {
                        busy = false;
                        uninstall.Enabled = cancel.Enabled = true;
                        uninstall.Text = "重新卸载";
                        status.Text = "卸载未完成，请按提示处理后重试。";
                        MessageBox.Show(this, Errors.Message(ex), "卸载未完成", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    });
                }
            });
            worker.IsBackground = true;
            worker.SetApartmentState(ApartmentState.STA);
            worker.Start();
        }
    }

    internal static class UninstallProgram
    {
        [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();

        [STAThread]
        private static int Main(string[] args)
        {
            bool silent = args.Any(arg => String.Equals(arg, "--silent", StringComparison.OrdinalIgnoreCase));
            string log = Path.Combine(Path.GetTempPath(), "PicLingo-uninstall.log");
            try
            {
                bool check = false;
                for (int index = 0; index < args.Length; index++)
                {
                    if (String.Equals(args[index], "--silent", StringComparison.OrdinalIgnoreCase)) continue;
                    if (String.Equals(args[index], "--check-install", StringComparison.OrdinalIgnoreCase)) { check = true; continue; }
                    if (String.Equals(args[index], "--log", StringComparison.OrdinalIgnoreCase) && ++index < args.Length) { log = Path.GetFullPath(args[index]); continue; }
                    throw new ArgumentException("不支持的卸载参数。");
                }
                if (check) { Safety.ReadManifest(Safety.CanonicalDirectory(Application.StartupPath)); Errors.Save(log, "MANIFEST_OK"); return 0; }
                if (silent)
                {
                    bool preserved = UninstallEngine.Remove(delegate { });
                    UninstallEngine.ScheduleCleanup();
                    Errors.Save(log, "UNINSTALL_SUCCESS\r\nPersonalFilesPreserved=" + preserved);
                    return 0;
                }
                try { SetProcessDPIAware(); } catch { }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new UninstallForm(log));
                UninstallEngine.ScheduleCleanup();
                return 0;
            }
            catch (Exception ex)
            {
                Errors.Save(log, "UNINSTALL_FAILED\r\n" + ex.ToString());
                if (!silent) MessageBox.Show(Errors.Message(ex), "PicLingo 卸载未完成", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return 1;
            }
        }
    }
}
