param([Parameter(Mandatory=$true)][string]$DataDir, [Parameter(Mandatory=$true)][string]$NodePath)
$ErrorActionPreference = 'Stop'
$env:PSModulePath = $PSHOME + '\Modules;' + $env:PSModulePath
$DataDir = [IO.Path]::GetFullPath($DataDir)
$hash = [Security.Cryptography.SHA256]::Create()
$bytes = $hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($DataDir.ToLowerInvariant()))
$name = 'Local\TiboReset-' + ([BitConverter]::ToString($bytes).Replace('-','').ToLowerInvariant()).Substring(0,24)
$mutex = [Threading.Mutex]::new($false, $name)
$owns = $false
try {
    try { $owns = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $owns = $true }
    if (-not $owns) { exit 0 }
    $env:TIBO_RESET_DATA_DIR = $DataDir
    while (-not (Test-Path -LiteralPath (Join-Path $DataDir 'stop.request'))) {
        $child = Start-Process -FilePath $NodePath -ArgumentList ('"' + (Join-Path $DataDir 'app.cjs') + '"') -WorkingDirectory $DataDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $DataDir 'monitor.log') -RedirectStandardError (Join-Path $DataDir 'monitor.err.log')
        $child.WaitForExit()
        if (Test-Path -LiteralPath (Join-Path $DataDir 'stop.request')) { break }
        Start-Sleep -Seconds 5
    }
} finally {
    if ($owns) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
