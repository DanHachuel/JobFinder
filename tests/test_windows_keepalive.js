/**
 * tests/test_windows_keepalive.js
 *
 * Sobrevivência do processo no Windows (windows-runtime-guard): unhandledRejection,
 * EPIPE em stdio, sinais idempotentes e spawn de workers.
 *
 * Status: STUB — a cobertura equivalente já existe em
 *         scripts/manual-tests/startup-keepalive.mjs (12/12 OK).
 * Rodar com:  node --test tests/test_windows_keepalive.js
 *
 * O que cobrir quando implementado:
 *   1. unhandledRejection NÃO mata o processo (handler continua instalado)
 *   2. stdout/stderr com EPIPE não derruba o servidor
 *   3. SIGINT/SIGTERM/SIGBREAK são idempotentes (segundo sinal força a saída)
 *   4. worker spawnado com windowsHide + creationFlags + stdio pipe (nunca inherit)
 */
import { test } from 'node:test';

test('handlers de resiliência do processo (stub — ver também startup-keepalive.mjs)', (t) => {
  t.diagnostic('Pendente: promover os casos de startup-keepalive.mjs para node:test');
  t.skip();
});