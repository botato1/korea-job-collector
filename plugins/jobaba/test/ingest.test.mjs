// ingest() against a fake ctx that serves a fake feed the way the live API
// does (pIndex/pSize slices, oldest rows first). Zero network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import plugin from '../index.mjs';

const FUTURE = '20991231';
const PAST = '20000101';
const row = (n, o = {}) => ({
  ENTRPRS_NM: `회사${n}`, PBANC_CONT: `공고${n}`, WORK_REGION_CONT: '성남시', CAREER_DIV: '신입',
  RCPT_END_DE: FUTURE, URL: `https://job.gg.go.kr/empmn/jobEntDtl.do?seq=${n}`, ...o,
});
const ok = (rows, total) => ({ GGJOBABARECRUSTM: [
  { head: [{ list_total_count: total }, { RESULT: { CODE: 'INFO-000', MESSAGE: '정상 처리되었습니다.' } }] },
  { row: rows },
] });

/** @param {{feed?: any[], settings?: any, env?: any, dryRun?: boolean, override?: (p:number, size:number) => any}} o */
function makeCtx({ feed = [], settings = {}, env = { GG_OPENAPI_KEY: 'TESTKEY' }, dryRun = false, override }) {
  const calls = [];
  const logs = [];
  return {
    calls, logs,
    ctx: {
      env, settings, dryRun,
      log: (m) => logs.push(String(m)),
      fetch: async (url, opts) => {
        const u = new URL(url);
        const p = Number(u.searchParams.get('pIndex'));
        const size = Number(u.searchParams.get('pSize'));
        calls.push({ p, size });
        if (opts?.headers?.Accept || opts?.headers?.accept) {
          return new Response('<html>500</html>', { status: 500 }); // mirrors the live API
        }
        const out = override?.(p, size) ?? ok(feed.slice((p - 1) * size, p * size), feed.length);
        if (out instanceof Response) return out;
        // The live API labels JSON as text/html.
        return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'text/html;charset=UTF-8' } });
      },
    },
  };
}

test('ingest learns the total, then reads pages from the last one backwards', async () => {
  const feed = [row(1), row(2), row(3), row(4), row(5)];
  const { ctx, calls } = makeCtx({ feed, settings: { concurrency: 1, page_size: 2 } });
  const leads = await plugin.ingest(ctx);
  assert.deepEqual(calls, [{ p: 1, size: 1 }, { p: 3, size: 2 }, { p: 2, size: 2 }, { p: 1, size: 2 }]);
  assert.deepEqual(leads.map(l => l.title), ['공고5', '공고3', '공고4', '공고1', '공고2']);
});

test('ingest dedupes repeated postings by URL', async () => {
  const feed = [row(1), row(2), row(1), row(2), row(1)];
  const { ctx } = makeCtx({ feed, settings: { concurrency: 1, page_size: 2 } });
  assert.deepEqual((await plugin.ingest(ctx)).map(l => l.title), ['공고1', '공고2']);
});

test('ingest respects max_pages', async () => {
  const feed = Array.from({ length: 10 }, (_, i) => row(i));
  const { ctx, calls } = makeCtx({ feed, settings: { concurrency: 1, page_size: 1, max_pages: 3 } });
  await plugin.ingest(ctx);
  assert.deepEqual(calls.slice(1).map(c => c.p), [10, 9, 8]);
});

test('ingest stops after N pages in a row that are almost all expired', async () => {
  // Pages 1–6 expired, 7–8 open; read backwards from 8.
  const feed = Array.from({ length: 8 }, (_, i) => row(i, { RCPT_END_DE: i >= 6 ? FUTURE : PAST }));
  const { ctx, calls, logs } = makeCtx({ feed, settings: { concurrency: 1, page_size: 1, stop_after_stale_pages: 2 } });
  const leads = await plugin.ingest(ctx);
  assert.equal(leads.length, 2);
  assert.deepEqual(calls.slice(1).map(c => c.p), [8, 7, 6, 5]);
  assert.ok(logs.some(l => /almost all expired/.test(l)));
});

test('a page with a few open rows still counts as stale under the ratio', async () => {
  const mk = (n, open) => Array.from({ length: 20 }, (_, i) => row(`${n}-${i}`, { RCPT_END_DE: i < open ? FUTURE : PAST }));
  const feed = [...mk('a', 0), ...mk('b', 0), ...mk('c', 1), ...mk('d', 0), ...mk('e', 20)];
  const { ctx, calls } = makeCtx({ feed, settings: { concurrency: 1, page_size: 20, stop_after_stale_pages: 2, stale_open_ratio: 0.1 } });
  const leads = await plugin.ingest(ctx);
  assert.equal(leads.length, 21); // the one open row on page 3 is still kept
  assert.deepEqual(calls.slice(1).map(c => c.p), [5, 4, 3]);
});

