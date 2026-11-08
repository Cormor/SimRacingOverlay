using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Threading;
using System.Web.Script.Serialization;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

// The same small native host builds Setup and the installed uninstaller.
internal static class AppInstaller
{
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static string updateRoot, updateId, updateVersion;
    static void UpdateState(string phase, string message)
    {
        if (updateRoot == null) return;
        string folder = Path.Combine(updateRoot, "runtime", "updates");
        Directory.CreateDirectory(folder);
        string file = Path.Combine(folder, "install-state.json"), temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try {
            File.WriteAllText(temporary, Json.Serialize(new { schema = 1, attemptId = updateId, version = updateVersion, phase = phase, message = message, updatedAt = DateTime.UtcNow.ToString("O") }), new UTF8Encoding(false));
            if (File.Exists(file)) File.Replace(temporary, file, null); else File.Move(temporary, file);
        } finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    static bool InstalledAt(string root)
    {
        string full = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
        if (!Directory.Exists(full) || (File.GetAttributes(full) & FileAttributes.ReparsePoint) != 0) return false;
        string file = Path.Combine(full, "runtime", "installed-app.json");
        if (!File.Exists(file)) return false;
        Dictionary<string, object> identity = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(file, Encoding.UTF8));
        object installed, recorded;
        return identity.TryGetValue("installed", out installed) && installed is bool && (bool)installed && identity.TryGetValue("root", out recorded) && recorded is string && String.Equals(full, Path.GetFullPath((string)recorded).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase);
    }
    static int Update(string root, string migration, string attempt)
    {
        // The native lifetime lock prevents repeated old-client clicks from
        // starting another install or replacing the active attempt receipt.
        string normalized = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar).ToUpperInvariant();
        string name;
        using (SHA256 hash = SHA256.Create()) name = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(normalized))).Replace("-", "");
        using (Mutex mutex = new Mutex(false, "Local\\SimRacingOverlay.Update." + name)) {
            bool acquired;
            try { acquired = mutex.WaitOne(0); } catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) return 2;
            try {
                if (!InstalledAt(root)) throw new InvalidOperationException("The update target is not this installed application.");
                updateRoot = Path.GetFullPath(root); updateId = attempt;
                using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("PackageVersion"))
                using (StreamReader reader = new StreamReader(stream)) updateVersion = reader.ReadToEnd().Trim();
                UpdateState("preparing", "正在准备更新；完成后将自动重启。");
                Execute(root, migration, false);
                UpdateState("restarting", "文件已更新，正在重新启动应用…");
                Restart(root);
                return 0;
            } catch (Exception error) {
                UpdateState("error", "更新未完成：" + error.Message);
                throw;
            } finally { mutex.ReleaseMutex(); }
        }
    }

    static string Option(string[] args, string key, string fallback)
    {
        for (int i = 0; i < args.Length; i++) if (args[i] == key) {
            if (i + 1 == args.Length) throw new ArgumentException("Missing value for " + key);
            return args[i + 1];
        }
        return fallback;
    }
    static string Quote(string value)
    {
        StringBuilder result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            if (c == '\"') result.Append('\\', slashes * 2 + 1).Append(c);
            else result.Append('\\', slashes).Append(c);
            slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('\"').ToString();
    }
    static void Resource(string name, string file)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(file));
        using (Stream source = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
        using (Stream target = File.Create(file)) {
            if (source == null) throw new InvalidOperationException("Missing installer resource: " + name);
            source.CopyTo(target);
        }
    }
    static void Extract(string archive, string target)
    {
        string prefix = Path.GetFullPath(target).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        Directory.CreateDirectory(target);
        using (ZipArchive zip = ZipFile.OpenRead(archive)) foreach (ZipArchiveEntry entry in zip.Entries) {
            string file = Path.GetFullPath(Path.Combine(target, entry.FullName));
            if (!file.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Invalid payload path.");
            if (entry.FullName.EndsWith("/") || entry.FullName.EndsWith("\\")) { Directory.CreateDirectory(file); continue; }
            Directory.CreateDirectory(Path.GetDirectoryName(file));
            entry.ExtractToFile(file, true);
        }
    }
    static string Execute(string root, string migration, bool uninstall)
    {
        string temporary = Path.Combine(Path.GetTempPath(), "SimRacingOverlay-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temporary);
        try {
            string script;
            string arguments;
            if (uninstall) {
                script = Path.Combine(temporary, "Uninstall-App.ps1");
                Resource("UninstallScript", script);
                arguments = " -InstallPath " + Quote(root) + " -UninstallerProcessId " + Process.GetCurrentProcess().Id;
            } else {
#if UNINSTALLER
                throw new InvalidOperationException("This executable only uninstalls the application.");
#else
                string archive = Path.Combine(temporary, "payload.zip");
                Resource("Payload", archive);
                string payload = Path.Combine(temporary, "app");
                Extract(archive, payload);
                Resource("Uninstaller", Path.Combine(payload, "runtime", "SimRacingUninstall.exe"));
                script = Path.Combine(payload, "tools", "Install-App.ps1");
                arguments = " -Payload " + Quote(payload) + " -InstallPath " + Quote(root);
                if (!String.IsNullOrWhiteSpace(migration)) arguments += " -MigrationSource " + Quote(migration);
                if (updateId != null) arguments += " -UpdateAttemptId " + Quote(updateId) + " -UpdateVersion " + Quote(updateVersion);
#endif
            }
            ProcessStartInfo start = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"));
            start.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File " + Quote(script) + arguments;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;
            start.StandardOutputEncoding = Encoding.UTF8;
            start.StandardErrorEncoding = Encoding.UTF8;
            using (Process process = Process.Start(start)) {
                Task<string> output = process.StandardOutput.ReadToEndAsync();
                Task<string> errors = process.StandardError.ReadToEndAsync();
                process.WaitForExit();
                Task.WaitAll(output, errors);
                if (process.ExitCode != 0) throw new InvalidOperationException(errors.Result + Environment.NewLine + output.Result);
                return output.Result;
            }
        } finally { try { Directory.Delete(temporary, true); } catch (IOException) { } catch (UnauthorizedAccessException) { } }
    }
    static void Restart(string root)
    {
        ProcessStartInfo start = new ProcessStartInfo(Path.Combine(root, "runtime", "SimRacingLauncher.exe"));
        start.Arguments = "--root " + Quote(root);
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        Process.Start(start);
    }
    [STAThread]
    static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try {
#if UNINSTALLER
            bool uninstall = true;
            string defaultRoot = Path.GetDirectoryName(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location));
#else
            bool uninstall = Array.IndexOf(args, "--uninstall") >= 0;
            string defaultRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "AI", "Apps", "SimRacingOverlay");
#endif
            string root = Option(args, "--root", defaultRoot);
            string migration = Option(args, "--migration-source", null);
            bool restart = !uninstall && Array.IndexOf(args, "--restart") >= 0;
            // --root + --restart was the update entry in 1.6.0/1.6.1.
            // A real installed identity is mandatory before interpreting it as
            // a background in-place update; ordinary double-click stays a wizard.
            if (!uninstall && restart && Array.IndexOf(args, "--root") >= 0) {
                string attempt = Option(args, "--attempt-id", Guid.NewGuid().ToString("N"));
                Guid parsed;
                if (!Guid.TryParseExact(attempt, "N", out parsed)) throw new ArgumentException("Invalid update attempt identity.");
                return Update(root, migration, attempt);
            }
            if (Array.IndexOf(args, "--quiet") >= 0) { Execute(root, migration, uninstall); if (restart) Restart(root); return 0; }
            using (Form form = new Form()) {
                form.Text = uninstall ? "卸载 SimRacingOverlay" : "安装 SimRacingOverlay";
                form.Font = new Font("Microsoft YaHei UI", 10);
                form.ClientSize = new Size(620, 250);
                form.AutoScaleMode = AutoScaleMode.Dpi;
                form.FormBorderStyle = FormBorderStyle.FixedDialog;
                form.MaximizeBox = false;
                form.StartPosition = FormStartPosition.CenterScreen;
                form.Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location);
                Label intro = new Label { Left = 24, Top = 22, Width = 572, Height = 58, Text = uninstall ? "卸载程序并保留设置、布局、已下载盘面和桌面配置。\n叠加层会先保存并正常退出。" : "安装到当前用户，添加开始菜单入口。\n升级时保留设置、布局、已下载盘面和桌面配置。" };
                TextBox path = new TextBox { Left = 24, Top = 94, Width = 480, Text = root, ReadOnly = uninstall };
                Button browse = new Button { Left = 512, Top = 92, Width = 84, Height = 30, Text = "浏览…", Enabled = !uninstall };
                browse.Click += delegate { using (FolderBrowserDialog dialog = new FolderBrowserDialog()) { dialog.SelectedPath = path.Text; if (dialog.ShowDialog(form) == DialogResult.OK) path.Text = dialog.SelectedPath; } };
                Label status = new Label { Left = 24, Top = 138, Width = 572, Height = 42, Text = "" };
                Button action = new Button { Left = 390, Top = 198, Width = 100, Height = 32, Text = uninstall ? "卸载" : "安装" };
                Button close = new Button { Left = 502, Top = 198, Width = 94, Height = 32, Text = "取消" };
                bool busy = false;
                close.Click += delegate { form.Close(); };
                form.FormClosing += delegate(object sender, FormClosingEventArgs e) { if (busy) e.Cancel = true; };
                action.Click += async delegate {
                    string destination = path.Text;
                    busy = true; action.Enabled = false; browse.Enabled = false; path.Enabled = false; close.Enabled = false;
                    status.Text = uninstall ? "正在保存并卸载…" : "正在保存现有配置并安装，请稍候…";
                    try {
                        await Task.Run(delegate { return Execute(destination, migration, uninstall); });
                        if (restart) Restart(destination);
                        status.Text = uninstall ? "卸载完成。用户数据保留在原安装目录。" : restart ? "安装完成，已启动 SimRacingOverlay。" : "安装完成。可从开始菜单打开 SimRacingOverlay。";
                        close.Text = "完成";
                    } catch (Exception error) {
                        status.Text = "操作未完成。";
                        MessageBox.Show(form, error.Message, "SimRacingOverlay", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        action.Enabled = true; browse.Enabled = !uninstall; path.Enabled = !uninstall;
                    } finally { busy = false; close.Enabled = true; }
                };
                form.Controls.AddRange(new Control[] { intro, path, browse, status, action, close });
                Application.Run(form);
                return 0;
            }
        } catch (Exception error) {
            if (Array.IndexOf(args, "--quiet") < 0 && !(Array.IndexOf(args, "--root") >= 0 && Array.IndexOf(args, "--restart") >= 0)) MessageBox.Show(error.Message, "SimRacingOverlay", MessageBoxButtons.OK, MessageBoxIcon.Error);
            else { try { Console.Error.WriteLine(error.ToString()); } catch (IOException) { } catch (InvalidOperationException) { } }
            return 1;
        }
    }
}
