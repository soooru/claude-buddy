# Claude Buddy status line (Windows PowerShell 5.1+)
#
# Claude Code runs this with the status JSON on stdin. It does two things:
#   1. Saves account usage (rate_limits) to <data>\usage.json so the Claude Buddy widget can show it.
#   2. Prints a status line:
#        - if the user had a status line before connecting Claude Buddy, that command is run
#          with the same stdin and its output is passed through unchanged;
#        - otherwise a small built-in line is printed (model / folder / context, 5h / 7d usage).
#
# It never sends anything over the network.
# Keep this file ASCII-only: PowerShell 5.1 reads BOM-less scripts in the system code page.

$ErrorActionPreference = 'SilentlyContinue'
$utf8 = New-Object System.Text.UTF8Encoding $false
try { [Console]::InputEncoding = $utf8; [Console]::OutputEncoding = $utf8 } catch {}

$dataDir = Split-Path $PSScriptRoot -Parent
$raw = [Console]::In.ReadToEnd()
$d = $null
try { $d = $raw | ConvertFrom-Json } catch {}

# --- 1. save usage -------------------------------------------------------------------------
if ($d -and $d.rate_limits) {
  try {
    $usage = [ordered]@{ at = [DateTimeOffset]::Now.ToUnixTimeMilliseconds() }
    foreach ($k in 'five_hour', 'seven_day') {
      $r = $d.rate_limits.$k
      if ($r -and $r.used_percentage -ne $null) {
        $usage[$k] = [ordered]@{ used_percentage = [double]$r.used_percentage; resets_at = [long]$r.resets_at }
      }
    }
    # Overage estimate: once a limit is used up, every session's cost from that moment on is extra usage.
    # Each session's cost when it was first seen over the limit is kept as its baseline; the sum of
    # (current - baseline) is the estimate. It restarts when the limit window resets. Sessions on this PC only.
    $nowSec = [DateTimeOffset]::Now.ToUnixTimeSeconds()
    $overEpoch = 0
    foreach ($k in 'five_hour', 'seven_day') {
      $r = $d.rate_limits.$k
      if ($r -and [double]$r.used_percentage -ge 100 -and [long]$r.resets_at -gt $nowSec) { $overEpoch = [Math]::Max($overEpoch, [long]$r.resets_at) }
    }
    $ovFile = Join-Path $dataDir 'overage.json'
    if ($overEpoch -gt 0) {
      $sessions = @{}
      try {
        $ov = [System.IO.File]::ReadAllText($ovFile, $utf8) | ConvertFrom-Json
        if ([long]$ov.epoch -eq $overEpoch) { foreach ($p in $ov.sessions.PSObject.Properties) { $sessions[$p.Name] = @{ base = [double]$p.Value.base; cost = [double]$p.Value.cost } } }
      } catch {}
      $sid = [string]$d.session_id
      if ($sid -match '^[\w-]{1,80}$' -and $d.cost -and $d.cost.total_cost_usd -ne $null) {
        $cost = [double]$d.cost.total_cost_usd
        if (-not $sessions.ContainsKey($sid)) { $sessions[$sid] = @{ base = $cost; cost = $cost } } else { $sessions[$sid].cost = $cost }
      }
      $billed = 0.0
      foreach ($s in $sessions.Values) { $billed += [Math]::Max(0.0, $s.cost - $s.base) }
      $usage['billed'] = [Math]::Round($billed, 2)
      try {
        $tmpOv = Join-Path $dataDir ("overage.json.$PID.tmp")
        [System.IO.File]::WriteAllText($tmpOv, ([ordered]@{ epoch = $overEpoch; sessions = $sessions } | ConvertTo-Json -Depth 4 -Compress), $utf8)
        try { Move-Item -Force $tmpOv $ovFile -ErrorAction Stop } catch { Remove-Item -Force $tmpOv -ErrorAction SilentlyContinue }
      } catch {}
    } elseif (Test-Path $ovFile) {
      Remove-Item -Force $ovFile -ErrorAction SilentlyContinue
    }
    if ($usage.Count -gt 1) {
      $tmp = Join-Path $dataDir ("usage.json.$PID.tmp")
      [System.IO.File]::WriteAllText($tmp, ($usage | ConvertTo-Json -Depth 4 -Compress), $utf8)
      # Several sessions can refresh at the same moment; if another one holds the file, drop this write.
      try { Move-Item -Force $tmp (Join-Path $dataDir 'usage.json') -ErrorAction Stop }
      catch { Remove-Item -Force $tmp -ErrorAction SilentlyContinue }
    }
  } catch {}
}

