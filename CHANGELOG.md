# Changelog

All notable changes to JobFinder are documented in this file.

**Version labels** use a two-digit PATCH (`0.0.01` → after `0.0.99` comes `0.1.00`; after `0.9.99` comes `1.0.00`). npm publishes the normalized SemVer form (`0.0.01` → `0.0.1`), which is what install commands must use.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.05] — 2026-11-13

### Changed

- **Nenhuma abertura automática de navegador**: o launcher (`scripts/cli.mjs`) não abre mais o navegador do sistema ao iniciar. O terminal apenas imprime a URL (`http://127.0.0.1:4040`) e a mensagem `Press Ctrl+C to stop.`, aguardando a ação do usuário — abrir uma janela sem ser pedido não é aceitável para um produto hospedado (SaaS). A função `openBrowser` foi removida, as flags `--open`/`--no-open` viraram no-ops (ainda aceitas por compatibilidade) e a chave `openBrowserOnStart` saiu do config padrão.
- **Marca reposicionada para SaaS**: removidas todas as menções a "100% local" / "local-first" / "seus dados nunca saem desta máquina" da UI (badge do login, rodapé da sidebar — que fica apenas com o perfil e o botão **Sair** —, rodapé do conteúdo, cartões de Vagas, Candidaturas e Header) e do CLI (subtítulo do banner agora é "LinkedIn Automation • Intelligent Workflows"). A descrição do pacote npm e o README seguem o mesmo reposicionamento.

### Removed

- Bloco "100% local" (link para o GitHub) do rodapé da sidebar e badge "100% local" da tela de login; frases de posicionamento exclusivamente local em toda a interface.

## [0.1.04] — 2026-11-12

### Added

- **Sistema de login local (autenticação single-user)**: usuário pré-criado `dan.hachuel@gmail.com` / `123456`, com a senha gravada em `~/.jobfinder/auth.json` usando **scrypt** (salt + hash — nunca em texto puro). Sessão via token assinado (HMAC-SHA256) em **cookie HTTP-only** (`jobfinder_session`, 7 dias, `SameSite=Lax`), também aceito como `Authorization: Bearer` para testes de API. Novo arquivo `src/server/storage/authStore.mjs` + rotas `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session`, `PUT /api/auth/password`, `GET /api/auth/defaults`.
- **Proteção de rotas**: todo o app (exceto `/login`) exige sessão ativa — sem sessão, a UI redireciona para `/login` e a API responde `401 unauthorized`. Ficam públicos apenas `/api/auth/*`, `/api/health` (smoke test do CI) e `/api/channels/oauth/callback` (redirect do LinkedIn). Um `401` em qualquer request derruba a sessão e volta para o login.
- **Tela de login** (`src/ui/src/pages/Login.jsx`) no padrão visual da tela de login do ProdMaker, adaptada para a identidade JobFinder (`#1e1b4b`, acento indigo): painel de marca escuro com orbs/partículas animadas e os 4 passos do fluxo (Publique com LLM → Conecte-se → DMs em cascata → Candidate-se), painel de formulário com ícones, mostrar/ocultar senha, caixa de erro e dica de primeiro acesso com as credenciais padrão (a dica desaparece quando a senha deixa de ser a padrão).
- **Logout e conta na sidebar**: rodapé da sidebar mostra o usuário logado (avatar + e-mail) e o botão **Sair**, ao lado do selo "100% local".
- **Seção "Execução" nas Configurações**: switch para **desativar o dry-run**, com o aviso *"Ao desativar o modo Dry-run, o JobFinder executará ações reais no LinkedIn (postagens, convites, DMs e candidaturas). Use com responsabilidade."*, modal de confirmação antes de ativar o modo real e persistência imediata da flag em `config.json`.
- **Seção "Segurança" nas Configurações**: alteração de senha do usuário logado (senha atual, nova senha, confirmação) com validações (mínimo de 6 caracteres, confirmação, senha atual correta) e atualização do hash em `auth.json`.
- **Rota `/configuracoes`** (alias de `/config`, que continua funcionando) com o item da sidebar apontando para o novo endereço.
- **Badge "Real Mode"** (vermelho) no topo quando o dry-run está desativado, ao lado do badge âmbar `dry-run` quando está ativo; o avatar do header mostra as iniciais da conta logada.

