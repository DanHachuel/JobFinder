# Changelog

All notable changes to JobFinder are documented in this file.

**Version labels** use a two-digit PATCH (`0.0.01` → after `0.0.99` comes `0.1.00`; after `0.9.99` comes `1.0.00`). npm publishes the normalized SemVer form (`0.0.01` → `0.0.1`), which is what install commands must use.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.0.01] — 2026-11-12

### Added

- **npx launcher** `jobfinder` (`scripts/cli.mjs`): `install` creates the `~/.jobfinder/` skeleton (idempotent, never overwrites data); the default command starts the local server on `localhost:3030`. Flags: `--port`, `--host`, `--data-dir`, `--open/--no-open`, `--dry-run`, `--version`, `--help`.
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
- **Directory skeleton** for the backend (`src/server/routes`, `src/server/storage`, `src/server/services/{linkedin,llm,posting,outreach,jobs}`) and the UI (`src/ui/{public,src/{components,pages,lib}}`).
- **`.gitignore`** protecting `node_modules/`, `dist/`, `storage/`, `.jobfinder/`, `.env`, `cookies.txt` and logs.