# --- 2a. chain to the previous status line ---------------------------------------------------
$prevFile = Join-Path $dataDir 'prev-statusline.json'
if (Test-Path $prevFile) {
  try {
    $prev = [System.IO.File]::ReadAllText($prevFile, $utf8) | ConvertFrom-Json
    $cmd = [string]$prev.command
    if ($cmd) {
      # Claude Code runs status lines through Git Bash when it is installed, so do the same.
      $bash = $env:CLAUDE_CODE_GIT_BASH_PATH
      if (-not $bash -or -not (Test-Path $bash)) { $bash = Join-Path $env:ProgramFiles 'Git\bin\bash.exe' }
      $psi = New-Object System.Diagnostics.ProcessStartInfo
      if (Test-Path $bash) { $psi.FileName = $bash; $psi.Arguments = '-c "' + $cmd.Replace('\', '\\').Replace('"', '\"') + '"' }
      else { $psi.FileName = 'cmd.exe'; $psi.Arguments = '/d /s /c "' + $cmd + '"' }
      $psi.UseShellExecute = $false
      $psi.RedirectStandardInput = $true
      $psi.RedirectStandardOutput = $true
      $psi.CreateNoWindow = $true
      $psi.StandardOutputEncoding = $utf8
      $p = [System.Diagnostics.Process]::Start($psi)
      $in = New-Object System.IO.StreamWriter($p.StandardInput.BaseStream, $utf8)
      $in.Write($raw); $in.Close()
      $out = $p.StandardOutput.ReadToEndAsync()
      if ($p.WaitForExit(8000)) { [Console]::Out.Write($out.Result); exit 0 }
      try { $p.Kill() } catch {}
    }
  } catch {}
}

# --- 2b. built-in status line ------------------------------------------------------------------
if (-not $d) { exit 0 }
# PowerShell variable names are case-insensitive: keep these distinct from loop variables.
$e = [char]27
$RST = "$e[0m"; $DIM = "$e[38;5;245m"; $PINK = "$e[38;2;247;131;172m"
$GREEN = "$e[38;2;81;207;102m"; $YELLOW = "$e[38;2;252;196;25m"; $RED = "$e[38;2;250;82;82m"; $EMPTY = "$e[38;5;239m"
$FULL = [string][char]0x25B0; $HOLE = [string][char]0x25B1; $SEP = " $DIM" + [char]0x2502 + "$RST "

function Color($p) { if ($p -ge 85) { $RED } elseif ($p -ge 60) { $YELLOW } else { $GREEN } }
function Left($epoch) {
  if (-not $epoch) { return '' }
  $s = [long]$epoch - [DateTimeOffset]::Now.ToUnixTimeSeconds()
  if ($s -le 0) { return '' }
  if ($s -ge 86400) { return ('{0}d{1}h' -f [math]::Floor($s / 86400), [math]::Floor(($s % 86400) / 3600)) }
  if ($s -ge 3600) { return ('{0}h{1}m' -f [math]::Floor($s / 3600), [math]::Floor(($s % 3600) / 60)) }
  return ('{0}m' -f [math]::Max(1, [math]::Floor($s / 60)))
}
function Gauge($label, $pct, $reset) {
  $p = [int][math]::Max(0, [math]::Min(100, [math]::Round([double]$pct)))
  $n = [int][math]::Round($p / 10); if ($p -gt 0 -and $n -eq 0) { $n = 1 }
  $c = Color $p
  $s = "$DIM$label$RST $c" + ($FULL * $n) + "$EMPTY" + ($HOLE * (10 - $n)) + "$RST $c$p%$RST"
  if ($reset) { $s += " $DIM$reset$RST" }
  return $s
}

$model = if ($d.model.display_name) { [string]$d.model.display_name } else { 'Claude' }
$dir = if ($d.workspace.current_dir) { Split-Path ([string]$d.workspace.current_dir) -Leaf } else { '' }
$line1 = "$PINK$model$RST"
if ($dir) { $line1 += $SEP + $dir }
if ($d.context_window -and $d.context_window.used_percentage -ne $null) {
  $cp = [int][math]::Round([double]$d.context_window.used_percentage)
  $line1 += $SEP + "${DIM}ctx$RST " + (Color $cp) + "$cp%$RST"
}
$parts = @()
foreach ($k in @(@('five_hour', '5h'), @('seven_day', '7d'))) {
  $lim = $d.rate_limits.($k[0])
  if ($lim -and $lim.used_percentage -ne $null) { $parts += Gauge $k[1] $lim.used_percentage (Left $lim.resets_at) }
}
[Console]::Out.WriteLine($line1)
if ($parts.Count) { [Console]::Out.WriteLine($parts -join $SEP) }
