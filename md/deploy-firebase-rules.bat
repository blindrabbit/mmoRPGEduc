@echo off
REM ═══════════════════════════════════════════════════════════════
REM Script de Deploy das Regras do Firebase — mmoRPGGame
REM Uso: deploy-firebase-rules.bat
REM ═══════════════════════════════════════════════════════════════

echo.
echo ════════════════════════════════════════════════════════════
echo   Deploy das Regras do Firebase — mmoRPGGame
echo ════════════════════════════════════════════════════════════
echo.

REM Verifica se firebase.json existe
if not exist "firebase.json" (
    echo [ERRO] firebase.json nao encontrado!
    echo.
    echo Execute primeiro: firebase init
    echo.
    pause
    exit /b 1
)

REM Verifica se as regras existem
if not exist "md\firebase.rules.json" (
    echo [ERRO] md\firebase.rules.json nao encontrado!
    echo.
    pause
    exit /b 1
)

REM Verifica se Firebase CLI está instalado
where firebase >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] Firebase CLI nao instalado!
    echo.
    echo Instale com: npm install -g firebase-tools
    echo.
    pause
    exit /b 1
)

echo [1/4] Verificando login...
firebase projects:list >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [LOGIN] Fazendo login no Firebase...
    firebase login
)

echo [2/4] Verificando projeto...
if exist ".firebaserc" (
    echo [OK] Projeto configurado em .firebaserc
) else (
    echo [CONFIG] Selecione um projeto...
    firebase use --add
)

echo [3/4] Validando sintaxe JSON...
powershell -Command "try { $null = Get-Content 'md\firebase.rules.json' -Raw | ConvertFrom-Json; Write-Host 'OK' } catch { Write-Host 'ERRO' }" > %TEMP%\validate.txt
findstr /C:"ERRO" %TEMP%\validate.txt >nul
if %ERRORLEVEL% EQU 0 (
    echo [ERRO] Erro na sintaxe JSON das regras!
    del %TEMP%\validate.txt
    pause
    exit /b 1
)
del %TEMP%\validate.txt
echo [OK] Sintaxe JSON valida!

echo.
echo [4/4] Fazendo deploy...
echo.
firebase deploy --only database:rules

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ════════════════════════════════════════════════════════════
    echo   ✓ Deploy realizado com sucesso!
    echo ════════════════════════════════════════════════════════════
    echo.
) else (
    echo.
    echo ════════════════════════════════════════════════════════════
    echo   ✗ Deploy falhou! Verifique os erros acima.
    echo ════════════════════════════════════════════════════════════
    echo.
)

pause
