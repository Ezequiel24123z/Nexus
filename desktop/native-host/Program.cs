using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace NexusHost;

internal static class HostLog
{
    private static readonly object Sync = new();
    private static string LogDir => Path.Combine(
        Environment.GetEnvironmentVariable("NEXUS_TEST_DATA")
        ?? Environment.GetEnvironmentVariable("NEXUS_DATA_DIR")
        ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "NEXUS"),
        "logs"
    );

    public static void Write(string source, string message)
    {
        try
        {
            lock (Sync)
            {
                Directory.CreateDirectory(LogDir);
                string file = Path.Combine(LogDir, $"{source}.log");
                if (File.Exists(file) && new FileInfo(file).Length > 2 * 1024 * 1024)
                {
                    File.Move(file, file + ".prev", overwrite: true);
                }
                File.AppendAllText(file, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] {message}{Environment.NewLine}");
            }
        }
        catch { }
    }
}

internal static class Program
{
    private const string MutexName = @"Local\NEXUS_AGENT_IDE_SINGLE_INSTANCE";

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length >= 1 && args[0] == "--list-windows")
        {
            return NativeDesktop.RunListWindows();
        }
        if (args.Length >= 2 && args[0] == "--screenshot")
        {
            return NativeDesktop.RunScreenshot(args[1], args.Length >= 3 ? args[2] : null);
        }
        if (args.Length >= 2 && args[0] == "--desktop-action")
        {
            return NativeDesktop.RunDesktopAction(args[1]);
        }
        if (args.Length >= 2 && args[0] == "--browser-inspect")
        {
            return NativeBrowser.RunBrowserInspect(args[1]);
        }

        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) =>
        {
            HostLog.Write("host", "UI ThreadException: " + e.Exception);
        };
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
        {
            HostLog.Write("host", "AppDomain UnhandledException: " + e.ExceptionObject);
        };
        AppDomain.CurrentDomain.ProcessExit += (_, _) =>
        {
            HostLog.Write("host", "ProcessExit triggered");
        };
        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            HostLog.Write("host", "UnobservedTaskException: " + e.Exception);
            e.SetObserved();
        };

        using var mutex = new Mutex(true, MutexName, out bool isFirstInstance);
        if (!isFirstInstance && !args.Contains("--allow-multi"))
        {
            FocusExistingWindow();
            return 0;
        }

        ApplicationConfiguration.Initialize();
        try
        {
            HostLog.Write("host", "Launching NEXUS native host v1.4.0");
            using var server = CoreProcess.Start(args);
            using var form = new NexusWindow(server, args);
            Application.Run(form);
            return 0;
        }
        catch (Exception ex)
        {
            HostLog.Write("host", "Startup fatal error: " + ex);
            MessageBox.Show(
                $"NEXUS could not start.\n\n{ex.Message}",
                "NEXUS Startup Error",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
            return 1;
        }
    }

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    private static void FocusExistingWindow()
    {
        try
        {
            var current = Process.GetCurrentProcess();
            foreach (var proc in Process.GetProcessesByName(current.ProcessName))
            {
                if (proc.Id != current.Id && proc.MainWindowHandle != IntPtr.Zero)
                {
                    ShowWindow(proc.MainWindowHandle, 9); // SW_RESTORE
                    SetForegroundWindow(proc.MainWindowHandle);
                    break;
                }
            }
        }
        catch { }
    }
}

