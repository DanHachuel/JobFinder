# Changelog

All notable changes to JobFinder are documented in this file.

**Version labels** use a two-digit PATCH (`0.0.01` → after `0.0.99` comes `0.1.00`; after `0.9.99` comes `1.0.00`). npm publishes the normalized SemVer form (`0.0.01` → `0.0.1`), which is what install commands must use.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.18] — 2026-11-25

### Fixed

- **UI não servida no modo daemon (`{"error":{"code":"internal_error","message":"Not Found"}}` na raiz)**: o fallback SPA usava `res.sendFile(caminhoAbsoluto)` — no **Express 5** um caminho absoluto sem a opção `root` falha com 404 "Not Found", que chegava ao handler central e era devolvido como JSON. Os assets (servidos pelo `express.static`) funcionavam, o que mascara o diagnóstico. Agora o fallback usa a forma canônica `res.sendFile('index.html', { root: UI_DIST })` — `/`, `/login`, `/configuracoes` e qualquer rota do React Router voltaram a servir o `index.html` (HTTP 200, `text/html`).
- `src/ui/dist/` já estava no `files` do `package.json` e o `setupRuntime()` já copiava o dist para `~/.jobfinder/runtime/src/ui/dist` — a cópia não era a causa; o bug era exclusivamente do `sendFile` no Express 5.

## [0.1.17] — 2026-11-23

### Added

- **Runtime permanente (`setupRuntime`)**: o código do servidor é copiado para `~/.jobfinder/runtime` (`src/server` + `src/ui/dist` + `package.json` enxuto, com marcador `.version`). A cópia só é refeita quando falta o entrypoint ou quando a versão muda — atualizar de versão nunca reimplanta o resto. **O Express nunca mais sobe de dentro do cache do npx**: essa era a causa raiz do `EBUSY` no Windows (o npx renomeia/limpa o cache enquanto um processo vivo segura arquivos lá dentro).
- **Dependências instaladas dentro do runtime**: `npm install --prefix ~/.jobfinder/runtime --omit=dev` (express, mammoth, pdfjs-dist; playwright segue opcional). O runtime é autossuficiente — nenhum symlink/junction de volta para o cache do npx, que reintroduziria o EBUSY. `NODE_OPTIONS` é removido do ambiente do npm: um preload da aplicação (`--require`, `--inspect`) não pode mais quebrar o instalador. Falha na instalação aborta o start com mensagem clara em vez de spawnar um servidor que morreria em seguida.
- **Daemon por padrão**: `npx @danhachuel/jobfinder` (ou `jobfinder start`) sobe o servidor **destacado** (`detached: true`, `windowsHide: true`, `CREATE_NEW_PROCESS_GROUP`) com `stdio` em `~/.jobfinder/jobfinder.log` e volta ao prompt: `JobFinder iniciado em background (PID: XXXX). Acesse http://127.0.0.1:4040.` O terminal (MobaXterm, wrapper do npx, PowerShell) pode fechar sem levar o servidor junto.
- **Lock de instância `~/.jobfinder/jobfinder.pid`**: registra PID, porta e versão. `jobfinder stop` (ou `--stop`/`--daemon-stop`) encerra por PID — `taskkill /PID /T` no Windows, grupo de processos no Unix — e ainda usa o **dono da porta** (`netstat`) como rede de segurança para lock obsoleto. Antes de subir, o launcher mata a instância anterior (evita servidores zumbis e UI nova servida por backend velho).
- **`--foreground`**: modo de depuração que sobe o servidor do runtime preso ao terminal, com a saída encaminhada por pipe (nunca `inherit`) e Ctrl+C encerrando a árvore de processos.
- **O servidor passou a supervisionar o worker**: desde que o servidor é o daemon, o launcher não existe mais para isso. `src/server/index.mjs` spawna `worker.mjs`, reinicia em quedas (teto de 5) e o encerra no shutdown gracioso — worker morto nunca derruba o servidor.
- **`ecosystem.config.cjs` reescrito para 0.1.17**: o PM2 aponta para o servidor do runtime (resolvido em runtime) em vez do `cli.mjs` — um PM2 que apontasse para o launcher acharia que o app "encerrou" logo após subir, porque o launcher destaca e retorna.
- **`scripts/start-windows.ps1` reescrito**: delega ao CLI (que já faz runtime + daemon) e apenas orquestra — detecta porta em uso, dispara, confere o `/api/health`, informa PID/log/como parar. Sem `&` e sem `Start-Process -Wait`/redirecionamento: o PowerShell ficava pendurado esperando handles do processo nativo.

