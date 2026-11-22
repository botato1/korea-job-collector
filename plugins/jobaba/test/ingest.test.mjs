// ingest() against a fake ctx. Zero network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import plugin from '../index.mjs';

const FUTURE = '20991231';
const PAST = '20000101';
const row = (n, o = {}) => ({
  ENTRPRS_NM: `회사${n}`, PBANC_CONT: `공고${n}`, WORK_REGION_CONT: '성남시', CAREER_DIV: '신입',
  RCPT_END_DE: FUTURE, URL: `https://job.gg.go.kr/empmn/jobEntDtl.do?seq=${n}`, ...o,
});
const page = (rows, total) => ({ GGJOBABARECRUSTM: [
  { head: [{ list_total_count: total }, { RESULT: { CODE: 'INFO-000', MESSAGE: '정상 처리되었습니다.' } }] },
  { row: rows },
] });

function makeCtx({ pages, settings = {}, env = { GG_OPENAPI_KEY: 'TESTKEY' }, dryRun = false }) {
  const calls = [];
  const logs = [];
  return {
    calls, logs,
    ctx: {
      env, settings, dryRun,
      log: (m) => logs.push(String(m)),
      fetch: async (url, opts) => {
        const u = new URL(url);
        calls.push(u);
        if (opts?.headers?.Accept || opts?.headers?.accept) {
          return new Response('<html>500</html>', { status: 500 }); // mirrors the live API
        }
        const out = pages(Number(u.searchParams.get('pIndex')));
        if (out instanceof Response) return out;
        // The live API labels JSON as text/html.
        return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'text/html;charset=UTF-8' } });
      },
    },
  };
}

test('ingest pages until a short page and returns leads', async () => {
  const { ctx, calls } = makeCtx({
    settings: { page_size: 2 },
    pages: (p) => (p === 1 ? page([row(1), row(2)], 3) : page([row(3)], 3)),
  });
  const leads = await plugin.ingest(ctx);
  assert.deepEqual(leads.map(l => l.title), ['공고1', '공고2', '공고3']);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].searchParams.get('pIndex'), '1');
});

test('ingest stops when pIndex*pSize reaches total', async () => {
  const { ctx, calls } = makeCtx({ settings: { page_size: 1 }, pages: (p) => page([row(p)], 2) });
  await plugin.ingest(ctx);
  assert.equal(calls.length, 2);
});

test('ingest respects max_pages', async () => {
  const { ctx, calls } = makeCtx({ settings: { page_size: 1, max_pages: 3 }, pages: (p) => page([row(p)], 100) });
  await plugin.ingest(ctx);
  assert.equal(calls.length, 3);
});

test('ingest stops after N consecutive pages with no open postings', async () => {
  const { ctx, calls, logs } = makeCtx({
    settings: { page_size: 1, stop_after_stale_pages: 2 },
    pages: (p) => page([row(p, { RCPT_END_DE: p === 1 ? FUTURE : PAST })], 100),
  });
  const leads = await plugin.ingest(ctx);
  assert.equal(leads.length, 1);
  assert.equal(calls.length, 3);
  assert.ok(logs.some(l => /expired/.test(l)));
});

test('ingest stops on an API error and returns what it has', async () => {
  const { ctx, calls, logs } = makeCtx({
    settings: { page_size: 1 },
    pages: (p) => (p === 1 ? page([row(1)], 100) : { RESULT: { CODE: 'ERROR-290', MESSAGE: '인증키가 유효하지 않습니다.' } }),
  });
  const leads = await plugin.ingest(ctx);
  assert.equal(leads.length, 1);
  assert.equal(calls.length, 2);
  assert.ok(logs.some(l => l.includes('ERROR-290')));
});

test('ingest stops on non-200 and on non-JSON', async () => {
  for (const mk of [() => new Response('x', { status: 500 }), () => new Response('<html>', { status: 200 })]) {
    const { ctx, calls } = makeCtx({ pages: mk });
    assert.deepEqual(await plugin.ingest(ctx), []);
    assert.equal(calls.length, 1);
  }
});

test('ingest keeps earlier leads when the guarded fetch throws', async () => {
  const { ctx, calls, logs } = makeCtx({
    settings: { page_size: 1 },
    pages: (p) => { if (p === 2) throw new Error('HTTP 500: <!doctype html>'); return page([row(p)], 100); },
  });
  const leads = await plugin.ingest(ctx);
  assert.equal(leads.length, 1);
  assert.equal(calls.length, 2);
  assert.ok(logs.some(l => l.includes('request failed (HTTP 500)')));
});

test('ingest throws without a key and makes no calls on dry run', async () => {
  const a = makeCtx({ env: {}, pages: () => page([], 0) });
  await assert.rejects(plugin.ingest(a.ctx), /GG_OPENAPI_KEY/);
  assert.equal(a.calls.length, 0);
  const b = makeCtx({ dryRun: true, pages: () => page([], 0) });
  assert.deepEqual(await plugin.ingest(b.ctx), []);
  assert.equal(b.calls.length, 0);
});

test('ingest never logs the key', async () => {
  const { ctx, logs } = makeCtx({ env: { GG_OPENAPI_KEY: 'SECRET123' }, pages: () => ({ RESULT: { CODE: 'ERROR-290', MESSAGE: 'bad' } }) });
  await plugin.ingest(ctx);
  assert.ok(logs.length > 0);
  assert.ok(logs.every(l => !l.includes('SECRET123')));
});
