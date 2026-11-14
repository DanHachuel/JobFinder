---
name: systemic-view-guard
description: Evita que uma alteração local quebre dependências ocultas entre UI, API, serviços, storage e launcher. Leia antes de alterar qualquer arquivo do JobFinder.
---

# Systemic View Guard

## Propósito

Impedir que uma mudança "pequena e inocente" em um módulo quebre outro que depende dele
de forma invisível. No JobFinder, uma rota renomeada, um campo removido do JSON ou uma
assinatura de função alterada pode derrubar a UI, o worker ou o launcher — e o sintoma só
aparece em outro lugar.

## Quando aplicar

Antes de **qualquer** edição. Se você não consegue nomear quem consome o que vai mudar,
você ainda não tem visão sistêmica suficiente para editar.

## Mapa de Dependências

```
scripts/cli.mjs ──spawna──> src/server/index.mjs ──cria──> context.mjs ──> app.mjs ──> /api/*
      │                            │                                     │
      │                            └──> services/workers.mjs ─────────────┤
      │                                                                  │
src/ui/ (React) ───fetch /api──> routes/* ───> services/{posting,outreach,jobs,llm,linkedin}
                                        │                    │
                                        └──> storage/ <──────┘  (JSON = fonte da verdade)
```

| Camada | Papel | Quem depende dela | Cuidado ao alterar |
|---|---|---|---|
| `src/ui/` | Consome a API REST (`src/ui/src/lib/api.js`) | Usuário final | Renomear rota/campo sem atualizar os componentes quebra a tela |
| `src/server/routes/` | Contrato HTTP (`/api/*`) | UI e clientes externos (curl/Playwright) | Remover campo da resposta quebra o consumidor silenciosamente |
| `src/server/services/` | Regra de negócio (posting, outreach, jobs, llm, linkedin) | Routes + workers | Mudar assinatura afeta scheduler, cascatas e testes |
| `src/server/storage/` | Fonte da verdade em JSON | Todos os serviços | Alterar o schema exige migração (ver `atomic-write-guard`) |
| `src/server/middleware/auth.mjs` | Protege **todas** as rotas `/api` | Todo o backend | Mover a pública/privada quebra o login ou vaza a API |
| `scripts/cli.mjs` | Launcher `npx` | Inicialização do servidor | Ver `surgical-scope-guard`: arquivo sensível |

## Regra de Ouro

> **Antes de alterar um arquivo, verifique quem depende dele.**

Na prática, rode estas buscas antes de salvar qualquer edição:

```bash
# quem importa/consome o símbolo que vou mudar?
grep -rn "createLinkedInClient\|requireLiveLinkedInClient" src/ --include=*.mjs
grep -rn "dryRun" src/ --include=*.mjs --include=*.jsx
# a rota que vou mudar é usada na UI?
grep -rn "/api/config\|api.put('/config" src/ui/src
```

## Regras

1. **Contrato é ponte.** Alteração em `routes/` (rota, método, status, nome de campo) exige
   atualização simultânea de todos os consumidores: `src/ui/src/pages/*.jsx`,
   `src/ui/src/lib/api.js` e `scripts/manual-tests/*.mjs`.
2. **Mudar schema de JSON é migração.** `config.json`, `auth.json`, `channels.json` etc. são
   lidos por código já publicado. Acrescente campos com valor padrão, nunca remova/renomeie
   sem migração em `storage/bootstrap.mjs` / `AuthStore.ensure()`.
3. **Um toggle, vários lugares.** `config.dryRun` afeta `linkedin/index.mjs`, publisher,
   invitations, cascades, easyApply, badges da UI e o comportamento do worker. Sempre
   procurar **todos** os leitores da flag.
4. **Worker é consumidor invisível.** Tudo que roda no `startWorkers()` (scheduler de posts,
   cascatas de DM, checagem de respostas) consome os mesmos serviços das rotas. Uma exceção
   nova em serviço derruba o worker, não a rota.
5. **UI não é dona da regra.** Se a UI deixar de exibir algo, o backend continua aceitando —
   e vice-versa. Decida explícita e simetricamente.

## Checklist antes do commit

- [ ] Procurei o símbolo/arquivo alterado em `src/` (rotas, serviços, UI, testes).
- [ ] Se mudei rota/campo: atualizei UI **e** testes manuais.
- [ ] Se mudei schema de JSON: há migração/default para dados antigos.
- [ ) Se mudei flag/serviço: verifiquei o worker (`services/workers.mjs`).
- [ ] Rodei a suíte de testes (`node scripts/manual-tests/*.mjs`) — ver `contract-test-guard`.

## Anti-padrões (exemplos reais de regressão)

- Renomear `dryRun` para `liveMode` no `config.json`: UI, `linkedin/index.mjs`, publisher,
  cascatas e testes passam a ler `undefined` → volta tudo para dry-run "por acidente".
- Mover `/api/auth/login` para dentro do guard de sessão: ninguém consegue mais logar.
- Adicionar campo obrigatório em `channels.json`: canais antigos quebram na leitura.