---
name: surgical-scope-guard
description: Impede refatorações não solicitadas e alterações em arquivos sensíveis. Toca apenas nas linhas estritamente necessárias à tarefa.
---

# Surgical Scope Guard

## Propósito

Refatoração não solicitada é a maior fonte de regressão "sem explicação": o diff fica
grande, a revisão fica impossível e o bug aparece longe da mudança. A regra é simples:
**a menor mudança que resolve a tarefa**, nada mais.

## Quando aplicar

Em toda edição. Principalmente quando a tarefa parece "pequena" (um texto, um toggle, um
badge) e o arquivo é grande.

## Regras

1. **Regra do menor arquivo possível.** Tarefa de UI → mexe em `src/ui/`. Tarefa de API →
   mexe em `src/server/`. Não atravesse camadas sem necessidade. Se a tarefa é de UI, não
   altere `package.json`, `vite.config.js` ou backend.
2. **Proibição de refatoração.** Não renomeie variáveis, não "limpe" imports que não estão
   causando erro, não reformate arquivos inteiros, não mude estilo de código de arquivos que
   você só está lendo. Altere **apenas as linhas estritamente necessárias**.
3. **Arquivos sensíveis** — não alterar sem autorização **explícita** do usuário:

   | Arquivo | Por quê |
   |---|---|
   | `package.json` | Versão, `bin`, `files`, `install` hook e dist-tag do npm |
   | `scripts/cli.mjs` | Launcher `npx`; quebra a initialização do servidor |
   | `vite.config.js` | Proxy de dev, `define.__APP_VERSION__`, build |
   | `src/server/index.mjs` | Entrypoint, sinais, workers, handles do processo |
   | `.github/workflows/publish-npm.yml` | Esteira de release (publica no npm) |
   | `src/server/storage/jsonStore.mjs` | Atomicidade e serialização de escrita |

   > A alteração nesses arquivos só ocorre quando a tarefa pede explicitamente (ex.: bump de
   > versão, mudança de launcher). Nunca "aproveitar o caminho".

4. **Um diff, uma intenção.** Se você precisa alterar 12 arquivos para um toggle de UI, pare e
   reavalie: provavelmente há consumo acoplado (ver `systemic-view-guard`).
5. **Não apague código "morto"** que não é seu. Remoção preventiva é refatoração.
6. **Preserve o estilo do entorno.** O repositório tem padrões estabelecidos: ESM `.mjs`,
   `asyncRoute` + `HttpError` nas rotas, português nas mensagens de UI, inglês nos
   identificadores. Siga o que já existe no arquivo.

## Checklist antes do commit

- [ ] O diff contém apenas linhas relacionadas à tarefa.
- [ ] Nenhum arquivo sensível foi alterado sem pedido explícito.
- [ ] Nenhuma reformatação/renomeação "de graça".
- [ ) `git diff --stat` tem poucos arquivos e a contagem de linhas faz sentido para a tarefa.
- [ ] Nenhum import foi removido/adicionado sem uso correspondente.

## Exemplo de bom diff (toggle de dry-run)

```
src/ui/src/pages/Config.jsx  | 120 ++++++++++++++++-   <- seção Execução + Segurança
src/server/routes/config.mjs  |  20 ++++--             <- validação + syncLiveConfig
src/server/services/linkedin/index.mjs | 23 +++++++-   <- requireLiveLinkedInClient
```

## Exemplo de diff ruim (escopo estourado)

```
 38 files changed, 1400 insertions(+), 900 deletions(-)   <- "só queria mudar um texto"
```