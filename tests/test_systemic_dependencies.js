/**
 * tests/test_systemic_dependencies.js
 *
 * Contratos entre camadas (systemic-view-guard): garante que a UI, a API e o
 * store continuam conversando entre si depois de qualquer refatoração.
 *
 * Status: STUB — estrutura pronta para a próxima fase.
 * Rodar com:  node --test tests/test_systemic_dependencies.js
 *
 * O que cobrir quando implementado:
 *   1. toda rota usada em src/ui/src/pages/*.jsx existe em src/server/routes/
 *   2. campos lidos pela UI existem na resposta da API (config.dryRun, user.email…)
 *   3. todo arquivo em DATA_FILES continua sendo lido/escrito só pelo JsonStore
 *   4. alterar config.dryRun reflete em linkedin/index.mjs, publisher, invitations,
 *      cascades e nos badges da UI
 */
import { test } from 'node:test';

test('contratos entre camadas (stub — implementar na próxima fase)', (t) => {
  t.diagnostic('Pendente: mapear rotas da UI vs. rotas registradas em routes/index.mjs');
  t.skip();
});