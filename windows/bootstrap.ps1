param([ValidateSet('install','status','launch','uninstall','prepare-runtime')][string]$Action = 'install')
$ErrorActionPreference = 'Stop'
$env:PSModulePath = $PSHOME + '\Modules;' + $env:PSModulePath
$ProgressPreference = 'SilentlyContinue'
try {
    if ($env:TIBO_RESET_DATA_DIR) { $data = $env:TIBO_RESET_DATA_DIR } else { $data = Join-Path $env:LOCALAPPDATA 'TiboReset' }
    $node = Join-Path $data 'runtime\node.exe'
    $packagedNode = Join-Path $PSScriptRoot '..\runtime\node.exe'
    if (Test-Path -LiteralPath $packagedNode) { $node = [IO.Path]::GetFullPath($packagedNode) }
    if (-not (Test-Path -LiteralPath $node) -and $Action -ne 'prepare-runtime') {
        $available = Get-Command node.exe -ErrorAction SilentlyContinue
        if ($available) {
            $versionText = & $available.Source --version
            if ([version]($versionText.TrimStart('v')) -ge [version]'24.14.0') { $node = $available.Source }
        }
    }
    if (-not (Test-Path -LiteralPath $node)) {
        if ($Action -notin @('install','prepare-runtime')) { throw 'Run install.cmd first.' }
        $spec = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'runtime.json') -Raw | ConvertFrom-Json
        $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
        $name = 'node-' + $spec.version + '-win-' + $arch
        $temp = Join-Path ([IO.Path]::GetTempPath()) ('tibo-runtime-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $temp | Out-Null
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            $zip = Join-Path $temp 'node.zip'
            Write-Host ('Downloading Node.js ' + $spec.version + ' for ' + $arch + '...')
            Invoke-WebRequest -UseBasicParsing -Uri ('https://nodejs.org/dist/' + $spec.version + '/' + $name + '.zip') -OutFile $zip -TimeoutSec 120
            $hasher = [Security.Cryptography.SHA256]::Create()
            $stream = [IO.File]::OpenRead($zip)
            try { $digest = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
            finally { $stream.Dispose(); $hasher.Dispose() }
            if ($digest -ne $spec.sha256.$arch) { throw 'Node.js checksum mismatch.' }
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            [IO.Compression.ZipFile]::ExtractToDirectory($zip, $temp)
            $dest = Join-Path $data 'runtime'
            New-Item -ItemType Directory -Path $dest -Force | Out-Null
            Copy-Item -LiteralPath (Join-Path $temp ($name + '\node.exe')) -Destination (Join-Path $dest 'node.exe')
            Copy-Item -LiteralPath (Join-Path $temp ($name + '\LICENSE')) -Destination (Join-Path $dest 'Node-LICENSE.txt')
            $node = Join-Path $dest 'node.exe'
        } finally { Remove-Item -LiteralPath $temp -Recurse -Force }
    }
    $versionText = & $node --version
    if ($LASTEXITCODE -ne 0 -or [version]($versionText.TrimStart('v')) -lt [version]'24.14.0') { throw 'Node.js 24.14+ is required.' }
    if ($Action -eq 'prepare-runtime') { Write-Host ('Verified private runtime: ' + $versionText); exit 0 }
    & $node (Join-Path $PSScriptRoot 'manage.cjs') $Action
    exit $LASTEXITCODE
} catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }
