---
name: contract-test-guard
description: Garante que os testes validem comportamento real (HTTP, clique, persistência) e não apenas a existência de strings no código.
---

# Contract Test Guard

## Propósito

Teste que só verifica "o arquivo contém a string X" passa até quando a feature está
quebrada. No JobFinder o que importa é: **a rota responde o que a UI espera**, **o clique
leva ao destino certo** e **o dado persiste no JSON**.

## Quando aplicar

Antes de commitar, ao criar qualquer teste e ao corrigir qualquer bug.

## O que é um bom teste aqui

| Camada | Tipo | Exemplo |
|---|---|---|
| API | teste de contrato HTTP real (sobe o servidor, chama a rota, checa status/corpo) | `scripts/manual-tests/fase1-auth-dryrun.mjs` |
| Integração | flag/serviço exercitado de ponta a ponta | `fase1-dryrun-services.mjs` |
| UI | clique real com Playwright, verificando rota e resposta | `fase1-ui-e2e.mjs` |
| Runtime | processo sobrevive a falha do ambiente | `startup-keepalive.mjs` |

Um bom teste **falha antes da correção e passa depois**. Se ele passa nas duas situações,
não está testando nada.

## Proibições

- ❌ `expect(source).toContain('dryRun')` como validação de comportamento.
- ❌ Teste que mocka o próprio módulo que está sob teste.
- ❌ Teste que depende de estado deixado por outro teste (porta, diretório, cookie).
- ❌ Teste sem afirmativa (`assert`/`expect`) explícita.
- ❌ Commitar com suíte vermelha "porque é flaky".

## Regras

1. **Contrato > implementação.** Asserte o que o consumidor vê: `status`, `error.code`,
   campos usados pela UI (`config.dryRun`, `user.email`, `post.status`, `results[].simulated`).
2. **Estado real em disco.** Quando o teste é sobre persistência, leia o JSON do diretório
   de dados (`JOBFINDER_HOME`) e compare — não confie na resposta da API.
3. **Isolamento.** Cada suite usa porta própria e `JOBFINDER_HOME` em diretório temporário
   único; espere a porta liberar antes de iniciar (`waitPortFree`).
4. **Regressão por bug corrigido.** Para cada bug encontrado, crie o teste que o reproduz.
   Exemplos já cobertos: post travado em `publishing` sem canal em modo real; switch de
   dry-run não clicável; toggle que só valia após reiniciar o servidor.
5. **Suíte completa antes do commit.**
   ```bash
   node scripts/manual-tests/fase1-auth-dryrun.mjs
   node scripts/manual-tests/fase1-dryrun-services.mjs
   node scripts/manual-tests/fase1-ui-e2e.mjs
   node scripts/manual-tests/startup-keepalive.mjs
   ```
   Falhou? **Não commite.**
6. **Teste novo precisa de dono.** Toda suite em `scripts/manual-tests/` deve dizer no
   cabeçalho o que valida e como rodar.
7. **Flakiness é bug.** Se um teste passa ora sim ora não (porta, timing, animação), corrija
   com espera determinística (`waitForSelector`, `waitPortFree`) — nunca com `sleep` genérico.

## Estrutura pronta para as próximas fases

`tests/` já existe com stubs para evoluir (rodados com `node --test` quando implementados):

- `test_systemic_dependencies.js` — contratos entre camadas (UI ↔ API ↔ store)
- `test_atomic_write_concurrency.js` — escrita concorrente não corrompe o JSON
- `test_windows_keepalive.js` — handlers de EPIPE/rejection/sinais
- `test_api_contracts.js` — status/corpo de cada rota `/api`
- `test_ui_state.spec.js` — estado da UI (Playwright)

## Checklist

- [ ] O teste exercita comportamento (HTTP/clique/persistência), não string de arquivo.
- [ ] Existe caso que falha sem a correção.
- [ ] Suíte completa rodada e verde antes do commit.
- [ ] Nenhum teste depende de outro ou de estado global.