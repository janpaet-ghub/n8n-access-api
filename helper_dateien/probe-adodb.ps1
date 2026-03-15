#Version: 2026-02-27 02:00
<#
.SYNOPSIS
  Probes ADODB/ACE OLEDB availability on Windows 11 for node-adodb decisions.

.DESCRIPTION
  - Detects available Microsoft.ACE.OLEDB providers (12.0 / 16.0) via registry (x86/x64)
  - Checks cscript hosts:
      * 64-bit: C:\Windows\System32\cscript.exe
      * 32-bit: C:\Windows\SysWOW64\cscript.exe
    and tries to create ADODB.Connection + open an optional .accdb file.
  - Prints a summary and writes JSON report.

.PARAMETER DbPath
  Optional path to a .accdb to test opening a real database.

.PARAMETER OutJson
  Optional output JSON file path (default: .\adodb-probe-report.json)

.EXAMPLE
  .\probe-adodb.ps1

.EXAMPLE
  .\probe-adodb.ps1 -DbPath "D:\Farbspektrum\n8n\api\access\backend_db\backend.accdb"
#>

param(
  [Parameter(Mandatory=$false)]
  [string]$DbPath,

  [Parameter(Mandatory=$false)]
  [string]$OutJson = ".\adodb-probe-report.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-PathStrict([string]$p) {
  if (-not $p) { return $false }
  return (Test-Path -LiteralPath $p)
}

function Read-RegistryKey([string]$regPath) {
  try {
    $item = Get-ItemProperty -Path $regPath -ErrorAction Stop
    return $item
  } catch {
    return $null
  }
}

function Get-AceProvidersFromRegistry {
  # We check both 64-bit and 32-bit view keys.
  # ACE Provider keys usually exist under:
  # HKCR\Microsoft.ACE.OLEDB.12.0
  # HKCR\Microsoft.ACE.OLEDB.16.0
  # but bitness depends on registry view.
  $providers = @("Microsoft.ACE.OLEDB.12.0", "Microsoft.ACE.OLEDB.16.0")

  $results = @()

  foreach ($p in $providers) {
    # 64-bit view
    $k64 = "Registry::HKEY_CLASSES_ROOT\$p"
    $has64 = $false
    try {
      # Force 64-bit view by using reg.exe query with /reg:64
      $null = & reg.exe query "HKCR\$p" /reg:64 2>$null
      $has64 = ($LASTEXITCODE -eq 0)
    } catch { $has64 = $false }

    # 32-bit view
    $has32 = $false
    try {
      $null = & reg.exe query "HKCR\$p" /reg:32 2>$null
      $has32 = ($LASTEXITCODE -eq 0)
    } catch { $has32 = $false }

    $results += [pscustomobject]@{
      Provider = $p
      Registered_x64 = $has64
      Registered_x86 = $has32
    }
  }

  return $results
}

function Get-OfficeBitnessGuess {
  # Not perfect, but often helpful.
  # Office Click-to-Run reports Platform in HKLM.
  $c2r = Read-RegistryKey "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Office\ClickToRun\Configuration"
  if ($c2r -and $c2r.Platform) {
    return "Office Click-to-Run Platform: $($c2r.Platform)"
  }

  # MSI Office keys (common versions)
  $msi = Read-RegistryKey "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Office\16.0\Common\InstallRoot"
  if ($msi -and $msi.Path) {
    return "Office MSI InstallRoot: $($msi.Path)"
  }

  return "Unknown (not detected via common registry locations)"
}

