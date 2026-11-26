using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace NexusHost;

/// <summary>
/// Pure native C# Win32 desktop automation & screenshot helper invoked via:
///   NEXUS.exe --screenshot <outputJpgPath>
///   NEXUS.exe --desktop-action <base64JsonPayload>
/// Runs zero PowerShell scripts, avoiding AMSI/Defender false positives and reducing capture latency ~15x.
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

    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
    [DllImport("user32.dll")] private static extern uint MapVirtualKey(uint uCode, uint uMapType);
    private const uint KEYEVENTF_EXTENDEDKEY = 0x0001;

    public static int RunScreenshot(string outputPath)
    {
        try
        {
            SetProcessDPIAware();
            var bounds = Screen.PrimaryScreen?.Bounds ?? new Rectangle(0, 0, 1920, 1080);
            using var raw = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb);
            using (var g = Graphics.FromImage(raw))
            {
                g.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);
            }

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
            }));
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
