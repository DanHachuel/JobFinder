/**
 * tests/test_atomic_write_concurrency.js
 *
 * Escrita atômica sob concorrência e sob bloqueio de arquivo (atomic-write-guard).
 *
 * Rodar com:  node --test tests/test_atomic_write_concurrency.js
 *
 * Cobre (comportamento real, não string):
 *   1. N updates concorrentes no mesmo arquivo -> nenhum perdido, JSON válido
 *   2. mutator que lança deixa o arquivo anterior intacto
 *   3. leitura após "queda de energia" (.tmp restante) não quebra o store
 *   4. rename travado no Windows (EPERM) -> retry com backoff até succeed
 *   5. rename travado SEMPRE (EPERM) -> o write falha alto (documentado) e o
 *      caller (worker) decide — ver teste de runtime em startup-keepalive
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { JsonStore } from '../src/server/storage/jsonStore.mjs';

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobfinder-atomic-'));
  return { dir, store: new JsonStore(dir) };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test('N updates concorrentes serializam sem perder nenhum registro', async () => {
  const { dir, store } = tempStore();
  try {
    const N = 40;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        store.update('items.json', (items) => [...(Array.isArray(items) ? items : []), { id: `i${i}` }])
      )
    );
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'items.json'), 'utf8'));
    assert.equal(onDisk.length, N, 'todos os registros persistiram');
    assert.equal(new Set(onDisk.map((r) => r.id)).size, N, 'sem duplicatas');
    assert.deepEqual(
      onDisk.map((r) => r.id).sort(),
      Array.from({ length: N }, (_, i) => `i${i}`).sort()
    );
    assert.ok(!fs.readdirSync(dir).some((f) => f.includes('.tmp')), 'nenhum .tmp restou');
  } finally {
    cleanup(dir);
  }
});

test('mutator que lança deixa o arquivo anterior intacto', async () => {
  const { dir, store } = tempStore();
  try {
    await store.update('items.json', (items) => [...items, { id: 'keep' }]);
    const before = fs.readFileSync(path.join(dir, 'items.json'), 'utf8');
    await assert.rejects(() =>
      store.update('items.json', () => {
        throw new Error('mutator explodiu');
      })
    );
    const after = fs.readFileSync(path.join(dir, 'items.json'), 'utf8');
    assert.equal(after, before, 'o conteúdo anterior sobreviveu à falha');
    assert.ok(!fs.readdirSync(dir).some((f) => f.includes('.tmp')), 'nenhum .tmp restou');
  } finally {
    cleanup(dir);
  }
});

test('arquivo .tmp restante (queda de energia simulada) não quebra o store', async () => {
  const { dir, store } = tempStore();
  try {
    fs.writeFileSync(path.join(dir, 'items.json'), JSON.stringify([{ id: 'ok' }]), 'utf8');
    fs.writeFileSync(path.join(dir, 'items.json.tmp.99999'), '{ pela metade', 'utf8');
    const items = store.list('items.json');
    assert.deepEqual(items, [{ id: 'ok' }]);
    await store.update('items.json', (list) => [...list, { id: 'ok2' }]);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'items.json'), 'utf8'));
    assert.equal(onDisk.length, 2);
  } finally {
    cleanup(dir);
  }
});

test('rename travado com EPERM (Windows) é retentado com backoff e succeed', async () => {
  const { dir, store } = tempStore();
  const original = fs.renameSync;
  let attempts = 0;
  // Duas falhas EPERM (como antivírus/outro processo segurando o destino),
  // depois o rename passa.
  fs.renameSync = (from, to) => {
    attempts += 1;
    if (attempts <= 2) {
      const err = new Error('EPERM: operation not permitted, rename');
      err.code = 'EPERM';
      throw err;
    }
    return original(from, to);
  };
  try {
    store.write('items.json', [{ id: 'retry' }]);
    assert.equal(attempts, 3, 'o rename foi retentado até dar certo');
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'items.json'), 'utf8'));
    assert.deepEqual(onDisk, [{ id: 'retry' }], 'o conteúdo novo persistiu');
    assert.ok(!fs.readdirSync(dir).some((f) => f.includes('.tmp')), 'nenhum .tmp restou');
  } finally {
    fs.renameSync = original;
    cleanup(dir);
  }
});

test('rename travado PARA SEMPRE (EPERM) falha alto — sem .tmp órfão', async () => {
  const { dir, store } = tempStore();
  const original = fs.renameSync;
  fs.renameSync = () => {
    const err = new Error('EPERM: operation not permitted, rename');
    err.code = 'EPERM';
    throw err;
  };
  try {
    assert.throws(() => store.write('items.json', [{ id: 'x' }]), (err) => err.code === 'EPERM');
    assert.ok(!fs.readdirSync(dir).some((f) => f.includes('.tmp')), 'nenhum .tmp restou');
  } finally {
    fs.renameSync = original;
    cleanup(dir);
  }
});