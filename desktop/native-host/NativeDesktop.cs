using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace NexusHost;

/// <summary>
/// Pure native C# Win32 desktop automation, window enumeration &amp; privacy-safe screenshot helper invoked via:
///   NEXUS.exe --list-windows
///   NEXUS.exe --screenshot &lt;outputJpgPath&gt; [base64OptionsJson]
///   NEXUS.exe --desktop-action &lt;base64JsonPayload&gt;
/// Runs zero PowerShell scripts for screenshots/input, supports multi-monitor &amp; window-scoped capture.
/// </summary>
internal static class NativeDesktop
{
    private const uint INPUT_MOUSE = 0;
    private const uint INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_UNICODE = 0x0004;
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    private const uint MOUSEEVENTF_WHEEL = 0x0800;
    private const uint PW_RENDERFULLCONTENT = 0x00000002;
    private const int SW_RESTORE = 9;

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT { public uint type; public InputUnion U; }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
    [DllImport("user32.dll")] private static extern uint MapVirtualKey(uint uCode, uint uMapType);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextW(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] private static extern int GetWindowTextLengthW(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] private static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);
    private const uint KEYEVENTF_EXTENDEDKEY = 0x0001;

    private sealed record WindowEntry(long Hwnd, string Title, string ProcessName, int Pid, Rectangle Bounds, bool Active, bool Minimized);

    private static List<WindowEntry> EnumerateVisibleWindows()
    {
        var results = new List<WindowEntry>();
        IntPtr fg = GetForegroundWindow();
        EnumWindows((hWnd, _) =>
        {
            if (!IsWindowVisible(hWnd)) return true;
            int len = GetWindowTextLengthW(hWnd);
            if (len <= 0) return true;
            var sb = new StringBuilder(len + 1);
            GetWindowTextW(hWnd, sb, sb.Capacity);
            string title = sb.ToString().Trim();
            if (string.IsNullOrEmpty(title)) return true;
            if (!GetWindowRect(hWnd, out var rc)) return true;
            int w = rc.Right - rc.Left;
            int h = rc.Bottom - rc.Top;
            if (w < 40 || h < 30) return true;

            GetWindowThreadProcessId(hWnd, out uint pid);
            string procName = "";
            try { procName = Process.GetProcessById((int)pid).ProcessName; } catch { }
            results.Add(new WindowEntry(
                hWnd.ToInt64(),
                title,
                procName,
                (int)pid,
                new Rectangle(rc.Left, rc.Top, w, h),
                hWnd == fg,
                IsIconic(hWnd)
            ));
            return results.Count < 80;
        }, IntPtr.Zero);
        return results;
    }

    private static WindowEntry? FindWindow(long hwnd, string? titleQuery)
    {
        var windows = EnumerateVisibleWindows();
        if (hwnd != 0)
        {
            var byHwnd = windows.FirstOrDefault(w => w.Hwnd == hwnd);
            if (byHwnd != null) return byHwnd;
            IntPtr ptr = new(hwnd);
            if (GetWindowRect(ptr, out var rc))
            {
                return new WindowEntry(hwnd, "", "", 0, new Rectangle(rc.Left, rc.Top, Math.Max(1, rc.Right - rc.Left), Math.Max(1, rc.Bottom - rc.Top)), false, IsIconic(ptr));
            }
        }
        if (!string.IsNullOrWhiteSpace(titleQuery))
        {
            string q = titleQuery.Trim();
            return windows.FirstOrDefault(w => w.Title.Contains(q, StringComparison.OrdinalIgnoreCase))
                ?? windows.FirstOrDefault(w => w.ProcessName.Contains(q, StringComparison.OrdinalIgnoreCase));
        }
        return null;
    }

    public static int RunListWindows()
    {
        try
        {
            SetProcessDPIAware();
            var screens = Screen.AllScreens;
            var monitors = screens.Select((s, idx) => new
            {
                index = idx,
                primary = s.Primary,
                deviceName = s.DeviceName,
                bounds = new { x = s.Bounds.X, y = s.Bounds.Y, width = s.Bounds.Width, height = s.Bounds.Height },
            }).ToArray();

            var windows = EnumerateVisibleWindows().Select(w => new
            {
                hwnd = w.Hwnd,
                title = w.Title,
                processName = w.ProcessName,
                pid = w.Pid,
                active = w.Active,
                minimized = w.Minimized,
                bounds = new { x = w.Bounds.X, y = w.Bounds.Y, width = w.Bounds.Width, height = w.Bounds.Height },
            }).ToArray();

            Console.Out.Write(JsonSerializer.Serialize(new { monitors, windows }));
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.Write(ex.Message);
            return 1;
        }
    }

    public static int RunScreenshot(string outputPath, string? base64Options = null)
    {
        try
        {
            SetProcessDPIAware();
            long targetHwnd = 0;
            string? windowTitle = null;
            string? monitorMode = null;
            int? monitorIndex = null;
            Rectangle? region = null;

            if (!string.IsNullOrWhiteSpace(base64Options))
            {
                string optJson = Encoding.UTF8.GetString(Convert.FromBase64String(base64Options));
                using var doc = JsonDocument.Parse(optJson);
                var root = doc.RootElement;
                if (root.TryGetProperty("hwnd", out var hEl) && hEl.ValueKind == JsonValueKind.Number) targetHwnd = hEl.GetInt64();
                if (root.TryGetProperty("windowTitle", out var wtEl) && wtEl.ValueKind == JsonValueKind.String) windowTitle = wtEl.GetString();
                if (root.TryGetProperty("monitor", out var mEl))
                {
                    if (mEl.ValueKind == JsonValueKind.String) monitorMode = mEl.GetString();
                    else if (mEl.ValueKind == JsonValueKind.Number) monitorIndex = mEl.GetInt32();
                }
                if (root.TryGetProperty("region", out var rEl) && rEl.ValueKind == JsonValueKind.Object)
                {
                    int rx = rEl.TryGetProperty("x", out var xE) ? xE.GetInt32() : 0;
                    int ry = rEl.TryGetProperty("y", out var yE) ? yE.GetInt32() : 0;
                    int rw = rEl.TryGetProperty("width", out var wE) ? Math.Max(16, wE.GetInt32()) : 800;
                    int rh = rEl.TryGetProperty("height", out var hE2) ? Math.Max(16, hE2.GetInt32()) : 600;
                    region = new Rectangle(rx, ry, rw, rh);
                }
            }

            Rectangle bounds;
            string scope = "monitor";
            string? capturedWindowTitle = null;
            int? capturedMonitor = 0;
            Bitmap raw;

            if (targetHwnd != 0 || !string.IsNullOrWhiteSpace(windowTitle))
            {
                var win = FindWindow(targetHwnd, windowTitle)
                    ?? throw new InvalidOperationException($"Window not found ({windowTitle ?? targetHwnd.ToString()}). Call desktop_windows first to list visible windows.");
                bounds = win.Bounds;
                scope = "window";
                capturedWindowTitle = win.Title;
                capturedMonitor = null;
                raw = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb);
                using (var g = Graphics.FromImage(raw))
                {
                    IntPtr hdc = g.GetHdc();
                    bool printed = false;
                    try { printed = PrintWindow(new IntPtr(win.Hwnd), hdc, PW_RENDERFULLCONTENT); }
                    finally { g.ReleaseHdc(hdc); }
                    if (!printed)
                    {
                        g.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);
                    }
                }
            }
            else if (region.HasValue)
            {
                bounds = region.Value;
                scope = "region";
                capturedMonitor = null;
                raw = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb);
                using (var g = Graphics.FromImage(raw))
                {
                    g.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);
                }
            }
            else
            {
                var all = Screen.AllScreens;
                if (string.Equals(monitorMode, "all", StringComparison.OrdinalIgnoreCase))
                {
                    bounds = SystemInformation.VirtualScreen;
                    scope = "all-monitors";
                    capturedMonitor = null;
                }
                else if (monitorIndex.HasValue && monitorIndex.Value >= 0 && monitorIndex.Value < all.Length)
                {
                    bounds = all[monitorIndex.Value].Bounds;
                    capturedMonitor = monitorIndex.Value;
                }
                else
                {
                    bounds = Screen.PrimaryScreen?.Bounds ?? new Rectangle(0, 0, 1920, 1080);
                    capturedMonitor = Array.FindIndex(all, s => s.Primary);
                    if (capturedMonitor < 0) capturedMonitor = 0;
                }
                raw = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb);
                using (var g = Graphics.FromImage(raw))
                {
                    g.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);
                }
            }

            using (raw)
            {
                const double maxW = 1920.0;
                double scale = bounds.Width > maxW ? bounds.Width / maxW : 1.0;
                int tw = (int)Math.Round(bounds.Width / scale);
                int th = (int)Math.Round(bounds.Height / scale);

                Bitmap target = raw;
                Bitmap? resized = null;
                try
                {
                    if (scale > 1.0)
                    {
                        resized = new Bitmap(tw, th, PixelFormat.Format24bppRgb);
                        using var ng = Graphics.FromImage(resized);
                        ng.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        ng.DrawImage(raw, 0, 0, tw, th);
                        target = resized;
                    }

                    var jpegCodec = ImageCodecInfo.GetImageEncoders().FirstOrDefault(c => c.MimeType == "image/jpeg");
                    if (jpegCodec != null)
                    {
                        using var ep = new EncoderParameters(1);
                        ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 82L);
                        target.Save(outputPath, jpegCodec, ep);
                    }
                    else
                    {
                        target.Save(outputPath, ImageFormat.Jpeg);
                    }
                }
                finally
                {
                    resized?.Dispose();
                }

                Console.Out.Write(JsonSerializer.Serialize(new
                {
                    physicalWidth = bounds.Width,
                    physicalHeight = bounds.Height,
                    imageWidth = tw,
                    imageHeight = th,
                    scaleFactor = Math.Round(scale, 4),
                    origin = new { x = bounds.X, y = bounds.Y },
                    scope,
                    windowTitle = capturedWindowTitle,
                    monitor = capturedMonitor,
                }));
            }
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.Write(ex.Message);
            return 1;
        }
    }

    public static int RunDesktopAction(string base64Payload)
    {
        try
        {
            SetProcessDPIAware();
            string json = Encoding.UTF8.GetString(Convert.FromBase64String(base64Payload));
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            string action = root.TryGetProperty("action", out var aEl) ? aEl.GetString() ?? "" : "";

            switch (action)
            {
                case "validate":
                    break;
                case "focus_window":
                {
                    long hwnd = root.TryGetProperty("hwnd", out var hEl) && hEl.ValueKind == JsonValueKind.Number ? hEl.GetInt64() : 0;
                    string? title = root.TryGetProperty("windowTitle", out var wtEl) && wtEl.ValueKind == JsonValueKind.String ? wtEl.GetString() : null;
                    var win = FindWindow(hwnd, title)
                        ?? throw new InvalidOperationException("Target window not found.");
                    IntPtr ptr = new(win.Hwnd);
                    if (IsIconic(ptr)) ShowWindow(ptr, SW_RESTORE);
                    SetForegroundWindow(ptr);
                    break;
                }
                case "move":
                {
                    if (!root.TryGetProperty("x", out var xEl) || !root.TryGetProperty("y", out var yEl))
                        throw new InvalidOperationException("Coordinates x and y are required.");
                    SetCursorPos(xEl.GetInt32(), yEl.GetInt32());
                    break;
                }
                case "drag":
                {
                    if (!root.TryGetProperty("x", out var xEl) || !root.TryGetProperty("y", out var yEl)
                        || !root.TryGetProperty("toX", out var txEl) || !root.TryGetProperty("toY", out var tyEl))
                        throw new InvalidOperationException("drag requires x, y, toX, and toY coordinates.");
                    int sx = xEl.GetInt32(), sy = yEl.GetInt32(), ex = txEl.GetInt32(), ey = tyEl.GetInt32();
                    SetCursorPos(sx, sy);
                    Thread.Sleep(40);
                    SendMouse(MOUSEEVENTF_LEFTDOWN, 0);
                    const int steps = 12;
                    for (int i = 1; i <= steps; i++)
                    {
                        int nx = sx + (ex - sx) * i / steps;
                        int ny = sy + (ey - sy) * i / steps;
                        SetCursorPos(nx, ny);
                        Thread.Sleep(15);
                    }
                    SendMouse(MOUSEEVENTF_LEFTUP, 0);
                    break;
                }
                case "click":
                case "double_click":
                case "right_click":
                {
                    if (!root.TryGetProperty("x", out var xEl) || !root.TryGetProperty("y", out var yEl))
                        throw new InvalidOperationException("Coordinates x and y are required.");
                    SetCursorPos(xEl.GetInt32(), yEl.GetInt32());
                    if (action == "right_click")
                    {
                        SendMouse(MOUSEEVENTF_RIGHTDOWN, 0);
                        SendMouse(MOUSEEVENTF_RIGHTUP, 0);
                    }
                    else
                    {
                        SendMouse(MOUSEEVENTF_LEFTDOWN, 0);
                        SendMouse(MOUSEEVENTF_LEFTUP, 0);
                        if (action == "double_click")
                        {
                            Thread.Sleep(85);
                            SendMouse(MOUSEEVENTF_LEFTDOWN, 0);
                            SendMouse(MOUSEEVENTF_LEFTUP, 0);
                        }
                    }
                    break;
                }
                case "type":
                {
                    string text = root.TryGetProperty("text", out var tEl) ? tEl.GetString() ?? "" : "";
                    SendUnicodeText(text);
                    break;
                }
                case "key":
                {
                    string chord = root.TryGetProperty("text", out var kEl) ? (kEl.GetString() ?? "").Trim().ToUpperInvariant() : "";
                    SendKeyChord(chord);
                    break;
                }
                case "scroll":
                {
                    int amount = root.TryGetProperty("amount", out var amEl) ? Math.Clamp(amEl.GetInt32(), -20, 20) : 0;
                    SendMouse(MOUSEEVENTF_WHEEL, unchecked((uint)(amount * 120)));
                    break;
                }
                default:
                    throw new InvalidOperationException("Unsupported desktop action: " + action);
            }

            Console.Out.Write("{\"ok\":true}");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.Write(ex.Message);
            return 1;
        }
    }

    private static void SendMouse(uint flags, uint mouseData)
    {
        var inputs = new[]
        {
            new INPUT { type = INPUT_MOUSE, U = new InputUnion { mi = new MOUSEINPUT { dwFlags = flags, mouseData = mouseData } } }
        };
        SendInput(1, inputs, Marshal.SizeOf<INPUT>());
    }

    private static void SendUnicodeText(string text)
    {
        foreach (char ch in text)
        {
            if (ch == '\r') continue;
            if (ch == '\n')
            {
                SendKeyChord("ENTER");
                continue;
            }
            var pair = new[]
            {
                new INPUT { type = INPUT_KEYBOARD, U = new InputUnion { ki = new KEYBDINPUT { wScan = ch, dwFlags = KEYEVENTF_UNICODE } } },
                new INPUT { type = INPUT_KEYBOARD, U = new InputUnion { ki = new KEYBDINPUT { wScan = ch, dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP } } },
            };
            SendInput(2, pair, Marshal.SizeOf<INPUT>());
        }
    }

    private static void SendKeyChord(string chord)
    {
        if (string.IsNullOrWhiteSpace(chord)) throw new InvalidOperationException("Empty key chord.");
        var parts = chord.Split('+', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var vks = new List<ushort>();
        foreach (var part in parts)
        {
            ushort vk = part switch
            {
                "CTRL" or "CONTROL" => 0x11,
                "ALT" => 0x12,
                "SHIFT" => 0x10,
                "WIN" or "META" => 0x5B,
                "ENTER" or "RETURN" => 0x0D,
                "TAB" => 0x09,
                "ESC" or "ESCAPE" => 0x1B,
                "SPACE" => 0x20,
                "BACKSPACE" or "BS" => 0x08,
                "DELETE" or "DEL" => 0x2E,
                "UP" => 0x26,
                "DOWN" => 0x28,
                "LEFT" => 0x25,
                "RIGHT" => 0x27,
                "HOME" => 0x24,
                "END" => 0x23,
                "PGUP" or "PAGEUP" => 0x21,
                "PGDN" or "PAGEDOWN" => 0x22,
                "F1" => 0x70, "F2" => 0x71, "F3" => 0x72, "F4" => 0x73,
                "F5" => 0x74, "F6" => 0x75, "F7" => 0x76, "F8" => 0x77,
                "F9" => 0x78, "F10" => 0x79, "F11" => 0x7A, "F12" => 0x7B,
                _ when part.Length == 1 && part[0] is >= 'A' and <= 'Z' => (ushort)part[0],
                _ when part.Length == 1 && part[0] is >= '0' and <= '9' => (ushort)part[0],
                _ => throw new InvalidOperationException("Unsupported key in chord: " + part),
            };
            vks.Add(vk);
        }

        var extended = new HashSet<ushort> { 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2E, 0x5B };
        var seq = new List<INPUT>(vks.Count * 2);
        foreach (var vk in vks)
        {
            uint flags = extended.Contains(vk) ? KEYEVENTF_EXTENDEDKEY : 0;
            ushort scan = (ushort)MapVirtualKey(vk, 0);
            seq.Add(new INPUT { type = INPUT_KEYBOARD, U = new InputUnion { ki = new KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags } } });
        }
        for (int i = vks.Count - 1; i >= 0; i--)
        {
            ushort vk = vks[i];
            uint flags = KEYEVENTF_KEYUP | (extended.Contains(vk) ? KEYEVENTF_EXTENDEDKEY : 0);
            ushort scan = (ushort)MapVirtualKey(vk, 0);
            seq.Add(new INPUT { type = INPUT_KEYBOARD, U = new InputUnion { ki = new KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags } } });
        }

        var arr = seq.ToArray();
        SendInput((uint)arr.Length, arr, Marshal.SizeOf<INPUT>());
    }
}
