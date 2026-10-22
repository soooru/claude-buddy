# Claude Buddy - bring the window (and tab) that hosts a Claude Code session to the front.
#
#   focus.ps1 <pid> -ChainOnly                print the ancestor PIDs, one per line (used by the IDE extension)
#   focus.ps1 <pid> [-Pids a,b,c] [-TitleHint name]
#
# Strategy:
#   1. Console route - attach to the session's console. Windows Terminal owns the pseudo console window,
#      so its owner is the terminal window even when the process tree is broken (default-terminal handoff).
#      The right tab is found by briefly setting the console title to a unique marker and selecting the
#      tab with that name through UI Automation; the title is restored right away. Plain console windows
#      (conhost) are brought up directly.
#   2. Process route - walk up the parent processes to the first one with a window (IDEs such as Cursor,
#      VS Code, IntelliJ). For multi-window IDEs -TitleHint (workspace name) picks the window.
#      In other hosts the marker trick is tried as well to pick a terminal tab.
#
# Output: "OK|<window title>|<tab>" , "BLOCKED|<window title>|" (Windows refused focus) or "NOTFOUND".
# Keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less scripts in the system code page).
param([int]$SessionPid, [switch]$ChainOnly, [string]$TitleHint, [string]$Pids)

$chain = @()
if ($Pids) {
  $chain = $Pids -split ',' | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ }
} else {
  $p = $SessionPid
  for ($i = 0; $i -lt 12 -and $p; $i++) {
    $c = Get-CimInstance Win32_Process -Filter "ProcessId=$p"
    if (-not $c -or $c.Name -eq 'explorer.exe') { break }
    $chain += $p
    $p = $c.ParentProcessId
  }
}
if ($ChainOnly) { $chain; exit 0 }

# Compiling C# takes over a second, so build once and reuse. Bump the file name when the code changes.
$dll = Join-Path $PSScriptRoot 'buddy-win-v3.dll'
if (-not (Test-Path $dll)) {
  Add-Type -OutputAssembly $dll -OutputType Library -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, WindowsBase @"
using System;
using System.Text;
using System.Threading;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows.Automation;

public static class BuddyWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr h, bool altTab);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll")] static extern bool FreeConsole();
  [DllImport("kernel32.dll")] static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern uint GetConsoleTitle(StringBuilder sb, uint n);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool SetConsoleTitle(string t);

  public static string Title(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString().Replace("|", "/"); }
  static string Cls(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }

  // Windows blocks background processes from stealing focus. Attach to the foreground thread's
  // input queue so the call counts as coming from it; fall back to a simulated Alt press.
  public static bool Bring(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);
    IntPtr fg = GetForegroundWindow();
    if (fg == h) return true;
    uint dummy;
    uint fgThread = GetWindowThreadProcessId(fg, out dummy);
    uint me = GetCurrentThreadId();
    bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
    BringWindowToTop(h);
    SetForegroundWindow(h);
    if (attached) AttachThreadInput(me, fgThread, false);
    Thread.Sleep(80);
    if (GetForegroundWindow() == h) return true;
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    SetForegroundWindow(h);
    SwitchToThisWindow(h, true);
    Thread.Sleep(80);
    return GetForegroundWindow() == h;
  }

  public static IntPtr FindByTitle(HashSet<uint> pids, string hint) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (!pids.Contains(pid)) return true;
      if (Title(h).Contains(hint)) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  // Select the tab of window 'root' whose name contains 'marker'. Returns "tab" or null.
  static string SelectTab(IntPtr root, string marker) {
    try {
      var tabs = AutomationElement.FromHandle(root).FindAll(TreeScope.Descendants,
        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.TabItem));
      foreach (AutomationElement t in tabs) {
        if (!t.Current.Name.Contains(marker)) continue;
        object p;
        if (t.TryGetCurrentPattern(SelectionItemPattern.Pattern, out p)) ((SelectionItemPattern)p).Select();
        return "tab";
      }
    } catch { }
    return null;
  }

  // Attach to the session's console. Returns the window to raise (terminal or console window), or Zero.
  // When a tab host is known (found here, or 'tabHost'), selects the matching tab. Always detaches
  // and restores the console title.
  public static IntPtr ViaConsole(uint pid, IntPtr tabHost, out string tab) {
    tab = null;
    IntPtr target = IntPtr.Zero;
    FreeConsole();
    if (!AttachConsole(pid)) return IntPtr.Zero;
    var old = new StringBuilder(2048);
    bool changed = false;
    try {
      IntPtr con = GetConsoleWindow();
      if (con == IntPtr.Zero) return IntPtr.Zero;
      if (Cls(con) == "ConsoleWindowClass") return con;                    // classic console window
      IntPtr owner = GetAncestor(con, 3);                                    // GA_ROOTOWNER
      if (owner != IntPtr.Zero && owner != con) target = owner;              // Windows Terminal
      IntPtr host = target != IntPtr.Zero ? target : tabHost;
      if (host == IntPtr.Zero) return target;
      GetConsoleTitle(old, 2048);
      string marker = "@@claude-buddy-" + Guid.NewGuid().ToString("N").Substring(0, 8);
      changed = SetConsoleTitle(marker);
      for (int i = 0; i < 6 && tab == null; i++) { Thread.Sleep(80); tab = SelectTab(host, marker); }
      return target;
    } finally {
      if (changed) SetConsoleTitle(old.ToString());
      FreeConsole();
    }
  }
}
"@
}
Add-Type -Path $dll

function Out-Result([IntPtr]$h, [string]$tab) {
  $ok = [BuddyWin]::Bring($h)
  $status = if ($ok) { 'OK' } else { 'BLOCKED' }
  "$status|$([BuddyWin]::Title($h))|$tab"
}

# 1. console route (Windows Terminal tabs, classic console windows)
$tab = $null
$win = [BuddyWin]::ViaConsole([uint32]$SessionPid, [IntPtr]::Zero, [ref]$tab)
if ($win -ne [IntPtr]::Zero) { Out-Result $win $tab; exit 0 }

# 2. process route (IDEs)
foreach ($id in $chain) {
  $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
  if (-not $proc -or $proc.MainWindowHandle -eq 0) { continue }
  $h = $proc.MainWindowHandle
  if ($TitleHint) {
    # Multi-window IDEs (Cursor, VS Code): the extension already showed the terminal; pick the window.
    $set = New-Object 'System.Collections.Generic.HashSet[uint32]'
    Get-Process -Name $proc.ProcessName -ErrorAction SilentlyContinue | ForEach-Object { [void]$set.Add([uint32]$_.Id) }
    $byTitle = [BuddyWin]::FindByTitle($set, " - $TitleHint")
    if ($byTitle -ne [IntPtr]::Zero) { $h = $byTitle }
    Out-Result $h 'terminal'; exit 0
  }
  # Other IDEs (IntelliJ ...): try to pick the terminal tab with the same marker trick.
  $tab = $null
  [void][BuddyWin]::ViaConsole([uint32]$SessionPid, $h, [ref]$tab)
  Out-Result $h $tab
  exit 0
}
"NOTFOUND"