### Changed

- **Flag `dryRun` aplicada de verdade no backend**: novo `src/server/storage/configSync.mjs` mantém o objeto de configuração vivo sincronizado após `PUT /api/config` (antes um toggle só valia após reiniciar o servidor). `createLinkedInClient` passou a respeitar a flag lendo o config atual e o novo `requireLiveLinkedInClient` bloqueia ações reais **sem canal conectado** com `503 channel_required` em vez de simular silenciosamente — usado pelo publisher (postagens), pelos convites e pelas cascatas de DM (o tick é marcado como `skipped` com o motivo, sem travar o worker).
- **`auth.json` faz parte do skeleton** (`DATA_FILES`): `jobfinder install` e o smoke test do CI criam/validam o arquivo; o `AuthStore` também migra arquivos antigos (preenche `sessionSecret`/usuário).
- Startup do servidor registra no log e no console o usuário de login e avisa quando a **senha padrão** ainda está em uso.
- Versão `0.1.02` → `0.1.04` (npm `0.1.4`): a `0.1.03` já tinha sido consumida pelo release do badge de versão dinâmica na sidebar.

### Fixed

- **Encerramento prematuro do processo Node.js na inicialização**: o app imprimia o banner de startup (`listening on http://127.0.0.1:4040` + `DRY-RUN mode`) e o processo morria em seguida, devolvendo o terminal ao prompt. Desde o Node 15, qualquer `unhandledRejection` derruba o processo silenciosamente (exit 1) — uma promise solta em qualquer serviço (storage, workers, LLM, LinkedIn) era suficiente para matar o app logo após o banner. Além disso, um `EPIPE` no stdout herdado (terminal/pipe que desaparece — caso do Windows/MobaXterm) também encerrava o processo sem mensagem visível. Agora `src/server/index.mjs` e `scripts/cli.mjs` instalam handlers de processo no topo: `unhandledRejection` é registrado no log (e no console) sem derrubar o servidor; `uncaughtException` encerra de forma visível; erros de `stdout`/`stderr` (EPIPE) são ignorados; o `http.Server` fica pinado em escopo de módulo e em `globalThis.__jobfinder`; o shutdown (SIGINT/SIGTERM/SIGBREAK) é idempotente, para os workers e força a saída após 3 s; o launcher só encerra quando o servidor filho termina e passa a imprimir `[jobfinder] server exited (code/signal)` — a causa do encerramento nunca mais fica invisível. Teste de regressão: `node scripts/manual-tests/startup-keepalive.mjs` (boot via launcher, boot direto, `unhandledRejection` injetado, stdout fechado e shutdown gracioso).

## [0.1.03] — 2026-11-12

### Fixed

- **Versão dinâmica ao lado do logo na sidebar**: a versão agora é injetada no build via `define.__APP_VERSION__` no `vite.config.js`, lida do `package.json` da raiz (fonte única da verdade), e exibida como badge `vX.Y.ZZ` ao lado de "JobFinder" (borda `indigo-400/30`, fundo `indigo-500/10` translúcido, texto `text-[10px]` — padrão visual LeadMaster). Tooltip mostra também a forma canônica do npm (`0.1.03` → `0.1.3`). O rodapé da sidebar deixou de exibir a versão duplicada e mantém apenas "100% local". O workflow faz o build da UI após o bump de versão, então cada release reflete o número correto sem edição manual.

## [0.1.02] — 2026-11-12

### Fixed

- **Sidebar fixa com scroll independente na área de conteúdo**: refatoração do shell para o padrão de dashboard clássico — raiz `flex h-screen overflow-hidden`, sidebar `h-full` (navegação com `overflow-y-auto` interno e rodapé fixo via `mt-auto`), `<main>` `flex-1 flex-col h-full overflow-hidden` e o wrapper de conteúdo com `flex-1 overflow-y-auto overflow-x-hidden`. A sidebar não rola mais com a página, o rodapé da sidebar (versão + "100% local") fica sempre visível e não há scroll horizontal nem layout shift na troca de rotas. Colapso responsivo da sidebar em telas < 768 px fica como item futuro (app é desktop-first).