internal sealed class CoreProcess : IDisposable
{
    private const uint JobObjectExtendedLimitInformation = 9;
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public nuint MinimumWorkingSetSize;
        public nuint MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public nint Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public nuint ProcessMemoryLimit;
        public nuint JobMemoryLimit;
        public nuint PeakProcessMemoryUsed;
        public nuint PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern nint CreateJobObjectW(nint lpJobAttributes, string? lpName);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(nint hJob, uint infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION lpJobObjectInfo, uint cbJobObjectInfoLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(nint hJob, nint hProcess);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(nint hObject);

    private static nint AttachKillOnCloseJob(Process proc)
    {
        try
        {
            nint job = CreateJobObjectW(0, null);
            if (job == 0) return 0;
            var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION
            {
                BasicLimitInformation = new JOBOBJECT_BASIC_LIMIT_INFORMATION
                {
                    LimitFlags = JobObjectLimitKillOnJobClose,
                },
            };
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref info, (uint)Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>())
                || !AssignProcessToJobObject(job, proc.Handle))
            {
                CloseHandle(job);
                return 0;
            }
            return job;
        }
        catch { return 0; }
    }

    public Process Process { get; }
    public string Url { get; }
    public string Token { get; }
    public int Port { get; }
    public string DataDir { get; }
    public event Action<int>? UnexpectedExit;
    private bool _disposing;
    private nint _jobHandle;

    private CoreProcess(Process process, string url, string token, int port, string dataDir, nint jobHandle)
    {
        Process = process;
        Url = url;
        Token = token;
        Port = port;
        DataDir = dataDir;
        _jobHandle = jobHandle;
        Process.Exited += (_, _) =>
        {
            if (!_disposing)
            {
                int code = -1;
                try { code = Process.ExitCode; } catch { }
                HostLog.Write("host", $"Core daemon exited unexpectedly with code {code}");
                UnexpectedExit?.Invoke(code);
            }
        };
    }

    private static string BuildRefreshedPath(string nodeExe)
    {
        var parts = new List<string>();
        var nodeDir = Path.GetDirectoryName(nodeExe);
        if (!string.IsNullOrEmpty(nodeDir)) parts.Add(nodeDir);

        string localDotnet = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "dotnet");
        if (Directory.Exists(localDotnet)) parts.Add(localDotnet);

        void AddFrom(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return;
            foreach (var item in raw.Split(';', StringSplitOptions.RemoveEmptyEntries))
            {
                string trimmed = item.Trim();
                if (!string.IsNullOrEmpty(trimmed) && !parts.Contains(trimmed, StringComparer.OrdinalIgnoreCase))
                {
                    parts.Add(trimmed);
                }
            }
        }

        AddFrom(Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.User));
        AddFrom(Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.Machine));
        AddFrom(Environment.GetEnvironmentVariable("PATH"));
        return string.Join(';', parts);
    }

    public static CoreProcess Start(string[] cliArgs)
    {
        string serverScript = FindServerScript()
            ?? throw new FileNotFoundException("Could not locate core/server.mjs next to NEXUS.exe.");
        string nodeExe = FindNodeExecutable()
            ?? throw new FileNotFoundException("Could not locate Node.js 24 (node.exe). Install Node.js 24 or bundle node.exe in ./node/.");

        var startInfo = new ProcessStartInfo
        {
            FileName = nodeExe,
            WorkingDirectory = Path.GetDirectoryName(Path.GetDirectoryName(serverScript)) ?? Environment.CurrentDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        startInfo.Environment["PATH"] = BuildRefreshedPath(nodeExe);
        if (!string.IsNullOrEmpty(Environment.ProcessPath))
        {
            startInfo.Environment["NEXUS_HOST_EXE"] = Environment.ProcessPath;
        }
        startInfo.ArgumentList.Add(serverScript);
        startInfo.ArgumentList.Add("--native-host");
        startInfo.ArgumentList.Add("--parent-pid");
        startInfo.ArgumentList.Add(Environment.ProcessId.ToString());
        startInfo.ArgumentList.Add("--port");
        startInfo.ArgumentList.Add("0");
        foreach (var arg in cliArgs) startInfo.ArgumentList.Add(arg);

        var proc = Process.Start(startInfo)
            ?? throw new InvalidOperationException("Failed to launch NEXUS core daemon.");
        nint jobHandle = AttachKillOnCloseJob(proc);

        const string marker = "NEXUS_SERVER_READY:";
        var readyTcs = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var errorLines = new List<string>();

        proc.EnableRaisingEvents = true;
        proc.Exited += (_, _) => readyTcs.TrySetCanceled();

        proc.OutputDataReceived += (_, e) =>
        {
            if (string.IsNullOrEmpty(e.Data)) return;
            int idx = e.Data.IndexOf(marker, StringComparison.Ordinal);
            if (idx >= 0)
            {
                readyTcs.TrySetResult(e.Data[(idx + marker.Length)..].Trim());
            }
            else
            {
                HostLog.Write("core", e.Data);
            }
        };

        proc.ErrorDataReceived += (_, e) =>
        {
            if (!string.IsNullOrWhiteSpace(e.Data))
            {
                HostLog.Write("core", "STDERR: " + e.Data);
                lock (errorLines) { if (errorLines.Count < 40) errorLines.Add(e.Data); }
            }
        };

        proc.BeginOutputReadLine();
        proc.BeginErrorReadLine();

        string? readyJson = null;
        try
        {
            if (readyTcs.Task.Wait(TimeSpan.FromSeconds(30)) && readyTcs.Task.IsCompletedSuccessfully)
            {
                readyJson = readyTcs.Task.Result;
            }
        }
        catch { }

        if (readyJson == null)
        {
            string stderr;
            lock (errorLines) { stderr = string.Join("\n", errorLines); }
            try { proc.Kill(entireProcessTree: true); } catch { }
            throw new InvalidOperationException("NEXUS core engine did not report ready.\n" + stderr);
        }

        using var doc = JsonDocument.Parse(readyJson);
        var root = doc.RootElement;
        return new CoreProcess(
            proc,
            root.GetProperty("url").GetString()!,
            root.GetProperty("token").GetString()!,
            root.GetProperty("port").GetInt32(),
            root.GetProperty("dataDir").GetString()!,
            jobHandle
        );
    }

    private static string? FindServerScript()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        for (int i = 0; i < 6 && dir != null; i++, dir = dir.Parent)
        {
            string direct = Path.Combine(dir.FullName, "core", "server.mjs");
            if (File.Exists(direct)) return direct;
            string nested = Path.Combine(dir.FullName, "desktop", "core", "server.mjs");
            if (File.Exists(nested)) return nested;
        }
        return null;
    }

    private static string? FindNodeExecutable()
    {
        var candidates = new List<string>
        {
            Path.Combine(AppContext.BaseDirectory, "node", "node.exe"),
            Path.Combine(AppContext.BaseDirectory, "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nexus-toolchain", "node-v24.12.0-win-x64", "node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
        };
        foreach (var path in candidates)
        {
            if (File.Exists(path)) return path;
        }
        string? pathEnv = Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.User) + ";" + Environment.GetEnvironmentVariable("PATH");
        foreach (var seg in pathEnv.Split(';', StringSplitOptions.RemoveEmptyEntries))
        {
            try
            {
                var candidate = Path.Combine(seg.Trim(), "node.exe");
                if (File.Exists(candidate)) return candidate;
            }
            catch { }
        }
        return null;
    }

    public void Dispose()
    {
        _disposing = true;
        try
        {
            if (!Process.HasExited) Process.Kill(entireProcessTree: true);
        }
        catch { }
        if (_jobHandle != 0)
        {
            try { CloseHandle(_jobHandle); } catch { }
            _jobHandle = 0;
        }
        Process.Dispose();
    }
}

