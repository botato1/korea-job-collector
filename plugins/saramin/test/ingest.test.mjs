// ingest() against a fake ctx: paging, budget, error stop, state file. Zero network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import plugin from '../index.mjs';

function job(id, exp = 1, active = 1) {
  return {
    id: String(id), active, url: `https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=${id}`,
    company: { detail: { name: `회사${id}` } },
    position: { title: `공고${id}`, location: { name: '서울 &gt; 강남구' }, 'experience-level': { code: exp } },
  };
}

function makeCtx({ pages, settings, env = { SARAMIN_ACCESS_KEY: 'TESTKEY' }, dryRun = false }) {
  const calls = [];
  const logs = [];
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'saramin-'));
  return {
    calls, logs, dataRoot,
    ctx: {
      env, settings, dryRun, dataRoot,
      log: (m) => logs.push(String(m)),
      fetch: async (url, opts) => {
        calls.push({ url: new URL(url), opts });
        const u = new URL(url);
        const kw = u.searchParams.get('keywords');
        const start = Number(u.searchParams.get('start'));
        const out = pages(kw, start);
        if (out instanceof Response) return out;
        return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    },
  };
}

const page = (jobsArr, total) => ({ jobs: { count: jobsArr.length, start: 0, total: String(total), job: jobsArr } });

test('ingest pages through results until fewer than count are returned', async () => {
  const { ctx, calls } = makeCtx({
    settings: { keywords: ['AI'], count: 2, max_pages_per_keyword: 10 },
    pages: (_kw, start) => (start === 0 ? page([job(1), job(2)], 3) : page([job(3)], 3)),
  });
  const leads = await plugin.ingest(ctx);
  assert.deepEqual(leads.map(l => l.title), ['공고1', '공고2', '공고3']);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].opts.headers.Accept, 'application/json');
});

test('ingest dedupes across keywords and drops non-entry-level postings', async () => {
  const { ctx } = makeCtx({
    settings: { keywords: ['AI', '백엔드'], count: 110 },
    pages: (kw) => (kw === 'AI' ? page([job(1), job(2, 2)], 2) : page([job(1), job(3, 0)], 2)),
  });
  const leads = await plugin.ingest(ctx);
  assert.deepEqual(leads.map(l => l.title), ['공고1', '공고3']);
});

test('ingest stops at the daily budget and persists the counter', async () => {
  const { ctx, calls, dataRoot } = makeCtx({
    settings: { keywords: ['A', 'B', 'C'], count: 110, daily_call_budget: 2 },
    pages: (kw) => page([job(kw.charCodeAt(0))], 1),
  });
  const leads = await plugin.ingest(ctx);
  assert.equal(calls.length, 2);
  assert.equal(leads.length, 2);
  const state = JSON.parse(readFileSync(path.join(dataRoot, 'data', 'saramin-state.json'), 'utf8'));
  assert.equal(state.calls, 2);
});

test('ingest stops on an API error and keeps what it already collected', async () => {
  const { ctx, logs } = makeCtx({
    settings: { keywords: ['A', 'B'], count: 110 },
    pages: (kw) => (kw === 'A' ? page([job(1)], 1) : { result: { code: 4, message: 'daily limit' } }),
  });
  const leads = await plugin.ingest(ctx);
  assert.equal(leads.length, 1);
  assert.ok(logs.some(l => l.includes('code 4')));
});

test('ingest stops on a non-200 response (invalid key → 307 redirect to an error page)', async () => {
  const redirect = () => new Response('<meta http-equiv="refresh" content="0;url=https://www.saramin.co.kr/error/HTTP_BAD_REQUEST.php">',
    { status: 307, headers: { location: 'https://www.saramin.co.kr/error/HTTP_BAD_REQUEST.php' } });
  const { ctx, calls, logs } = makeCtx({ settings: { keywords: ['A', 'B', 'C'] }, pages: redirect });
  const leads = await plugin.ingest(ctx);
  assert.deepEqual(leads, []);
  assert.equal(calls.length, 1);
  assert.ok(logs.some(l => l.includes('HTTP 307')));
});

test('ingest stops on a 200 response that is not JSON', async () => {
  const html = () => new Response('<html>maintenance</html>', { status: 200 });
  const { ctx, calls, logs } = makeCtx({ settings: { keywords: ['A', 'B'] }, pages: html });
  const leads = await plugin.ingest(ctx);
  assert.deepEqual(leads, []);
  assert.equal(calls.length, 1);
  assert.ok(logs.some(l => l.includes('not JSON')));
});

test('ingest fails clearly without an access key', async () => {
  const { ctx } = makeCtx({ settings: { keywords: ['A'] }, env: {}, pages: () => page([], 0) });
  await assert.rejects(() => plugin.ingest(ctx), /SARAMIN_ACCESS_KEY/);
});

test('dry run makes no calls and writes no state', async () => {
  const { ctx, calls, dataRoot } = makeCtx({ settings: { keywords: ['A'] }, dryRun: true, pages: () => page([job(1)], 1) });
  const leads = await plugin.ingest(ctx);
  assert.deepEqual(leads, []);
  assert.equal(calls.length, 0);
  assert.equal(existsSync(path.join(dataRoot, 'data', 'saramin-state.json')), false);
});

test('the access key never appears in logs', async () => {
  const { ctx, logs } = makeCtx({ settings: { keywords: ['A'] }, pages: () => page([job(1)], 1) });
  await plugin.ingest(ctx);
  assert.ok(logs.length > 0);
  assert.ok(logs.every(l => !l.includes('TESTKEY')));
});
