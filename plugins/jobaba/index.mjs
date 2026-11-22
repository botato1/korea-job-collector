// @ts-check
// jobaba — career-ops ingest plugin for the 경기도 잡아바 채용정보 Open API
// (경기데이터드림 GGJOBABARECRUSTM).
//
// The API has no search parameters and is appended to over time: page 1 holds
// the oldest rows, the last page the newest, and the same posting appears many
// times. So the plugin asks for the row count, then reads pages from the end
// backwards, keeping open, entry-level postings in the configured regions
// (deduped by URL). It stops at max_pages or after `stop_after_stale_pages`
// pages in a row where under `stale_open_ratio` of rows are still open. The
// career-ops engine then applies portals.yml title_filter, the blacklist and
// scan history.
//
// Put GG_OPENAPI_KEY (경기데이터드림 인증키) in career-ops/.env.
// Run:  node plugins.mjs run jobaba
//
// 출처: 경기도 (경기데이터드림, 잡아바 채용정보)

import {
  normalizeSettings, buildUrl, parseResponse, filterRows, toLead, todayYmd, pagePlan,
} from './_lib.mjs';

/**
 * One API call. Returns the parsed page, or null after logging why it stopped.
 * No Accept header: the live API answers `Accept: application/json` with HTTP 500.
 */
async function fetchPage(ctx, key, pIndex, pageSize) {
  let res;
  try {
    res = await ctx.fetch(buildUrl({ key, pIndex, pageSize }));
  } catch (e) {
    // career-ops' guarded fetch throws on non-2xx; keep what we already have.
    ctx.log(`jobaba: request failed (${String(e?.message ?? e).split(':')[0]}) — stopping`);
    return null;
  }
  if (res.status !== 200) {
    ctx.log(`jobaba: HTTP ${res.status} — stopping`);
    return null;
  }
  let body;
  try {
    // The API labels its JSON as text/html, so parse the text ourselves.
    body = JSON.parse(await res.text());
  } catch {
    ctx.log('jobaba: response was not JSON — stopping');
    return null;
  }
  const page = parseResponse(body);
  if (!page.ok) {
    ctx.log(`jobaba: API error ${page.code} (${page.message}) — stopping`);
    return null;
  }
  return page;
}

export default {
  async ingest(ctx) {
    const key = ctx.env?.GG_OPENAPI_KEY;
    if (!key) throw new Error('jobaba: GG_OPENAPI_KEY is missing from .env');
    const settings = normalizeSettings(ctx.settings);

    if (ctx.dryRun) {
      ctx.log(`jobaba: dry run — would read up to ${settings.max_pages} page(s) of ${settings.page_size}, newest first`);
      return [];
    }

    const started = Date.now();
    // A 1-row call just to learn the total, so we know where the last page is.
    const head = await fetchPage(ctx, key, 1, 1);
    if (!head) return [];
    let calls = 1;

    const today = todayYmd();
    const seen = new Set();
    const leads = [];
    let scanned = 0;
    let stale = 0;

    // career-ops gives an ingest hook 15 s in total, so fetch a few pages at a
    // time and return what we have before the time budget runs out.
    const deadline = started + settings.time_budget_ms;
    const plan = pagePlan(head.total, settings.page_size, settings.max_pages);
    let done = false;
    for (let i = 0; i < plan.length && !done; i += settings.concurrency) {
      if (Date.now() >= deadline) {
        ctx.log(`jobaba: time budget (${settings.time_budget_ms} ms) used — stopping before page ${plan[i]}`);
        break;
      }
      const batch = plan.slice(i, i + settings.concurrency);
      calls += batch.length;
      const pages = await Promise.all(batch.map((p) => fetchPage(ctx, key, p, settings.page_size)));

      // Handle results in page order (newest first) so stop rules stay deterministic.
      for (let j = 0; j < batch.length; j++) {
        const page = pages[j];
        if (!page) { done = true; break; }

        scanned += page.rows.length;
        const { kept, open } = filterRows(page.rows, settings, seen, today);
        for (const r of kept) leads.push(toLead(r));

        const ratio = page.rows.length ? open / page.rows.length : 0;
        stale = ratio < settings.stale_open_ratio ? stale + 1 : 0;
        if (settings.stop_after_stale_pages > 0 && stale >= settings.stop_after_stale_pages) {
          ctx.log(`jobaba: ${stale} page(s) in a row were almost all expired — stopping at page ${batch[j]}`);
          done = true;
          break;
        }
      }
    }

    ctx.log(`jobaba: ${leads.length} posting(s) kept from ${scanned} row(s) in ${calls} call(s)`);
    return leads;
  },
};