test('ingest stops on an API error and returns what it has', async () => {
  const feed = [row(1), row(2), row(3)];
  const { ctx, calls, logs } = makeCtx({
    feed, settings: { concurrency: 1, page_size: 1 },
    override: (p, size) => (size === 1 && p === 2 ? { RESULT: { CODE: 'ERROR-500', MESSAGE: '서버 오류' } } : undefined),
  });
  const leads = await plugin.ingest(ctx);
  assert.deepEqual(leads.map(l => l.title), ['공고3']);
  assert.deepEqual(calls.map(c => c.p), [1, 3, 2]);
  assert.ok(logs.some(l => l.includes('ERROR-500')));
});

test('a bad key stops after the first call', async () => {
  const { ctx, calls, logs } = makeCtx({ override: () => ({ RESULT: { CODE: 'ERROR-290', MESSAGE: '인증키가 유효하지 않습니다.' } }) });
  assert.deepEqual(await plugin.ingest(ctx), []);
  assert.equal(calls.length, 1);
  assert.ok(logs.some(l => l.includes('ERROR-290')));
});

test('ingest keeps earlier leads when the guarded fetch throws', async () => {
  const feed = [row(1), row(2), row(3)];
  const { ctx, logs } = makeCtx({
    feed, settings: { concurrency: 1, page_size: 1 },
    override: (p, size) => { if (size === 1 && p === 2) throw new Error('HTTP 500: <!doctype html>'); },
  });
  const leads = await plugin.ingest(ctx);
  assert.deepEqual(leads.map(l => l.title), ['공고3']);
  assert.ok(logs.some(l => l.includes('request failed (HTTP 500)')));
});

test('ingest stops on non-200 and on non-JSON', async () => {
  for (const mk of [() => new Response('x', { status: 500 }), () => new Response('<html>', { status: 200 })]) {
    const { ctx, calls } = makeCtx({ override: mk });
    assert.deepEqual(await plugin.ingest(ctx), []);
    assert.equal(calls.length, 1);
  }
});

test('ingest throws without a key and makes no calls on dry run', async () => {
  const a = makeCtx({ env: {} });
  await assert.rejects(plugin.ingest(a.ctx), /GG_OPENAPI_KEY/);
  assert.equal(a.calls.length, 0);
  const b = makeCtx({ dryRun: true });
  assert.deepEqual(await plugin.ingest(b.ctx), []);
  assert.equal(b.calls.length, 0);
});

test('ingest never logs the key', async () => {
  const { ctx, logs } = makeCtx({ env: { GG_OPENAPI_KEY: 'SECRET123' }, override: () => ({ RESULT: { CODE: 'ERROR-290', MESSAGE: 'bad' } }) });
  await plugin.ingest(ctx);
  assert.ok(logs.length > 0);
  assert.ok(logs.every(l => !l.includes('SECRET123')));
});

test('parallel fetching keeps newest-first order and the same stop point', async () => {
  const feed = Array.from({ length: 8 }, (_, i) => row(i, { RCPT_END_DE: i >= 6 ? FUTURE : PAST }));
  const { ctx, logs } = makeCtx({ feed, settings: { page_size: 1, concurrency: 3, stop_after_stale_pages: 2 } });
  const leads = await plugin.ingest(ctx);
  assert.deepEqual(leads.map(l => l.title), ['공고7', '공고6']);
  assert.ok(logs.some(l => /stopping at page 5/.test(l)));
});

test('ingest returns what it has when the time budget runs out', async () => {
  const feed = Array.from({ length: 50 }, (_, i) => row(i));
  const { ctx, calls, logs } = makeCtx({ feed, settings: { page_size: 1, concurrency: 1, time_budget_ms: 1000 } });
  const realNow = Date.now;
  let t = realNow();
  Date.now = () => (t += 300); // each check advances the clock 300 ms
  try {
    const leads = await plugin.ingest(ctx);
    assert.ok(leads.length > 0 && leads.length < 50);
    assert.ok(calls.length < 51);
    assert.ok(logs.some(l => /time budget/.test(l)));
  } finally {
    Date.now = realNow;
  }
});
