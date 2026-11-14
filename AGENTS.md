# AGENTS.md — JobFinder

> **⚠️ ATENÇÃO AGENTE:** Antes de iniciar qualquer tarefa, leia todos os arquivos em
> `.agents/skills/*/SKILL.md`. Eles contêm regras críticas para evitar regressões.
> Siga-as à risca. **Na dúvida, não altere.**

## Skills obrigatórias

| Skill | Quando ler | Regra central |
|---|---|---|
| `systemic-view-guard` | toda tarefa | antes de alterar um arquivo, verifique quem depende dele |
| `parallel-session-guard` | início de tarefa, pré-commit, pré-push | uma sessão por repositório; `git status` antes de commitar; `rebase` antes do push |
| `surgical-scope-guard` | toda edição | menor diff possível; arquivos sensíveis só com autorização explícita |
| `atomic-write-guard` | qualquer escrita em `storage/` | só via `JsonStore`; nunca `fs.writeFileSync` em estado |
| `windows-runtime-guard` | launcher, servidor, processos, spawn | manter handlers de EPIPE/rejection; `stdio: 'pipe'`, `windowsHide` |
| `contract-test-guard` | testes e correção de bugs | testar comportamento (HTTP/clique/persistência), não strings |
| `react-state-guard` | UI React | backend é a fonte da verdade; sem `setInterval` sem limpeza |

## Regras de projeto

1. **Versão.** Visual `MAJOR.MINOR.PATCH` com PATCH de dois dígitos (`0.1.06`); o npm
   publica a forma canônica (`0.1.6`). Bump em `package.json`, `src/ui/package.json` e nos
   dois `package-lock.json`.
2. **CHANGELOG.** Uma entrada por release, no topo, em `Keep a Changelog`.
3. **Release.** Exclusivamente via GitHub Actions
   (`.github/workflows/publish-npm.yml`): commit → push → `workflow_dispatch` com
   `dist_tag=next` → push da tag `v0.1.06` promove a `latest`. Nunca `npm publish` local.
4. **Push.** Após o commit: `git fetch origin` + `git rebase origin/main` + `git push origin main`.
5. **Testes.** Rodar a suíte antes de commitar; com falha, **não commitar**:
   ```bash
   node scripts/manual-tests/fase1-auth-dryrun.mjs
   node scripts/manual-tests/fase1-dryrun-services.mjs
   node scripts/manual-tests/fase1-ui-e2e.mjs
   node scripts/manual-tests/startup-keepalive.mjs
   node --test tests/*.js          # contratos/concorrencia/UI (stubs por enquanto)
   ```
   > `node --test tests/` não funciona no Node 22: a pasta `tests/` não é auto-detectada
   > (só `test/` é). Use sempre o glob `tests/*.js`.
6. **Sessões paralelas.** Se encontrar alterações que não são suas no working tree: **pare**,
   reporte e pergunte — não descarte nem comite trabalho alheio.
7. **Documentação.** Mudança de comportamento → atualizar `README.md` (comandos de
   instalação, uso) e `CHANGELOG.md` no mesmo commit.

## Mapa rápido do repositório

```
scripts/
  cli.mjs                  # launcher npx (arquivo sensível)
  manual-tests/            # suíte de smoke/E2E atual
src/server/
  index.mjs                # entrypoint, sinais, workers (arquivo sensível)
  app.mjs / context.mjs    # factory Express + singletons
  middleware/              # auth.mjs (sessão), errors.mjs, rateLimiter.mjs
  routes/                  # contratos HTTP (/api/*)
  services/                # posting, outreach, jobs, llm, linkedin, workers
  storage/                 # jsonStore.mjs (atômico), bootstrap, logger, authStore
src/ui/
  src/lib/                 # api.js, auth.jsx
  src/components/          # Layout, Sidebar, Header, Widgets, Toast, Charts
  src/pages/               # Dashboard, Postagens, Agendar, Conexoes, DmCascades,
                           # Vagas, Candidaturas, Integracoes, Config, Login
tests/                     # stub de contratos/concorrencia/UI (node --test)
.agents/skills/            # este conjunto de regras
```

## Convenções

- ESM com extensão `.mjs` no servidor; `.jsx` no UI.
- Rotas: `asyncRoute` + `HttpError` (`middleware/errors.mjs`); respostas de erro no formato
  `{ error: { code, message } }`.
- Mensagens de UI em português; identificadores e comentários de código em inglês.
- Estado persistido em `~/.jobfinder/` (override: `JOBFINDER_HOME`, `--data-dir`).
- Nenhum dado sai da máquina do usuário; nenhum servidor do JobFinder.