## [0.1.01] — 2026-11-12

### Fixed

- **Porta padrão `3030` → `4040`**: `config.json` (default + `officialRedirectUri`), fallback do servidor e do launcher, proxy do Vite em dev, textos de ajuda e documentação.
- **`jsonStore` tolerante a BOM**: arquivos JSON editados por ferramentas externas (ex.: `Set-Content` do PowerShell grava BOM) não são mais tratados como corrompidos — o store remove o BOM antes do parse.
- **Compatibilidade publicada no npm**: `@danhachuel/jobfinder@0.1.0` (visual `0.1.00`) publicada via workflow (`latest` + `next`), instalável via `npx`.

## [0.1.00] — 2026-11-12

First functional release of JobFinder (deliverables of PRD §12):

- App installable via `npx @danhachuel/jobfinder` with a local React+Vite+Tailwind UI at `localhost:4040`
- Módulo 1 (Postagens): manual + agendada + geração por LLM (OpenAI, Anthropic, DeepSeek, Ollama local)
- Módulo 2 (Conexões & DMs): convites com variáveis, limite semanal de 100, cascatas com até 5 mensagens/dia
- Módulo 3 (Vagas): match semântico currículo↔vaga, busca com score, Easy Apply em dry-run (Playwright opcional para live)
- Armazenamento 100% local em JSON (`~/.jobfinder/`) — nenhum banco externo, nenhum servidor do JobFinder
- Workflow `publish-npm.yml` ativo (smoke tests + dist-tag `next` → `latest`)
- Pasta `legal/` completa em inglês
- `README.md` com instalação/uso e `CHANGELOG.md` histórico

### Fixed

- `.gitignore`: o padrão amplo `storage/` escondia `src/server/storage/` do commit (quebrava o `npm ci` do CI e o pacote npx). Agora ancorado na raiz: `/storage/` e `/.jobfinder/`.
- `package-lock.json` (raiz e `src/ui`) sincronizados com o bump `0.1.00` ( exigência do `npm ci` no CI).

## [0.0.01] — 2026-11-12

### Added

- **npx launcher** `jobfinder` (`scripts/cli.mjs`): `install` creates the `~/.jobfinder/` skeleton (idempotent, never overwrites data); the default command starts the local server on `localhost:4040`. Flags: `--port`, `--host`, `--data-dir`, `--open/--no-open`, `--dry-run`, `--version`, `--help`.
- **Root `package.json`**: `@danhachuel/jobfinder`, ESM, `bin.jobfinder`, scripts `dev`/`dev:server`/`dev:ui`/`build`/`start`/`install`, engines `node >= 20.19`. Dependencies: `express`, `mammoth`, `pdfjs-dist`; optional: `playwright` (loaded on demand for Easy Apply); dev: `concurrently`.
- **Local JSON store bootstrap** (`src/server/storage/bootstrap.mjs`): `config.json` (LLM provider, LinkedIn auth mode, rate limits, dry-run), `channels/topics/posts/connections/dm-cascades/jobs/applications/resume.json`, `logs/`, plus 3 seed topics. Data directory: `~/.jobfinder/`, overridable via `JOBFINDER_HOME` or `--data-dir`.
- **Backend core**:
  - `src/server/storage/jsonStore.mjs` — atomic JSON reads/writes (tmp + rename) with a per-file serialization queue, plus collection helpers (query with filter/sort/pagination, create/patch/remove).
  - `src/server/storage/logger.mjs` — daily JSONL logs in `logs/YYYY-MM-DD.jsonl` with automatic secret redaction and a `tail`/`dates` reader for the UI.
  - `src/server/middleware/rateLimiter.mjs` — central `RateLimiter` (human-like random delays 1–4 s, per-action-key throttle) + `countToday` / `countThisWeek` quota helpers.
  - `src/server/middleware/errors.mjs` — `HttpError` + `asyncRoute`; the central error handler maps errors to a stable `{ error: { code, message } }` shape.
  - `src/server/app.mjs` — Express 5 app factory: JSON body parsing, `/api` router, static serving of the built UI with SPA fallback, 503 hint when the UI build is missing.
  - `src/server/index.mjs` — entrypoint with `EADDRINUSE` guidance and graceful shutdown; env overrides `JOBFINDER_PORT` / `JOBFINDER_HOST` / `JOBFINDER_DATA_DIR` / `JOBFINDER_DRY_RUN`.
  - Routes: `GET /api/health`, `GET /api/logs`, `GET /api/config`, `PUT /api/config` (validated partial merge; secrets are redacted in responses).
