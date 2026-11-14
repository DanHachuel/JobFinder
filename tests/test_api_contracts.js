/**
 * tests/test_api_contracts.js
 *
 * Contratos HTTP (contract-test-guard): status code, error.code e campos das rotas /api.
 *
 * Status: STUB — a cobertura equivalente já existe em
 *         scripts/manual-tests/fase1-auth-dryrun.mjs (32/32) e
 *         scripts/manual-tests/fase1-dryrun-services.mjs (16/16).
 * Rodar com:  node --test tests/test_api_contracts.js
 *
 * O que cobrir quando implementado:
 *   1. /api/auth/login: 200 com cookie + 401 invalid_credentials
 *   2. /api/auth/session: authenticated true/false
 *   3. /api/auth/password: 200 na troca, 400 nas validações, hash em auth.json
 *   4. /api/config: PUT dryRun booleano (400 em tipo inválido) e persistência
 *   5. ações em modo real sem canal: 503 channel_required (não simula)
 *   6. rotas protegidas sem sessão: 401 unauthorized
 */
import { test } from 'node:test';

test('contratos HTTP das rotas (stub — ver também fase1-auth-dryrun.mjs)', (t) => {
  t.diagnostic('Pendente: subir o servidor em tmp e exercitar as rotas');
  t.skip();
});