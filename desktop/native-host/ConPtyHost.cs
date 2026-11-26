using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace NexusHost;

/// <summary>
/// Pure Win32 ConPTY (CreatePseudoConsole) terminal host for NEXUS.
/// Zero Electron, zero native Node addons — runs real interactive PowerShell/CMD/TUI sessions
/// with true VT100/ANSI sequences, Tab completion, arrow keys, Ctrl+C, and dynamic resize.
/// </summary>
internal sealed class ConPtyManager : IDisposable
{
    private readonly ConcurrentDictionary<string, ConPtySession> _sessions = new();
    private readonly Action<object> _emitEvent;
    private bool _disposed;

    public ConPtyManager(Action<object> emitEvent)
    {
        _emitEvent = emitEvent;
    }

    public object Create(string? cwd, string? title, int cols = 120, int rows = 30)
    {
        string id = "conpty-" + Guid.NewGuid().ToString("N")[..8];
        string workDir = !string.IsNullOrWhiteSpace(cwd) && Directory.Exists(cwd)
            ? cwd
            : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var session = ConPtySession.Start(
            id,
            string.IsNullOrWhiteSpace(title) ? "PowerShell (ConPTY)" : title,
            workDir,
            (short)Math.Clamp(cols, 40, 320),
            (short)Math.Clamp(rows, 10, 120),
            chunk => _emitEvent(new { type = "data", id, stream = "stdout", chunk, conpty = true }),
            code => _emitEvent(new { type = "exit", id, exitCode = code, conpty = true })
        );
        _sessions[id] = session;
        return session.Serialize(includeBuffer: true);
    }

    public object Write(string id, string data)
    {
        if (!_sessions.TryGetValue(id, out var session))
            throw new InvalidOperationException("ConPTY session not found: " + id);
        session.Write(data);
        return new { ok = true };
    }

    public object Resize(string id, int cols, int rows)
    {
        if (!_sessions.TryGetValue(id, out var session))
            throw new InvalidOperationException("ConPTY session not found: " + id);
        session.Resize((short)Math.Clamp(cols, 40, 320), (short)Math.Clamp(rows, 10, 120));
        return new { ok = true };
    }

    public object Interrupt(string id)
    {
        if (!_sessions.TryGetValue(id, out var session))
            throw new InvalidOperationException("ConPTY session not found: " + id);
        session.Write("\x03");
        return new { ok = true };
    }

    public object ClearBuffer(string id)
    {
        if (!_sessions.TryGetValue(id, out var session))
            throw new InvalidOperationException("ConPTY session not found: " + id);
        session.ClearBuffer();
        return new { ok = true };
    }

    public object Get(string id)
    {
        if (!_sessions.TryGetValue(id, out var session))
            throw new InvalidOperationException("ConPTY session not found: " + id);
        return session.Serialize(includeBuffer: true);
    }

    public object List() => _sessions.Values.Select(s => s.Serialize(includeBuffer: false)).ToArray();

    public object Close(string id)
    {
        if (!_sessions.TryRemove(id, out var session)) return new { closed = false, id };
        session.Dispose();
        return new { closed = true, id };
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        foreach (var kv in _sessions)
        {
            try { kv.Value.Dispose(); } catch { }
        }
        _sessions.Clear();
    }
}

internal sealed class ConPtySession : IDisposable
{
    private const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    private static readonly IntPtr PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = new(0x00020016);
    private const uint WAIT_OBJECT_0 = 0x00000000;
    private const uint INFINITE = 0xFFFFFFFF;

