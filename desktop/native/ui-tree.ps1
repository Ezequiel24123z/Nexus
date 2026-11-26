param([Parameter(Mandatory=$true)][string]$Payload)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NexusWin32Uia {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@

[void][NexusWin32Uia]::SetProcessDPIAware()

$opts = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json
$maxDepth = if ($null -ne $opts.maxDepth) { [Math]::Min(24, [Math]::Max(1, [int]$opts.maxDepth)) } else { 14 }
$maxElements = if ($null -ne $opts.maxElements) { [Math]::Min(300, [Math]::Max(10, [int]$opts.maxElements)) } else { 120 }
$interactiveOnly = if ($null -ne $opts.interactiveOnly) { [bool]$opts.interactiveOnly } else { $true }
$query = if ($opts.query) { [string]$opts.query } else { '' }
$targetHwnd = if ($null -ne $opts.hwnd -and [long]$opts.hwnd -ne 0) { [IntPtr][long]$opts.hwnd } else { [IntPtr]::Zero }
$targetTitle = if ($opts.windowTitle) { [string]$opts.windowTitle } else { '' }
$deadline = [DateTime]::UtcNow.AddMilliseconds(4500)

$root = [System.Windows.Automation.AutomationElement]::RootElement
$targetEl = $null

if ($targetHwnd -ne [IntPtr]::Zero) {
  try { $targetEl = [System.Windows.Automation.AutomationElement]::FromHandle($targetHwnd) } catch { $targetEl = $null }
} elseif ($targetTitle) {
  $children = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($win in $children) {
    try {
      $name = $win.Current.Name
      $procName = ''
      try { $procName = (Get-Process -Id $win.Current.ProcessId -ErrorAction SilentlyContinue).ProcessName } catch {}
      if (($name -and $name.IndexOf($targetTitle, [StringComparison]::OrdinalIgnoreCase) -ge 0) -or
          ($procName -and $procName.IndexOf($targetTitle, [StringComparison]::OrdinalIgnoreCase) -ge 0)) {
        $targetEl = $win
        break
      }
    } catch {}
  }
} else {
  $fg = [NexusWin32Uia]::GetForegroundWindow()
  if ($fg -ne [IntPtr]::Zero) {
    try { $targetEl = [System.Windows.Automation.AutomationElement]::FromHandle($fg) } catch { $targetEl = $null }
  }
}

if ($null -eq $targetEl) {
  throw 'Target window was not found for UI Automation inspection. Call desktop_windows first to list active windows.'
}

$interactiveTypes = @(
  'ControlType.Button', 'ControlType.Edit', 'ControlType.Hyperlink', 'ControlType.MenuItem',
  'ControlType.TabItem', 'ControlType.CheckBox', 'ControlType.RadioButton', 'ControlType.ComboBox',
  'ControlType.ListItem', 'ControlType.TreeItem', 'ControlType.Slider', 'ControlType.SplitButton',
  'ControlType.Document', 'ControlType.Text'
)

$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$elements = New-Object System.Collections.Generic.List[object]

function Walk-UiaNode {
  param($node, [int]$depth)
  if ($null -eq $node -or $depth -gt $maxDepth -or $elements.Count -ge $maxElements -or [DateTime]::UtcNow -gt $deadline) { return }
  try {
    $cur = $node.Current
    $ct = $cur.ControlType.ProgrammaticName
    $shortType = $ct -replace '^ControlType\.', ''
    $name = if ($cur.Name) { $cur.Name.Trim() } else { '' }
    $autoId = if ($cur.AutomationId) { $cur.AutomationId.Trim() } else { '' }
    $rect = $cur.BoundingRectangle
    $hasRect = (-not $rect.IsEmpty) -and (-not [double]::IsInfinity($rect.Width)) -and ($rect.Width -gt 0) -and ($rect.Height -gt 0)
    $val = $null
    try {
      $vp = $null
      if ($node.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
        $rawVal = [string]$vp.Current.Value
        if ($rawVal) { $val = if ($rawVal.Length -gt 200) { $rawVal.Substring(0, 200) } else { $rawVal } }
      }
    } catch {}

    $keep = $depth -gt 0 -and $hasRect -and (-not $cur.IsOffscreen)
    if ($keep -and $interactiveOnly) {
      $keep = ($interactiveTypes -contains $ct) -and ($name -or $autoId -or $val)
    }
    if ($keep -and $query) {
      $hay = "$name $autoId $shortType $val"
      $keep = $hay.IndexOf($query, [StringComparison]::OrdinalIgnoreCase) -ge 0
    }
    if ($keep) {
      $x = [int][Math]::Round($rect.X)
      $y = [int][Math]::Round($rect.Y)
      $w = [int][Math]::Round($rect.Width)
      $h = [int][Math]::Round($rect.Height)
      $elements.Add([ordered]@{
        name = if ($name.Length -gt 140) { $name.Substring(0, 140) } else { $name }
        controlType = $shortType
        automationId = $autoId
        enabled = [bool]$cur.IsEnabled
        value = $val
        bounds = [ordered]@{ x = $x; y = $y; width = $w; height = $h }
        center = [ordered]@{ x = [int]($x + $w / 2); y = [int]($y + $h / 2) }
        depth = $depth
      })
    }

    if ($depth -lt $maxDepth -and $elements.Count -lt $maxElements -and [DateTime]::UtcNow -le $deadline) {
      $child = $walker.GetFirstChild($node)
      while ($null -ne $child -and $elements.Count -lt $maxElements -and [DateTime]::UtcNow -le $deadline) {
        Walk-UiaNode -node $child -depth ($depth + 1)
        $child = $walker.GetNextSibling($child)
      }
    }
  } catch {}
}

Walk-UiaNode -node $targetEl -depth 0

$winCur = $targetEl.Current
$winRect = $winCur.BoundingRectangle
$winProc = ''
try { $winProc = (Get-Process -Id $winCur.ProcessId -ErrorAction SilentlyContinue).ProcessName } catch {}

$result = [ordered]@{
  window = [ordered]@{
    hwnd = [long]$winCur.NativeWindowHandle
    title = [string]$winCur.Name
    processName = $winProc
    pid = [int]$winCur.ProcessId
    bounds = if (-not $winRect.IsEmpty) {
      [ordered]@{ x = [int][Math]::Round($winRect.X); y = [int][Math]::Round($winRect.Y); width = [int][Math]::Round($winRect.Width); height = [int][Math]::Round($winRect.Height) }
    } else { $null }
  }
  count = $elements.Count
  bounded = ($elements.Count -ge $maxElements)
  elements = $elements
}

[Console]::Out.Write(($result | ConvertTo-Json -Depth 6 -Compress))