### Changed

- **`scripts/cli.mjs` deixou de ser o servidor**: agora é launcher puro (runtime + daemon + lock). `install`, `--version`, `--help` e `stop` continuam leves; `start` passou a ser alias do daemon.
- `stop` passa a resolver a porta pelo lock (`env > lock > 4040`), então encerra a instância certa mesmo sem `JOBFINDER_PORT` no ambiente.

### Fixed

- **`npm install` do runtime quebrado por preload da aplicação**: `NODE_OPTIONS` vazava para o npm (ex.: injeção de falha dos testes, `--inspect`) e instalava nada — o servidor então morria com `ERR_MODULE_NOT_FOUND: express`. O ambiente do npm é limpo e a falha agora aborta o start.

### Tests

- Nova suíte `scripts/manual-tests/fase6-runtime-daemon.mjs` — **40 verificações, 0 falhas**: runtime criado com `.version` correto, UI copiada, `node_modules` não copiado, **linha de comando do daemon aponta para `~/.jobfinder/runtime/src/server/index.mjs`** (prova de que não roda do cache do npx), log em disco com a versão correta, sobrevivência à morte do terminal, lock escrito, segunda execução não empilha instâncias, lock obsoleto não impede arranque, `stop` encerra e limpa, `--foreground` prende o servidor, e o **servidor spawnando o worker** (com `worker-state.json` e processo vivo).
- Suítes adaptadas à arquitetura nova: `startup-keepalive` (38/38 — home compartilhado para instalar o runtime uma vez; eventos do worker agora são lidos do JSONL), `fase2-worker` (39/39), `fase4-npx-start` (12/12), `fase5-daemon` (22/22). Regressão completa: **228 checks, 0 falhas**.

## [0.1.16] — 2026-11-22

### Added

- **Modo daemon (`node scripts/cli.mjs --daemon`)**: o servidor sobe **detached** do terminal interativo e sobrevive ao fechamento da sessão — a resposta definitiva ao terminal (MobaXterm, wrapper do `npx`, PowerShell) que mata o processo filho. `stdio: ['ignore', <log>, <log>]` (nunca `inherit`), `windowsHide`, `creationFlags: CREATE_NEW_PROCESS_GROUP`, estado do daemon em `jobfinder-daemon.json` via **JsonStore** (atômico, nunca `fs.writeFileSync`). O terminal volta ao prompt em ~300 ms.
- **Comando `stop`** (`--stop` / `--daemon-stop`): encerra o daemon com SIGTERM, espera o encerramento gracioso, força com SIGKILL se necessário e limpa o pid do registro. Roda limpo quando não há daemon.
- **`scripts/start-windows.ps1`** (+ wrapper `start-windows.cmd` para duplo clique): detecta porta em uso, sobe o daemon via `Start-Process` (desacoplado dos pipes do terminal — com `&` ou `Start-Process -Wait` o PowerShell fica pendurado esperando handles do processo nativo), confere o `/api/health` e informa PID, log e como parar. Flag `-Local` usa o working copy; `-Version` fixa a versão do npm.
- **`ecosystem.config.cjs` + scripts PM2** (`pm2:start`, `pm2:stop`, `daemon:logs`): JobFinder como serviço real, com reinício automático em caso de crash. `pm2` entra como **optionalDependency** — a regra do projeto é executar nativamente, sem infraestrutura obrigatória; sem pm2 tudo continua funcionando.
- **README**: nova seção "Rodando como Serviço (Windows/Linux)" comparando as quatro formas (foreground / `--daemon` / script Windows / PM2).