internal sealed class NexusWindow : Form
{
    private const int DWMWA_USE_IMMUTABLE_DARK_MODE = 20;
    private const int WM_HOTKEY = 0x0312;
    private const int HOTKEY_ID = 0x4E58;
    private const uint MOD_CONTROL = 0x0002;
    private const uint MOD_SHIFT = 0x0004;
    private const uint VK_SPACE = 0x20;

    private CoreProcess _server;
    private readonly string[] _cliArgs;
    private readonly WebView2 _webView;
    private readonly PrivateBrowserPanel _privateBrowser;
    private readonly ConPtyManager _conPty;
    private readonly NotifyIcon _trayIcon;
    private string? _bootstrapScriptId;
    private bool _minimizeToTray;
    private bool _forceExit;
    private bool _darkMode = true;
    private bool _restartingCore;
    private readonly Queue<DateTime> _coreRestartTimestamps = new();

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

    [DllImport("user32.dll")]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll")]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr hIcon);

    public NexusWindow(CoreProcess server, string[] cliArgs)
    {
        _server = server;
        _cliArgs = cliArgs;
        AttachCoreWatchdog(_server);

        Text = "NEXUS";
        Width = 1480;
        Height = 940;
        MinimumSize = new Size(900, 640);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(13, 15, 18);
        Icon = BuildNexusIcon();

        _webView = new WebView2
        {
            Dock = DockStyle.Fill,
            DefaultBackgroundColor = Color.FromArgb(13, 15, 18),
        };
        Controls.Add(_webView);

        _privateBrowser = new PrivateBrowserPanel(this, _server.DataDir, evt =>
        {
            try
            {
                var payload = JsonSerializer.Serialize(new { @event = "browserState", data = evt });
                _webView.CoreWebView2?.PostWebMessageAsJson(payload);
            }
            catch { }
        });

        _conPty = new ConPtyManager(evt =>
        {
            try
            {
                if (IsDisposed || !IsHandleCreated) return;
                var payload = JsonSerializer.Serialize(new { @event = "conpty", data = evt });
                BeginInvoke(new Action(() =>
                {
                    try { _webView.CoreWebView2?.PostWebMessageAsJson(payload); } catch { }
                }));
            }
            catch { }
        });

        var trayMenu = new ContextMenuStrip();
        trayMenu.Items.Add("Open NEXUS", null, (_, _) => SummonWindow());
        trayMenu.Items.Add("Reload Interface", null, (_, _) => { try { _webView.CoreWebView2?.Reload(); } catch { } });
        trayMenu.Items.Add(new ToolStripSeparator());
        trayMenu.Items.Add("Quit NEXUS", null, (_, _) => { _forceExit = true; Close(); });

        _trayIcon = new NotifyIcon
        {
            Icon = Icon,
            Text = "NEXUS Agent IDE",
            ContextMenuStrip = trayMenu,
            Visible = true,
        };
        _trayIcon.DoubleClick += (_, _) => SummonWindow();

        Load += async (_, _) => await InitializeWebViewAsync();
        FormClosing += OnWindowClosing;
    }

    private void AttachCoreWatchdog(CoreProcess proc)
    {
        proc.UnexpectedExit += code =>
        {
            if (IsDisposed || _forceExit || _restartingCore) return;
            lock (_coreRestartTimestamps)
            {
                var cutoff = DateTime.UtcNow.AddSeconds(-60);
                while (_coreRestartTimestamps.Count > 0 && _coreRestartTimestamps.Peek() < cutoff)
                    _coreRestartTimestamps.Dequeue();
                if (_coreRestartTimestamps.Count >= 5)
                {
                    HostLog.Write("host", "Core daemon restarted 5 times in 60s; halting auto-restart loop.");
                    return;
                }
                _coreRestartTimestamps.Enqueue(DateTime.UtcNow);
            }
            _restartingCore = true;
            Task.Run(async () =>
            {
                try
                {
                    await Task.Delay(600);
                    HostLog.Write("host", "Attempting automatic restart of NEXUS core daemon...");
                    var oldServer = _server;
                    var restarted = CoreProcess.Start(_cliArgs);
                    _server = restarted;
                    try { oldServer.Dispose(); } catch { }
                    AttachCoreWatchdog(restarted);
                    if (!IsDisposed && IsHandleCreated)
                    {
                        BeginInvoke(new Action(async () =>
                        {
                            try
                            {
                                await InjectBootstrapAndNavigateAsync();
                                HostLog.Write("host", "Core daemon restarted and WebView2 reconnected cleanly.");
                            }
                            catch (Exception ex) { HostLog.Write("host", "Reconnect failed: " + ex); }
                        }));
                    }
                }
                catch (Exception ex)
                {
                    HostLog.Write("host", "Auto-restart failed: " + ex);
                }
                finally { _restartingCore = false; }
            });
        };
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        ApplyDarkTitleBar(_darkMode);
        try { RegisterHotKey(Handle, HOTKEY_ID, MOD_CONTROL | MOD_SHIFT, VK_SPACE); } catch { }
    }

