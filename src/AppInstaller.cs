using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

// The same small native host builds Setup and the installed uninstaller.
internal static class AppInstaller
{
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
            if (Array.IndexOf(args, "--quiet") >= 0) { Execute(root, migration, uninstall); return 0; }
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
                        status.Text = uninstall ? "卸载完成。用户数据保留在原安装目录。" : "安装完成。可从开始菜单打开 SimRacingOverlay。";
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
            if (Array.IndexOf(args, "--quiet") < 0) MessageBox.Show(error.Message, "SimRacingOverlay", MessageBoxButtons.OK, MessageBoxIcon.Error);
            else { try { Console.Error.WriteLine(error.ToString()); } catch (IOException) { } catch (InvalidOperationException) { } }
            return 1;
        }
    }
}