### Notas

- O daemon grava o log em `~/.jobfinder/jobfinder.log` (respeita `JOBFINDER_HOME`/`JOBFINDER_DATA_DIR`).
- `JOBFINDER_MODE=daemon` é propagado ao processo para identificar o modo no ambiente.
- Validado: `npm ci` continua instalando pm2 como dependência opcional sem falhar (245 pacotes).

### Tests

- Nova suíte `scripts/manual-tests/fase5-daemon.mjs` — **21 verificações, 0 falhas**: launcher volta ao prompt com código 0 em < 8 s, pid registrado, HTTP 200, log em disco com a versão correta (não `0.0.00`), daemon sobrevive à morte do terminal, rodar duas vezes não duplica, `stop` encerra e limpa o registro, `stop` sem daemon não quebra.
- PM2 validado ponta a ponta: `pm2 start ecosystem.config.cjs` → app `online` (pid + uptime), `/api/health` 200, `pm2 stop` → `stopped`.
- Script Windows validado ponta a ponta (`-Local`): start → HTTP 200 e `exit 0` sem travar; `-Stop` → porta não responde mais e `exit 0`.

## [0.1.15] — 2026-11-21

### Fixed

- **Versão `0.0.00` ao rodar via `npx`**: `readPkgVersion()` em `src/server/index.mjs` lia `package.json` com `path.resolve(process.cwd(), 'package.json')`. Sob `npx` o cwd é o diretório do usuário (home do MobaXterm, um path qualquer do PowerShell), a leitura falhava em silêncio e o servidor imprimia `JobFinder v0.0.00 (npm 0.0.0)`. Agora a versão vem de `JOBFINDER_VERSION` (definida pelo launcher, que lê o `package.json` a partir da própria localização do arquivo) ou, na ausência dela, de `createRequire(import.meta.url)` + `require('../../package.json')` — resolvido a partir **deste módulo**, nunca do cwd. O fallback ruidoso (`console.error`) substitui o silencioso.
- **Retenção do event loop com rastro forense**: `beforeExit` no launcher **e** no servidor registra os handles ativos antes de qualquer saída natural e re-arma um timer de keep-alive **referenciado** (sem `unref()`) quando o socket do servidor não está entre eles — a saída silenciosa agora é impossível sem deixar `[jobfinder] launcher: event loop esvaziando (beforeExit code=…) — handles: …` no terminal. `exit` registra o código final nos dois processos. Nenhum `server.unref()` e nenhum `process.exit(0)` no caminho de startup.

### Tests

- Nova suíte `scripts/manual-tests/fase4-npx-start.mjs` — **12 verificações, 0 falhas**, rodando o binário de um **diretório estranho** (reprodução do ambiente `npx`/MobaXterm): versão correta na linha do `listen`, processo vivo depois do banner, HTTP 200, caminho `node src/server/index.mjs` direto sem `JOBFINDER_VERSION` (valida o `createRequire`) e caminho completo com worker ativo.

## [0.1.14] — 2026-11-20

### Security

