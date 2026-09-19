@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem Adiciona Node.js ao PATH (necessario apos instalar sem reiniciar o PC)
set "PATH=C:\Program Files\nodejs;%PATH%"

echo.
echo  Renata Batista - Iniciando servidor
echo  ====================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo  [ERRO] Node.js nao encontrado!
  echo.
  echo  Instale em: https://nodejs.org  ^(versao LTS^)
  echo  Depois REINICIE o computador e tente novamente.
  echo.
  pause
  exit /b 1
)

echo  Node: 
node --version
echo.

if exist node_modules\better-sqlite3 (
  echo  Removendo instalacao antiga...
  rmdir /s /q node_modules 2>nul
)

if not exist node_modules (
  echo  Instalando dependencias...
  call npm install
  if errorlevel 1 (
    echo  [ERRO] Falha ao instalar dependencias.
    pause
    exit /b 1
  )
)

if not exist .env (
  echo  Criando arquivo .env...
  copy .env.example .env >nul
)

echo  Sincronizando login do painel com o arquivo .env...
call npm run setup

echo.
echo  Verificando porta 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  echo  Encerrando servidor antigo na porta 3000 ^(PID %%a^)...
  taskkill /F /PID %%a >nul 2>&1
)

echo.
echo  ====================================
echo  Site:   http://localhost:3000
echo  Admin:  http://localhost:3000/admin/login
echo.
echo  Login e senha: veja ADMIN_USERNAME e ADMIN_PASSWORD no arquivo .env
echo  Padrao (.env): admin / AltereSenhaForte123!
echo  ====================================
echo.
echo  Mantenha esta janela aberta enquanto usar o site.
echo  Pressione Ctrl+C para parar.
echo.

npm start
