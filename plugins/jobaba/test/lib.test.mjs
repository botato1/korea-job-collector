// Pure helper tests for the jobaba plugin. Zero network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSettings, buildUrl, parseResponse, filterRows, toLead, todayYmd,
} from '../_lib.mjs';

const row = (o = {}) => ({
  ENTRPRS_NM: '(주)테스트', PBANC_CONT: 'AI 엔지니어 신입 모집', WORK_REGION_CONT: '성남시',
  CAREER_DIV: '신입', RECRUT_FIELD_NM: '연구ㆍ공학기술직', RCPT_END_DE: '20261231',
  URL: 'https://job.gg.go.kr/empmn/jobEntDtl.do?seq=1', ...o,
});

test('normalizeSettings fills defaults and clamps', () => {
  const s = normalizeSettings({});
  assert.ok(s.regions.includes('성남시'));
  assert.deepEqual(s.career, ['신입', '무관']);
  assert.equal(s.page_size, 1000);
  assert.equal(s.max_pages, 50);
  assert.equal(s.stop_after_stale_pages, 3);
  const c = normalizeSettings({ page_size: 99999, max_pages: 0, regions: ['수원시'] });
  assert.equal(c.page_size, 1000);
  assert.equal(c.max_pages, 1);
  assert.deepEqual(c.regions, ['수원시']);
});

test('buildUrl sets KEY, Type=json, pIndex, pSize', () => {
  const u = new URL(buildUrl({ key: 'K', pIndex: 2, settings: normalizeSettings({}) }));
  assert.equal(u.origin + u.pathname, 'https://openapi.gg.go.kr/GGJOBABARECRUSTM');
  assert.equal(u.searchParams.get('KEY'), 'K');
  assert.equal(u.searchParams.get('Type'), 'json');
  assert.equal(u.searchParams.get('pIndex'), '2');
  assert.equal(u.searchParams.get('pSize'), '1000');
});

test('parseResponse reads rows and total from a normal response', () => {
  const body = { GGJOBABARECRUSTM: [
    { head: [{ list_total_count: 7 }, { RESULT: { CODE: 'INFO-000', MESSAGE: '정상' } }] },
    { row: [row(), row()] },
  ] };
  assert.deepEqual(parseResponse(body), { ok: true, rows: [row(), row()], total: 7 });
});

test('parseResponse treats INFO-200 (no data) as an empty last page', () => {
  const r = parseResponse({ RESULT: { CODE: 'INFO-200', MESSAGE: '해당하는 데이터가 없습니다.' } });
  assert.deepEqual(r, { ok: true, rows: [], total: 0 });
});

test('parseResponse reports a top-level error such as a bad key', () => {
  const r = parseResponse({ RESULT: { CODE: 'ERROR-290', MESSAGE: '인증키가 유효하지 않습니다. ' } });
  assert.deepEqual(r, { ok: false, code: 'ERROR-290', message: '인증키가 유효하지 않습니다.' });
});

test('parseResponse reports an error code inside head', () => {
  const r = parseResponse({ GGJOBABARECRUSTM: [{ head: [{ list_total_count: 0 }, { RESULT: { CODE: 'ERROR-336', MESSAGE: 'x' } }] }] });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ERROR-336');
});

test('parseResponse rejects an unknown shape', () => {
  assert.equal(parseResponse({ foo: 1 }).ok, false);
  assert.equal(parseResponse(null).ok, false);
});

test('filterRows keeps open entry-level postings in allowed regions, deduped by URL', () => {
  const s = normalizeSettings({});
  const seen = new Set();
  const rows = [
    row(),                                          // keep
    row(),                                          // duplicate URL
    row({ URL: 'u2', CAREER_DIV: '경력' }),          // career
    row({ URL: 'u3', CAREER_DIV: '신입/경력' }),      // keep
    row({ URL: 'u4', CAREER_DIV: '경력무관' }),       // keep
    row({ URL: 'u5', WORK_REGION_CONT: '화성시' }),   // region
    row({ URL: 'u6', RCPT_END_DE: '20261122' }),    // expired
    row({ URL: 'u7', RCPT_END_DE: null }),          // no end date: keep
    row({ URL: '' }),                               // no URL
  ];
  const { kept, open } = filterRows(rows, s, seen, '20261123');
  assert.deepEqual(kept.map(r => r.URL), ['https://job.gg.go.kr/empmn/jobEntDtl.do?seq=1', 'u3', 'u4', 'u7']);
  assert.equal(open, 8); // every row except the expired one
});

test('filterRows region match is a substring match so "성남시 분당구" counts', () => {
  const { kept } = filterRows([row({ WORK_REGION_CONT: '경기 성남시 분당구' })], normalizeSettings({}), new Set(), '20261123');
  assert.equal(kept.length, 1);
});

test('filterRows with empty regions keeps every region', () => {
  const { kept } = filterRows([row({ WORK_REGION_CONT: '화성시' })], normalizeSettings({ regions: [] }), new Set(), '20261123');
  assert.equal(kept.length, 1);
});

test('toLead maps fields to the career-ops Job shape', () => {
  assert.deepEqual(toLead(row()), {
    title: 'AI 엔지니어 신입 모집', url: 'https://job.gg.go.kr/empmn/jobEntDtl.do?seq=1',
    company: '(주)테스트', location: '성남시',
  });
});

test('todayYmd formats a local date', () => {
  assert.equal(todayYmd(new Date(2026, 10, 3)), '20261103');
});