- **Saneamento de credenciais — nenhuma senha em nenhuma superfície**: removido o cartão âmbar de "Primeiro acesso" da tela de login, que exibia e-mail e senha padrão. O terminal já não os exibia (0.1.12) e agora nenhuma rota, resposta de API, log ou documento os expõe.
- **Rota `GET /api/auth/defaults` descontinuada**: era o canal que alimentava o cartão com o e-mail do usuário semeado. Removida do router — nenhum endpoint devolve mais credenciais.
- **Onboarding por variável de ambiente**: o first-run account aceita `JOBFINDER_INITIAL_EMAIL` e `JOBFINDER_INITIAL_PASSWORD` (mínimo de 6 caracteres). Sem elas, o seed embutido é usado e a senha deve ser trocada em **Configurações → Segurança** no primeiro acesso. O valor nunca é renderizado em lugar nenhum.
- **Smoke test do CI sem credenciais no repositório**: `.github/workflows/publish-npm.yml` define as variáveis de seed dentro do step, em vez de embutir e-mail/senha no arquivo versionado.
- **Documentação**: README e CHANGELOG sem credenciais; a seção "First login" passa a explicar o onboarding (env/`auth.json`) sem citar senha. Nota correspondente adicionada à tela de login.

### Notas

- A tela de login ficou apenas com o formulário (e-mail, senha, mostrar/ocultar, entrar) e a nota de onboarding em texto simples.
- Instalações existentes não são afetadas: um `auth.json` já criado é preservado e as env vars só valem na primeira criação.

## [0.1.13] — 2026-11-20

### Changed

- **Arquitetura: servidor Express embutido no processo do CLI (fim do `spawn`)**: `scripts/cli.mjs` agora importa `start()` de `src/server/index.mjs` diretamente e roda o `app.listen()` **no próprio processo**. Um socket de servidor escutando na porta mantém o event loop do Node aberto **matematicamente** — nenhum comportamento de terminal hostil (MobaXterm, wrapper do npx, redirecionamento, pipes fechados) pode mais esvaziá-lo. Esta é a correção definitiva para o encerramento prematuro que perseguia o Windows desde a 0.1.7.
- **Worker desacoplado e silencioso**: o worker continua sendo processo filho (tarefas pesadas não travam a UI), mas agora com `stdio: ['ignore','ignore','ignore']` — ele **grava seus logs em arquivo** (`worker.log` para o ciclo de vida e `worker-error.log` para falhas). Um terminal que engasga ao ler os pipes do worker não tem mais como perturbá-lo. A detecção de órfão por `stdin` EOF e o `JOBFINDER_TAKEOVER` permanecem.
- **Sinais**: o CLI encerra o worker no primeiro Ctrl+C e o shutdown gracioso do servidor (mesmo processo) assume a partir daí; o segundo sinal força a saída.

### Fixed

- **Resiliência inquebrável do launcher**: `keep-alive` de 24 h sem `unref()` no `start`, handlers de `unhandledRejection`/`uncaughtException`/EPIPE no topo e o registro `[jobfinder] launcher exiting with code N` — nenhuma morte futura fica sem explicação.

### Tests

- **Novo teste de estresse** (`startup-keepalive.mjs`, ambiente hostil): sobe o app pelo CLI, **destrói o `stdout`/`stderr` do launcher** (simulando a queda do MobaXterm) e **mata o worker à força** — o CLI continua vivo, o servidor responde HTTP 200 em todos os pontos e o worker é reiniciado. Suíte completa: 38 keepalive + 39 fase2-worker + 32 auth + 16 serviços + 22 E2E + 5 unit.

## [0.1.12] — 2026-11-18

### Security

- **Remoção definitiva da senha no terminal**: a linha `Login: <email> / <senha>` foi **deletada** do startup do servidor — o terminal não exibe mais e-mail nem senha (a recomendação de troca de senha continua apenas na UI, em Configurações → Segurança). Verificado em boot real: stdout/stderr sem senha, sem e-mail e sem `Login:`.

### Fixed