    protected override void OnHandleDestroyed(EventArgs e)
    {
        try { UnregisterHotKey(Handle, HOTKEY_ID); } catch { }
        base.OnHandleDestroyed(e);
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_HOTKEY && m.WParam.ToInt32() == HOTKEY_ID)
        {
            SummonWindow();
            return;
        }
        base.WndProc(ref m);
    }

    private void SummonWindow()
    {
        Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
    }

    private void ApplyDarkTitleBar(bool dark)
    {
        _darkMode = dark;
        BackColor = dark ? Color.FromArgb(13, 15, 18) : Color.FromArgb(250, 250, 248);
        try { _webView.DefaultBackgroundColor = BackColor; } catch { }
        int value = dark ? 1 : 0;
        try { _ = DwmSetWindowAttribute(Handle, DWMWA_USE_IMMUTABLE_DARK_MODE, ref value, Marshal.SizeOf<int>()); } catch { }
    }

    private async Task InjectBootstrapAndNavigateAsync()
    {
        if (_webView.CoreWebView2 == null) return;
        if (!string.IsNullOrEmpty(_bootstrapScriptId))
        {
            try { _webView.CoreWebView2.RemoveScriptToExecuteOnDocumentCreated(_bootstrapScriptId); } catch { }
        }
        var bootstrap = $$"""
            window.__NEXUS_BOOTSTRAP__ = {
              serverUrl: {{JsonSerializer.Serialize(_server.Url)}},
              token: {{JsonSerializer.Serialize(_server.Token)}},
              nativeHost: true
            };
            """;
        _bootstrapScriptId = await _webView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(bootstrap);
        _webView.CoreWebView2.Navigate($"{_server.Url}/?token={Uri.EscapeDataString(_server.Token)}");
    }

    private async Task InitializeWebViewAsync()
    {
        try
        {
            string userDataFolder = Path.Combine(_server.DataDir, "webview2-profile");
            var env = await CoreWebView2Environment.CreateAsync(null, userDataFolder);
            await _webView.EnsureCoreWebView2Async(env);

            var settings = _webView.CoreWebView2.Settings;
            settings.AreDevToolsEnabled = true;
            settings.AreDefaultContextMenusEnabled = true;
            settings.IsStatusBarEnabled = false;
            settings.IsZoomControlEnabled = true;

            _webView.CoreWebView2.WebMessageReceived += OnWebMessage;
            _webView.CoreWebView2.NewWindowRequested += (_, args) =>
            {
                args.Handled = true;
                if (!string.IsNullOrWhiteSpace(args.Uri)) OpenSafeHttpUrl(args.Uri);
            };
            _webView.CoreWebView2.ProcessFailed += (_, args) =>
            {
                HostLog.Write("host", $"WebView2 ProcessFailed: kind={args.ProcessFailedKind}, reason={args.Reason}");
                if (args.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited
                    || args.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
                {
                    BeginInvoke(new Action(() =>
                    {
                        try { _webView.CoreWebView2?.Reload(); } catch { }
                    }));
                }
            };

            await InjectBootstrapAndNavigateAsync();
        }
        catch (Exception ex)
        {
            HostLog.Write("host", "WebView2 init error: " + ex);
            MessageBox.Show(
                $"WebView2 could not initialize.\n\n{ex.Message}",
                "NEXUS WebView2 Error",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }
    }

    private async void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!Uri.TryCreate(e.Source, UriKind.Absolute, out var sourceUri)
            || !Uri.TryCreate(_server.Url, UriKind.Absolute, out var serverUri)
            || !string.Equals(sourceUri.Scheme, serverUri.Scheme, StringComparison.OrdinalIgnoreCase)
            || !string.Equals(sourceUri.Host, serverUri.Host, StringComparison.OrdinalIgnoreCase)
            || sourceUri.Port != serverUri.Port)
        {
            HostLog.Write("host", "Rejected native WebMessage from untrusted origin: " + e.Source);
            return;
        }
        string id = "";
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            id = root.TryGetProperty("id", out var idEl) ? idEl.GetString() ?? "" : "";
            string method = root.TryGetProperty("method", out var mEl) ? mEl.GetString() ?? "" : "";
            JsonElement args = root.TryGetProperty("args", out var aEl) ? aEl.Clone() : default;

            object? result = await HandleNativeCallAsync(method, args);
            if (!string.IsNullOrEmpty(id))
            {
                PostResponse(id, ok: true, result: result, error: null);
            }
        }
        catch (Exception ex)
        {
            HostLog.Write("host", "WebMessage error: " + ex.Message);
            if (!string.IsNullOrEmpty(id))
            {
                PostResponse(id, ok: false, result: null, error: ex.Message);
            }
        }
    }

    private async Task<object?> HandleNativeCallAsync(string method, JsonElement args)
    {
        string GetStr(string prop, string fallback = "") =>
            args.ValueKind == JsonValueKind.Object && args.TryGetProperty(prop, out var el) && el.ValueKind == JsonValueKind.String
                ? el.GetString() ?? fallback
                : fallback;
        bool GetBool(string prop, bool fallback = false) =>
            args.ValueKind == JsonValueKind.Object && args.TryGetProperty(prop, out var el) && (el.ValueKind == JsonValueKind.True || el.ValueKind == JsonValueKind.False)
                ? el.GetBoolean()
                : fallback;
        double GetNum(string prop, double fallback = 0) =>
            args.ValueKind == JsonValueKind.Object && args.TryGetProperty(prop, out var el) && el.ValueKind == JsonValueKind.Number
                ? el.GetDouble()
                : fallback;

        switch (method)
        {
            case "setTheme":
                ApplyDarkTitleBar(GetStr("theme", "dark") != "light");
                return true;
            case "setTrayMode":
                _minimizeToTray = GetBool("enabled", false);
                return true;
            case "notify":
            {
                string title = GetStr("title", "NEXUS");
                string body = GetStr("body", "");
                if (!string.IsNullOrWhiteSpace(body)) _trayIcon.ShowBalloonTip(3500, title, body, ToolTipIcon.Info);
                return true;
            }
            case "browserShow":
                return await _privateBrowser.ShowAsync(
                    GetNum("x"), GetNum("y"), GetNum("width", 800), GetNum("height", 600),
                    GetStr("url", "https://duckduckgo.com/"),
                    GetStr("proxyUrl", ""),
                    GetBool("blockTrackers", true),
                    GetBool("antiFingerprint", true),
                    GetBool("persistent", false)
                );
            case "browserBounds":
                _privateBrowser.UpdateBounds(GetNum("x"), GetNum("y"), GetNum("width", 800), GetNum("height", 600));
                return true;
            case "browserHide":
                _privateBrowser.Hide();
                return true;
            case "browserNavigate":
                _privateBrowser.Navigate(GetStr("url", "https://duckduckgo.com/"));
                return true;
            case "browserBack":
                _privateBrowser.GoBack();
                return true;
            case "browserForward":
                _privateBrowser.GoForward();
                return true;
            case "browserReload":
                _privateBrowser.Reload();
                return true;
            case "browserWipe":
                return await _privateBrowser.WipeAndReinitAsync(
                    GetStr("url", "https://duckduckgo.com/"),
                    GetStr("proxyUrl", ""),
                    GetBool("blockTrackers", true),
                    GetBool("antiFingerprint", true),
                    GetBool("persistent", false)
                );
            case "browserExtract":
                return await _privateBrowser.ExtractPageAsync();
            case "browserScreenshot":
                return await _privateBrowser.CaptureScreenshotAsync();
            case "conptyCreate":
                return _conPty.Create(GetStr("cwd", ""), GetStr("title", "PowerShell (ConPTY)"), (int)GetNum("cols", 120), (int)GetNum("rows", 30));
            case "conptyWrite":
                return _conPty.Write(GetStr("id", ""), GetStr("data", ""));
            case "conptyResize":
                return _conPty.Resize(GetStr("id", ""), (int)GetNum("cols", 120), (int)GetNum("rows", 30));
            case "conptyInterrupt":
                return _conPty.Interrupt(GetStr("id", ""));
            case "conptyClear":
                return _conPty.ClearBuffer(GetStr("id", ""));
            case "conptyGet":
                return _conPty.Get(GetStr("id", ""));
            case "conptyList":
                return _conPty.List();
            case "conptyClose":
                return _conPty.Close(GetStr("id", ""));
            case "chooseWorkspace":
            case "pickDirectory":
            {
                string title = GetStr("title", "Select Project Workspace Folder");
                using var dlg = new FolderBrowserDialog { Description = title, UseDescriptionForTitle = true, ShowNewFolderButton = true };
                return dlg.ShowDialog(this) == DialogResult.OK ? dlg.SelectedPath : null;
            }
            case "chooseAttachments":
            {
                using var dlg = new OpenFileDialog { Title = "Attach files to chat", Multiselect = true, Filter = "All files (*.*)|*.*" };
                return dlg.ShowDialog(this) == DialogResult.OK ? dlg.FileNames : Array.Empty<string>();
            }
            case "pickBackupFile":
            {
                using var dlg = new OpenFileDialog { Title = "Select NEXUS Backup", Multiselect = false, Filter = "NEXUS Backup (*.json;*.sqlite)|*.json;*.sqlite|All files (*.*)|*.*" };
                return dlg.ShowDialog(this) == DialogResult.OK ? dlg.FileName : null;
            }
            case "pickSaveFile":
            {
                string defaultName = GetStr("defaultPath", "export.json");
                string filter = GetStr("filter", "All files (*.*)|*.*");
                using var dlg = new SaveFileDialog { FileName = defaultName, Filter = filter };
                return dlg.ShowDialog(this) == DialogResult.OK ? dlg.FileName : null;
            }
            case "openExternal":
            {
                string target = GetStr("target", "");
                if (!string.IsNullOrWhiteSpace(target)) OpenSafeHttpUrl(target);
                return true;
            }
            case "openPath":
            {
                string target = GetStr("target", "");
                if (!string.IsNullOrWhiteSpace(target)) OpenExistingLocalPath(target);
                return true;
            }
            case "openDevTools":
                _webView.CoreWebView2?.OpenDevToolsWindow();
                return true;
            case "relaunchElevated":
            {
                string? exe = Environment.ProcessPath;
                if (string.IsNullOrWhiteSpace(exe)) throw new InvalidOperationException("Unable to locate NEXUS executable path.");
                var psi = new ProcessStartInfo
                {
                    FileName = exe,
                    UseShellExecute = true,
                    Verb = "runas",
                };
                Process.Start(psi);
                _forceExit = true;
                BeginInvoke(() => Close());
                return true;
            }
            case "logError":
                HostLog.Write("renderer", $"[{GetStr("source", "ui")}] {GetStr("message", "")}");
                return true;
            default:
                throw new InvalidOperationException("Unknown native call: " + method);
        }
    }

    private void PostResponse(string id, bool ok, object? result, string? error)
    {
        var payload = JsonSerializer.Serialize(new { id, ok, result, error });
        _webView.CoreWebView2?.PostWebMessageAsJson(payload);
    }

    private static void OpenSafeHttpUrl(string url)
    {
        try
        {
            if (Uri.TryCreate(url.Trim(), UriKind.Absolute, out var uri)
                && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
            {
                Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
            }
        }
        catch { }
    }

    private static void OpenExistingLocalPath(string target)
    {
        try
        {
            string full = Path.GetFullPath(target.Trim());
            if (File.Exists(full) || Directory.Exists(full))
            {
                Process.Start(new ProcessStartInfo(full) { UseShellExecute = true });
            }
        }
        catch { }
    }

    private void OnWindowClosing(object? sender, FormClosingEventArgs e)
    {
        if (_minimizeToTray && !_forceExit && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide();
            return;
        }
        _forceExit = true;
        HostLog.Write("host", $"Closing NEXUS window (reason={e.CloseReason})");
        _conPty.Dispose();
        _privateBrowser.Dispose();
        _trayIcon.Visible = false;
        _trayIcon.Dispose();
        try { _server.Dispose(); } catch { }
    }

    private static Icon BuildNexusIcon()
    {
        using var bmp = new Bitmap(64, 64);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);
            using var bg = new SolidBrush(Color.FromArgb(18, 22, 26));
            using var border = new Pen(Color.FromArgb(62, 207, 142), 3f);
            g.FillRoundedRectangle(bg, 4, 4, 56, 56, 14);
            g.DrawRoundedRectangle(border, 4, 4, 56, 56, 14);
            using var font = new Font("Segoe UI", 30f, FontStyle.Bold, GraphicsUnit.Pixel);
            using var fg = new SolidBrush(Color.FromArgb(62, 207, 142));
            var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
            g.DrawString("N", font, fg, new RectangleF(4, 5, 56, 56), sf);
        }
        IntPtr hIcon = bmp.GetHicon();
        try
        {
            using var tempIcon = Icon.FromHandle(hIcon);
            return (Icon)tempIcon.Clone();
        }
        finally
        {
            DestroyIcon(hIcon);
        }
    }
}