    [StructLayout(LayoutKind.Sequential)]
    private struct COORD { public short X; public short Y; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string? lpReserved;
        public string? lpDesktop;
        public string? lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFOEX
    {
        public STARTUPINFO StartupInfo;
        public IntPtr lpAttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CreatePipe(out SafeFileHandle hReadPipe, out SafeFileHandle hWritePipe, IntPtr lpPipeAttributes, int nSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern int CreatePseudoConsole(COORD size, SafeFileHandle hInput, SafeFileHandle hOutput, uint dwFlags, out IntPtr phPC);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern int ResizePseudoConsole(IntPtr hPC, COORD size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern void ClosePseudoConsole(IntPtr hPC);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool InitializeProcThreadAttributeList(IntPtr lpAttributeList, int dwAttributeCount, int dwFlags, ref IntPtr lpSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateProcThreadAttribute(IntPtr lpAttributeList, uint dwFlags, IntPtr Attribute, IntPtr lpValue, IntPtr cbSize, IntPtr lpPreviousValue, IntPtr lpReturnSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern void DeleteProcThreadAttributeList(IntPtr lpAttributeList);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessW(
        string? lpApplicationName,
        string lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string? lpCurrentDirectory,
        ref STARTUPINFOEX lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr hProcess, uint uExitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    public string Id { get; }
    public string Title { get; }
    public string Cwd { get; }
    public int Pid { get; }
    public string CreatedAt { get; } = DateTime.UtcNow.ToString("O");
    public string Status { get; private set; } = "running";
    public int? ExitCode { get; private set; }

    private IntPtr _hPC;
    private IntPtr _hProcess;
    private IntPtr _hThread;
    private readonly FileStream _inputStream;
    private readonly FileStream _outputStream;
    private readonly object _bufLock = new();
    private readonly StringBuilder _buffer = new();
    private bool _disposed;

    private ConPtySession(string id, string title, string cwd, int pid, IntPtr hPC, IntPtr hProcess, IntPtr hThread, SafeFileHandle inputWrite, SafeFileHandle outputRead, Action<string> onData, Action<int> onExit)
    {
        Id = id;
        Title = title;
        Cwd = cwd;
        Pid = pid;
        _hPC = hPC;
        _hProcess = hProcess;
        _hThread = hThread;
        _inputStream = new FileStream(inputWrite, FileAccess.Write, 4096, isAsync: false);
        _outputStream = new FileStream(outputRead, FileAccess.Read, 4096, isAsync: false);

        Task.Run(() => ReadLoop(onData));
        Task.Run(() => WaitExitLoop(onExit));
    }

    public static ConPtySession Start(string id, string title, string cwd, short cols, short rows, Action<string> onData, Action<int> onExit)
    {
        if (!CreatePipe(out var ptyInputRead, out var ptyInputWrite, IntPtr.Zero, 0))
            throw new InvalidOperationException("ConPTY CreatePipe(in) failed: " + Marshal.GetLastWin32Error());
        if (!CreatePipe(out var ptyOutputRead, out var ptyOutputWrite, IntPtr.Zero, 0))
        {
            ptyInputRead.Dispose();
            ptyInputWrite.Dispose();
            throw new InvalidOperationException("ConPTY CreatePipe(out) failed: " + Marshal.GetLastWin32Error());
        }

        int hr = CreatePseudoConsole(new COORD { X = cols, Y = rows }, ptyInputRead, ptyOutputWrite, 0, out IntPtr hPC);
        if (hr != 0)
        {
            ptyInputRead.Dispose(); ptyInputWrite.Dispose();
            ptyOutputRead.Dispose(); ptyOutputWrite.Dispose();
            throw new InvalidOperationException($"CreatePseudoConsole failed (HRESULT 0x{hr:X8}).");
        }

        IntPtr attrSize = IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attrSize);
        IntPtr attrList = Marshal.AllocHGlobal(attrSize);
        bool attrInit = false;
        try
        {
            if (!InitializeProcThreadAttributeList(attrList, 1, 0, ref attrSize))
                throw new InvalidOperationException("InitializeProcThreadAttributeList failed: " + Marshal.GetLastWin32Error());
            attrInit = true;
            if (!UpdateProcThreadAttribute(attrList, 0, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, hPC, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero))
                throw new InvalidOperationException("UpdateProcThreadAttribute failed: " + Marshal.GetLastWin32Error());

            var startupInfo = new STARTUPINFOEX
            {
                StartupInfo = new STARTUPINFO { cb = Marshal.SizeOf<STARTUPINFOEX>() },
                lpAttributeList = attrList,
            };

            string cmdLine = "powershell.exe -NoLogo";
            if (!CreateProcessW(null, cmdLine, IntPtr.Zero, IntPtr.Zero, false, EXTENDED_STARTUPINFO_PRESENT, IntPtr.Zero, cwd, ref startupInfo, out var procInfo))
                throw new InvalidOperationException("ConPTY CreateProcessW failed: " + Marshal.GetLastWin32Error());

            // Child-owned pipe ends must be closed in the parent so output EOF triggers cleanly on exit
            ptyInputRead.Dispose();
            ptyOutputWrite.Dispose();

            return new ConPtySession(id, title, cwd, procInfo.dwProcessId, hPC, procInfo.hProcess, procInfo.hThread, ptyInputWrite, ptyOutputRead, onData, onExit);
        }
        catch
        {
            ClosePseudoConsole(hPC);
            ptyInputRead.Dispose(); ptyInputWrite.Dispose();
            ptyOutputRead.Dispose(); ptyOutputWrite.Dispose();
            throw;
        }
        finally
        {
            if (attrInit) DeleteProcThreadAttributeList(attrList);
            Marshal.FreeHGlobal(attrList);
        }
    }

    private void ReadLoop(Action<string> onData)
    {
        var raw = new byte[4096];
        var chars = new char[4096];
        var decoder = Encoding.UTF8.GetDecoder();
        try
        {
            while (!_disposed)
            {
                int read = _outputStream.Read(raw, 0, raw.Length);
                if (read <= 0) break;
                int charCount = decoder.GetChars(raw, 0, read, chars, 0);
                if (charCount <= 0) continue;
                string chunk = new(chars, 0, charCount);
                lock (_bufLock)
                {
                    _buffer.Append(chunk);
                    if (_buffer.Length > 120_000) _buffer.Remove(0, _buffer.Length - 120_000);
                }
                onData(chunk);
            }
        }
        catch { }
    }

    private void WaitExitLoop(Action<int> onExit)
    {
        try
        {
            if (_hProcess != IntPtr.Zero && WaitForSingleObject(_hProcess, INFINITE) == WAIT_OBJECT_0)
            {
                uint code = 0;
                GetExitCodeProcess(_hProcess, out code);
                Status = "exited";
                ExitCode = unchecked((int)code);
                onExit(ExitCode.Value);
            }
        }
        catch { }
    }

    public void Write(string data)
    {
        if (_disposed || Status != "running") return;
        byte[] bytes = Encoding.UTF8.GetBytes(data);
        lock (_inputStream)
        {
            _inputStream.Write(bytes, 0, bytes.Length);
            _inputStream.Flush();
        }
    }

    public void Resize(short cols, short rows)
    {
        if (_disposed || _hPC == IntPtr.Zero) return;
        ResizePseudoConsole(_hPC, new COORD { X = cols, Y = rows });
    }

    public void ClearBuffer()
    {
        lock (_bufLock) _buffer.Clear();
    }

    public object Serialize(bool includeBuffer)
    {
        string? buf = null;
        if (includeBuffer)
        {
            lock (_bufLock) buf = _buffer.ToString();
        }
        return new
        {
            id = Id,
            title = Title,
            cwd = Cwd,
            pid = Pid,
            status = Status,
            exitCode = ExitCode,
            createdAt = CreatedAt,
            conpty = true,
            buffer = buf,
        };
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        Status = "closed";
        try { if (_hProcess != IntPtr.Zero) TerminateProcess(_hProcess, 0); } catch { }
        try { if (_hPC != IntPtr.Zero) { ClosePseudoConsole(_hPC); _hPC = IntPtr.Zero; } } catch { }
        try { _inputStream.Dispose(); } catch { }
        try { _outputStream.Dispose(); } catch { }
        try { if (_hThread != IntPtr.Zero) { CloseHandle(_hThread); _hThread = IntPtr.Zero; } } catch { }
        try { if (_hProcess != IntPtr.Zero) { CloseHandle(_hProcess); _hProcess = IntPtr.Zero; } } catch { }
    }
}