- **`EPERM` no `rename` atômico (Windows)**: `JsonStore.write` agora usa `renameAtomic` — em `EPERM`/`EACCES`/`EBUSY` (antivírus, editor ou outro processo segurando o destino) o rename é retentado com backoff (5 × 50 ms) e, se ainda falhar, o destino é removido antes da última tentativa (`unlink` + `rename`); falha definitiva limpa o `.tmp` e propaga o erro. Nenhum `.tmp` órfão em nenhum caminho.
- **Worker não morre por falha de escrita de estado**: `patchState`/`patchStateSync` envolvem a escrita em try/catch — `EPERM` (ou qualquer erro de I/O) VAI para `worker-error.log` + log + console e a escrita é tentada de novo no próximo tick/heartbeat; `process.exit` não é chamado.
- **Restart do worker determinístico (fim do falso "outro worker dono")**: (1) detecção de órfão por **pipe** — o supervisor mantém o stdin do worker aberto; quando ele morre (inclusive kill externo), o worker vê EOF e se encerra na hora, sem depender de `ppid` (que o Windows recicla); (2) o launcher passa `JOBFINDER_TAKEOVER=1` em seus spawns — no boot e no restart, uma heartbeat velha de pid reciclado nunca mais bloqueia o worker novo.
- **Loop do worker à prova de fuga síncrona**: callbacks dos timers (tick e heartbeat) em try/catch, com re-agendamento.

### Tests

- `tests/test_atomic_write_concurrency.js` (stub → real, node:test): 40 updates concorrentes sem perder registro, mutator que lança preserva o arquivo anterior, `.tmp` restante não quebra o store, **rename travado com EPERM retentado até dar certo** e **EPERM permanente falhando alto sem .tmp órfão**.
- `startup-keepalive.mjs`: novo cenário **worker direto com rename sabotado (EPERM permanente)** — sobrevive, registra em `worker-error.log`. Suíte: 32 keepalive + 39 fase2-worker + 32 auth + 16 serviços + 22 E2E.

## [0.1.11] — 2026-11-16

### Fixed

- **Crash do Worker (exit `4294967295` / `0xFFFFFFFF`) não encerra mais o processo principal** (Windows/MobaXterm): o launcher passou a **supervisionar** o worker — a saída dele só é registrada (`[jobfinder] worker encerrou (code/signal). O servidor web continua rodando.`) e, com o servidor no ar, um worker novo é iniciado automaticamente (até 5 tentativas, 3 s de intervalo; nunca durante o shutdown — sem órfãos). `process.exit` não é chamado nesse caminho.
- **Worker não morre mais por falha de I/O no console**: escritas em `stdout`/`stderr` passaram por um helper à prova de throw (`safeWrite`); `unhandledRejection` é registrado e o processo **continua rodando** (antes um EPIPE/escrita quebrada no MobaXterm podia derrubar o worker); `uncaughtException` registra e sai(1) — com o launcher reiniciando o worker.
- **`worker-error.log`**: falhas inesperadas do worker (rejection, exceção, erro de stdio) agora são gravadas em `<dataDir>/worker-error.log` — o único artefato que sobrevive a um pipe morto, permitindo diagnosticar o crash no terminal hostil.
- **Heartbeat fresca de pid morto não bloqueia mais um worker novo**: `anotherWorkerOwnsState()` confirma que o pid dono do estado está vivo (`process.kill(pid, 0)`). Sem isso, um worker morto por kill externo (que no Windows pula o handler de exit) deixava a heartbeat "fresca" e o restart seria recusado como duplicado.
- **Loop do worker à prova de fuga**: os callbacks dos timers (tick e heartbeat) estão envoltos em try/catch — uma falha síncrona é reportada e o loop é re-agendado, nunca abandonado.

### Changed

- Mensagem de encerramento do worker no launcher agora é em português e explícita sobre a continuidade do servidor.

### Tests

- `startup-keepalive.mjs` cobre o worker de ponta a ponta: crash do worker com o CLI vivo + **restart automático** (pid novo assumindo a fila), `worker-error.log` com rejection injetada, worker sobrevivendo a EPIPE com heartbeat no disco. Suíte: 29 keepalive + 39 fase2-worker + 32 auth + 16 serviços + 22 E2E.

