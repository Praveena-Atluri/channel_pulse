import assert from 'node:assert/strict';
import test from 'node:test';
import { retryBackgroundDatabase, backgroundErrorMessage } from '../lib/background-retry.ts';
test('transient connectivity failures retry with backoff and recover', async () => {
  let calls = 0; const delays: number[] = [];
  const value = await retryBackgroundDatabase(async () => { if (++calls < 3) throw new Error('fetch failed', { cause: new Error('Connect Timeout Error') }); return 42; }, { wait: async (ms) => { delays.push(ms); } });
  assert.equal(value, 42); assert.deepEqual(delays, [2000, 4000]);
});
test('permanent failures are not retried; transient failures are bounded and retain cause', async () => {
  let calls = 0;
  await assert.rejects(retryBackgroundDatabase(async () => { calls++; throw new Error('SQL syntax error'); }), /syntax/);
  assert.equal(calls, 1); calls = 0;
  const error = new Error('fetch failed', { cause: new Error('timeout') });
  await assert.rejects(retryBackgroundDatabase(async () => { calls++; throw error; }, { attempts: 3, wait: async () => {} }), /fetch failed/);
  assert.equal(calls, 3); assert.equal(backgroundErrorMessage(error), 'fetch failed: timeout');
});
test('YouTube backend errors retry but permission and quota errors do not', async () => {
  let calls = 0;
  const result = await retryBackgroundDatabase(async () => { if (++calls < 2) throw new Error('YouTube report: {"code":500,"reason":"backendError"}'); return 1; }, { wait: async () => {} });
  assert.equal(result, 1);
  for (const message of ['quotaExceeded', 'Forbidden']) {
    let attempts = 0;
    await assert.rejects(retryBackgroundDatabase(async () => { attempts++; throw new Error(message); }, { wait: async () => {} }));
    assert.equal(attempts, 1);
  }
});
