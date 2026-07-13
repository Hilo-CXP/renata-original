# Renata Batista — Psicologia & Arteterapia

Site institucional com **sistema de agendamento online**, painel administrativo privado e lista de espera.

## Funcionalidades

### Site público
- Apresentação de serviços e contato
- Agendamento em 5 passos (serviço → data → horário → dados → confirmação)
- Bloqueio automático de horários reservados (sem double-booking)
- Lista de espera quando a agenda está fechada
- Aviso de privacidade (LGPD) — coleta apenas nome e contato

### Painel admin (`/admin/login`)
- Login seguro com JWT em cookie httpOnly
- Calendário: visão dia, semana e mês
- CRUD de consultas (criar, editar, reagendar, cancelar, confirmar)
- **Fechar agenda** / **Abrir agenda**
- Horários de trabalho, pausas, datas indisponíveis, bloqueio manual de slots
- Lista de espera com status: aguardando, contactado, agendado, cancelado
- Notificações por e-mail e WhatsApp (webhook configurável)

## Instalação

```bash
cd renata-batista-site
npm install
cp .env.example .env
# Edite .env — altere JWT_SECRET, ADMIN_PASSWORD e credenciais SMTP
npm run setup
npm start
```

- **Site:** http://localhost:3000
- **Painel:** http://localhost:3000/admin/login

## Configuração (.env)

| Variável | Descrição |
|----------|-----------|
| `JWT_SECRET` | Segredo para tokens (mín. 32 caracteres) |
| `ADMIN_USERNAME` | Usuário do painel |
| `ADMIN_PASSWORD` | Senha do painel |
| `NOTIFY_EMAIL` | E-mail que recebe alertas |
| `SMTP_*` | Servidor de e-mail (Gmail, SendGrid, etc.) |
| `WHATSAPP_WEBHOOK_URL` | URL de API para enviar WhatsApp |
| `WHATSAPP_NOTIFY_NUMBER` | Número que recebe alertas |

## Segurança e LGPD

- Painel **não indexado** (`robots.txt`, `noindex`)
- Dashboard **inacessível** sem autenticação
- Coleta mínima de dados (nome, telefone, e-mail opcional)
- **Sem** campos clínicos, diagnósticos ou prontuário
- Rate limiting no agendamento público
- Cookies httpOnly + SameSite
- Banco SQLite local em `data/` (não versionado)

## Estrutura

```
├── index.html          # Site público
├── css/ js/            # Estilos e scripts públicos
├── admin/              # Painel (login + dashboard)
├── server/             # API Node.js + Express
│   ├── index.js
│   ├── db.js
│   ├── slotEngine.js   # Motor de horários + anti double-booking
│   ├── notifications.js
│   └── routes/
├── data/               # Banco SQLite (gerado automaticamente)
└── package.json
```

## Deploy

Este projeto requer **Node.js** em servidor (Railway, Render, VPS, etc.). GitHub Pages **não** suporta o backend.

```bash
npm start
# ou com PM2: pm2 start server/index.js --name renata-site
```

## GitHub

```bash
git add .
git commit -m "Sistema de agendamento com painel admin"
git push origin main
```

## Licença

Projeto privado — Renata Batista © 2026