## [0.1.10] — 2026-11-15

### Documentation

- **Regra permanente de infraestrutura**: nova seção "Regras de Infraestrutura" no `AGENTS.md` — **Multiplataforma e Sem Docker Obrigatório**. O JobFinder deve rodar nativamente no Windows e no Linux; é proibido adicionar dependências obrigatórias de Docker/containers para desenvolvimento, testes ou execução; nada pode quebrar a execução direta via Node.js em nenhum dos dois sistemas; compatibilidade cruzada via bibliotecas nativas do Node (`path`, `os`, `node:fs`, `node:child_process`).
- **Skill `windows-runtime-guard` → `runtime-guard`** (renomeada para refletir o escopo multiplataforma): além do Blindagem de runtime (EPIPE, sinais, spawn), passou a documentar explicitamente a regra de execução nativa em Windows e Linux sem imposição de Docker, com item dedicado no checklist. Referências atualizadas no `AGENTS.md` e na stub `tests/test_windows_keepalive.js`.

## [0.1.08] — 2026-11-15

### Fixed

- **Encerramento prematuro do CLI após a introdução do Background Worker** (regressão da 0.1.7): o launcher delegava 100% da sua sobrevivência aos handles dos processos filhos — com o event loop vazio, o Node saía com código 0 **em silêncio**, logo após o banner de startup, e o terminal voltava ao prompt. Causas combinadas: (1) nenhum keep-alive próprio no `cli.mjs`; (2) o servidor era spawnado com `stdio: 'inherit'` (proibido pela `windows-runtime-guard` — um terminal quebrado, ex. MobaXterm, o matava com EPIPE); (3) o guardião de órfãos do worker tratava **qualquer** erro ≠ EPERM do `process.kill(ppid, 0)` como "pai morreu", podendo se suicidar por falso-positivo no Windows. Agora: o `cli.mjs` tem um keep-alive referenciado (timer de 60 s, independente de qualquer filho); o servidor é spawnado via `spawnSupervised` com `stdio: ['ignore','pipe','pipe']` + `windowsHide` + `CREATE_NEW_PROCESS_GROUP`, com a saída encaminhada pelo launcher (o servidor não escreve mais direto no terminal); o guardião só considera o pai morto em **ESRCH** (pid inexistente); e o launcher passou a registrar `[jobfinder] launcher exiting with code N` para que nenhuma morte futura fique sem explicação.

### Added

- Regressão `startup-keepalive.mjs` cobre o worker: sobe o app pelo launcher, confirma pid/heartbeat em `worker-state.json`, **mata o worker e o CLI continua vivo servindo HTTP 200** (só loga `worker exited`), e valida o modo `JOBFINDER_NO_WORKER=1`. Suíte: 21 keepalive + 39 fase2-worker + 32 auth + 16 serviços + 22 E2E.

## [0.1.07] — 2026-11-14

### Added

- **Background Worker autônomo (`src/server/worker.mjs`)**: processo Node separado que mantém as automações rodando com o navegador fechado (ou nunca aberto). Spawnado pelo launcher (`scripts/cli.mjs`) com `windowsHide: true`, `creationFlags: 0x00000200` e `stdio: 'pipe'` (nunca `inherit`), e sob demanda pela API (`POST /api/worker/start`). Loop próprio (padrão 30 s, `JOBFINDER_WORKER_INTERVAL`) com heartbeat a cada 5 s em `worker-state.json`.
- **Endpoint `GET /api/worker/status`**: `isRunning`, `status`, `desired`, `pid`, `activeTask` (ex.: "publicando 2 post(s) agendado(s) · processando 3 cascata(s) de DM"), `nextTickAt`, `lastTickAt`, `intervalMs`, `lastError`, `stats` (passes, posts publicados, DMs enviadas, cascatas pausadas, ignorados, falhas) e as 10 últimas ações (`logs`).
- **Controles na UI**: `POST /api/worker/start`, `POST /api/worker/stop` (pausa — o processo continua vivo e ocioso) e `POST /api/worker/tick` (força um passe; usado por testes e quem quer agir agora). Botões **Iniciar/Pausar** e **Executar agora** no card "Automação em segundo plano" do Painel e na seção **Execução** das Configurações.
- **Worker Status Badge** no cabeçalho: ponto verde pulsante "Worker ativo", âmbar "Worker pausado" ou cinza "Worker parado".
- **`worker-state.json` / `worker-control.json`** no data dir (`DATA_FILES`), escritos sempre via `JsonStore`: o worker publica estado, a API publica apenas o `desired` — nenhuma escrita concorrente entre os dois processos no mesmo arquivo.