internal static class GraphicsExtensions
{
    public static void FillRoundedRectangle(this Graphics g, Brush brush, float x, float y, float w, float h, float r)
    {
        using var path = RoundedRect(x, y, w, h, r);
        g.FillPath(brush, path);
    }

    public static void DrawRoundedRectangle(this Graphics g, Pen pen, float x, float y, float w, float h, float r)
    {
        using var path = RoundedRect(x, y, w, h, r);
        g.DrawPath(pen, path);
    }

    private static GraphicsPath RoundedRect(float x, float y, float w, float h, float r)
    {
        float d = r * 2;
        var path = new GraphicsPath();
        path.AddArc(x, y, d, d, 180, 90);
        path.AddArc(x + w - d, y, d, d, 270, 90);
        path.AddArc(x + w - d, y + h - d, d, d, 0, 90);
        path.AddArc(x, y + h - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }
}

internal sealed class PrivateBrowserPanel : IDisposable
{
    private static readonly string[] TrackerDomains =
    [
        "doubleclick.net", "google-analytics.com", "googletagmanager.com", "googlesyndication.com",
        "googleadservices.com", "adservice.google.com", "connect.facebook.net", "pixel.facebook.com",
        "analytics.tiktok.com", "ads-twitter.com", "static.ads-twitter.com", "bat.bing.com",
        "clarity.ms", "hotjar.com", "mixpanel.com", "segment.io", "cdn.segment.com",
        "amplitude.com", "scorecardresearch.com", "quantserve.com", "taboola.com",
        "outbrain.com", "criteo.com", "pubmatic.com", "rubiconproject.com", "adnxs.com",
        "amazon-adsystem.com", "moatads.com", "newrelic.com", "bam.nr-data.net"
    ];

