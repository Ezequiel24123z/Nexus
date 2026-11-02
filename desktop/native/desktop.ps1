param([Parameter(Mandatory=$true)][string]$Payload)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NexusInput {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION data; }
  [StructLayout(LayoutKind.Explicit)] public struct UNION {
    [FieldOffset(0)] public MOUSEINPUT mouse;
    [FieldOffset(0)] public KEYBDINPUT keyboard;
  }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint flags; public uint time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort key; public ushort scan; public uint flags; public uint time; public UIntPtr extra; }
  public static void Type(string text) {
    foreach (char character in text) {
      INPUT down = new INPUT { type=1, data = new UNION { keyboard = new KEYBDINPUT { scan=character, flags=4 } } };
      INPUT up = new INPUT { type=1, data = new UNION { keyboard = new KEYBDINPUT { scan=character, flags=6 } } };
      if(SendInput(2,new INPUT[]{down,up},Marshal.SizeOf(typeof(INPUT))) != 2) throw new Exception("Windows rechazó la entrada.");
    }
  }
}
'@
$nexusAction = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json
[void][NexusInput]::SetProcessDPIAware()
switch ($nexusAction.action) {
  'validate' { }
  { $_ -in 'click','double_click' } {
    if ($null -eq $nexusAction.x -or $null -eq $nexusAction.y) { throw 'Se requieren coordenadas.' }
    [void][NexusInput]::SetCursorPos([int]$nexusAction.x,[int]$nexusAction.y)
    [NexusInput]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
    [NexusInput]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
    if($nexusAction.action -eq 'double_click') {
      Start-Sleep -Milliseconds 90
      [NexusInput]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
      [NexusInput]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
    }
  }
  'type' { [NexusInput]::Type([string]$nexusAction.text) }
  'key' {
    $nexusKeys = @{ ENTER='{ENTER}'; TAB='{TAB}'; ESC='{ESC}'; 'CTRL+A'='^a'; 'CTRL+C'='^c'; 'CTRL+V'='^v'; 'ALT+TAB'='%{TAB}'; BACKSPACE='{BACKSPACE}'; DELETE='{DELETE}'; UP='{UP}'; DOWN='{DOWN}'; LEFT='{LEFT}'; RIGHT='{RIGHT}' }
    if (-not $nexusKeys.ContainsKey([string]$nexusAction.text)) { throw 'Tecla no admitida' }
    [Windows.Forms.SendKeys]::SendWait($nexusKeys[[string]$nexusAction.text])
  }
  'scroll' {
    $nexusAmount = [Math]::Min(10,[Math]::Max(-10,[int]$nexusAction.amount))
    [NexusInput]::mouse_event(2048,0,0,($nexusAmount*120),[UIntPtr]::Zero)
  }
  default { throw 'Acción desconocida' }
}
Write-Output '{"ok":true}'