### Changed

- **Fila compartilhada entre processos**: `runWorkerPass` invalida o cache de `posts.json`/`dm-cascades.json`/`connections.json` e `publishPost` invalida `posts.json` antes de cada mutação. Sem isso o worker (cache próprio) nunca via itens criados pela UI e um post podia ser sobrescrito. É o caso documentado de "escritor externo" do `atomic-write-guard`.
- **`syncLiveConfig` passa a invalidar o cache** antes de ler: o worker agora reage ao toggle de dry-run da UI sem precisar reiniciar (antes o toggle só valeria no processo da API).
- **`JsonStore.write` usa arquivo temporário por PID** (`<arquivo>.tmp.<pid>`): com API e worker no mesmo diretório de dados, um `.tmp` fixo causava `EPERM` no `rename` no Windows.
- **Cron interno removido da API** (`index.mjs` não chama mais `startWorkers`): `services/workers.mjs` virou `runWorkerPass` — um passe de trabalho puro, compartilhado pelo worker e pela rota de tick manual. Nenhum `setInterval` fica no processo da API.
- **`GET /api/worker/status` como fonte da verdade da UI** (react-state-guard): `useWorkerStatus` faz polling de 5 s com `setTimeout` recursivo + `AbortController` e cleanup; `api.js` aceita `signal`.
- **Worker não fica órfão**: além de o launcher encerrar o filho no SIGINT/SIGTERM/SIGBREAK (com `SIGKILL` após 2 s), o worker detecta a morte do pai (`process.ppid`) e se encerra — inclusive quando o launcher é morto à força.

### Fixed

- **`createLinkedInClient is not defined` em `checkReplies`**: a migração da Fase 1 para `requireLiveLinkedInClient` deixou `checkReplies` sem o cliente de leitura; a checagem de respostas (pausar cascata quando o contato responde) quebrava silenciosamente dentro do worker.
- **Worker morria instantaneamente (exit code 0)**: os timers do loop estavam `unref()` — num processo cujo único trabalho é o loop, isso esvazia o event loop. O `unref()` só é correto no cron interno do servidor (onde o socket mantém o loop vivo).

### Tests

- Nova suíte `scripts/manual-tests/fase2-worker.mjs` — **39 verificações, 0 falhas** (3 execuções consecutivas): spawn pelo launcher, post agendado publicado automaticamente em dry-run, limite de 5 DMs/dia, bloqueio de ação real sem canal, JSON corrompido não derruba o worker (com backup do store), estresse de 10 posts no mesmo minuto sem corromper o JSON, pausar/retomar pela API e ausência de processos órfãos no Windows.
- Suíte de regressão íntegra: `fase1-auth-dryrun` 32/32 · `fase1-dryrun-services` 16/16 · `fase1-ui-e2e` 22/22 · `startup-keepalive` 12/12.

## [0.1.06] — 2026-11-13

### Added

