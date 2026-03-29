# ═══════════════════════════════════════════════════════════════
# Script de Deploy das Regras do Firebase — mmoRPGGame
# Uso: .\deploy-firebase-rules.ps1
# ═══════════════════════════════════════════════════════════════

param(
    [switch]$ValidateOnly,
    [switch]$Help
)

if ($Help) {
    Write-Host @"
════════════════════════════════════════════════════════════
  Deploy das Regras do Firebase — mmoRPGGame
════════════════════════════════════════════════════════════

Uso:
  .\deploy-firebase-rules.ps1 [-ValidateOnly] [-Help]

Opções:
  -ValidateOnly   Apenas valida as regras (não faz deploy)
  -Help           Mostra esta ajuda

Exemplos:
  .\deploy-firebase-rules.ps1              # Faz deploy completo
  .\deploy-firebase-rules.ps1 -ValidateOnly  # Apenas valida

"@
    exit 0
}

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Deploy das Regras do Firebase — mmoRPGGame" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Verifica se firebase.json existe
if (-not (Test-Path "firebase.json")) {
    Write-Host "[ERRO] firebase.json nao encontrado!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Execute primeiro: firebase init" -ForegroundColor Yellow
    Write-Host ""
    pause
    exit 1
}

# Verifica se as regras existem
if (-not (Test-Path "md\firebase.rules.json")) {
    Write-Host "[ERRO] md\firebase.rules.json nao encontrado!" -ForegroundColor Red
    Write-Host ""
    pause
    exit 1
}

# Verifica se Firebase CLI está instalado
try {
    $firebaseCmd = Get-Command firebase -ErrorAction Stop
} catch {
    Write-Host "[ERRO] Firebase CLI nao instalado!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Instale com: npm install -g firebase-tools" -ForegroundColor Yellow
    Write-Host ""
    pause
    exit 1
}

# [1/4] Verificando login
Write-Host "[1/4] Verificando login..." -ForegroundColor Cyan
try {
    $null = firebase projects:list 2>&1
    Write-Host "[OK] Login confirmado" -ForegroundColor Green
} catch {
    Write-Host "[LOGIN] Fazendo login no Firebase..." -ForegroundColor Yellow
    firebase login
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERRO] Login falhou!" -ForegroundColor Red
        pause
        exit 1
    }
}

# [2/4] Verificando projeto
Write-Host "[2/4] Verificando projeto..." -ForegroundColor Cyan
if (Test-Path ".firebaserc") {
    Write-Host "[OK] Projeto configurado em .firebaserc" -ForegroundColor Green
    $firebaserc = Get-Content ".firebaserc" -Raw | ConvertFrom-Json
    $projectId = $firebaserc.projects.default
    if ($projectId) {
        Write-Host "     Projeto: $projectId" -ForegroundColor Gray
    }
} else {
    Write-Host "[CONFIG] Selecione um projeto..." -ForegroundColor Yellow
    firebase use --add
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERRO] Configuração do projeto falhou!" -ForegroundColor Red
        pause
        exit 1
    }
}

# [3/4] Validando regras (verificação de sintaxe JSON)
Write-Host "[3/4] Validando sintaxe JSON..." -ForegroundColor Cyan
try {
    $rulesContent = Get-Content "md\firebase.rules.json" -Raw | ConvertFrom-Json
    Write-Host "[OK] Sintaxe JSON válida!" -ForegroundColor Green
} catch {
    Write-Host "[ERRO] Erro na sintaxe JSON das regras!" -ForegroundColor Red
    Write-Host "Detalhes: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    pause
    exit 1
}

# Se for apenas validação, para aqui
if ($ValidateOnly) {
    Write-Host ""
    Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host "  ✓ Validação concluída com sucesso!" -ForegroundColor Green
    Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host ""
    pause
    exit 0
}

Write-Host ""
Write-Host "[4/4] Fazendo deploy..." -ForegroundColor Cyan
Write-Host ""

firebase deploy --only database:rules

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host "  ✓ Deploy realizado com sucesso!" -ForegroundColor Green
    Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Red
    Write-Host "  ✗ Deploy falhou! Verifique os erros acima." -ForegroundColor Red
    Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Red
    Write-Host ""
}

pause
