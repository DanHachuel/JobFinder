<#
.SYNOPSIS
    Inicia o JobFinder em background (runtime permanente + daemon) no Windows.

.DESCRIPTION
    Delega ao CLI (@danhachuel/jobfinder), que desde a 0.1.17:
      1. copia o código do servidor para o runtime permanente ~/.jobfinder/runtime
      2. sobe o Express DESTACADO (detached), com stdio no arquivo de log —
         imune ao terminal (MobaXterm, wrapper do npx, PowerShell) e ao EBUSY
         que o Windows devolvia quando um processo vivo segurava o cache do npx
      3. registra o PID em ~/.jobfinder/jobfinder.pid

    O script apenas orquestra: detecta porta em uso, dispara o CLI, confere o
    /api/health e informa PID, log e como parar. Nada de `&`/`Start-Process
    -Wait` aqui — o PowerShell ficava pendurado esperando handles do filho.

    Uso:
        .\start-windows.ps1                     # versão latest do npm
        .\start-windows.ps1 -Version 0.1.17     # versão fixa
        .\start-windows.ps1 -Local              # working copy (desenvolvimento)
        .\start-windows.ps1 -Stop               # encerra o daemon
#>
[CmdletBinding()]
param(
    [string]$Version = "latest",
    [int]$Port = 4040,
    [switch]$Stop,
    [switch]$Local
)

$ErrorActionPreference = "Stop"
$pkg = "@danhachuel/jobfinder@$Version"

# Resolve o comando: pacote do npm (padrão) ou working copy (-Local).
if ($Local) {
    $repoRoot = Split-Path -Parent $PSScriptRoot
    $exe = "node"
    $cliArgs = @((Join-Path $repoRoot "scripts\cli.mjs"))
    $label = "working copy ($repoRoot)"
} else {
    $exe = "npx"
    $cliArgs = @("--yes", $pkg)
    $label = $pkg
}

function Test-JobFinderUp {
    param([int]$Port)
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 3 -UseBasicParsing
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

# Data dir: mesma precedência do CLI (JOBFINDER_HOME > JOBFINDER_DATA_DIR > ~/.jobfinder).
if ($env:JOBFINDER_HOME) { $dataDir = $env:JOBFINDER_HOME }
elseif ($env:JOBFINDER_DATA_DIR) { $dataDir = $env:JOBFINDER_DATA_DIR }
else { $dataDir = Join-Path $env:USERPROFILE ".jobfinder" }
$logFile = Join-Path $dataDir "jobfinder.log"

if ($Stop) {
    Write-Host "Parando o JobFinder ($label)..." -ForegroundColor Cyan
    Start-Process -FilePath $exe -ArgumentList ($cliArgs + @("stop")) -WindowStyle Hidden
    $down = $false
    for ($i = 0; $i -lt 20; $i++) {
        if (-not (Test-JobFinderUp -Port $Port)) { $down = $true; break }
        Start-Sleep -Seconds 1
    }
    if ($down) {
        Write-Host "JobFinder parado. Log preservado em $logFile" -ForegroundColor Green
        exit 0
    }
    Write-Host "A porta $Port ainda responde. Verifique o log em $logFile" -ForegroundColor Yellow
    exit 1
}

if (Test-JobFinderUp -Port $Port) {
    Write-Host "JobFinder ja esta rodando em http://127.0.0.1:$Port" -ForegroundColor Green
    exit 0
}

Write-Host "Iniciando o JobFinder em background ($label, porta $Port)..." -ForegroundColor Cyan
$env:JOBFINDER_MODE = "daemon"
# Sem -Wait e sem redirecionamento: o CLI copia o runtime, sobe o daemon e
# retorna. Qualquer espera por handles do processo nativo travaria o script.
Start-Process -FilePath $exe -ArgumentList ($cliArgs + @("--daemon", "--port", "$Port")) -WindowStyle Hidden

if (Test-JobFinderUp -Port $Port) {
    Start-Sleep -Seconds 1
    if (Test-JobFinderUp -Port $Port) {
        $pidInfo = ""
        $lockFile = Join-Path $dataDir "jobfinder.pid"
        if (Test-Path $lockFile) {
            try { $pidInfo = " (PID $((Get-Content $lockFile -Raw | ConvertFrom-Json).pid))" } catch { }
        }
        Write-Host ""
        Write-Host "JobFinder rodando em background$pidInfo`: http://127.0.0.1:$Port" -ForegroundColor Green
        Write-Host "Runtime: $(Join-Path $dataDir 'runtime')" -ForegroundColor Gray
        Write-Host "Log    : $logFile" -ForegroundColor Gray
        Write-Host "Parar  : .\start-windows.ps1 -Stop   (ou: taskkill /F /IM node.exe)" -ForegroundColor Gray
        exit 0
    }
}

Write-Host ""
Write-Host "O daemon nao respondeu em http://127.0.0.1:$Port/api/health." -ForegroundColor Red
Write-Host "Verifique o log em $logFile" -ForegroundColor Yellow
exit 1