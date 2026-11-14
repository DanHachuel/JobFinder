---
name: windows-runtime-guard
description: Blindar launcher, servidor e workers contra o ambiente hostil do Windows (MobaXterm, PowerShell, EPIPE, sinais e spawn).
---

# Windows Runtime Guard

## Propósito

O app roda em Windows, muitas vezes dentro de terminais hostis (MobaXterm, PowerShell,
redirecionamento de saída, SSH). Nesse ambiente o serviço pode "sumir sem explicação":
terminal volta ao prompt, processo morre sem mensagem, spawns de worker ficam presos.

## Quando aplicar

Ao mexer em `scripts/cli.mjs`, `src/server/index.mjs`, qualquer `spawn`, sinais de processo
ou futuros background workers (Fase 2).

## O que já está implementado (NÃO REMOVA)

`src/server/index.mjs` (desde a 0.1.4/0.1.5):

| Handler | Efeito |
|---|---|
| `unhandledRejection` | loga e **mantém** o processo vivo (Node ≥ 15 mata por padrão) |
| `uncaughtException` | loga alto e sai com código visível — nunca some em silêncio |
| `error` em `stdout`/`stderr` | ignora `EPIPE` (terminal/pipe fechado) |
| `globalThis.__jobfinder` | mantém referência do `server`/`context` ( keep-alive do event loop) |
| `SIGINT`/`SIGTERM` idempotentes | `shuttingDown` + parada dos workers + exit forçado em 3 s |

`scripts/cli.mjs`: mesmos handlers + `child.exit` sempre imprime o motivo
(`code`/`signal`) e o forward de sinal força saída no segundo Ctrl+C.

> **Esses handlers são infraestrutura de sobrevivência. Não remova, não "simplifique".**

## Regras para spawn (obrigatórias na Fase 2 — background workers)

```js
// ✅ correto
spawn(command, args, {
  windowsHide: true,              // não pisca janela de console no Windows
  creationFlags: 0x00000200,      // CREATE_NEW_PROCESS_GROUP: sinal não mata o pai
  stdio: ['ignore', 'pipe', 'pipe'], // NUNCA 'inherit' — herda o EPIPE do terminal
});

// ❌ proibido
spawn(cmd, args, { stdio: 'inherit' });
```

1. **Nunca `stdio: 'inherit'`** em worker/child: quando o terminal quebra (EPIPE), o erro
   sobe e mata o processo. Use `pipe` e trate `error` no stream.
2. **`windowsHide: true` + `creationFlags: 0x00000200`** em todo spawn no Windows.
3. **Sinais idempotentes.** Trate `SIGINT`, `SIGTERM` e `SIGBREAK`; um segundo sinal deve
   forçar a saída, nunca ser ignorado. O processo só encerra quando o usuário mandar (ou em
   falha irrecuperável).
4. **Worker não pode derrubar o servidor.** Erro no scheduler/cascata deve ser capturado e
   logado (`logger.error`), não propagado como exceção não tratada.
5. **Timer sempre `unref()`.** Loops internos (`setInterval`) não devem segurar o event loop
   sozinhos — ver `services/workers.mjs`.
6. **Porta em uso** deve mensagem acionável (`EADDRINUSE` já sugere `--port 4041`).
7. **Caminhos.** Use `path.join`/`resolveDataDir`, nunca concatenar com `/` ou `\`.

## Encoding (pegadinha do PowerShell)

- Arquivos do projeto são **UTF-8**. No PowerShell 5.1, `Get-Content`/`Set-Content` sem
  `-Encoding utf8` leem/gravam como ANSI e **corrompem acentos** — inclusive apagando
  edições legítimas. Prefira as ferramentas de edição de arquivo; se usar shell, sempre
  `-Encoding utf8` nos dois comandos.
- Console que exibe `?`/`�` quase sempre é artefato de codepage, não arquivo corrompido:
  confie no byte (`C3 A1` = "á" em UTF-8).

## Checklist

- [ ] Nenhum handler de `unhandledRejection`/`uncaughtException`/EPIPE foi removido.
- [ ] Nenhum `stdio: 'inherit'` novo.
- [ ] Spawns com `windowsHide` + `creationFlags` + stdio `pipe`.
- [ ] Sinais tratados de forma idempotente; timer com `unref()`.
- [ ) Rodei `node scripts/manual-tests/startup-keepalive.mjs` (boot, rejection, EPIPE).