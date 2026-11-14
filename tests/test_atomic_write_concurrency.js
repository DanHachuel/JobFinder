/**
 * tests/test_atomic_write_concurrency.js
 *
 * Escrita concorrente não corrompe o JSON (atomic-write-guard).
 *
 * Status: STUB — estrutura pronta para a próxima fase.
 * Rodar com:  node --test tests/test_atomic_write_concurrency.js
 *
 * O que cobrir quando implementado:
 *   1. N escritas simultâneas via store.update() no mesmo arquivo -> nenhuma perdida
 *   2. falha no meio da escrita (mutator que lança) deixa o arquivo anterior intacto
 *   3. leitura após queda de energia simulada (arquivo .tmp restante) não quebra o store
 *   4. nenhum fs.writeFileSync direto em arquivo de estado (grep de regressão)
 */
import { test } from 'node:test';

test('escrita concorrente é serializada e atômica (stub — implementar na próxima fase)', (t) => {
  t.diagnostic('Pendente: disparar N updates concorrentes em um JsonStore temporário');
  t.skip();
});