- **Skills de prevenção de regressões (`.agents/skills/`)**: sete documentos obrigatórios, adaptados das lições do Thunderbolt para a arquitetura React + Node + JSON do JobFinder — `systemic-view-guard` (dependências entre UI/API/serviços/storage/launcher), `parallel-session-guard` (uma sessão por repositório, `git status` pré-commit, `rebase` antes do push), `surgical-scope-guard` (menor diff possível, arquivos sensíveis só com autorização explícita), `atomic-write-guard` (toda escrita em JSON via `JsonStore`, nunca `fs.writeFileSync` em estado), `windows-runtime-guard` (handlers de `unhandledRejection`/EPIPE/sinais, `spawn` com `windowsHide` + `creationFlags` + `stdio: pipe`), `contract-test-guard` (testar comportamento HTTP/clique/persistência, não strings) e `react-state-guard` (backend como fonte da verdade, sem `setInterval` sem limpeza, `AbortController` no polling).
- **`AGENTS.md` na raiz**: instrução de leitura obrigatória das skills, regras de projeto (versionamento visual, release via GitHub Actions, push com `rebase`, suíte de testes antes do commit, proibição de sessões paralelas), mapa rápido do repositório e convenções de código.
- **`tests/`**: pasta criada com stubs (`test_systemic_dependencies.js`, `test_atomic_write_concurrency.js`, `test_windows_keepalive.js`, `test_api_contracts.js`, `test_ui_state.spec.js`) documentando o que cada suíte deve cobrir nas próximas fases — rodáveis com `node --test tests/*.js`.
- **README**: nova seção em "Development" descrevendo as skills, o `AGENTS.md` e a suíte de testes.

### Notas

- Nenhum código funcional foi alterado: apenas documentação, `AGENTS.md` e stubs de teste. A suíte existente (`scripts/manual-tests/`) continua passando (82 checks) e os stubs rodam limpos com `node --test tests/*.js` (5 skipped).

## [0.1.05] — 2026-11-13

### Changed

- **Nenhuma abertura automática de navegador**: o launcher (`scripts/cli.mjs`) não abre mais o navegador do sistema ao iniciar. O terminal apenas imprime a URL (`http://127.0.0.1:4040`) e a mensagem `Press Ctrl+C to stop.`, aguardando a ação do usuário — abrir uma janela sem ser pedido não é aceitável para um produto hospedado (SaaS). A função `openBrowser` foi removida, as flags `--open`/`--no-open` viraram no-ops (ainda aceitas por compatibilidade) e a chave `openBrowserOnStart` saiu do config padrão.
- **Marca reposicionada para SaaS**: removidas todas as menções a "100% local" / "local-first" / "seus dados nunca saem desta máquina" da UI (badge do login, rodapé da sidebar — que fica apenas com o perfil e o botão **Sair** —, rodapé do conteúdo, cartões de Vagas, Candidaturas e Header) e do CLI (subtítulo do banner agora é "LinkedIn Automation • Intelligent Workflows"). A descrição do pacote npm e o README seguem o mesmo reposicionamento.

### Removed

- Bloco "100% local" (link para o GitHub) do rodapé da sidebar e badge "100% local" da tela de login; frases de posicionamento exclusivamente local em toda a interface.

## [0.1.04] — 2026-11-12

### Added

- **Sistema de login local (autenticação single-user)**: conta única criada no primeiro boot em `~/.jobfinder/auth.json` com a senha em **hash scrypt** (salt + verificação em tempo constante — nunca em texto puro). Sessão via token assinado (HMAC-SHA256) em **cookie HTTP-only** (`jobfinder_session`, 7 dias, `SameSite=Lax`), também aceito como `Authorization: Bearer` para testes de API. Novo arquivo `src/server/storage/authStore.mjs` + rotas `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session`, `PUT /api/auth/password`, `GET /api/auth/defaults`. *(Nota de 2026-11-20: as credenciais de seed foram removidas desta entrada e a rota `/auth/defaults` foi descontinuada na 0.1.14 — ver “Saneamento de credenciais”.)*
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
