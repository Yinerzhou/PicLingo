using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32;

namespace PicLingo.Installation
{
    internal static class Product
    {
        internal const string Id = "PicLingo.ImageTranslator.Desktop.7F96C460";
        internal const string Name = "PicLingo 图译工坊";
        internal const string Version = "1.2.0";
        internal const string Executable = "PicLingo.exe";
        internal const string Uninstaller = "Uninstall.exe";
        internal const string Marker = ".piclingo-install.json";
        internal const string RegistryPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\PicLingo";

        internal static string DefaultDirectory
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "PicLingo"); }
        }

        internal static string DesktopShortcut
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Name + ".lnk"); }
        }

        internal static string MenuDirectory
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), Name); }
        }

        internal static string MenuShortcut
        {
            get { return Path.Combine(MenuDirectory, Name + ".lnk"); }
        }
    }

    public sealed class InstallManifest
    {
        public string ProductId { get; set; }
        public string Version { get; set; }
        public string InstallPath { get; set; }
        public string InstalledUtc { get; set; }
        public List<string> Files { get; set; }
        public bool DesktopShortcut { get; set; }
        public bool StartMenuShortcut { get; set; }
        public bool Registered { get; set; }
    }

    internal sealed class DestinationState
    {
        internal string Directory;
        internal InstallManifest Previous;
    }

    internal static class Safety
    {
        internal static string CanonicalDirectory(string path)
        {
            if (String.IsNullOrWhiteSpace(path)) throw new InvalidOperationException("请选择安装位置。");
            string full = Path.GetFullPath(path).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string root = Path.GetPathRoot(full).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            if (String.Equals(full, root, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("不能安装到磁盘根目录，请选择独立文件夹。");
            if (full.Length > 180) throw new InvalidOperationException("安装路径过长，请选择更短的路径（180 个字符以内）。");
            return full;
        }

        internal static bool EqualPath(string first, string second)
        {
            try { return String.Equals(CanonicalDirectory(first), CanonicalDirectory(second), StringComparison.OrdinalIgnoreCase); }
            catch { return false; }
        }

        internal static string RelativeFile(string value)
        {
            if (String.IsNullOrEmpty(value)) throw new InvalidOperationException("安装包中含有空文件名。");
            string normalized = value.Replace('\\', '/');
            if (normalized.StartsWith("/", StringComparison.Ordinal) || Path.IsPathRooted(normalized) || normalized.IndexOf(':') >= 0)
                throw new InvalidOperationException("安装包包含不安全的绝对路径：" + value);
            string[] segments = normalized.Split('/');
            foreach (string segment in segments)
            {
                if (segment.Length == 0 || segment == "." || segment == ".." || segment.EndsWith(".", StringComparison.Ordinal) || segment.EndsWith(" ", StringComparison.Ordinal))
                    throw new InvalidOperationException("安装包包含不安全的文件路径：" + value);
                if (segment.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
                    throw new InvalidOperationException("安装包包含无效文件名：" + value);
                string stem = segment.Split('.')[0].ToUpperInvariant();
                if (stem == "CON" || stem == "PRN" || stem == "AUX" || stem == "NUL" ||
                    (stem.Length == 4 && (stem.StartsWith("COM", StringComparison.Ordinal) || stem.StartsWith("LPT", StringComparison.Ordinal)) && stem[3] >= '0' && stem[3] <= '9'))
                    throw new InvalidOperationException("安装包包含 Windows 保留文件名：" + value);
            }
            return String.Join("/", segments);
        }

        internal static string Child(string directory, string relative)
        {
            string safe = RelativeFile(relative);
            string root = CanonicalDirectory(directory);
            string full = Path.GetFullPath(Path.Combine(root, safe.Replace('/', Path.DirectorySeparatorChar)));
            if (!full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("安装文件超出安装目录。");
            return full;
        }

        internal static void NoReparsePoints(string path)
        {
            string current = Path.GetFullPath(path);
            while (!String.IsNullOrEmpty(current))
            {
                if ((Directory.Exists(current) || File.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidOperationException("安装路径中包含符号链接或目录联接，请选择普通文件夹：" + current);
                string parent = Path.GetDirectoryName(current.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
                if (String.Equals(parent, current, StringComparison.OrdinalIgnoreCase)) break;
                current = parent;
            }
        }

        internal static InstallManifest ReadManifest(string directory)
        {
            string marker = Path.Combine(directory, Product.Marker);
            if (!File.Exists(marker)) throw new InvalidOperationException("此目录不是 PicLingo 安装目录。为保护您的文件，操作已停止。");
            if (new FileInfo(marker).Length > 4 * 1024 * 1024) throw new InvalidOperationException("安装清单大小异常，操作已停止。");
            InstallManifest manifest;
            try { manifest = new JavaScriptSerializer().Deserialize<InstallManifest>(File.ReadAllText(marker, Encoding.UTF8)); }
            catch (Exception ex) { throw new InvalidOperationException("安装清单无法读取，未修改此目录。", ex); }
            if (manifest == null || manifest.ProductId != Product.Id || !EqualPath(manifest.InstallPath, directory) || manifest.Files == null)
                throw new InvalidOperationException("安装清单不属于此产品或目录，操作已停止。");
            HashSet<string> files = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string name in manifest.Files)
            {
                string safe = RelativeFile(name);
                if (String.Equals(safe, Product.Marker, StringComparison.OrdinalIgnoreCase) || !files.Add(safe))
                    throw new InvalidOperationException("安装清单中有重复或无效项目，操作已停止。");
                Child(directory, safe);
            }
            if (!files.Contains(Product.Executable) || !files.Contains(Product.Uninstaller))
                throw new InvalidOperationException("安装清单缺少程序文件，操作已停止。");
            return manifest;
        }

        internal static DestinationState InspectDestination(string requested, bool inspectRegistration = true)
        {
            string destination = CanonicalDirectory(requested);
            NoReparsePoints(destination);
            if (File.Exists(destination)) throw new InvalidOperationException("安装位置是一个文件，请选择文件夹。");
            InstallManifest previous = null;
            if (Directory.Exists(destination) && Directory.EnumerateFileSystemEntries(destination).Any())
            {
                if (!File.Exists(Path.Combine(destination, Product.Marker)))
                    throw new InvalidOperationException("所选文件夹已有其他文件。请选择空文件夹，或此前由 PicLingo 安装的文件夹。");
                previous = ReadManifest(destination);
            }
            using (RegistryKey key = inspectRegistration ? Registry.CurrentUser.OpenSubKey(Product.RegistryPath) : null)
            {
                if (key != null)
                {
                    if (Convert.ToString(key.GetValue("ProductId")) != Product.Id)
                        throw new InvalidOperationException("发现同名但不属于本产品的卸载信息，未修改任何文件。");
                    string registered = Convert.ToString(key.GetValue("InstallLocation"));
                    if (!EqualPath(registered, destination))
                        throw new InvalidOperationException("PicLingo 已安装在：" + registered + "\r\n请使用原位置安装，或先卸载原版本。");
                }
            }
            return new DestinationState { Directory = destination, Previous = previous };
        }

        internal static void EnsureFileAvailable(string path)
        {
            if (!File.Exists(path)) return;
            NoReparsePoints(path);
            for (int attempt = 0; attempt < 40; attempt++)
            {
                try { using (new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { } return; }
                catch (IOException ex)
                {
                    // Electron helper processes can release image mappings shortly after the main process exits.
                    if (attempt == 39) throw new InvalidOperationException("无法修改文件，可能程序仍在运行或文件被占用。请关闭 PicLingo 后重试：\r\n" + path, ex);
                    System.Threading.Thread.Sleep(150);
                }
                catch (Exception ex) { throw new InvalidOperationException("无法修改文件，请检查文件权限：\r\n" + path, ex); }
            }
        }

        internal static void DeleteEmptyDirectories(string root, IEnumerable<string> relativeFiles)
        {
            HashSet<string> directories = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string relative in relativeFiles)
            {
                string parent = Path.GetDirectoryName(Child(root, relative));
                while (!String.IsNullOrEmpty(parent) && !EqualPath(parent, root))
                {
                    directories.Add(parent);
                    parent = Path.GetDirectoryName(parent);
                }
            }
            foreach (string directory in directories.OrderByDescending(p => p.Length))
            {
                try { if (Directory.Exists(directory) && !Directory.EnumerateFileSystemEntries(directory).Any()) Directory.Delete(directory, false); }
                catch { }
            }
        }
    }

    internal static class Shortcuts
    {
        private static object CreateShell()
        {
            Type type = Type.GetTypeFromProgID("WScript.Shell");
            if (type == null) throw new InvalidOperationException("Windows 快捷方式组件不可用。");
            return Activator.CreateInstance(type);
        }

        private static object Open(object shell, string path)
        {
            return shell.GetType().InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { path });
        }

        internal static bool BelongsTo(string path, string directory)
        {
            if (!File.Exists(path)) return false;
            object shell = null, shortcut = null;
            try
            {
                shell = CreateShell(); shortcut = Open(shell, path);
                string target = Convert.ToString(shortcut.GetType().InvokeMember("TargetPath", BindingFlags.GetProperty, null, shortcut, null));
                return String.Equals(Path.GetFullPath(target), Path.Combine(directory, Product.Executable), StringComparison.OrdinalIgnoreCase);
            }
            catch { return false; }
            finally
            {
                if (shortcut != null && Marshal.IsComObject(shortcut)) Marshal.FinalReleaseComObject(shortcut);
                if (shell != null && Marshal.IsComObject(shell)) Marshal.FinalReleaseComObject(shell);
            }
        }

        internal static void Check(string path, string directory)
        {
            if (File.Exists(path) && !BelongsTo(path, directory))
                throw new InvalidOperationException("快捷方式名称已被其他程序使用，未覆盖：" + path);
            if (Directory.Exists(path)) throw new InvalidOperationException("快捷方式位置已存在同名文件夹：" + path);
        }

        internal static void Write(string path, string directory)
        {
            Check(path, directory);
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            object shell = null, shortcut = null;
            try
            {
                shell = CreateShell(); shortcut = Open(shell, path);
                Type type = shortcut.GetType();
                type.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { Path.Combine(directory, Product.Executable) });
                type.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { directory });
                type.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { Path.Combine(directory, "assets", "app.ico") + ",0" });
                type.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { "批量翻译图片中的文字" });
                type.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
            }
            finally
            {
                if (shortcut != null && Marshal.IsComObject(shortcut)) Marshal.FinalReleaseComObject(shortcut);
                if (shell != null && Marshal.IsComObject(shell)) Marshal.FinalReleaseComObject(shell);
            }
        }

        internal static void RemoveOwned(string path, string directory)
        {
            if (BelongsTo(path, directory)) File.Delete(path);
        }
    }

    internal sealed class RegistrySnapshot
    {
        internal bool Existed;
        internal Dictionary<string, object> Values = new Dictionary<string, object>();
        internal Dictionary<string, RegistryValueKind> Kinds = new Dictionary<string, RegistryValueKind>();

        internal static RegistrySnapshot Capture()
        {
            RegistrySnapshot result = new RegistrySnapshot();
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(Product.RegistryPath))
            {
                if (key != null)
                {
                    result.Existed = true;
                    foreach (string name in key.GetValueNames())
                    {
                        result.Values[name] = key.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames);
                        result.Kinds[name] = key.GetValueKind(name);
                    }
                }
            }
            return result;
        }

        internal void Restore()
        {
            Registry.CurrentUser.DeleteSubKeyTree(Product.RegistryPath, false);
            if (!Existed) return;
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(Product.RegistryPath))
                foreach (KeyValuePair<string, object> value in Values) key.SetValue(value.Key, value.Value, Kinds[value.Key]);
        }
    }

    internal static class Registration
    {
        internal static void Write(string directory, long bytes)
        {
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(Product.RegistryPath))
            {
                if (key == null) throw new InvalidOperationException("无法写入当前用户的卸载信息。");
                key.SetValue("ProductId", Product.Id);
                key.SetValue("DisplayName", Product.Name);
                key.SetValue("DisplayVersion", Product.Version);
                key.SetValue("Publisher", "PicLingo");
                key.SetValue("InstallLocation", directory);
                key.SetValue("DisplayIcon", Path.Combine(directory, "assets", "app.ico"));
                key.SetValue("UninstallString", "\"" + Path.Combine(directory, Product.Uninstaller) + "\"");
                key.SetValue("QuietUninstallString", "\"" + Path.Combine(directory, Product.Uninstaller) + "\" --silent");
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                key.SetValue("EstimatedSize", (int)Math.Min(Int32.MaxValue, (bytes + 1023) / 1024), RegistryValueKind.DWord);
                key.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
            }
        }

        internal static void RemoveOwned(string directory)
        {
            bool owned;
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(Product.RegistryPath))
                owned = key != null && Convert.ToString(key.GetValue("ProductId")) == Product.Id && Safety.EqualPath(Convert.ToString(key.GetValue("InstallLocation")), directory);
            if (owned) Registry.CurrentUser.DeleteSubKeyTree(Product.RegistryPath, false);
        }
    }

    internal static class Errors
    {
        internal static string Message(Exception exception)
        {
            if (exception is UnauthorizedAccessException) return "没有写入此位置的权限，请选择当前用户可写的文件夹。\r\n" + exception.Message;
            if (exception is IOException) return "无法完成文件操作。请检查磁盘空间，并关闭可能正在使用安装文件的程序。\r\n" + exception.Message;
            return exception.Message;
        }

        internal static void Save(string path, string message)
        {
            try { File.WriteAllText(path, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "\r\n" + message, new UTF8Encoding(false)); }
            catch { }
        }
    }
}
