using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace PicLingo.Installation
{
    internal sealed class SetupOptions
    {
        internal string Directory = Product.DefaultDirectory;
        internal bool Silent;
        internal bool Launch = true;
        internal bool Desktop = true;
        internal bool StartMenu = true;
        internal bool Register = true;
        internal bool VerifyPayload;
        internal bool CheckDirectory;
        internal string Log = Path.Combine(Path.GetTempPath(), "PicLingo-setup.log");
    }

    internal sealed class PayloadEntry
    {
        internal ZipArchiveEntry Entry;
        internal string Name;
    }

    internal static class SetupEngine
    {
        internal static Stream OpenPayload()
        {
            Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("PicLingo.Payload.zip");
            if (stream == null) throw new InvalidOperationException("安装包资源缺失，请重新获取完整安装程序。");
            try
            {
                string expected;
                using (Stream checksum = Assembly.GetExecutingAssembly().GetManifestResourceStream("PicLingo.Payload.sha256"))
                {
                    if (checksum == null) throw new InvalidOperationException("安装包完整性校验信息缺失。");
                    using (StreamReader reader = new StreamReader(checksum, Encoding.ASCII)) expected = reader.ReadToEnd().Trim();
                }
                string actual;
                using (SHA256 hash = SHA256.Create()) actual = BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "");
                if (!String.Equals(expected, actual, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("安装包完整性校验失败，文件可能已损坏。请重新获取安装程序。");
                stream.Position = 0;
            }
            catch { stream.Dispose(); throw; }
            return stream;
        }

        private static List<PayloadEntry> InspectArchive(ZipArchive archive)
        {
            List<PayloadEntry> files = new List<PayloadEntry>();
            HashSet<string> names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            long total = 0;
            if (archive.Entries.Count > 15000) throw new InvalidOperationException("安装包文件数异常，请重新获取安装程序。");
            foreach (ZipArchiveEntry entry in archive.Entries)
            {
                string raw = entry.FullName.Replace('\\', '/');
                bool directory = raw.EndsWith("/", StringComparison.Ordinal);
                string safe = Safety.RelativeFile(directory ? raw.TrimEnd('/') : raw);
                if ((((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000) || (entry.ExternalAttributes & (int)FileAttributes.ReparsePoint) != 0)
                    throw new InvalidOperationException("安装包含有符号链接，已停止安装。");
                if (String.Equals(safe, Product.Marker, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("安装包包含保留的安装清单名称。");
                if (!names.Add(safe)) throw new InvalidOperationException("安装包包含重复文件路径：" + safe);
                if (directory) continue;
                if (entry.Length < 0 || entry.Length > 768L * 1024 * 1024) throw new InvalidOperationException("安装包单个文件大小异常。");
                total = checked(total + entry.Length);
                if (total > 2048L * 1024 * 1024) throw new InvalidOperationException("安装包展开大小超过 2 GB，已停止安装。");
                files.Add(new PayloadEntry { Entry = entry, Name = safe });
            }
            HashSet<string> actualFiles = new HashSet<string>(files.Select(f => f.Name), StringComparer.OrdinalIgnoreCase);
            foreach (string required in new string[] { Product.Executable, Product.Uninstaller, "assets/app.ico" })
                if (!actualFiles.Contains(required)) throw new InvalidOperationException("安装包不完整，缺少：" + required);
            foreach (PayloadEntry file in files)
            {
                string parent = file.Name;
                while (parent.IndexOf('/') >= 0)
                {
                    parent = parent.Substring(0, parent.LastIndexOf('/'));
                    if (actualFiles.Contains(parent)) throw new InvalidOperationException("安装包中的文件和文件夹名称冲突：" + parent);
                }
            }
            return files;
        }

        internal static void Verify()
        {
            try
            {
                using (Stream resource = OpenPayload())
                using (ZipArchive archive = new ZipArchive(resource, ZipArchiveMode.Read, false))
                {
                    List<PayloadEntry> entries = InspectArchive(archive);
                    byte[] buffer = new byte[65536];
                    foreach (PayloadEntry file in entries)
                    {
                        long bytes = 0;
                        using (Stream input = file.Entry.Open())
                        {
                            int read;
                            while ((read = input.Read(buffer, 0, buffer.Length)) != 0)
                            {
                                bytes += read;
                                if (bytes > file.Entry.Length) throw new InvalidDataException("文件大小不符：" + file.Name);
                            }
                        }
                        if (bytes != file.Entry.Length) throw new InvalidDataException("文件大小不符：" + file.Name);
                    }
                }
            }
            catch (InvalidDataException ex) { throw new InvalidOperationException("安装包已损坏，请重新获取安装程序。", ex); }
        }

        internal static void Install(SetupOptions options, Action<int, string> progress)
        {
            progress(2, "正在检查安装位置…");
            DestinationState destination = Safety.InspectDestination(options.Directory, options.Register);
            options.Directory = destination.Directory;
            if (options.Desktop) Shortcuts.Check(Product.DesktopShortcut, destination.Directory);
            if (options.StartMenu) Shortcuts.Check(Product.MenuShortcut, destination.Directory);

            string scratch = Path.Combine(Path.GetTempPath(), "PicLingoSetup-" + Guid.NewGuid().ToString("N"));
            string stage = Path.Combine(scratch, "payload");
            string backup = Path.Combine(scratch, "backup");
            Directory.CreateDirectory(stage);
            Directory.CreateDirectory(backup);
            List<string> files = new List<string>();
            List<string> changed = new List<string>();
            List<string> saved = new List<string>();
            List<string> createdDirectories = new List<string>();
            Dictionary<string, byte[]> shortcutBackup = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
            RegistrySnapshot registry = null;
            bool registryTouched = false;
            bool filesTouched = false;
            bool keepScratch = false;
            string previousMarker = File.Exists(Path.Combine(destination.Directory, Product.Marker)) ? File.ReadAllText(Path.Combine(destination.Directory, Product.Marker), Encoding.UTF8) : null;
            string markerTemporary = null;
            long bytes = 0;
            try
            {
                progress(8, "正在校验并解压程序文件…");
                try
                {
                    using (Stream resource = OpenPayload())
                    using (ZipArchive archive = new ZipArchive(resource, ZipArchiveMode.Read, false))
                    {
                        List<PayloadEntry> entries = InspectArchive(archive);
                        for (int index = 0; index < entries.Count; index++)
                        {
                            PayloadEntry file = entries[index];
                            string staged = Safety.Child(stage, file.Name);
                            Directory.CreateDirectory(Path.GetDirectoryName(staged));
                            using (Stream input = file.Entry.Open())
                            using (FileStream output = new FileStream(staged, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                                input.CopyTo(output);
                            if (new FileInfo(staged).Length != file.Entry.Length) throw new InvalidDataException("文件大小不符：" + file.Name);
                            files.Add(file.Name);
                            bytes += file.Entry.Length;
                            progress(8 + (int)(42.0 * (index + 1) / entries.Count), "正在校验并解压程序文件…");
                        }
                    }
                }
                catch (InvalidDataException ex) { throw new InvalidOperationException("安装包已损坏，请重新获取安装程序。", ex); }

                progress(51, "正在检查文件占用…");
                destination = Safety.InspectDestination(destination.Directory, options.Register);
                HashSet<string> previousFiles = destination.Previous == null ? new HashSet<string>(StringComparer.OrdinalIgnoreCase) : new HashSet<string>(destination.Previous.Files, StringComparer.OrdinalIgnoreCase);
                foreach (string file in files)
                {
                    string target = Safety.Child(destination.Directory, file);
                    Safety.NoReparsePoints(target);
                    if (Directory.Exists(target)) throw new InvalidOperationException("程序文件位置存在同名文件夹：" + target);
                    if (File.Exists(target) && !previousFiles.Contains(file))
                        throw new InvalidOperationException("安装目录中存在同名的用户文件，未覆盖：" + target);
                    string parent = Path.GetDirectoryName(target);
                    while (!Safety.EqualPath(parent, destination.Directory))
                    {
                        if (File.Exists(parent)) throw new InvalidOperationException("程序文件夹位置被文件占用：" + parent);
                        parent = Path.GetDirectoryName(parent);
                    }
                }
                List<string> affected = files.Concat(previousFiles).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                foreach (string file in affected) Safety.EnsureFileAvailable(Safety.Child(destination.Directory, file));
                Safety.EnsureFileAvailable(Path.Combine(destination.Directory, Product.Marker));
                if (options.Register) registry = RegistrySnapshot.Capture();
                if (options.Desktop) shortcutBackup[Product.DesktopShortcut] = File.Exists(Product.DesktopShortcut) ? File.ReadAllBytes(Product.DesktopShortcut) : null;
                if (options.StartMenu) shortcutBackup[Product.MenuShortcut] = File.Exists(Product.MenuShortcut) ? File.ReadAllBytes(Product.MenuShortcut) : null;

                progress(55, "正在安装 PicLingo…");
                foreach (string file in affected)
                {
                    string target = Safety.Child(destination.Directory, file);
                    if (File.Exists(target))
                    {
                        string savedPath = Safety.Child(backup, file);
                        Directory.CreateDirectory(Path.GetDirectoryName(savedPath));
                        File.Copy(target, savedPath, false);
                        saved.Add(file);
                    }
                }
                EnsureDirectory(destination.Directory, createdDirectories);
                filesTouched = true;
                for (int index = 0; index < files.Count; index++)
                {
                    string file = files[index];
                    string target = Safety.Child(destination.Directory, file);
                    EnsureDirectory(Path.GetDirectoryName(target), createdDirectories);
                    Safety.NoReparsePoints(target);
                    changed.Add(file);
                    File.Copy(Safety.Child(stage, file), target, true);
                    progress(55 + (int)(30.0 * (index + 1) / files.Count), "正在安装 PicLingo…");
                }
                HashSet<string> newFiles = new HashSet<string>(files, StringComparer.OrdinalIgnoreCase);
                foreach (string old in previousFiles)
                {
                    if (!newFiles.Contains(old) && File.Exists(Safety.Child(destination.Directory, old)))
                    {
                        changed.Add(old);
                        File.Delete(Safety.Child(destination.Directory, old));
                    }
                }
                InstallManifest manifest = new InstallManifest
                {
                    ProductId = Product.Id,
                    Version = Product.Version,
                    InstallPath = destination.Directory,
                    InstalledUtc = DateTime.UtcNow.ToString("o"),
                    Files = files.OrderBy(name => name, StringComparer.OrdinalIgnoreCase).ToList(),
                    DesktopShortcut = options.Desktop || (destination.Previous != null && destination.Previous.DesktopShortcut),
                    StartMenuShortcut = options.StartMenu || (destination.Previous != null && destination.Previous.StartMenuShortcut),
                    Registered = options.Register || (destination.Previous != null && destination.Previous.Registered)
                };
                string marker = Path.Combine(destination.Directory, Product.Marker);
                markerTemporary = marker + ".tmp-" + Guid.NewGuid().ToString("N");
                File.WriteAllText(markerTemporary, new JavaScriptSerializer().Serialize(manifest), new UTF8Encoding(false));
                if (File.Exists(marker)) File.Delete(marker);
                File.Move(markerTemporary, marker);
                markerTemporary = null;

                progress(89, "正在创建快捷方式…");
                if (options.Desktop) Shortcuts.Write(Product.DesktopShortcut, destination.Directory);
                if (options.StartMenu) Shortcuts.Write(Product.MenuShortcut, destination.Directory);
                progress(95, "正在登记卸载信息…");
                if (options.Register)
                {
                    registryTouched = true;
                    Registration.Write(destination.Directory, bytes);
                }
                Safety.DeleteEmptyDirectories(destination.Directory, previousFiles);
                progress(100, "安装完成，可以开始翻译图片了。");
            }
            catch (Exception original)
            {
                List<string> rollbackErrors = new List<string>();
                if (registryTouched && registry != null) TryRollback(delegate { registry.Restore(); }, rollbackErrors);
                foreach (KeyValuePair<string, byte[]> shortcut in shortcutBackup)
                {
                    KeyValuePair<string, byte[]> entry = shortcut;
                    TryRollback(delegate
                    {
                        if (entry.Value == null) Shortcuts.RemoveOwned(entry.Key, destination.Directory);
                        else File.WriteAllBytes(entry.Key, entry.Value);
                    }, rollbackErrors);
                }
                if (filesTouched)
                {
                    foreach (string file in changed.Distinct(StringComparer.OrdinalIgnoreCase).Reverse())
                    {
                        string relative = file;
                        TryRollback(delegate
                        {
                            string target = Safety.Child(destination.Directory, relative);
                            if (saved.Contains(relative, StringComparer.OrdinalIgnoreCase)) File.Copy(Safety.Child(backup, relative), target, true);
                            else if (File.Exists(target)) File.Delete(target);
                        }, rollbackErrors);
                    }
                    TryRollback(delegate
                    {
                        string marker = Path.Combine(destination.Directory, Product.Marker);
                        if (previousMarker == null) { if (File.Exists(marker)) File.Delete(marker); }
                        else File.WriteAllText(marker, previousMarker, new UTF8Encoding(false));
                    }, rollbackErrors);
                    if (markerTemporary != null) TryRollback(delegate { if (File.Exists(markerTemporary)) File.Delete(markerTemporary); }, rollbackErrors);
                    foreach (string directory in createdDirectories.OrderByDescending(p => p.Length))
                    {
                        string item = directory;
                        TryRollback(delegate { if (Directory.Exists(item) && !Directory.EnumerateFileSystemEntries(item).Any()) Directory.Delete(item, false); }, rollbackErrors);
                    }
                }
                if (rollbackErrors.Count > 0)
                {
                    keepScratch = true;
                    throw new InvalidOperationException(Errors.Message(original) + "\r\n恢复时遇到问题，请保留此信息：\r\n" + String.Join("\r\n", rollbackErrors) + "\r\n备份位置：" + backup, original);
                }
                throw;
            }
            finally
            {
                // Scratch contains only files created by this process. Never recurse over the chosen install directory.
                try { if (!keepScratch && Directory.Exists(scratch)) Directory.Delete(scratch, true); }
                catch { }
            }
        }

        private static void TryRollback(Action action, List<string> errors)
        {
            try { action(); } catch (Exception ex) { errors.Add(ex.Message); }
        }

        private static void EnsureDirectory(string directory, List<string> created)
        {
            if (Directory.Exists(directory)) return;
            List<string> missing = new List<string>();
            string item = directory;
            while (!Directory.Exists(item))
            {
                if (File.Exists(item)) throw new InvalidOperationException("需要创建的文件夹已存在同名文件：" + item);
                missing.Add(item);
                item = Path.GetDirectoryName(item);
            }
            for (int index = missing.Count - 1; index >= 0; index--)
            {
                Directory.CreateDirectory(missing[index]);
                created.Add(missing[index]);
            }
        }
    }

    internal sealed class HeroPanel : Panel
    {
        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (LinearGradientBrush brush = new LinearGradientBrush(ClientRectangle, Color.FromArgb(22, 39, 79), Color.FromArgb(24, 78, 110), 90f))
                e.Graphics.FillRectangle(brush, ClientRectangle);
            using (Pen pen = new Pen(Color.FromArgb(48, 255, 255, 255), 1))
            {
                e.Graphics.DrawEllipse(pen, -90, 210, 330, 330);
                e.Graphics.DrawEllipse(pen, 105, -110, 270, 270);
            }
            using (SolidBrush surface = new SolidBrush(Color.FromArgb(28, 255, 255, 255))) e.Graphics.FillRectangle(surface, 34, 188, 226, 148);
            using (Font big = new Font("Microsoft YaHei UI", 32, FontStyle.Bold))
            using (Font body = new Font("Microsoft YaHei UI", 11))
            using (SolidBrush white = new SolidBrush(Color.White))
            using (SolidBrush muted = new SolidBrush(Color.FromArgb(191, 215, 234)))
            {
                e.Graphics.DrawString("文", big, white, 53, 202);
                e.Graphics.DrawString("→", big, muted, 118, 202);
                e.Graphics.DrawString("A", big, white, 183, 202);
                e.Graphics.DrawString("图片里的世界\r\n换一种语言，继续表达。", body, muted, 48, 283);
            }
        }
    }

    internal sealed class SetupForm : Form
    {
        private readonly SetupOptions options;
        private TextBox directory;
        private CheckBox desktop;
        private CheckBox menu;
        private CheckBox launch;
        private Button install;
        private Button browse;
        private Button cancel;
        private ProgressBar progress;
        private Label status;
        private bool busy;
        private bool completed;

        internal SetupForm(SetupOptions options)
        {
            this.options = options;
            Text = Product.Name + " · 安装";
            Font = new Font("Microsoft YaHei UI", 9f);
            ClientSize = new Size(880, 554);
            MinimumSize = MaximumSize = Size;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            BackColor = Color.FromArgb(248, 250, 253);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            HeroPanel hero = new HeroPanel { Dock = DockStyle.Left, Width = 292 };
            hero.Controls.Add(new Label { Text = "PicLingo", Location = new Point(34, 37), AutoSize = true, Font = new Font("Segoe UI", 25, FontStyle.Bold), ForeColor = Color.White, BackColor = Color.Transparent });
            hero.Controls.Add(new Label { Text = "图 译 工 坊", Location = new Point(39, 93), AutoSize = true, Font = new Font("Microsoft YaHei UI", 13), ForeColor = Color.FromArgb(157, 217, 234), BackColor = Color.Transparent });
            hero.Controls.Add(new Label { Text = "批量导入  ·  识别文字  ·  多语言重绘", Location = new Point(34, 480), Size = new Size(250, 40), Font = new Font("Microsoft YaHei UI", 9), ForeColor = Color.FromArgb(184, 211, 233), BackColor = Color.Transparent });
            Controls.Add(hero);
            AddLabel("让图片跨越语言", 328, 40, 26, true, Color.FromArgb(23, 38, 64));
            AddLabel("欢迎安装 PicLingo 图译工坊", 331, 98, 11, false, Color.FromArgb(94, 108, 130));
            AddLabel("安装位置", 331, 155, 10, true, Color.FromArgb(45, 61, 85));
            directory = new TextBox { Text = options.Directory, Location = new Point(333, 185), Size = new Size(398, 31), BorderStyle = BorderStyle.FixedSingle };
            Controls.Add(directory);
            browse = MakeButton("更改…", 743, 182, 95, 35, false);
            browse.Click += delegate
            {
                using (FolderBrowserDialog dialog = new FolderBrowserDialog { Description = "请选择空文件夹，或此前由 PicLingo 安装的文件夹", SelectedPath = directory.Text, ShowNewFolderButton = true })
                    if (dialog.ShowDialog(this) == DialogResult.OK) directory.Text = dialog.SelectedPath;
            };
            AddLabel("仅为当前 Windows 用户安装，无需管理员权限。", 332, 225, 9, false, Color.FromArgb(116, 128, 146));
            desktop = new CheckBox { Text = "创建桌面快捷图标", Checked = options.Desktop, Location = new Point(333, 273), AutoSize = true };
            menu = new CheckBox { Text = "添加到开始菜单", Checked = options.StartMenu, Location = new Point(333, 309), AutoSize = true };
            launch = new CheckBox { Text = "安装完成后打开 PicLingo", Checked = options.Launch, Location = new Point(333, 345), AutoSize = true };
            Controls.AddRange(new Control[] { desktop, menu, launch });
            progress = new ProgressBar { Location = new Point(333, 400), Size = new Size(505, 6), Style = ProgressBarStyle.Continuous };
            status = new Label { Text = "准备就绪 · 版本 " + Product.Version, Location = new Point(331, 416), Size = new Size(508, 42), ForeColor = Color.FromArgb(109, 122, 143) };
            Controls.Add(progress); Controls.Add(status);
            install = MakeButton("开始安装", 652, 477, 186, 44, true);
            install.Click += delegate { if (completed) Finish(); else BeginInstallation(); };
            cancel = MakeButton("取消", 536, 477, 100, 44, false);
            cancel.Click += delegate { Close(); };
            FormClosing += delegate(object sender, FormClosingEventArgs args) { if (busy) args.Cancel = true; };
        }

        private void AddLabel(string text, int x, int y, float size, bool bold, Color color)
        {
            Controls.Add(new Label { Text = text, AutoSize = true, Location = new Point(x, y), Font = new Font("Microsoft YaHei UI", size, bold ? FontStyle.Bold : FontStyle.Regular), ForeColor = color });
        }

        private Button MakeButton(string text, int x, int y, int width, int height, bool primary)
        {
            Button button = new Button { Text = text, Location = new Point(x, y), Size = new Size(width, height), FlatStyle = FlatStyle.Flat, Cursor = Cursors.Hand, BackColor = primary ? Color.FromArgb(25, 106, 229) : Color.White, ForeColor = primary ? Color.White : Color.FromArgb(56, 71, 91) };
            button.FlatAppearance.BorderColor = primary ? button.BackColor : Color.FromArgb(216, 223, 232);
            button.FlatAppearance.BorderSize = primary ? 0 : 1;
            Controls.Add(button);
            return button;
        }

        private void BeginInstallation()
        {
            options.Directory = directory.Text;
            options.Desktop = desktop.Checked;
            options.StartMenu = menu.Checked;
            options.Launch = launch.Checked;
            try { Safety.InspectDestination(options.Directory, options.Register); }
            catch (Exception ex) { MessageBox.Show(this, Errors.Message(ex), "请选择可用的安装位置", MessageBoxButtons.OK, MessageBoxIcon.Information); return; }
            busy = true;
            directory.Enabled = browse.Enabled = desktop.Enabled = menu.Enabled = launch.Enabled = install.Enabled = cancel.Enabled = false;
            install.Text = "正在安装…";
            Thread worker = new Thread(delegate()
            {
                try
                {
                    SetupEngine.Install(options, delegate(int amount, string message) { BeginInvoke((Action)delegate { progress.Value = amount; status.Text = message; }); });
                    Errors.Save(options.Log, "SUCCESS\r\n" + options.Directory);
                    BeginInvoke((Action)delegate
                    {
                        busy = false; completed = true;
                        install.Enabled = true; install.Text = "完成";
                        cancel.Visible = false;
                        launch.Enabled = true;
                        status.ForeColor = Color.FromArgb(21, 126, 94);
                    });
                }
                catch (Exception ex)
                {
                    string message = Errors.Message(ex);
                    Errors.Save(options.Log, "FAILED\r\n" + ex.ToString());
                    BeginInvoke((Action)delegate
                    {
                        busy = false;
                        directory.Enabled = browse.Enabled = desktop.Enabled = menu.Enabled = launch.Enabled = install.Enabled = cancel.Enabled = true;
                        install.Text = "重新安装";
                        status.Text = "安装未完成，请检查提示后重试。";
                        progress.Value = 0;
                        MessageBox.Show(this, message, "安装未完成", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    });
                }
            });
            worker.IsBackground = true;
            worker.SetApartmentState(ApartmentState.STA);
            worker.Start();
        }

        private void Finish()
        {
            if (launch.Checked)
            {
                try { Process.Start(new ProcessStartInfo(Path.Combine(options.Directory, Product.Executable)) { WorkingDirectory = options.Directory, UseShellExecute = true }); }
                catch (Exception ex) { MessageBox.Show(this, "安装已完成，但程序未能启动：\r\n" + ex.Message, Product.Name, MessageBoxButtons.OK, MessageBoxIcon.Information); }
            }
            Close();
        }
    }

    internal static class SetupProgram
    {
        [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();

        [STAThread]
        private static int Main(string[] args)
        {
            SetupOptions options = new SetupOptions();
            try
            {
                for (int index = 0; index < args.Length; index++)
                {
                    switch (args[index].ToLowerInvariant())
                    {
                        case "--silent": options.Silent = true; break;
                        case "--no-launch": options.Launch = false; break;
                        case "--no-desktop": options.Desktop = false; break;
                        case "--no-start-menu": options.StartMenu = false; break;
                        case "--no-shortcuts": options.Desktop = false; options.StartMenu = false; break;
                        case "--no-register": options.Register = false; break;
                        case "--verify-payload": options.VerifyPayload = true; options.Silent = true; break;
                        case "--check-dir": options.CheckDirectory = true; options.Silent = true; options.Directory = Next(args, ref index); break;
                        case "--dir": options.Directory = Next(args, ref index); break;
                        case "--log": options.Log = Path.GetFullPath(Next(args, ref index)); break;
                        default: throw new ArgumentException("不支持的安装参数：" + args[index]);
                    }
                }
                if (options.VerifyPayload) { SetupEngine.Verify(); Errors.Save(options.Log, "PAYLOAD_OK"); return 0; }
                if (options.CheckDirectory) { Safety.InspectDestination(options.Directory, options.Register); Errors.Save(options.Log, "DIRECTORY_OK\r\n" + options.Directory); return 0; }
                if (options.Silent)
                {
                    SetupEngine.Install(options, delegate { });
                    Errors.Save(options.Log, "SUCCESS\r\n" + options.Directory);
                    if (options.Launch)
                    {
                        try { Process.Start(new ProcessStartInfo(Path.Combine(options.Directory, Product.Executable)) { WorkingDirectory = options.Directory, UseShellExecute = true }); }
                        catch (Exception launchError) { Errors.Save(options.Log, "SUCCESS\r\n" + options.Directory + "\r\nLaunch warning: " + launchError.Message); }
                    }
                    return 0;
                }
                try { SetProcessDPIAware(); } catch { }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                using (Microsoft.Win32.RegistryKey key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(Product.RegistryPath))
                    if (key != null && Convert.ToString(key.GetValue("ProductId")) == Product.Id && !args.Any(a => String.Equals(a, "--dir", StringComparison.OrdinalIgnoreCase))) options.Directory = Convert.ToString(key.GetValue("InstallLocation"));
                Application.Run(new SetupForm(options));
                return 0;
            }
            catch (Exception ex)
            {
                Errors.Save(options.Log, "FAILED\r\n" + ex.ToString());
                if (!options.Silent) MessageBox.Show(Errors.Message(ex), "PicLingo 安装未完成", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return 1;
            }
        }

        private static string Next(string[] args, ref int index)
        {
            if (++index >= args.Length) throw new ArgumentException("安装参数缺少值。");
            return args[index];
        }
    }
}
