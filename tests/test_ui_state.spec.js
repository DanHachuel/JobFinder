/**
 * tests/test_ui_state.spec.js
 *
 * Estado da UI (react-state-guard + contract-test-guard): clique real, rota correta,
 * resposta refletida na tela, sem memory leak no polling.
 *
 * Status: STUB — a cobertura equivalente já existe em
 *         scripts/manual-tests/fase1-ui-e2e.mjs (Playwright, 22/22 OK).
 *
 * Rodar com (quando implementado, Playwright é dependência opcional):
 *   node tests/test_ui_state.spec.js
 *   # ou: npx playwright test tests/test_ui_state.spec.js
 *
 * O que cobrir quando implementado:
 *   1. sem sessão, qualquer rota redireciona para /login
 *   2. login válido leva à rota pedida (state.from) e persiste após F5
 *   3. toggle de dry-run persiste no backend e reflete no badge (dry-run vs Real Mode)
 *   4. troca de senha invalidada a sessão antiga
 *   5. logout volta ao /login e bloqueia rotas protegidas
 *   6. nenhum erro de console relevante durante o fluxo
 */
import { test } from 'node:test';

test('estado da UI e navegação (stub — ver também fase1-ui-e2e.mjs)', (t) => {
  t.diagnostic('Pendente: migrar os casos de fase1-ui-e2e.mjs para este spec');
  t.skip();
});