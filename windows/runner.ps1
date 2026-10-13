param([Parameter(Mandatory=$true)][string]$DataDir, [Parameter(Mandatory=$true)][string]$NodePath)
$ErrorActionPreference = 'Stop'
$env:PSModulePath = $PSHOME + '\Modules;' + $env:PSModulePath
$DataDir = [IO.Path]::GetFullPath($DataDir)
trap { [IO.File]::AppendAllText((Join-Path $DataDir 'runner.err.log'), $_.Exception.Message + [Environment]::NewLine, [Text.Encoding]::UTF8); break }
[IO.File]::WriteAllText((Join-Path $DataDir 'runner-status.json'), ('{"event":"initializing"}'), [Text.Encoding]::UTF8)
$hash = [Security.Cryptography.SHA256]::Create()
$bytes = $hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($DataDir.ToLowerInvariant()))
$name = 'Local\TiboReset-' + ([BitConverter]::ToString($bytes).Replace('-','').ToLowerInvariant()).Substring(0,24)
$mutex = [Threading.Mutex]::new($false, $name)
$owns = $false
try {
    [IO.File]::WriteAllText((Join-Path $DataDir 'runner-status.json'), ('{"event":"starting"}'), [Text.Encoding]::UTF8)
    try { $owns = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $owns = $true }
    if (-not $owns) { [IO.File]::WriteAllText((Join-Path $DataDir 'runner-status.json'), ('{"event":"duplicate"}'), [Text.Encoding]::UTF8); exit 0 }
    $env:TIBO_RESET_DATA_DIR = $DataDir
    while (-not (Test-Path -LiteralPath (Join-Path $DataDir 'stop.request'))) {
        [IO.File]::WriteAllText((Join-Path $DataDir 'runner-status.json'), ('{"event":"launching"}'), [Text.Encoding]::UTF8)
        $child = Start-Process -FilePath $NodePath -ArgumentList ('"' + (Join-Path $DataDir 'app.cjs') + '"') -WorkingDirectory $DataDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $DataDir 'monitor.log') -RedirectStandardError (Join-Path $DataDir 'monitor.err.log')
        $child.WaitForExit()
        if (Test-Path -LiteralPath (Join-Path $DataDir 'stop.request')) { break }
        Start-Sleep -Seconds 5
    }
} finally {
    [IO.File]::WriteAllText((Join-Path $DataDir 'runner-status.json'), ('{"event":"stopped"}'), [Text.Encoding]::UTF8)
    if ($owns) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