function New-VbsProbeScript([string]$dbPathMaybe) {
  # We create a temporary .vbs that:
  #  - prints host bitness (using pointer size)
  #  - tries to create ADODB.Connection
  #  - optionally opens the DB with provider 12.0 and 16.0
  #  - prints OK/FAIL lines
  $dbLine = ""
  if ($dbPathMaybe) {
    # Escape backslashes for VBScript string literal
    $dbEsc = $dbPathMaybe.Replace("\", "\\")
    $dbLine = "dbPath = `"$dbEsc`""
  } else {
    $dbLine = "dbPath = `"`""
  }

@"
On Error Resume Next

WScript.Echo "VBSPROBE:START"
WScript.Echo "HostName=" & WScript.FullName

' Determine bitness (works reliably under cscript/wscript)
Dim ptrSize
ptrSize = LenB(ChrB(&H0)) ' dummy
' Better: use Win32 API? We'll infer via environment variables:
Dim procArch, procArchWow
procArch = WScript.CreateObject("WScript.Shell").ExpandEnvironmentStrings("%PROCESSOR_ARCHITECTURE%")
procArchWow = WScript.CreateObject("WScript.Shell").ExpandEnvironmentStrings("%PROCESSOR_ARCHITEW6432%")
WScript.Echo "Env.PROCESSOR_ARCHITECTURE=" & procArch
WScript.Echo "Env.PROCESSOR_ARCHITEW6432=" & procArchWow

$dbLine
WScript.Echo "DbPath=" & dbPath

Dim providers(1)
providers(0) = "Microsoft.ACE.OLEDB.16.0"
providers(1) = "Microsoft.ACE.OLEDB.12.0"

Dim i
For i = 0 To UBound(providers)
  Dim prov
  prov = providers(i)

  Dim conn
  Set conn = CreateObject("ADODB.Connection")
  If Err.Number <> 0 Then
    WScript.Echo "CreateObject ADODB.Connection FAIL Err=" & Err.Number & " Desc=" & Err.Description
    Err.Clear
    Exit For
  End If
  WScript.Echo "CreateObject ADODB.Connection OK"

  If dbPath <> "" Then
    Dim cs
    cs = "Provider=" & prov & ";Data Source=" & dbPath & ";Persist Security Info=False;"
    conn.Open cs
    If Err.Number <> 0 Then
      WScript.Echo "OPEN FAIL Provider=" & prov & " Err=" & Err.Number & " Desc=" & Err.Description
      Err.Clear
    Else
      WScript.Echo "OPEN OK Provider=" & prov
      conn.Close
    End If
  Else
    ' No DB to open, but we can at least instantiate connection object.
    WScript.Echo "SKIP OPEN (no DbPath) Provider=" & prov
  End If

  Set conn = Nothing
Next

WScript.Echo "VBSPROBE:END"
"@
}

function Run-CscriptProbe([string]$cscriptPath, [string]$vbsPath) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $cscriptPath
  $psi.Arguments = "/nologo `"$vbsPath`""
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true

  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  $null = $p.Start()
  $stdout = $p.StandardOutput.ReadToEnd()
  $stderr = $p.StandardError.ReadToEnd()
  $p.WaitForExit()

  return [pscustomobject]@{
    Cscript = $cscriptPath
    ExitCode = $p.ExitCode
    Stdout = $stdout
    Stderr = $stderr
  }
}

# =============================
# Main
# =============================

$report = [ordered]@{}
$report.Timestamp = (Get-Date).ToString("o")
$report.ComputerName = $env:COMPUTERNAME
$report.UserName = $env:USERNAME
$report.OS = (Get-CimInstance Win32_OperatingSystem | Select-Object -ExpandProperty Caption)
$report.OSBuild = (Get-CimInstance Win32_OperatingSystem | Select-Object -ExpandProperty BuildNumber)
$report.NodeHint = "node-adodb chooses cscript host; x64=System32, x86=SysWOW64 (in many setups)."
$report.OfficeBitnessGuess = Get-OfficeBitnessGuess

if ($DbPath) {
  if (-not (Test-PathStrict $DbPath)) {
    Write-Warning "DbPath does not exist: $DbPath"
  } else {
    $DbPath = (Resolve-Path -LiteralPath $DbPath).Path
  }
}
$report.DbPath = $DbPath

$report.AceRegistry = Get-AceProvidersFromRegistry

$cscript64 = "$env:WINDIR\System32\cscript.exe"
$cscript32 = "$env:WINDIR\SysWOW64\cscript.exe"

$report.CscriptPaths = [ordered]@{
  System32 = $cscript64
  SysWOW64 = $cscript32
  System32_exists = (Test-PathStrict $cscript64)
  SysWOW64_exists = (Test-PathStrict $cscript32)
}

# Create temp VBS
$tempVbs = Join-Path $env:TEMP ("adodb-probe-" + [guid]::NewGuid().ToString() + ".vbs")
$vbsContent = New-VbsProbeScript -dbPathMaybe $DbPath
Set-Content -LiteralPath $tempVbs -Value $vbsContent -Encoding ASCII

try {
  $results = @()

  if (Test-PathStrict $cscript64) {
    $results += Run-CscriptProbe -cscriptPath $cscript64 -vbsPath $tempVbs
  }
  if (Test-PathStrict $cscript32) {
    $results += Run-CscriptProbe -cscriptPath $cscript32 -vbsPath $tempVbs
  }

  $report.CscriptProbe = $results
}
finally {
  Remove-Item -LiteralPath $tempVbs -Force -ErrorAction SilentlyContinue
}

# Summary extraction: find OPEN OK lines
function Extract-Summary($probeObj) {
  $lines = ($probeObj.Stdout -split "`r?`n") | Where-Object { $_ -and $_.Trim().Length -gt 0 }
  $openOk = $lines | Where-Object { $_ -like "OPEN OK*" }
  $openFail = $lines | Where-Object { $_ -like "OPEN FAIL*" }
  $createFail = $lines | Where-Object { $_ -like "CreateObject ADODB.Connection FAIL*" }

  return [pscustomobject]@{
    Cscript = $probeObj.Cscript
    ExitCode = $probeObj.ExitCode
    OpenOkLines = $openOk
    OpenFailLines = $openFail
    CreateFailLines = $createFail
    Stderr = $probeObj.Stderr
  }
}

$report.Summary = @()
foreach ($p in $report.CscriptProbe) {
  $report.Summary += Extract-Summary $p
}

# Write JSON report
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $OutJson -Encoding UTF8

Write-Host "==== ADODB Probe Summary ===="
$report.Summary | Format-List

Write-Host ""
Write-Host "JSON report written to: $OutJson"
Write-Host "Tip: If OPEN OK appears only under SysWOW64 => use ADODB.open(connStr) (no x64 flag). If only under System32 => use ADODB.open(connStr, true)."