- **LinkedIn layer** (`src/server/services/linkedin/`):
  - `cookies.mjs` — Netscape/JSON `cookies.txt` parsing, cookie-header builder, session sanity check (`li_at` + `JSESSIONID`).
  - `officialApi.mjs` — OAuth 2.0 (authorization URL, code exchange, refresh) + REST `/rest/posts` (fallback `ugcPosts`) + OpenID profile; outreach clearly flagged as unsupported on the official API.
  - `voyagerClient.mjs` — cookie fallback client (ported from cv-cat/LinkedinApis, davidobbs anti-detection, Isaac-Foster invitations): people search, invitations, messaging (conversations/events), job search, cookie posting, JSESSIONID rotation on 403.
  - `dryRun.mjs` — simulation client (people, conversations, jobs, posts, DMs) so the whole app is explorable with zero credentials; every result is flagged `simulated: true`.
  - `index.mjs` — unified facade selecting `dry-run` (default) / `official` / `cookie` per the active channel; channel factory + secret redaction.
  - Routes: `GET /api/channels`, `GET /api/linkedin/status`, `POST /api/linkedin/test`, `POST /api/channels/official`, `POST /api/channels/oauth/start`, `GET /api/channels/oauth/callback`, `POST /api/channels/cookies` (raw body), `POST|DELETE /api/channels/:id`.
- **Módulo Conexões & DMs** (`src/server/services/outreach/`):
  - `templates.mjs` — `{{nome}}`/`{{empresa}}`/`{{cargo}}` interpolation with headline parsing; 300-char invitation limit.
  - `invitations.mjs` — keyword search + batch sends through the central rate limiter; weekly quota (default 100) enforced per invite; history in `connections.json`.
  - `cascades.mjs` — DM cascade engine: sequences up to 5 messages/day (hard limit), min interval (default 30 min), per-step `delayDays`, automatic pause on reply detection, manual approval gate; stats ("X de 5 hoje").
  - Routes: `POST /api/connections/search`, `POST /api/connections/invitations`, `GET /api/connections`, `GET /api/connections/limits`, `GET|POST /api/cascades`, `POST /api/cascades/:id/status|approve`, `GET /api/cascades/stats`, `POST /api/cascades/tick|check-replies`.
- **Módulo Vagas** (`src/server/services/jobs/`):
  - `resumeParser.mjs` — local extraction for PDF (pdfjs-dist), DOCX (mammoth) and TXT; skills, titles, years, education and languages; stored in `resume.json`.
  - `matcher.mjs` — TF-IDF + cosine semantic match (offline), calibrated 0–100 score, skill gaps and recommendation (ported from Parthshewale18/AI-Resume-Job-Matcher).
  - `jobSearch.mjs` — job search through the LinkedIn facade with automatic scoring; save/discard/status in `jobs.json`.
  - `easyApply.mjs` — Easy Apply automation: dry-run is the default; live mode uses Playwright (optional dependency) with the channel session cookies, human pacing and `needs_intervention` reports; daily quota (default 20).
  - Routes: `POST|GET /api/resume`, `POST /api/jobs/search`, `GET|POST /api/jobs`, `POST /api/jobs/:id/status|match`, `GET /api/jobs/stats`, `GET|POST /api/applications`, `POST /api/applications/:id/retry`, `GET /api/applications/limits`.