    private readonly Form _host;
    private readonly string _dataDir;
    private readonly Action<object> _emitState;
    private WebView2? _view;
    private string _profileDir = "";
    private bool _profileIsTemp;
    private string _activeProxy = "";
    private bool _persistent;
    private bool _blockTrackers = true;
    private bool _antiFingerprint = true;
    private int _blockedCount;
    private bool _loading;
    private string _currentUrl = "https://duckduckgo.com/";
    private string _currentTitle = "NEXUS Browser";
    private Rectangle _lastRect = new(280, 120, 900, 650);

    public PrivateBrowserPanel(Form host, string dataDir, Action<object> emitState)
    {
        _host = host;
        _dataDir = dataDir;
        _emitState = emitState;
    }

    private static string ValidateProxyUrl(string proxyUrl)
    {
        string trimmed = (proxyUrl ?? "").Trim();
        if (string.IsNullOrEmpty(trimmed)) return "";
        if (trimmed.IndexOfAny(['"', '\'', ' ', '\t', '\r', '\n', ';']) >= 0)
            throw new InvalidOperationException("Proxy URL contains disallowed characters.");
        if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var uri))
            throw new InvalidOperationException("Invalid proxy URL.");
        string scheme = uri.Scheme.ToLowerInvariant();
        if (scheme is not ("http" or "https" or "socks4" or "socks5" or "socks5h"))
            throw new InvalidOperationException("Unsupported proxy scheme: " + scheme);
        return uri.AbsoluteUri.TrimEnd('/');
    }

    public async Task<object> ShowAsync(double x, double y, double width, double height, string url, string proxyUrl, bool blockTrackers, bool antiFingerprint, bool persistent = false)
    {
        string safeProxy = ValidateProxyUrl(proxyUrl);
        bool antiFpChanged = _antiFingerprint != antiFingerprint;
        _blockTrackers = blockTrackers;
        _antiFingerprint = antiFingerprint;
        UpdateBounds(x, y, width, height);

        bool needsInit = _view == null || _activeProxy != safeProxy || _persistent != persistent || antiFpChanged;
        if (needsInit)
        {
            await RecreateAsync(url, safeProxy, persistent);
        }
        else if (!string.IsNullOrWhiteSpace(url) && url != _currentUrl && _view?.CoreWebView2 != null)
        {
            _view.CoreWebView2.Navigate(url);
        }

        if (_view != null)
        {
            _view.Bounds = _lastRect;
            _view.Visible = true;
            _view.BringToFront();
        }
        EmitSnapshot();
        return CurrentSnapshot();
    }

    public void UpdateBounds(double x, double y, double width, double height)
    {
        float scale = _host.DeviceDpi / 96f;
        int rx = Math.Max(0, (int)Math.Round(x * scale));
        int ry = Math.Max(0, (int)Math.Round(y * scale));
        int rw = Math.Max(200, (int)Math.Round(width * scale));
        int rh = Math.Max(160, (int)Math.Round(height * scale));
        _lastRect = new Rectangle(rx, ry, rw, rh);
        if (_view != null) _view.Bounds = _lastRect;
    }

    public void Hide()
    {
        if (_view != null) _view.Visible = false;
    }

    public void Navigate(string url)
    {
        if (string.IsNullOrWhiteSpace(url)) return;
        _currentUrl = url;
        _view?.CoreWebView2?.Navigate(url);
    }

    public void GoBack() { try { if (_view?.CoreWebView2?.CanGoBack == true) _view.CoreWebView2.GoBack(); } catch { } }
    public void GoForward() { try { if (_view?.CoreWebView2?.CanGoForward == true) _view.CoreWebView2.GoForward(); } catch { } }
    public void Reload() { try { _view?.CoreWebView2?.Reload(); } catch { } }

    public async Task<object> WipeAndReinitAsync(string url, string proxyUrl, bool blockTrackers, bool antiFingerprint, bool persistent = false)
    {
        string safeProxy = ValidateProxyUrl(proxyUrl);
        bool wasVisible = _view?.Visible == true;
        _blockTrackers = blockTrackers;
        _antiFingerprint = antiFingerprint;
        if (persistent)
        {
            string persistDir = Path.Combine(_dataDir, "browser-account-profile");
            DestroyCurrent();
            try { if (Directory.Exists(persistDir)) Directory.Delete(persistDir, true); } catch { }
        }
        await RecreateAsync(url, safeProxy, persistent);
        if (_view != null && wasVisible)
        {
            _view.Bounds = _lastRect;
            _view.Visible = true;
            _view.BringToFront();
        }
        return CurrentSnapshot();
    }

    private async Task RecreateAsync(string url, string proxyUrl, bool persistent)
    {
        DestroyCurrent();
        _blockedCount = 0;
        _activeProxy = proxyUrl;
        _persistent = persistent;
        if (persistent)
        {
            _profileDir = Path.Combine(_dataDir, "browser-account-profile");
            _profileIsTemp = false;
        }
        else
        {
            _profileDir = Path.Combine(Path.GetTempPath(), "nexus-private-" + Guid.NewGuid().ToString("N")[..10]);
            _profileIsTemp = true;
        }
        Directory.CreateDirectory(_profileDir);

        var argsList = new List<string>
        {
            "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
            "--disable-features=msEdgeAccountConsistency,msEdgeSmartScreen",
        };
        if (!string.IsNullOrWhiteSpace(proxyUrl))
        {
            argsList.Add($"--proxy-server=\"{proxyUrl}\"");
            if (proxyUrl.StartsWith("socks", StringComparison.OrdinalIgnoreCase))
            {
                argsList.Add("--host-resolver-rules=\"MAP * ~NOTFOUND , EXCLUDE 127.0.0.1\"");
            }
        }

        var options = new CoreWebView2EnvironmentOptions(string.Join(" ", argsList));
        var env = await CoreWebView2Environment.CreateAsync(null, _profileDir, options);

        var view = new WebView2
        {
            Bounds = _lastRect,
            Visible = false,
            DefaultBackgroundColor = Color.FromArgb(13, 15, 18),
        };
        _host.Controls.Add(view);

        var ctrlOptions = env.CreateCoreWebView2ControllerOptions();
        ctrlOptions.IsInPrivateModeEnabled = !persistent;
        await view.EnsureCoreWebView2Async(env, ctrlOptions);

        var core = view.CoreWebView2;
        core.Settings.AreDevToolsEnabled = true;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = true;
        core.Settings.IsGeneralAutofillEnabled = persistent;
        core.Settings.IsPasswordAutosaveEnabled = persistent;

        if (_antiFingerprint)
        {
            const string shield = """
                (() => {
                  try {
                    Object.defineProperty(navigator, 'webdriver', { get: () => false });
                    Object.defineProperty(navigator, 'doNotTrack', { get: () => '1' });
                    Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true });
                    if (navigator.sendBeacon) navigator.sendBeacon = () => false;
                    if (navigator.getBattery) navigator.getBattery = undefined;
                  } catch {}
                })();
                """;
            await core.AddScriptToExecuteOnDocumentCreatedAsync(shield);
        }

        core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += (_, e) =>
        {
            if (!_blockTrackers) return;
            try
            {
                var uri = new Uri(e.Request.Uri);
                string host = uri.Host.ToLowerInvariant();
                foreach (var tracker in TrackerDomains)
                {
                    if (host == tracker || host.EndsWith("." + tracker, StringComparison.Ordinal))
                    {
                        e.Response = env.CreateWebResourceResponse(null, 403, "Blocked by NEXUS Privacy Shield", "");
                        _blockedCount++;
                        EmitSnapshot();
                        return;
                    }
                }
            }
            catch { }
        };

        core.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            if (!string.IsNullOrWhiteSpace(e.Uri)) core.Navigate(e.Uri);
        };
        core.NavigationStarting += (_, e) => { _loading = true; _currentUrl = e.Uri; EmitSnapshot(); };
        core.NavigationCompleted += (_, _) => { _loading = false; _currentUrl = core.Source; _currentTitle = core.DocumentTitle; EmitSnapshot(); };
        core.SourceChanged += (_, _) => { _currentUrl = core.Source; EmitSnapshot(); };
        core.DocumentTitleChanged += (_, _) => { _currentTitle = core.DocumentTitle; EmitSnapshot(); };

        _view = view;
        _currentUrl = string.IsNullOrWhiteSpace(url) ? "https://duckduckgo.com/" : url;
        core.Navigate(_currentUrl);
        EmitSnapshot();
    }

    public async Task<object> ExtractPageAsync()
    {
        if (_view?.CoreWebView2 == null) throw new InvalidOperationException("Private Browser is not active.");
        const string script = """
            (() => {
              const selection = (window.getSelection?.()?.toString() || '').trim();
              const text = (document.body?.innerText || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 18000);
              const links = [...document.querySelectorAll('a[href]')].slice(0, 40).map(a => ({
                text: (a.innerText || a.href).trim().slice(0, 100),
                url: a.href
              }));
              return { url: location.href, title: document.title, selection, text, links };
            })()
            """;
        string json = await _view.CoreWebView2.ExecuteScriptAsync(script);
        return JsonSerializer.Deserialize<JsonElement>(json);
    }

    public async Task<object> CaptureScreenshotAsync()
    {
        if (_view?.CoreWebView2 == null) throw new InvalidOperationException("Private Browser is not active.");
        using var ms = new MemoryStream();
        await _view.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, ms);
        return new
        {
            url = _currentUrl,
            title = _currentTitle,
            base64 = Convert.ToBase64String(ms.ToArray()),
            mime = "image/png",
        };
    }

    private object CurrentSnapshot() => new
    {
        url = _currentUrl,
        title = _currentTitle,
        loading = _loading,
        blockedCount = _blockedCount,
        proxyUrl = _activeProxy,
        inPrivate = !_persistent,
        persistent = _persistent,
        canGoBack = _view?.CoreWebView2?.CanGoBack ?? false,
        canGoForward = _view?.CoreWebView2?.CanGoForward ?? false,
    };

    private void EmitSnapshot() => _emitState(CurrentSnapshot());

    private void DestroyCurrent()
    {
        if (_view != null)
        {
            try
            {
                _host.Controls.Remove(_view);
                _view.Dispose();
            }
            catch { }
            _view = null;
        }
        if (_profileIsTemp && !string.IsNullOrEmpty(_profileDir))
        {
            string oldDir = _profileDir;
            _profileDir = "";
            _profileIsTemp = false;
            Task.Run(async () =>
            {
                await Task.Delay(1200);
                try { if (Directory.Exists(oldDir)) Directory.Delete(oldDir, recursive: true); } catch { }
            });
        }
    }

    public void Dispose() => DestroyCurrent();
}
