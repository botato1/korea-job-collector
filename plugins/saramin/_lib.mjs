// @ts-check
// Pure helpers for the saramin plugin: no network, no filesystem.
// API spec: https://oapi.saramin.co.kr/guide/job-search

export const API_URL = 'https://oapi.saramin.co.kr/job-search';
export const MAX_COUNT = 110;      // spec: count max 110
export const MAX_DAILY_CALLS = 500; // spec: 1일 최대 500회

/** 1 신입, 3 신입·경력, 0 경력무관 */
const DEFAULT_EXPERIENCE = [1, 3, 0];

/**
 * Validate and fill defaults for the user's config/plugins.yml block.
 * @param {any} raw
 */
export function normalizeSettings(raw = {}) {
  const keywords = Array.isArray(raw.keywords) ? raw.keywords.map(String).filter(Boolean) : [];
  if (keywords.length === 0) {
    throw new Error('saramin: set `keywords` (a list) in config/plugins.yml');
  }
  const intList = (v) => (Array.isArray(v) ? v : v == null ? [] : [v])
    .map(Number).filter(Number.isFinite);
  const clamp = (n, lo, hi, dflt) => {
    const x = Number(n);
    return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.floor(x))) : dflt;
  };
  return {
    keywords,
    loc_cd: intList(raw.loc_cd),
    experience: raw.experience == null ? DEFAULT_EXPERIENCE : intList(raw.experience),
    count: clamp(raw.count, 1, MAX_COUNT, MAX_COUNT),
    max_pages_per_keyword: clamp(raw.max_pages_per_keyword, 1, 50, 5),
    daily_call_budget: clamp(raw.daily_call_budget, 1, MAX_DAILY_CALLS, 300),
    published_days: clamp(raw.published_days, 0, 365, 7),
    exclude_headhunting: raw.exclude_headhunting !== false,
  };
}

/**
 * @param {{key: string, keyword: string, start: number, settings: ReturnType<typeof normalizeSettings>, nowSec: number}} a
 */
export function buildSearchUrl({ key, keyword, start, settings, nowSec }) {
  const u = new URL(API_URL);
  u.searchParams.set('access-key', key);
  u.searchParams.set('keywords', keyword);
  if (settings.loc_cd.length) u.searchParams.set('loc_cd', settings.loc_cd.join(','));
  if (settings.exclude_headhunting) u.searchParams.set('sr', 'directhire');
  if (settings.published_days > 0) {
    u.searchParams.set('published_min', String(Math.floor(nowSec) - settings.published_days * 86400));
  }
  u.searchParams.set('sort', 'pd');
  u.searchParams.set('start', String(start));
  u.searchParams.set('count', String(settings.count));
  return u.toString();
}

/**
 * Returns {code, message} for an error response, else null.
 * The spec documents `result.code`, but the live API answers a bad key with a
 * top-level `{"code": 2, "message": "..."}` — accept both.
 */
export function apiError(body) {
  if (!body || typeof body !== 'object' || body.jobs) return null;
  const r = body.result && typeof body.result === 'object' ? body.result : body;
  if (r.code != null && Number(r.code) !== 0) {
    return { code: Number(r.code), message: String(r.message ?? '').trim() };
  }
  return null;
}

/** @returns {{jobs: any[], total: number}} */
export function parseResponse(body) {
  const jobs = body && body.jobs;
  if (!jobs) return { jobs: [], total: 0 };
  const list = jobs.job == null ? [] : Array.isArray(jobs.job) ? jobs.job : [jobs.job];
  const total = Number(jobs.total);
  return { jobs: list, total: Number.isFinite(total) ? total : list.length };
}

/**
 * Keep active postings with an allowed experience code, not seen before.
 * Mutates `seen` with the ids it keeps.
 * @param {any[]} jobs
 * @param {ReturnType<typeof normalizeSettings>} settings
 * @param {Set<string>} seen
 */
export function filterJobs(jobs, settings, seen) {
  const allowed = new Set(settings.experience.map(Number));
  const out = [];
  for (const j of jobs) {
    const id = String(j?.id ?? '');
    if (!id || seen.has(id)) continue;
    if (Number(j.active) !== 1) continue;
    const exp = Number(j?.position?.['experience-level']?.code);
    if (!allowed.has(exp)) continue;
    seen.add(id);
    out.push(j);
  }
  return out;
}

const ENTITIES = { '&gt;': '>', '&lt;': '<', '&amp;': '&', '&quot;': '"', '&#39;': "'" };
const decode = (s) => String(s ?? '').replace(/&(gt|lt|amp|quot|#39);/g, (m) => ENTITIES[m] ?? m).trim();

/** Map one API posting to the career-ops Job shape. */
export function toLead(j) {
  return {
    title: decode(j?.position?.title),
    url: String(j?.url ?? ''),
    company: decode(j?.company?.detail?.name),
    location: decode(j?.position?.location?.name),
  };
}

/**
 * Count one API call against the daily budget.
 * @param {{date?: string, calls?: number}} state
 * @param {string} today YYYY-MM-DD
 * @param {number} budget
 */
export function consumeBudget(state, today, budget) {
  const calls = state?.date === today ? Number(state.calls) || 0 : 0;
  if (calls >= budget) return { ok: false, state };
  return { ok: true, state: { date: today, calls: calls + 1 } };
}
