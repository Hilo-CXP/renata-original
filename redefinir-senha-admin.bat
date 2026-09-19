@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"

echo.
echo  Redefinir senha do painel admin
echo  ================================
echo.
echo  A senha sera atualizada conforme o arquivo .env:
echo  ADMIN_USERNAME e ADMIN_PASSWORD
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo  [ERRO] Node.js nao encontrado. Instale em https://nodejs.org
  pause
  exit /b 1
)

if not exist .env (
  echo  Criando .env a partir do exemplo...
  copy .env.example .env >nul
)

call npm run reset-admin

echo.
echo  Pronto! Use as credenciais do .env em:
echo  http://localhost:3000/admin/login
echo.
pause
