using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Web.Script.Serialization;

// 仅处理安装清单中的文件，保护同目录的个人文件。
internal static class Maintenance
{
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };
    static string Child(string root, string relative)
    {
        if (String.IsNullOrEmpty(relative) || Path.IsPathRooted(relative) || relative.Contains(':')) throw new Exception("清单路径无效");
        var parts = relative.Replace('\\', '/').Split('/');
        if (parts.Any(part => part == ".." || part == "." || part.Length == 0)) throw new Exception("清单路径越界");
        string target = Path.GetFullPath(Path.Combine(root, relative));
        if (!target.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new Exception("清单路径越界");
        string current = target;
        while (current != null)
        {
            if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new Exception("路径包含链接");
            current = Path.GetDirectoryName(current);
        }
        return target;
    }
    static int Main(string[] args)
    {
        try
        {
            if (args.Length != 2 || !new[] { "migrate", "uninstall" }.Contains(args[0])) throw new Exception("参数无效");
            string root = Path.GetFullPath(args[1]).TrimEnd(Path.DirectorySeparatorChar);
            if (root.Length < 5 || root == Path.GetPathRoot(root).TrimEnd(Path.DirectorySeparatorChar)) throw new Exception("安装目录无效");
            var owned = Json.Deserialize<string[]>(File.ReadAllText(Child(root, ".piclingo-managed.json")));
            IEnumerable<string> remove = owned;
            if (args[0] == "migrate")
            {
                string legacy = Child(root, ".piclingo-install.json");
                if (!File.Exists(legacy)) return 0;
                var record = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(legacy));
                if (Convert.ToString(record["ProductId"]) != "PicLingo.ImageTranslator.Desktop.7F96C460" ||
                    !String.Equals(Path.GetFullPath(Convert.ToString(record["InstallPath"])).TrimEnd('\\'), root, StringComparison.OrdinalIgnoreCase)) throw new Exception("旧安装身份不匹配");
                var previous = ((System.Collections.IEnumerable)record["Files"]).Cast<object>().Select(Convert.ToString);
                remove = previous.Except(owned, StringComparer.OrdinalIgnoreCase).Concat(new[] { ".piclingo-install.json", "Uninstall.exe" });
            }
            var targets = remove.Where(name => name != "PicLingoMaintenance.exe" && name != ".piclingo-managed.json").Select(name => Child(root, name)).Distinct().ToList();
            // 先检查路径与文件占用，再删除，避免明显的半途失败。
            foreach (string file in targets) if (File.Exists(file)) using (File.Open(file, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { }
            foreach (string file in targets) if (File.Exists(file)) File.Delete(file);
            var directories = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string file in targets)
            {
                string parent = Path.GetDirectoryName(file);
                while (parent != root && parent != null) { directories.Add(parent); parent = Path.GetDirectoryName(parent); }
            }
            foreach (string directory in directories.OrderByDescending(value => value.Length))
                if (Directory.Exists(directory) && !Directory.EnumerateFileSystemEntries(directory).Any()) Directory.Delete(directory);
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error.Message); return 2; }
    }
}

