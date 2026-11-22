// Unit tests for the pure helpers. Zero network: run with `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  buildSearchUrl, parseResponse, filterJobs, toLead, normalizeSettings,
  consumeBudget, apiError,
} from '../_lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(readFileSync(path.join(here, 'fixtures', 'sample-response.json'), 'utf8'));

test('normalizeSettings applies defaults and caps count at 110', () => {
  const s = normalizeSettings({ keywords: ['AI'], count: 500 });
  assert.equal(s.count, 110);
  assert.deepEqual(s.experience, [1, 3, 0]);
  assert.equal(s.exclude_headhunting, true);
  assert.ok(s.max_pages_per_keyword >= 1);
  assert.ok(s.daily_call_budget <= 500);
});

test('normalizeSettings rejects missing keywords', () => {
  assert.throws(() => normalizeSettings({}), /keywords/);
});

test('buildSearchUrl sets key, keyword, locations, paging and headhunting filter', () => {
  const s = normalizeSettings({ keywords: ['백엔드'], loc_cd: [101000, 102180], published_days: 7 });
  const now = Date.UTC(2026, 10, 23) / 1000;
  const u = new URL(buildSearchUrl({ key: 'KEY', keyword: '백엔드', start: 2, settings: s, nowSec: now }));
  assert.equal(u.origin + u.pathname, 'https://oapi.saramin.co.kr/job-search');
  assert.equal(u.searchParams.get('access-key'), 'KEY');
  assert.equal(u.searchParams.get('keywords'), '백엔드');
  assert.equal(u.searchParams.get('loc_cd'), '101000,102180');
  assert.equal(u.searchParams.get('start'), '2');
  assert.equal(u.searchParams.get('count'), '110');
  assert.equal(u.searchParams.get('sr'), 'directhire');
  assert.equal(u.searchParams.get('sort'), 'pd');
  assert.equal(u.searchParams.get('published_min'), String(now - 7 * 86400));
});

test('buildSearchUrl omits optional filters when unset', () => {
  const s = normalizeSettings({ keywords: ['AI'], exclude_headhunting: false, published_days: 0 });
  const u = new URL(buildSearchUrl({ key: 'K', keyword: 'AI', start: 0, settings: s, nowSec: 0 }));
  assert.equal(u.searchParams.has('loc_cd'), false);
  assert.equal(u.searchParams.has('sr'), false);
  assert.equal(u.searchParams.has('published_min'), false);
});

test('parseResponse returns jobs and total', () => {
  const r = parseResponse(sample);
  assert.equal(r.jobs.length, 4);
  assert.equal(r.total, 4);
});

test('parseResponse accepts a single job object (XML-to-JSON style) and an empty result', () => {
  const single = { jobs: { count: 1, start: 0, total: '1', job: sample.jobs.job[0] } };
  assert.equal(parseResponse(single).jobs.length, 1);
  assert.deepEqual(parseResponse({ jobs: { count: 0, total: '0' } }).jobs, []);
});

test('apiError detects the documented error codes', () => {
  assert.equal(apiError({ result: { code: 4, message: 'over limit' } })?.code, 4);
  // What the live API actually returns for a bad key: a top-level code, not result.code.
  assert.deepEqual(apiError({ code: 2, message: '사용 불가능한 access-key 입니다. ' }), { code: 2, message: '사용 불가능한 access-key 입니다.' });
  assert.equal(apiError(sample), null);
});

test('filterJobs keeps active postings with allowed experience codes and dedupes by id', () => {
  const s = normalizeSettings({ keywords: ['AI'] });
  const seen = new Set(['10000003']);
  const kept = filterJobs(sample.jobs.job, s, seen);
  // 10000001 신입 → keep; 10000002 경력 → drop; 10000003 already seen → drop; 10000004 inactive → drop
  assert.deepEqual(kept.map(j => j.id), ['10000001']);
  assert.ok(seen.has('10000001'));
});

test('toLead maps to the career-ops Job shape and decodes HTML entities', () => {
  const lead = toLead(sample.jobs.job[0]);
  assert.deepEqual(lead, {
    title: '[신입] AI 엔지니어 (LLM)',
    url: 'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=10000001',
    company: '가상테크(주)',
    location: '경기 > 성남시 분당구',
  });
});

test('consumeBudget resets per day and refuses past the budget', () => {
  let state = { date: '2026-11-22', calls: 99 };
  let r = consumeBudget(state, '2026-11-23', 100);
  assert.equal(r.ok, true);
  assert.deepEqual(r.state, { date: '2026-11-23', calls: 1 });
  state = { date: '2026-11-23', calls: 100 };
  r = consumeBudget(state, '2026-11-23', 100);
  assert.equal(r.ok, false);
  assert.deepEqual(r.state, state);
});
