# JobFinder

**Local-first LinkedIn automation.** Single user, no cloud account, no external database — everything runs on your machine and is stored in JSON.

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

## Requirements

- **Node.js ≥ 20.19** (developed/tested on Node 22)
- Optional: **Playwright** for live Easy Apply (`npm i -g playwright && npx playwright install chromium`) — without it, applications stay in dry-run
- Optional: **Ollama** running locally for free LLM drafts (`ollama serve`) — or configure OpenAI / DeepSeek / Anthropic keys in the UI

## Install (delivered per version)

Windows / CMD / MobaXterm:

```bash
npx.cmd --yes --prefer-online @danhachuel/jobfinder@0.1.4 install
npx.cmd --yes --prefer-online @danhachuel/jobfinder@0.1.4
```

Normal terminal:

```bash
npx --yes @danhachuel/jobfinder@0.1.4 install
npx --yes @danhachuel/jobfinder@0.1.4
```

`install` creates `~/.jobfinder/` (config, auth, channels, topics, posts, connections, dm-cascades, jobs, applications, resume, logs). It is safe to re-run: existing data is never overwritten.

## First login

The app is protected by a local session. On the first run a single user is created:

| Field | Value |
|---|---|
| E-mail | `dan.hachuel@gmail.com` |
| Password | `123456` |

- Without a session every screen redirects to `/login` (and the API answers `401`).
- The password is stored hashed (scrypt) in `~/.jobfinder/auth.json` — never in plain text. Change it in **Configurações → Segurança** right after the first login.
- **Sair** (sidebar footer) ends the session.

## Usage

1. Start the app → it opens `http://localhost:4040` → log in with the local user above
2. **Integrações** → connect LinkedIn:
   - **Recommended:** create your LinkedIn app ([Criar API Oficial do LinkedIn](legal/)) → paste Client ID/Secret → run the OAuth flow
   - **Fallback:** export cookies with ["Get cookies.txt LOCALLY"](https://chromewebstore.google.com/) and upload `cookies.txt`
3. **Configurações** → choose your LLM provider and tune the rate limits (100 invites/week, 5 DMs/day, 20 applications/day by default)
4. **Dry-run is ON by default** — explore the whole app safely; disable it in **Configurações → Execução** when you are ready (the header then shows the red `Real Mode` badge)
5. Publish posts, connect with people, run DM cascades, match and apply to jobs

### Useful flags

```bash
node scripts/cli.mjs start --port 3031     # custom port
node scripts/cli.mjs start --data-dir .   # custom data directory
node scripts/cli.mjs start --dry-run       # force dry-run
node scripts/cli.mjs --version             # version info
```

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
```

Layout: `scripts/cli.mjs` (launcher) · `src/server/` (Express API, JSON store, LinkedIn + LLM services, workers) · `src/ui/` (React + Vite + Tailwind v4).

## Publishing

Versions use the visual `MAJOR.MINOR.PATCH` scheme with a two-digit PATCH (`0.0.01` → after `0.0.99` comes `0.1.00`; after `0.9.99` comes `1.0.00`). npm publishes the normalized SemVer form (`0.0.01` → `0.0.1`) — always use the canonical registry version in install commands.

Releases happen **exclusively via GitHub Actions** (`.github/workflows/publish-npm.yml`): bump version → commit/push → dispatch with dist-tag `next` → push tag `vX.Y.ZZ` → the workflow verifies the tarball and promotes it to `latest`. Every change is recorded in [CHANGELOG.md](CHANGELOG.md).

## Legal

- [Legal index](legal/index.html) · [Privacy Policy](legal/privacy.html) · [Terms of Use](legal/terms.html)

Key points: 100% local storage, no data sent to any JobFinder server, cookies never shared, you are responsible for respecting LinkedIn's rate limits and for every action taken on your account.

## License

[MIT](LICENSE) © 2026 Dan Pariente Hachuel