- **Dashboard**: `GET /api/dashboard` aggregates connection state, module counters, 7-day publishing series, invitations series, DM daily state and recent logs for the Painel page.
- **Workers**: `src/server/services/workers.mjs` — single internal cron (every minute) running the post scheduler + cascade engine and inbox monitoring every 10 minutes.
- **UI React + Vite + Tailwind v4** (`src/ui/`, visual base = LeadMaster):
  - `index.css` — Tailwind v4 CSS-first theme: sidebar `#1e1b4b`, accent `#818cf8`, Inter (bundled via @fontsource-variable/inter), component classes (card, btn, input, sidebar-link).
  - `components/Sidebar.jsx` — sidebar escura com grupos colapsáveis (Conexões, Vagas) e o botão fixo "Criar API Oficial do LinkedIn" com badge "⚠ Recomendado" quando não configurado.
  - `components/Layout.jsx` + `Header.jsx` — shell com título da página, badge de dry-run/conectado, "Ver tutorial" e avatar.
  - `components/` — `MetricCard`, `ProgressBar`, `QuotaBar` (Goal Gradient), `StatusBadge`, `Spinner`, `EmptyState`, `Modal`, `Toast` e charts Chart.js (`BarsChart` horizontais + `DoughnutChart`).
  - Páginas (9 rotas): `Dashboard` (cards, quotas, 2 gráficos, checklist de onboarding, atividade), `Postagens` (compositor manual + preview lado a lado + histórico com filtros/paginação), `Agendar` (geração LLM com preview obrigatório, fila com barra de progresso), `Conexoes` (busca por palavra-chave, seleção em lote, `{{variáveis}}`, barra "X de 100"), `DmCascades` (até 5 mensagens/dia, delays em dias, aprovação manual, pausa por resposta, "X de 5 hoje"), `Vagas` (upload de currículo PDF/DOCX/TXT, match score + lacunas, salvar/descartar, candidatar dry-run), `Candidaturas` (histórico, relatório, retry, cota diária), `Integracoes` (OAuth oficial, upload de cookies.txt com passo a passo, canais ativar/remover, avisos de risco, suporte), `Config` (LLM, limites de rate, servidor, temas CRUD).
  - `vite.config.js` — dev em :5173 com proxy `/api` → :4040; build em `src/ui/dist` (servido pelo backend em produção).
- **CI/CD**: `.github/workflows/publish-npm.yml` (adaptado do modelo Thunderbolt): triggers `workflow_dispatch` (inputs `version`, `dist_tag=next`) + push de tags `v*`; validação da versão visual `MAJOR.MINOR.PATCH` com PATCH de 2 dígitos, `npm ci`, build da UI, `node --check` do launcher, checagem de metadados do pacote (nome `@danhachuel/jobfinder`, `bin.jobfinder`), `npm pack --dry-run`, smoke test do `install` (skeleton JSON completo) e boot da API em dry-run, publish com `--tag next`, verificação do tarball publicada e promoção a `latest` no push de tag.
- **`legal/` (em inglês)**: `index.html` (índice + fatos-chave), `privacy.html` (política de privacidade) e `terms.html` (termos de uso), adaptados do Thunderbolt para o domínio JobFinder, com as menções obrigatórias: uso por conta e risco do usuário, possível violação dos Termos de Serviço do LinkedIn, armazenamento 100% local (sem coleta de dados), nenhum dado transmitido a servidores do JobFinder, cookies de sessão armazenados localmente e nunca compartilhados, usuário responsável por respeitar os limites de rate do LinkedIn.
- **README.md completo**: o que é/onde o faz, requisitos (Node ≥ 20.19, Playwright e Ollama opcionais), comandos de instalação (CMD/MobaXterm + normal), fluxo de uso, flags do launcher, layout de `~/.jobfinder/`, desenvolvimento, política de publicação (versionamento visual + GitHub Actions) e links legais. Remoção dos `.gitkeep` obsoletos e `*.tgz` adicionado ao `.gitignore`.
- **Directory skeleton** for the backend (`src/server/routes`, `src/server/storage`, `src/server/services/{linkedin,llm,posting,outreach,jobs}`) and the UI (`src/ui/{public,src/{components,pages,lib}}`).
- **`.gitignore`** protecting `node_modules/`, `dist/`, `storage/`, `.jobfinder/`, `.env`, `cookies.txt` and logs.
