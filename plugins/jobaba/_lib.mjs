// @ts-check
// Pure helpers for the jobaba plugin: no network, no filesystem.
// API: 경기도 잡아바 채용정보 (경기데이터드림 GGJOBABARECRUSTM, data.go.kr 15119896).
// The endpoint takes only KEY / Type / pIndex / pSize, so every filter is
// applied here, on the client.

export const API_URL = 'https://openapi.gg.go.kr/GGJOBABARECRUSTM';
export const MAX_PAGE_SIZE = 1000; // 경기데이터드림 pSize upper bound

/** 성남(판교·분당), 용인, 수원, 의왕, 안양, 과천, 군포, 광명, 부천 */
export const DEFAULT_REGIONS = ['성남시', '용인시', '수원시', '의왕시', '안양시', '과천시', '군포시', '광명시', '부천시'];
/** CAREER_DIV substrings: 신입, 신입/경력, 경력무관 */
export const DEFAULT_CAREER = ['신입', '무관'];

const strList = (v, dflt) => (v == null ? dflt : (Array.isArray(v) ? v : [v]).map(String).filter(Boolean));
const clamp = (n, lo, hi, dflt) => {
  const x = Number(n);
  return n != null && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.floor(x))) : dflt;
};

/** @param {any} raw */
export function normalizeSettings(raw = {}) {
  raw = raw || {};
  return {
    regions: strList(raw.regions, DEFAULT_REGIONS),
    career: strList(raw.career, DEFAULT_CAREER),
    page_size: clamp(raw.page_size, 1, MAX_PAGE_SIZE, MAX_PAGE_SIZE),
    max_pages: clamp(raw.max_pages, 1, 1000, 50),
    stop_after_stale_pages: clamp(raw.stop_after_stale_pages, 0, 1000, 3),
  };
}

/** @param {{key: string, pIndex: number, settings: ReturnType<typeof normalizeSettings>}} a */
export function buildUrl({ key, pIndex, settings }) {
  const u = new URL(API_URL);
  u.searchParams.set('KEY', key);
  u.searchParams.set('Type', 'json');
  u.searchParams.set('pIndex', String(pIndex));
  u.searchParams.set('pSize', String(settings.page_size));
  return u.toString();
}

const result = (code, message) => ({ code: String(code ?? ''), message: String(message ?? '').trim() });

/**
 * A normal answer is {GGJOBABARECRUSTM: [{head: [...]}, {row: [...]}]}.
 * Errors (bad key etc.) and "no data" (INFO-200) come back as a top-level {RESULT}.
 * @returns {{ok: true, rows: any[], total: number} | {ok: false, code: string, message: string}}
 */
export function parseResponse(body) {
  if (body && typeof body === 'object' && body.RESULT) {
    const r = result(body.RESULT.CODE, body.RESULT.MESSAGE);
    if (r.code === 'INFO-200') return { ok: true, rows: [], total: 0 };
    return { ok: false, ...r };
  }
  const sections = body && Array.isArray(body.GGJOBABARECRUSTM) ? body.GGJOBABARECRUSTM : null;
  if (!sections) return { ok: false, code: 'SHAPE', message: 'unexpected response shape' };

  const head = sections.find((s) => s && Array.isArray(s.head))?.head ?? [];
  const res = head.find((h) => h && h.RESULT)?.RESULT;
  if (res && res.CODE !== 'INFO-000') {
    if (res.CODE === 'INFO-200') return { ok: true, rows: [], total: 0 };
    return { ok: false, ...result(res.CODE, res.MESSAGE) };
  }
  const total = Number(head.find((h) => h && h.list_total_count != null)?.list_total_count);
  const rows = sections.find((s) => s && Array.isArray(s.row))?.row ?? [];
  return { ok: true, rows, total: Number.isFinite(total) ? total : rows.length };
}

const isExpired = (end, today) => /^\d{8}$/.test(String(end ?? '')) && String(end) < today;

/**
 * Keep postings that are still open, entry-level and in an allowed region.
 * Mutates `seen` (posting URLs). `open` counts rows that are not expired, so
 * the caller can tell when it has paged into old data.
 * @param {any[]} rows
 * @param {ReturnType<typeof normalizeSettings>} settings
 * @param {Set<string>} seen
 * @param {string} today YYYYMMDD
 */
export function filterRows(rows, settings, seen, today) {
  const kept = [];
  let open = 0;
  for (const r of rows) {
    if (isExpired(r?.RCPT_END_DE, today)) continue;
    open++;
    const url = String(r?.URL ?? '').trim();
    if (!url || seen.has(url)) continue;
    const career = String(r.CAREER_DIV ?? '');
    if (!settings.career.some((c) => career.includes(c))) continue;
    const region = String(r.WORK_REGION_CONT ?? '');
    if (settings.regions.length && !settings.regions.some((g) => region.includes(g))) continue;
    seen.add(url);
    kept.push(r);
  }
  return { kept, open };
}

/** Map one row to the career-ops Job shape. */
export function toLead(r) {
  const s = (v) => String(v ?? '').trim();
  return { title: s(r.PBANC_CONT), url: s(r.URL), company: s(r.ENTRPRS_NM), location: s(r.WORK_REGION_CONT) };
}

/** Local calendar date as YYYYMMDD (the API's date format). */
export function todayYmd(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}
