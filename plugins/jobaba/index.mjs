// @ts-check
// jobaba — career-ops ingest plugin for the 경기도 잡아바 채용정보 Open API
// (경기데이터드림 GGJOBABARECRUSTM).
//
// The API has no search parameters, so the plugin pages through the feed and
// keeps open, entry-level postings in the configured cities. It stops at
// max_pages, at the end of the data, or after `stop_after_stale_pages` pages
// in a row that hold only expired postings. The career-ops engine then applies
// portals.yml title_filter, the blacklist and scan history.
//
// Put GG_OPENAPI_KEY (경기데이터드림 인증키) in career-ops/.env.
// Run:  node plugins.mjs run jobaba
//
// 출처: 경기도 (경기데이터드림, 잡아바 채용정보)

import { normalizeSettings, buildUrl, parseResponse, filterRows, toLead, todayYmd } from './_lib.mjs';

export default {
  async ingest(ctx) {
    const key = ctx.env?.GG_OPENAPI_KEY;
    if (!key) throw new Error('jobaba: GG_OPENAPI_KEY is missing from .env');
    const settings = normalizeSettings(ctx.settings);

    if (ctx.dryRun) {
      ctx.log(`jobaba: dry run — would read up to ${settings.max_pages} page(s) of ${settings.page_size}`);
      return [];
    }

    const today = todayYmd();
    const seen = new Set();
    const leads = [];
    let calls = 0;
    let scanned = 0;
    let stale = 0;

    for (let pIndex = 1; pIndex <= settings.max_pages; pIndex++) {
      calls++;
      // No Accept header: the live API answers `Accept: application/json` with HTTP 500.
      let res;
      try {
        res = await ctx.fetch(buildUrl({ key, pIndex, settings }));
      } catch (e) {
        // career-ops' guarded fetch throws on non-2xx; keep what we already have.
        ctx.log(`jobaba: request failed (${String(e?.message ?? e).split(':')[0]}) — stopping`);
        break;
      }
      if (res.status !== 200) {
        ctx.log(`jobaba: HTTP ${res.status} — stopping`);
        break;
      }
      let body;
      try {
        // The API labels its JSON as text/html, so parse the text ourselves.
        body = JSON.parse(await res.text());
      } catch {
        ctx.log('jobaba: response was not JSON — stopping');
        break;
      }
      const page = parseResponse(body);
      if (!page.ok) {
        ctx.log(`jobaba: API error ${page.code} (${page.message}) — stopping`);
        break;
      }

      scanned += page.rows.length;
      const { kept, open } = filterRows(page.rows, settings, seen, today);
      for (const r of kept) leads.push(toLead(r));

      if (page.rows.length < settings.page_size || pIndex * settings.page_size >= page.total) break;
      stale = open === 0 ? stale + 1 : 0;
      if (settings.stop_after_stale_pages > 0 && stale >= settings.stop_after_stale_pages) {
        ctx.log(`jobaba: ${stale} page(s) in a row held only expired postings — stopping`);
        break;
      }
    }

    ctx.log(`jobaba: ${leads.length} posting(s) kept from ${scanned} row(s) in ${calls} call(s)`);
    return leads;
  },
};
