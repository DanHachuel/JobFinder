<#
.SYNOPSIS
    Inicia o JobFinder em background (modo daemon) no Windows.

.DESCRIPTION
    Alternativa "a prova de balas" ao `npx` rodando direto no MobaXterm /
    PowerShell. O terminal interativo (e o wrapper do npx) pode matar o
    processo filho a qualquer momento; aqui o servidor sobe DETACHED, com o
    log em disco, e sobrevive ao fechamento do terminal.

    Uso:
        .\start-windows.ps1                     # pacote latest do npm
        .\start-windows.ps1 -Version 0.1.16     # versão fixa
        .\start-windows.ps1 -Local              # working copy (desenvolvimento)
        .\start-windows.ps1 -Stop               # encerra o daemon

.NOTES
    O app grava seu próprio log em %USERPROFILE%\.jobfinder\jobfinder.log —
    por isso o script NÃO redireciona a saída do processo. `Start-Process`
    com redireção (ou `&`) faz o PowerShell esperar handles do processo
    nativo, e um daemon que herdou qualquer handle travaria o script.
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

function Wait-JobFinderUp {
    param([int]$Port, [int]$Seconds = 30)
    for ($i = 0; $i -lt $Seconds; $i++) {
        if (Test-JobFinderUp -Port $Port) { return $true }
        Start-Sleep -Seconds 1
    }
    return $false
}

# Data dir: mesma precedência do CLI (JOBFINDER_HOME > JOBFINDER_DATA_DIR > ~/.jobfinder).
if ($env:JOBFINDER_HOME) { $dataDir = $env:JOBFINDER_HOME }
elseif ($env:JOBFINDER_DATA_DIR) { $dataDir = $env:JOBFINDER_DATA_DIR }
else { $dataDir = Join-Path $env:USERPROFILE ".jobfinder" }
$logFile = Join-Path $dataDir "jobfinder.log"

if ($Stop) {
    Write-Host "Parando o JobFinder ($label)..." -ForegroundColor Cyan
    Start-Process -FilePath $exe -ArgumentList ($cliArgs + @("stop")) -WindowStyle Hidden
    # Confirma que a porta deixou de responder.
    $down = $false
    for ($i = 0; $i -lt 15; $i++) {
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
Start-Process -FilePath $exe -ArgumentList ($cliArgs + @("--daemon", "--port", "$Port")) -WindowStyle Hidden

if (Wait-JobFinderUp -Port $Port -Seconds 40) {
    Write-Host ""
    Write-Host "JobFinder rodando em background: http://127.0.0.1:$Port" -ForegroundColor Green
    Write-Host "Log    : $logFile" -ForegroundColor Gray
    Write-Host "Parar  : .\start-windows.ps1 -Stop   (ou: taskkill /F /IM node.exe)" -ForegroundColor Gray
    exit 0
}

Write-Host ""
Write-Host "O daemon nao respondeu em http://127.0.0.1:$Port/api/health." -ForegroundColor Red
Write-Host "Verifique o log em $logFile" -ForegroundColor Yellow
exit 1