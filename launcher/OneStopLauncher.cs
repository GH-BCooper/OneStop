// OneStop.exe - double-click to run OneStop on this computer (see launcher/README.md).
//
// What it does, in order: finds Node.js, creates a `.env` on a first run, installs dependencies when
// package-lock.json changed, rebuilds when the source changed, starts `next start` on localhost,
// waits for /api/ping, opens the browser and sits in the system tray. Quitting from the tray (or
// the launcher being killed) takes the whole server process tree down with it, via a Windows job.
//
// Built by scripts/build-launcher.ps1 with the C# compiler that ships with Windows (.NET Framework
// 4.x), so the language level is C# 5: no string interpolation, `?.` or expression-bodied members.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("OneStop")]
[assembly: System.Reflection.AssemblyProduct("OneStop")]
[assembly: System.Reflection.AssemblyDescription("Starts OneStop on this computer and opens it in your browser.")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.0.0.0")]

namespace OneStopLauncher
{
    static class Program
    {
        [DllImport("user32.dll")]
        static extern bool SetProcessDPIAware();

        [STAThread]
        static void Main()
        {
            try { SetProcessDPIAware(); } catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string root = Paths.FindRoot(AppDomain.CurrentDomain.BaseDirectory);
            if (root == null)
            {
                MessageBox.Show(
                    "OneStop.exe has to sit inside the OneStop folder (next to package.json).\n\n" +
                    "Move it back there, or create a shortcut to it instead of moving it.",
                    "OneStop", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            bool created;
            using (var mutex = new Mutex(true, "Local\\OneStopLauncher-" + Paths.ShortHash(root.ToLowerInvariant()), out created))
            {
                if (!created)
                {
                    AlreadyRunning(root);
                    return;
                }
                Application.Run(new LauncherContext(root));
            }
        }

        /// A second double-click: just show the running instance instead of starting another.
        static void AlreadyRunning(string root)
        {
            string url = null;
            try { url = File.ReadAllText(Path.Combine(Paths.StateDir(root), "url.txt")).Trim(); } catch { }
            if (!string.IsNullOrEmpty(url) && Net.IsOneStop(url.Replace("//localhost:", "//127.0.0.1:")))
            {
                Net.OpenBrowser(url);
                return;
            }
            MessageBox.Show("OneStop is already starting. It will open in your browser as soon as it is ready.",
                "OneStop", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }

    /// Thrown for a problem the user can act on; the message is shown as-is.
    class LaunchError : Exception
    {
        public LaunchError(string message) : base(message) { }
    }

    class NodeMissing : Exception
    {
        public NodeMissing(string message) : base(message) { }
    }

    class LauncherContext : ApplicationContext
    {
        const int PreferredPort = 3000;

        readonly string root;
        readonly string webDir;
        readonly string stateDir;
        readonly Log log;
        readonly Job job = new Job();
        readonly Icon icon;
        readonly StatusForm status;
        readonly NotifyIcon tray;

        string node;
        string npmCli;
        Process server;
        string url;
        bool firstInstall;
        volatile bool quitting;
        volatile bool expectingExit;

        public LauncherContext(string root)
        {
            this.root = root;
            webDir = Path.Combine(root, "apps", "web");
            stateDir = Paths.StateDir(root);
            Directory.CreateDirectory(stateDir);
            log = new Log(Path.Combine(stateDir, "launcher.log"));
            try { File.Delete(Path.Combine(stateDir, "url.txt")); } catch { }

            icon = LoadIcon();

            status = new StatusForm(icon);
            status.CancelRequested += delegate { Quit(); };
            status.ShowLogRequested += delegate { OpenLog(); };

            tray = new NotifyIcon();
            tray.Icon = new Icon(icon, SystemInformation.SmallIconSize);
            tray.Text = "OneStop";
            tray.ContextMenuStrip = BuildMenu();
            tray.DoubleClick += delegate { OpenApp(); };
            tray.BalloonTipClicked += delegate { OpenApp(); };

            status.Show();
            StartWorker();
        }

        /// The full multi-size icon embedded by build-launcher.ps1 (the exe's own icon is 32px only).
        static Icon LoadIcon()
        {
            try
            {
                using (Stream s = typeof(LauncherContext).Assembly.GetManifestResourceStream("OneStop.ico"))
                    if (s != null) return new Icon(s);
            }
            catch { }
            try { return Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { return SystemIcons.Application; }
        }

        ContextMenuStrip BuildMenu()
        {
            var menu = new ContextMenuStrip();
            var open = new ToolStripMenuItem("Open OneStop", null, delegate { OpenApp(); });
            open.Font = new Font(open.Font, FontStyle.Bold);
            menu.Items.Add(open);
            menu.Items.Add(new ToolStripMenuItem("Restart (picks up code changes)", null, delegate { Restart(); }));
            menu.Items.Add(new ToolStripMenuItem("Show log", null, delegate { OpenLog(); }));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(new ToolStripMenuItem("Quit OneStop", null, delegate { Quit(); }));
            return menu;
        }

        // ---- startup sequence (runs on a worker thread) ----------------------------------------

        void StartWorker()
        {
            var worker = new Thread(delegate ()
            {
                try
                {
                    Launch();
                }
                catch (OperationCanceledException)
                {
                    // Quit was chosen mid-way; nothing to report.
                }
                catch (NodeMissing ex)
                {
                    log.Line("ERROR: " + ex.Message);
                    Ui(delegate
                    {
                        status.Hide();
                        var answer = MessageBox.Show(ex.Message + "\n\nOpen the Node.js download page now?",
                            "OneStop", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
                        if (answer == DialogResult.Yes) Net.OpenBrowser("https://nodejs.org/en/download");
                        Quit();
                    });
                }
                catch (Exception ex)
                {
                    bool known = ex is LaunchError;
                    log.Line("ERROR: " + (known ? ex.Message : ex.ToString()));
                    if (quitting) return;
                    string message = known ? ex.Message : "Something went wrong while starting OneStop:\n" + ex.Message;
                    Ui(delegate { Fail(message); });
                }
            });
            worker.IsBackground = true;
            worker.Start();
        }

        void Launch()
        {
            log.Line("OneStop launcher starting in " + root);

            SetStatus("Checking Node.js...");
            FindNode();

            // Someone already ran `npm start` / `npm run dev`: use that rather than fighting over the port.
            string existing = "http://localhost:" + PreferredPort;
            if (Net.IsListening(PreferredPort) && Net.IsOneStop("http://127.0.0.1:" + PreferredPort))
            {
                log.Line("OneStop is already answering on " + existing + "; opening it.");
                Net.OpenBrowser(existing);
                Ui(delegate { Quit(); });
                return;
            }

            EnsureEnvFile();
            EnsureDependencies();
            EnsureFfmpeg();
            EnsureBuild();
            StartServer();
        }

        void FindNode()
        {
            node = Paths.FindOnPath("node.exe");
            if (node == null)
            {
                foreach (string dir in new[] {
                    Environment.GetEnvironmentVariable("NVM_SYMLINK"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nodejs"),
                })
                {
                    if (string.IsNullOrEmpty(dir)) continue;
                    string candidate = Path.Combine(dir, "node.exe");
                    if (File.Exists(candidate)) { node = candidate; break; }
                }
            }
            if (node == null)
                throw new NodeMissing("OneStop needs Node.js (version 22 or newer, free) and it isn't installed on this computer.");

            string version = Capture(node, "-v").Trim();
            log.Line("Node.js " + version + " at " + node);
            int major;
            string[] parts = version.TrimStart('v').Split('.');
            if (!int.TryParse(parts[0], out major) || major < 22)
                throw new NodeMissing("OneStop needs Node.js 22 or newer, but this computer has " + version + ".");

            npmCli = Path.Combine(Path.GetDirectoryName(node), "node_modules", "npm", "bin", "npm-cli.js");
            if (!File.Exists(npmCli))
                throw new LaunchError("Node.js is installed but npm is missing from it (" + npmCli + "). Reinstall Node.js from nodejs.org.");
        }

        /// First run in a fresh copy: make a `.env` from the example that works with no database.
        void EnsureEnvFile()
        {
            string env = Path.Combine(root, ".env");
            string example = Path.Combine(root, ".env.example");
            if (File.Exists(env) || !File.Exists(example)) return;

            var lines = new List<string>();
            lines.Add("# Created by OneStop.exe on first run from .env.example.");
            lines.Add("# Accounts, history and favourites are off until DATABASE_URL points at a Postgres database.");
            lines.Add("");
            foreach (string line in File.ReadAllLines(example))
            {
                if (line.StartsWith("NODE_ENV=")) lines.Add("NODE_ENV=production");
                else if (line.StartsWith("DATABASE_URL=")) lines.Add("DATABASE_URL=");
                else if (line.StartsWith("NEXTAUTH_SECRET=")) lines.Add("NEXTAUTH_SECRET=" + Paths.RandomSecret());
                else lines.Add(line);
            }
            File.WriteAllLines(env, lines.ToArray(), new UTF8Encoding(false));
            log.Line("Created .env from .env.example (no database: accounts are switched off).");
        }

        void EnsureDependencies()
        {
            string lockFile = Path.Combine(root, "package-lock.json");
            string want = File.Exists(lockFile) ? Paths.FileHash(lockFile) : "no-lockfile";
            string stamp = Path.Combine(stateDir, "install.stamp");
            bool fresh = !File.Exists(Path.Combine(root, "node_modules", "next", "package.json"));
            if (!fresh && Paths.ReadText(stamp) == want) return;

            SetStatus(fresh
                ? "Installing OneStop for the first time. This downloads a few hundred MB and can take several minutes..."
                : "Updating dependencies...");
            // --no-save: never rewrite the committed package-lock.json (npm on Windows drops the Linux
            // `libc` markers from it, which would change what a Linux host installs).
            if (RunNpm("install --no-save --no-audit --no-fund") != 0)
                throw new LaunchError("Installing OneStop's dependencies failed. Check the internet connection and try again.");
            File.WriteAllText(stamp, File.Exists(lockFile) ? Paths.FileHash(lockFile) : want);
            firstInstall = fresh;
        }

        /// A fresh copy with no FFmpeg anywhere: fetch the free project-local build once, for the media tools.
        void EnsureFfmpeg()
        {
            string tried = Path.Combine(stateDir, "ffmpeg.tried");
            if (!firstInstall || File.Exists(tried)) return;
            File.WriteAllText(tried, DateTime.Now.ToString("s"));

            string configured = Settings.Get(root, "FFMPEG_PATH");
            bool haveTools = Directory.Exists(Path.Combine(root, ".tools")) &&
                Directory.GetFiles(Path.Combine(root, ".tools"), "ffmpeg.exe", SearchOption.AllDirectories).Length > 0;
            if (!string.IsNullOrEmpty(configured) || haveTools || Paths.FindOnPath("ffmpeg.exe") != null) return;

            SetStatus("Downloading FFmpeg for the audio and video tools...");
            if (Run(node, Paths.Quote(Path.Combine(root, "scripts", "fetch-ffmpeg.mjs")), root, null) != 0)
                log.Line("WARNING: FFmpeg download failed; the audio/video tools will explain how to install it.");
        }

        void EnsureBuild()
        {
            string buildId = Path.Combine(webDir, ".next", "BUILD_ID");
            string stamp = Path.Combine(stateDir, "build.stamp");
            bool haveBuild = File.Exists(buildId);
            if (haveBuild && Paths.ReadText(stamp) == Fingerprint.Of(root)) return;

            SetStatus(haveBuild
                ? "The code changed since the last run, so OneStop is rebuilding. This takes a few minutes..."
                : "Building OneStop. The first build takes a few minutes...");
            if (RunNpm("run db:generate") != 0)
                throw new LaunchError("Preparing the database client failed.");

            if (!string.IsNullOrEmpty(Settings.Get(root, "DATABASE_URL")))
            {
                SetStatus("Updating the database tables...");
                if (Run(node, Paths.Quote(Path.Combine(root, "scripts", "maybe-migrate.mjs")), root, null) != 0)
                    log.Line("WARNING: could not update the database (offline?). Continuing; accounts may not work until it can.");
            }

            SetStatus(haveBuild
                ? "Rebuilding OneStop with your latest changes. This takes a few minutes..."
                : "Building OneStop. The first build takes a few minutes...");
            var env = new Dictionary<string, string>();
            env["NODE_ENV"] = "production";
            if (RunNpm("run build -w @onestop/web", env) != 0)
                throw new LaunchError("Building OneStop failed. The log has the details (usually a code error to fix).");

            // Taken after the build, so files the build itself rewrites don't trigger another one next time.
            File.WriteAllText(stamp, Fingerprint.Of(root));
        }

        void StartServer()
        {
            string nextBin = Path.Combine(root, "node_modules", "next", "dist", "bin", "next");
            if (!File.Exists(nextBin)) nextBin = Path.Combine(webDir, "node_modules", "next", "dist", "bin", "next");
            if (!File.Exists(nextBin)) throw new LaunchError("Next.js is missing from node_modules. Delete the node_modules folder and start OneStop again.");

            int port = Net.PickPort(PreferredPort);
            url = "http://localhost:" + port;
            var env = new Dictionary<string, string>();
            env["NODE_ENV"] = "production";
            env["PORT"] = port.ToString();
            if (port != PreferredPort)
            {
                // Links, sign-in callbacks and dynamic QR codes must point at the port actually in use.
                log.Line("Port " + PreferredPort + " is busy; using " + port + ".");
                env["APP_URL"] = url;
                env["NEXTAUTH_URL"] = url;
                env["AUTH_URL"] = url;
            }

            SetStatus("Starting OneStop...");
            expectingExit = false;
            // Bound to this computer only: nothing on the local network can reach it.
            server = Start(node, Paths.Quote(nextBin) + " start -p " + port + " -H 127.0.0.1", webDir, env);
            server.EnableRaisingEvents = true;
            server.Exited += OnServerExited;

            DateTime deadline = DateTime.Now.AddMinutes(3);
            while (true)
            {
                if (quitting) throw new OperationCanceledException();
                if (server.HasExited) throw new LaunchError("OneStop stopped while starting up. The log has the details.");
                if (Net.IsListening(port) && Net.IsOneStop("http://127.0.0.1:" + port)) break;
                if (DateTime.Now > deadline) throw new LaunchError("OneStop took too long to start. The log has the details.");
                Thread.Sleep(400);
            }

            File.WriteAllText(Path.Combine(stateDir, "url.txt"), url);
            log.Line("OneStop is running at " + url);
            Net.OpenBrowser(url);
            Ui(delegate
            {
                status.Hide();
                tray.Text = "OneStop - " + url;
                tray.Visible = true;
                tray.ShowBalloonTip(6000, "OneStop is running",
                    "It opened in your browser at " + url + ". Right-click this icon to reopen, restart or quit.",
                    ToolTipIcon.Info);
            });
        }

        void OnServerExited(object sender, EventArgs e)
        {
            if (quitting || expectingExit || sender != server) return;
            log.Line("The OneStop server exited unexpectedly.");
            Ui(delegate { Fail("OneStop stopped unexpectedly."); });
        }

        // ---- tray actions ----------------------------------------------------------------------

        void OpenApp()
        {
            if (url != null) Net.OpenBrowser(url);
        }

        void OpenLog()
        {
            try { Process.Start("notepad.exe", Paths.Quote(log.FilePath)); } catch { }
        }

        void Restart()
        {
            if (quitting) return;
            log.Line("Restart requested.");
            expectingExit = true;
            job.KillAll();
            if (server != null) { try { server.WaitForExit(10000); } catch { } }
            tray.Visible = false;
            status.Reset();
            status.Show();
            StartWorker();
        }

        void Fail(string message)
        {
            if (quitting) return;
            status.Hide();
            tray.Visible = false;
            var answer = MessageBox.Show(message + "\n\nOpen the log to see what happened?", "OneStop",
                MessageBoxButtons.YesNo, MessageBoxIcon.Error);
            if (answer == DialogResult.Yes) OpenLog();
            Quit();
        }

        void Quit()
        {
            if (quitting) return;
            quitting = true;
            log.Line("Quitting.");
            job.KillAll();
            tray.Visible = false;
            tray.Dispose();
            status.AllowClose = true;
            status.Close();
            ExitThread();
        }

        // ---- process helpers -------------------------------------------------------------------

        int RunNpm(string arguments)
        {
            return RunNpm(arguments, null);
        }

        int RunNpm(string arguments, Dictionary<string, string> env)
        {
            return Run(node, Paths.Quote(npmCli) + " " + arguments, root, env);
        }

        /// Runs a step to completion, streaming its output to the log and the details box.
        int Run(string file, string arguments, string cwd, Dictionary<string, string> env)
        {
            Process p = Start(file, arguments, cwd, env);
            while (!p.WaitForExit(250))
            {
                if (quitting) throw new OperationCanceledException();
            }
            p.WaitForExit(); // flushes the redirected output
            if (quitting) throw new OperationCanceledException();
            log.Line("(exit code " + p.ExitCode + ")");
            return p.ExitCode;
        }

        Process Start(string file, string arguments, string cwd, Dictionary<string, string> env)
        {
            log.Line("> " + Path.GetFileName(file) + " " + arguments);
            var psi = new ProcessStartInfo(file, arguments);
            psi.WorkingDirectory = cwd;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            // npm scripts call `node`/`npx` by name, so the Node we found must come first on PATH.
            psi.EnvironmentVariables["PATH"] = Path.GetDirectoryName(node) + ";" + (psi.EnvironmentVariables["PATH"] ?? "");
            psi.EnvironmentVariables["NO_COLOR"] = "1";
            psi.EnvironmentVariables["FORCE_COLOR"] = "0";
            psi.EnvironmentVariables["NEXT_TELEMETRY_DISABLED"] = "1";
            psi.EnvironmentVariables["npm_config_update_notifier"] = "false";
            if (env != null)
                foreach (var kv in env) psi.EnvironmentVariables[kv.Key] = kv.Value;

            var p = new Process();
            p.StartInfo = psi;
            p.OutputDataReceived += OnOutput;
            p.ErrorDataReceived += OnOutput;
            p.Start();
            job.Add(p);
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            return p;
        }

        void OnOutput(object sender, DataReceivedEventArgs e)
        {
            if (e.Data == null) return;
            log.Line(e.Data);
            Ui(delegate { status.AppendDetail(e.Data); });
        }

        string Capture(string file, string arguments)
        {
            var psi = new ProcessStartInfo(file, arguments);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            using (var p = Process.Start(psi))
            {
                string output = p.StandardOutput.ReadToEnd();
                p.WaitForExit();
                return output;
            }
        }

        void SetStatus(string text)
        {
            log.Line("== " + text);
            Ui(delegate { status.SetStatus(text); });
        }

        void Ui(MethodInvoker action)
        {
            try
            {
                if (!status.IsDisposed && status.IsHandleCreated) status.BeginInvoke(action);
            }
            catch (InvalidOperationException) { }
        }
    }

    /// Small window shown while OneStop installs/builds/starts; hidden once it is running.
    class StatusForm : Form
    {
        public event EventHandler CancelRequested;
        public event EventHandler ShowLogRequested;
        public bool AllowClose;

        readonly Label title;
        readonly Label statusLabel;
        readonly ProgressBar bar;
        readonly LinkLabel detailsLink;
        readonly LinkLabel logLink;
        readonly Button cancel;
        readonly TextBox details;
        readonly Queue<string> detailLines = new Queue<string>();

        public StatusForm(Icon icon)
        {
            SuspendLayout();
            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoScaleMode = AutoScaleMode.Dpi;
            Font = new Font("Segoe UI", 9F);
            Text = "OneStop";
            Icon = icon;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(480, 160);

            var picture = new PictureBox();
            picture.Location = new Point(18, 18);
            picture.Size = new Size(48, 48);
            picture.SizeMode = PictureBoxSizeMode.Zoom;
            picture.Image = new Icon(icon, 48, 48).ToBitmap();

            title = new Label();
            title.Text = "Starting OneStop";
            title.Font = new Font("Segoe UI", 12F, FontStyle.Bold);
            title.Location = new Point(82, 16);
            title.Size = new Size(380, 26);

            statusLabel = new Label();
            statusLabel.Location = new Point(84, 46);
            statusLabel.Size = new Size(380, 40);

            bar = new ProgressBar();
            bar.Style = ProgressBarStyle.Marquee;
            bar.MarqueeAnimationSpeed = 30;
            bar.Location = new Point(84, 90);
            bar.Size = new Size(378, 12);

            detailsLink = new LinkLabel();
            detailsLink.Text = "Show details";
            detailsLink.AutoSize = true;
            detailsLink.Location = new Point(82, 124);
            detailsLink.LinkClicked += delegate { ToggleDetails(); };

            logLink = new LinkLabel();
            logLink.Text = "Open log";
            logLink.AutoSize = true;
            logLink.Location = new Point(176, 124);
            logLink.LinkClicked += delegate { if (ShowLogRequested != null) ShowLogRequested(this, EventArgs.Empty); };

            cancel = new Button();
            cancel.Text = "Cancel";
            cancel.Location = new Point(382, 118);
            cancel.Size = new Size(80, 28);
            cancel.Click += delegate { if (CancelRequested != null) CancelRequested(this, EventArgs.Empty); };

            details = new TextBox();
            details.Multiline = true;
            details.ReadOnly = true;
            details.ScrollBars = ScrollBars.Vertical;
            details.WordWrap = false;
            details.Font = new Font("Consolas", 8.5F);
            details.Location = new Point(18, 160);
            details.Size = new Size(444, 220);
            details.Visible = false;

            Controls.AddRange(new Control[] { picture, title, statusLabel, bar, detailsLink, logLink, cancel, details });
            ResumeLayout(false);
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!AllowClose && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                if (CancelRequested != null) CancelRequested(this, EventArgs.Empty);
                return;
            }
            base.OnFormClosing(e);
        }

        public void SetStatus(string text)
        {
            statusLabel.Text = text;
        }

        public void Reset()
        {
            title.Text = "Restarting OneStop";
            statusLabel.Text = "";
        }

        public void AppendDetail(string line)
        {
            detailLines.Enqueue(line);
            while (detailLines.Count > 400) detailLines.Dequeue();
            if (!details.Visible) return;
            details.AppendText(line + Environment.NewLine);
            if (details.TextLength > 60000) RefillDetails();
        }

        void RefillDetails()
        {
            details.Text = string.Join(Environment.NewLine, detailLines.ToArray()) + Environment.NewLine;
            details.SelectionStart = details.TextLength;
            details.ScrollToCaret();
        }

        void ToggleDetails()
        {
            details.Visible = !details.Visible;
            detailsLink.Text = details.Visible ? "Hide details" : "Show details";
            ClientSize = new Size(ClientSize.Width, (details.Visible ? details.Bottom : cancel.Bottom) + cancel.Top - bar.Bottom);
            if (details.Visible) RefillDetails();
        }
    }

    /// Kills every process started by the launcher (and their children) when it quits or dies.
    sealed class Job
    {
        [StructLayout(LayoutKind.Sequential)]
        struct BasicLimits
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct IoCounters
        {
            public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
            public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct ExtendedLimits
        {
            public BasicLimits BasicLimitInformation;
            public IoCounters IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        const int ExtendedLimitInformation = 9;
        const uint KillOnJobClose = 0x2000;

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        static extern IntPtr CreateJobObject(IntPtr attributes, string name);

        [DllImport("kernel32.dll")]
        static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);

        [DllImport("kernel32.dll")]
        static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [DllImport("kernel32.dll")]
        static extern bool TerminateJobObject(IntPtr job, uint exitCode);

        readonly IntPtr handle;

        public Job()
        {
            handle = CreateJobObject(IntPtr.Zero, null);
            var info = new ExtendedLimits();
            info.BasicLimitInformation.LimitFlags = KillOnJobClose;
            int length = Marshal.SizeOf(typeof(ExtendedLimits));
            IntPtr ptr = Marshal.AllocHGlobal(length);
            try
            {
                Marshal.StructureToPtr(info, ptr, false);
                SetInformationJobObject(handle, ExtendedLimitInformation, ptr, (uint)length);
            }
            finally
            {
                Marshal.FreeHGlobal(ptr);
            }
        }

        public void Add(Process p)
        {
            try { AssignProcessToJobObject(handle, p.Handle); } catch { }
        }

        public void KillAll()
        {
            TerminateJobObject(handle, 1);
        }
    }

    sealed class Log
    {
        readonly object gate = new object();
        readonly StreamWriter writer;
        public readonly string FilePath;

        public Log(string path)
        {
            FilePath = path;
            try
            {
                string previous = Path.Combine(Path.GetDirectoryName(path), "launcher.previous.log");
                if (File.Exists(path)) { File.Delete(previous); File.Move(path, previous); }
            }
            catch { }
            writer = new StreamWriter(path, true, new UTF8Encoding(false));
            writer.AutoFlush = true;
        }

        public void Line(string text)
        {
            lock (gate)
            {
                try { writer.WriteLine(DateTime.Now.ToString("HH:mm:ss") + "  " + text); } catch { }
            }
        }
    }

    static class Net
    {
        /// True when `baseUrl` is a OneStop server (its /api/ping names the app).
        public static bool IsOneStop(string baseUrl)
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create(baseUrl.TrimEnd('/') + "/api/ping");
                request.Proxy = null;
                request.Timeout = 2000;
                request.ReadWriteTimeout = 2000;
                using (var response = (HttpWebResponse)request.GetResponse())
                using (var reader = new StreamReader(response.GetResponseStream()))
                {
                    return reader.ReadToEnd().Contains("\"onestop\"");
                }
            }
            catch
            {
                return false;
            }
        }

        public static int PickPort(int preferred)
        {
            for (int port = preferred; port < preferred + 50; port++)
            {
                if (IsFree(IPAddress.Loopback, port) && IsFree(IPAddress.Any, port)) return port;
            }
            throw new LaunchError("No free port between " + preferred + " and " + (preferred + 49) + ".");
        }

        /// Instant, unlike an HTTP request: Windows takes ~2 s to report a refused local connection.
        public static bool IsListening(int port)
        {
            return !(IsFree(IPAddress.Loopback, port) && IsFree(IPAddress.Any, port));
        }

        static bool IsFree(IPAddress address, int port)
        {
            try
            {
                var listener = new TcpListener(address, port);
                listener.ExclusiveAddressUse = true;
                listener.Start();
                listener.Stop();
                return true;
            }
            catch (SocketException)
            {
                return false;
            }
        }

        public static void OpenBrowser(string url)
        {
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
        }
    }

    /// Reads a setting the way the app does: the real environment first, then the root `.env`.
    static class Settings
    {
        public static string Get(string root, string key)
        {
            string value = Environment.GetEnvironmentVariable(key);
            if (!string.IsNullOrEmpty(value)) return value.Trim();
            string file = Path.Combine(root, ".env");
            if (!File.Exists(file)) return null;
            foreach (string raw in File.ReadAllLines(file))
            {
                string line = raw.Trim();
                if (line.StartsWith("#")) continue;
                int eq = line.IndexOf('=');
                if (eq <= 0 || line.Substring(0, eq).Trim() != key) continue;
                string v = line.Substring(eq + 1).Trim();
                if (v.Length >= 2 && (v[0] == '"' || v[0] == '\'') && v[v.Length - 1] == v[0]) v = v.Substring(1, v.Length - 2);
                return v;
            }
            return null;
        }
    }

    /// A cheap "has the source changed?" signature: file count, total size and newest write time of
    /// everything that goes into the build. Deliberately skips outputs and tests.
    static class Fingerprint
    {
        static readonly string[] SkipDirs = { "node_modules", ".next", ".onestop-data", "generated", "dist", "coverage", "test", "__tests__" };

        public static string Of(string root)
        {
            long count = 0, size = 0, newest = 0;
            foreach (string dir in new[] { "apps", "packages", "prisma" })
                Walk(Path.Combine(root, dir), ref count, ref size, ref newest);
            foreach (string file in new[] { "package.json", "package-lock.json", "tsconfig.base.json", "prisma.config.ts" })
                Add(new FileInfo(Path.Combine(root, file)), ref count, ref size, ref newest);
            return count + ":" + size + ":" + newest;
        }

        static void Walk(string dir, ref long count, ref long size, ref long newest)
        {
            if (!Directory.Exists(dir)) return;
            foreach (string file in Directory.GetFiles(dir))
            {
                string name = Path.GetFileName(file);
                if (name.EndsWith(".tsbuildinfo") || name == "next-env.d.ts" || name.Contains(".test.")) continue;
                Add(new FileInfo(file), ref count, ref size, ref newest);
            }
            foreach (string sub in Directory.GetDirectories(dir))
            {
                if (Array.IndexOf(SkipDirs, Path.GetFileName(sub)) >= 0) continue;
                Walk(sub, ref count, ref size, ref newest);
            }
        }

        static void Add(FileInfo f, ref long count, ref long size, ref long newest)
        {
            if (!f.Exists) return;
            count++;
            size += f.Length;
            newest = Math.Max(newest, f.LastWriteTimeUtc.Ticks);
        }
    }

    static class Paths
    {
        /// The OneStop repository: the exe's own folder or one of its parents.
        public static string FindRoot(string start)
        {
            string dir = Path.GetFullPath(start);
            for (int i = 0; i < 4 && dir != null; i++)
            {
                string pkg = Path.Combine(dir, "package.json");
                if (File.Exists(pkg) && Directory.Exists(Path.Combine(dir, "apps", "web")) &&
                    File.ReadAllText(pkg).Contains("\"name\": \"onestop\""))
                    return dir.TrimEnd('\\');
                var parent = Directory.GetParent(dir);
                dir = parent == null ? null : parent.FullName;
            }
            return null;
        }

        public static string StateDir(string root)
        {
            return Path.Combine(root, ".onestop-launcher");
        }

        public static string FindOnPath(string exe)
        {
            string path = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string dir in path.Split(';'))
            {
                if (dir.Trim().Length == 0) continue;
                try
                {
                    string candidate = Path.Combine(dir.Trim().Trim('"'), exe);
                    if (File.Exists(candidate)) return candidate;
                }
                catch (ArgumentException) { }
            }
            return null;
        }

        public static string Quote(string arg)
        {
            return "\"" + arg.Replace("\"", "\\\"") + "\"";
        }

        public static string ReadText(string path)
        {
            try { return File.ReadAllText(path).Trim(); } catch { return null; }
        }

        public static string FileHash(string path)
        {
            using (var sha = SHA256.Create())
            using (var stream = File.OpenRead(path))
                return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "");
        }

        public static string ShortHash(string text)
        {
            using (var sha = SHA256.Create())
                return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(text))).Replace("-", "").Substring(0, 16);
        }

        public static string RandomSecret()
        {
            var bytes = new byte[32];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes);
            return Convert.ToBase64String(bytes);
        }
    }
}
