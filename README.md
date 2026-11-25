# JobFinder

**LinkedIn automation platform.** Posts, connections/DMs and job applications — intelligent workflows in one place.

[![npm](https://img.shields.io/badge/npm-@danhachuel%2Fjobfinder-indigo)](https://www.npmjs.com/package/@danhachuel/jobfinder)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20.19-brightgreen)](https://nodejs.org)

> ⚠️ **Use at your own risk.** Automating LinkedIn may violate LinkedIn's Terms of Service and can restrict your account. JobFinder is not affiliated with LinkedIn. The official LinkedIn API is the recommended path; the cookie fallback exists because the official API does not cover outreach and job applications. See [legal/terms.html](legal/terms.html).

## What it does

| Module | Capabilities |
|---|---|
| **Postagens** | Automatic posts from predefined themes (LLM), scheduled posts (date/time), manual text posts, history with filters, preview mandatory before publishing |
| **Conexões & DMs** | Keyword people search, batch invitations with `{{nome}}`/`{{empresa}}`/`{{cargo}}` variables, DM cascades (up to 5 messages/day, configurable interval, day delays, auto-pause on reply, manual approval), weekly/daily quotas |
| **Vagas** | Resume upload (PDF/DOCX/TXT) parsed locally, semantic match score 0–100 with skill gaps, job search, save/discard, Easy Apply automation (dry-run first) |

Everything is driven from a React dashboard at `http://localhost:4040` — metric cards, Chart.js charts, progress and quota bars, toasts.

A **background worker** (separate Node process) keeps the queues moving even with the browser closed: scheduled posts are published and DM cascades advance on their own, always respecting the daily limits and the dry-run flag.

## Requirements

- **Node.js ≥ 20.19** (developed/tested on Node 22)
- Optional: **Playwright** for live Easy Apply (`npm i -g playwright && npx playwright install chromium`) — without it, applications stay in dry-run
- Optional: **Ollama** running locally for free LLM drafts (`ollama serve`) — or configure OpenAI / DeepSeek / Anthropic keys in the UI

## Install (delivered per version)

Windows / CMD / MobaXterm:

```bash
npx.cmd --yes --prefer-online @danhachuel/jobfinder@0.1.17 install
npx.cmd --yes --prefer-online @danhachuel/jobfinder@0.1.17
```

Normal terminal:

```bash
npx --yes @danhachuel/jobfinder@0.1.17 install
npx --yes @danhachuel/jobfinder@0.1.17
```

`install` creates `~/.jobfinder/` (config, auth, channels, topics, posts, connections, dm-cascades, jobs, applications, resume, logs). It is safe to re-run: existing data is never overwritten.

## First login

The app is protected by a local session. **Credentials are never displayed** — not on the login screen, not in the terminal, and not in this document.

The single first-run account is created in `~/.jobfinder/auth.json` on the first boot. Define your own initial credentials through the environment **before** the first start:

```bash
# Windows (PowerShell)
$env:JOBFINDER_INITIAL_EMAIL = "voce@exemplo.com"
$env:JOBFINDER_INITIAL_PASSWORD = "sua-senha-forte"
npx --yes @danhachuel/jobfinder@0.1.17

# Linux / macOS
JOBFINDER_INITIAL_EMAIL="voce@exemplo.com" \
JOBFINDER_INITIAL_PASSWORD="sua-senha-forte" \
npx --yes @danhachuel/jobfinder@0.1.17
```

Alternative: create the account directly in `~/.jobfinder/auth.json` (see the `user` object) before starting the app.

- Without a session every screen redirects to `/login` (and the API answers `401`).
- The password is stored hashed (scrypt) in `~/.jobfinder/auth.json` — never in plain text. Change it in **Configurações → Segurança** right after the first login.
- **Sair** (sidebar footer) ends the session.

## Usage

1. Start the app → open `http://localhost:4040` → log in with the credentials you configured
2. **Integrações** → connect LinkedIn:
   - **Recommended:** create your LinkedIn app ([Criar API Oficial do LinkedIn](legal/)) → paste Client ID/Secret → run the OAuth flow
   - **Fallback:** export cookies with ["Get cookies.txt LOCALLY"](https://chromewebstore.google.com/) and upload `cookies.txt`
3. **Configurações** → choose your LLM provider and tune the rate limits (100 invites/week, 5 DMs/day, 20 applications/day by default)
4. **Dry-run is ON by default** — explore the whole app safely; disable it in **Configurações → Execução** when you are ready (the header then shows the red `Real Mode` badge)
5. The **worker** starts with the app and keeps processing the queues in the background — the header badge shows active/paused/stopped, and the Painel (or Configurações → Execução) lets you pause, resume or force a pass. Closing the browser never pauses the automations
6. Publish posts, connect with people, run DM cascades, match and apply to jobs

### Useful flags

```bash
node scripts/cli.mjs                        # daemon (padrão): background, terminal livre
node scripts/cli.mjs --port 3031            # porta customizada
node scripts/cli.mjs --data-dir .           # diretório de dados customizado
node scripts/cli.mjs --dry-run              # força o modo dry-run
node scripts/cli.mjs --foreground           # prende ao terminal (depuração)
node scripts/cli.mjs stop                   # encerra o daemon
node scripts/cli.mjs --version              # versão
```

## Rodando como Serviço (Windows/Linux)

Desde a **0.1.17** o JobFinder usa **runtime permanente + daemon** (a mesma arquitetura do `@danhachuel/pandanews`):

1. **Runtime permanente** — o código do servidor é copiado para `~/.jobfinder/runtime` e as dependências de produção são instaladas lá dentro. O Express **nunca** sobe de dentro do cache do `npx`, que é o que causava o `EBUSY` no Windows (o npx renomeia/limpa o cache enquanto um processo vivo segura arquivos ali).
2. **Daemon** — o servidor sobe destacado (`detached`, `windowsHide`) com o log em `~/.jobfinder/jobfinder.log`. O terminal volta ao prompt e pode ser fechado sem derrubar o app.
3. **Lock de instância** — `~/.jobfinder/jobfinder.pid` registra PID/porta/versão. `stop` encerra por PID (`taskkill /PID /T`) e pelo dono da porta. Antes de subir, o launcher mata a instância anterior, então nunca há dois servidores brigando pela mesma porta.

O daemon é o **comportamento padrão**: `npx @danhachuel/jobfinder` (ou `jobfinder start`) já sobe em background e devolve o prompt.

### 1. Daemon padrão (recomendado)

```bash
npx --yes @danhachuel/jobfinder@0.1.17                 # sobe em background
npx --yes @danhachuel/jobfinder@0.1.17 --port 4050     # porta customizada
npx --yes @danhachuel/jobfinder@0.1.17 stop            # encerra
```

> **Dica (Windows/npx):** se você já rodou uma versão antiga antes, use
> `npx --yes --prefer-online @danhachuel/jobfinder@latest`. Sem o
> `--prefer-online` o npx pode reaproveitar um bucket de cache antigo (com uma
> versão defasada do CLI) em vez de baixar a latest. Instalação global
> (`npm install -g @danhachuel/jobfinder@latest`) não tem esse problema.

Saída típica:

```
Preparando o runtime permanente (~/.jobfinder/runtime) - o servidor não roda mais do cache do npx...
Runtime pronto em C:\Users\voce\.jobfinder\runtime
 Iniciando o JobFinder em background (porta 4040)...
 Log: C:\Users\voce\.jobfinder\jobfinder.log
JobFinder iniciado em background (PID: 12345). Acesse http://127.0.0.1:4040
Para encerrar: npx --yes @danhachuel/jobfinder@0.1.17 stop
```

### 2. Foreground — `--foreground` (depuração)

Sobe o servidor do runtime preso a este terminal, com a saída encaminhada. `Ctrl+C` encerra a árvore de processos. Use para diagnosticar; se o terminal fechar, o app morre.

```bash
npx --yes @danhachuel/jobfinder@0.1.17 --foreground
node scripts/cli.mjs --foreground --port 4040
```

### 3. Script nativo do Windows — `scripts\start-windows.ps1`

Duplo clique ou PowerShell: detecta porta em uso, dispara o CLI (que prepara o runtime e sobe o daemon), confere o `/api/health` e informa PID, runtime e log.

```powershell
.\scripts\start-windows.ps1                       # versão latest do npm
.\scripts\start-windows.ps1 -Version 0.1.17        # versão fixa
.\scripts\start-windows.ps1 -Local                 # working copy (desenvolvimento)
.\scripts\start-windows.ps1 -Stop                  # encerra
.\scripts\start-windows.cmd                        # wrapper para duplo clique
```

### 4. PM2 — serviço de verdade (Windows e Linux)

Reinicia em caso de crash, gerencia logs e sobrevive ao fechamento da sessão. O `ecosystem.config.cjs` aponta para o servidor do runtime (não para o launcher, que destacaria e retornaria).

```bash
npm i -g pm2                 # ou: npx pm2
npm run pm2:start            # sobe
npm run daemon:logs          # acompanha os logs
npm run pm2:stop             # para
```

`pm2` é dependência **opcional**: sem ela o app continua funcionando normalmente pelos caminhos 1–3 — a regra do projeto é executar nativamente, sem infraestrutura obrigatória.

| Forma | Sobrevive ao terminal? | Logs | Uso |
|---|---|---|---|
| Daemon (padrão) | sim | `~/.jobfinder/jobfinder.log` | servidor local, o caso comum |
| `--foreground` | não | no terminal | depuração rápida |
| `start-windows.ps1` | sim | `~/.jobfinder/jobfinder.log` | Windows, duplo clique |
| PM2 | sim (reinicia) | `pm2 logs` | serviço de longo prazo |
## Screenshots

> Painel, Postagens, Conexões, Cascatas de DM, Vagas, Candidaturas, Integrações e Configurações — see the walkthrough in the app header (**Ver tutorial**) or open the app to explore in dry-run mode. Screenshots are published with each release in the GitHub Releases.

## Where the data lives

```
~/.jobfinder/
├── config.json          # LLM provider, LinkedIn auth, rate limits, dry-run
├── auth.json            # local user + scrypt password hash + session secret
├── channels.json        # LinkedIn accounts (OAuth tokens or cookies — local only)
├── topics.json          # themes for automatic posts
├── posts.json           # drafts, scheduled, published, failed
├── connections.json     # invitations sent
├── dm-cascades.json     # DM sequences in progress
├── jobs.json            # saved/discarded jobs + match scores
├── applications.json    # applications + reports
├── resume.json          # parsed resume
├── worker-state.json    # background worker: heartbeat, fila ativa, últimas ações
├── worker-control.json  # estado desejado do worker (running | paused)
├── jobfinder.log        # log do daemon (stdout/stderr do servidor)
├── jobfinder.pid        # lock da instância: PID, porta, versão
├── runtime/             # RUNTIME PERMANENTE: código do servidor + node_modules
└── logs/YYYY-MM-DD.jsonl
```

No cloud sync, no telemetry, no accounts.

## Development

```bash
npm install                       # root (server) deps
npm run dev                       # API (4040) + UI dev server (5173) in parallel
npm run build                     # builds the UI into src/ui/dist
npm start                         # production-style start (serves the built UI)
```

Manual smoke tests (start a temporary server + Playwright for the UI):

```bash
node scripts/manual-tests/fase1-auth-dryrun.mjs        # API: login, sessão, toggle dry-run, troca de senha
node scripts/manual-tests/fase1-dryrun-services.mjs    # API: flag dry-run aplicada a postagens/convites/DMs
node scripts/manual-tests/fase1-ui-e2e.mjs             # UI (Playwright): login, badges, configurações, logout
node scripts/manual-tests/fase2-worker.mjs             # worker: spawn, filas, limite de DMs, órfãos, estresse
node scripts/manual-tests/fase3-seed-env.mjs           # segurança: seed por env, nenhuma credencial exposta
node scripts/manual-tests/fase4-npx-start.mjs          # npx/cwd estranho: versão correta, processo vivo, HTTP 200
node scripts/manual-tests/fase5-daemon.mjs             # daemon: runtime, PID, log, stop, sem duplicar
node scripts/manual-tests/fase6-runtime-daemon.mjs     # runtime permanente: daemon do runtime, lock, worker
node scripts/manual-tests/startup-keepalive.mjs        # runtime: boot, unhandledRejection, EPIPE, sinais
node --test tests/*.js                                # contratos/concorrência/UI (stubs por enquanto)
```

### Regression-prevention skills (read before changing code)

[AGENTS.md](AGENTS.md) is the entry point: every agent (and every task) must read the seven
skills in `.agents/skills/` before touching the repo — systemic view of dependencies, one
session per repository, surgical scope (no unrequested refactors), atomic JSON writes through
the store, Windows runtime resilience, contract tests that exercise real behavior, and
predictable React state.

Layout: `scripts/cli.mjs` (launcher — embute o Express via import: o `app.listen()` roda no próprio processo) · `src/server/` (Express API, JSON store, LinkedIn + LLM services, worker autônomo) · `src/ui/` (React + Vite + Tailwind v4) · `.agents/skills/` (regression rules) · `tests/` (contract/concurrency/UI stubs).

## Publishing

Versions use the visual `MAJOR.MINOR.PATCH` scheme with a two-digit PATCH (`0.0.01` → after `0.0.99` comes `0.1.00`; after `0.9.99` comes `1.0.00`). npm publishes the normalized SemVer form (`0.0.01` → `0.0.1`) — always use the canonical registry version in install commands.

Releases happen **exclusively via GitHub Actions** (`.github/workflows/publish-npm.yml`): bump version → commit/push → dispatch with dist-tag `next` → push tag `vX.Y.ZZ` → the workflow verifies the tarball and promotes it to `latest`. Every change is recorded in [CHANGELOG.md](CHANGELOG.md).

## Legal

- [Legal index](legal/index.html) · [Privacy Policy](legal/privacy.html) · [Terms of Use](legal/terms.html)

Key points: your data stays in your own JSON store, no data is sent to any JobFinder server, cookies are never shared, you are responsible for respecting LinkedIn's rate limits and for every action taken on your account.

## License

[MIT](LICENSE) © 2026 Dan Pariente Hachuel
