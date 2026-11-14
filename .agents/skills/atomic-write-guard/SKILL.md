---
name: atomic-write-guard
description: Garante escritas atômicas e serializadas no store JSON, evitando corrupção por concorrência, crash ou queda de energia.
---

# Atomic Write Guard

## Propósito

`~/.jobfinder/*.json` é a **fonte da verdade** do app (usuários, canais, posts, candidaturas).
Uma escrita interrompida deixa o arquivo truncado e o app perde dados. O store já resolve
isso — o perigo é alguém escrever direto no arquivo e furar a abstração.

## Quando aplicar

Sempre que for criar, alterar ou migrar qualquer dado persistido em `storage/`.

## Regra única e obrigatória

> **Toda escrita em JSON usa o `JsonStore`.** Nunca `fs.writeFileSync` /
> `fs.promises.writeFile` / `fs.appendFileSync` direto em arquivo de estado.

## O que o store já garante (`src/server/storage/jsonStore.mjs`)

| Mecanismo | Como | Protege contra |
|---|---|---|
| **Atomicidade** | escreve em `<arquivo>.tmp` e faz `renameSync` | arquivo truncado por crash/energia |
| **Serialização** | fila de promessas por arquivo (`update()`) | duas escritas concorrentes se sobrescrevendo |
| **Cache + leitura única** | `read()` memoiza o parse | leitura repetida e estados divergentes |
| **Tolerância a BOM** | strip de `﻿` antes do parse | arquivos editados no PowerShell |
| **Backup de corrupto** | `.corrupt-<ts>` antes de recomeçar | perda silenciosa de dados |

## API correta de uso

```js
// leitura
const config = store.read('config.json', {});

// leitura-modificação-escrita (PREFIRA ESTA — serializada e atômica)
await store.update('posts.json', (posts) => {
  const next = [...posts];
  next[0] = { ...next[0], status: 'published' };
  return next;
});

// append/patch por id (já usam update internamente)
await store.create('connections.json', record, 'conn');
await store.patch('topics.json', id, { active: false });
await store.remove('channels.json', id);
```

## Proibições

```js
// ❌ NUNCA
fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify(config));
fs.appendFileSync(logFile, line);           // exceto logger, que é append-only de log
// ❌ NUNCA manter estado "vivo" só em memória sem refletir no store
let config = { ... };                      // use ctx.config + configSync.mjs
```

## Regras adicionais

1. **Não invalide o cache à toa.** `store.invalidate()` só quando um agente externo editou o
   arquivo; o `update()` já atualiza cache e disco juntos.
2. **Sincronize o objeto vivo.** Depois de `store.update('config.json', ...)`, chame
   `syncLiveConfig(store, config)` (`storage/configSync.mjs`) — serviços leem `ctx.config` e
   sem isso um toggle só valeria após reiniciar o servidor.
3. **Migração de schema** entra em `bootstrap.mjs` (`DATA_FILES` / `initialPayload`) ou em
   `AuthStore.ensure()` — nunca reescrevendo o arquivo por fora.
4. **Nunca sobrescreva arquivo existente** no bootstrap: `ensureDataDir` só cria o que falta.
5. **Logs são a exceção controlada:** `storage/logger.mjs` faz append em JSONL diário — é
   dado auxiliar, não estado. Não converta estado em log nem log em estado.

## Checklist

- [ ] Nenhum `fs.writeFileSync`/`writeFile` em arquivo de estado no meu diff.
- [ ] Usei `store.update`/`create`/`patch`/`remove` para mutações.
- [ ] Após mudar `config.json`, chamei `syncLiveConfig`.
- [ ] Se criei arquivo novo de dados, ele está em `DATA_FILES` + `initialPayload`.
- [ ) Testei escrita concorrente (ver `tests/test_atomic_write_concurrency.js`).