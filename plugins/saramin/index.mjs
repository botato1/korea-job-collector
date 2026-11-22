// @ts-check
// saramin — career-ops ingest plugin for the Saramin Open API.
//
// Pulls job postings for each configured keyword (optionally limited to region
// codes), keeps active entry-level postings (신입 / 신입·경력 / 경력무관), dedupes
// them and RETURNS Job[]. The career-ops engine writes them to the pipeline and
// applies portals.yml title_filter, the blacklist and scan history.
//
// Enable in config/plugins.yml (see config/plugins.example.yml in this repo).
// Put SARAMIN_ACCESS_KEY in career-ops/.env.
// Run:  node plugins.mjs run saramin
//
// Powered by 취업 사람인 (http://www.saramin.co.kr)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  normalizeSettings, buildSearchUrl, parseResponse, filterJobs, toLead,
  consumeBudget, apiError,
} from './_lib.mjs';

const STATE_FILE = join('data', 'saramin-state.json');
const statePath = (ctx) => join(ctx?.dataRoot || process.cwd(), STATE_FILE);

function loadState(ctx) {
  try {
    const p = statePath(ctx);
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
  } catch {
    return {};
  }
}

function saveState(ctx, state) {
  const p = statePath(ctx);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2) + '\n');
}

/** Local calendar date (KST on the user's machine), YYYY-MM-DD. */
function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default {
  async ingest(ctx) {
    const key = ctx.env?.SARAMIN_ACCESS_KEY;
    if (!key) throw new Error('saramin: SARAMIN_ACCESS_KEY is missing from .env');
    const settings = normalizeSettings(ctx.settings);

    if (ctx.dryRun) {
      ctx.log(`saramin: dry run — would search ${settings.keywords.length} keyword(s), up to ${settings.max_pages_per_keyword} page(s) each`);
      return [];
    }

    let state = loadState(ctx);
    const date = today();
    const seen = new Set();
    const leads = [];
    let calls = 0;
    let stop = false;

    for (const keyword of settings.keywords) {
      if (stop) break;
      let kept = 0;
      for (let pageNo = 0; pageNo < settings.max_pages_per_keyword; pageNo++) {
        const budget = consumeBudget(state, date, settings.daily_call_budget);
        if (!budget.ok) {
          ctx.log(`saramin: daily call budget (${settings.daily_call_budget}) reached — stopping`);
          stop = true;
          break;
        }
        state = budget.state;
        saveState(ctx, state);
        calls++;

        const url = buildSearchUrl({ key, keyword, start: pageNo, settings, nowSec: Date.now() / 1000 });
        // Raw fetch, not fetchJson: an invalid key comes back as HTTP 307 to an
        // HTML error page on www.saramin.co.kr, not as a JSON error code.
        const res = await ctx.fetch(url, { headers: { Accept: 'application/json' } });
        if (res.status !== 200) {
          ctx.log(`saramin: HTTP ${res.status} — check SARAMIN_ACCESS_KEY and parameters; stopping`);
          stop = true;
          break;
        }
        let body;
        try {
          body = JSON.parse(await res.text());
        } catch {
          ctx.log('saramin: response was not JSON — stopping');
          stop = true;
          break;
        }

        const err = apiError(body);
        if (err) {
          ctx.log(`saramin: API error code ${err.code} (${err.message}) — stopping`);
          stop = true;
          break;
        }

        const { jobs, total } = parseResponse(body);
        const fresh = filterJobs(jobs, settings, seen);
        kept += fresh.length;
        for (const j of fresh) leads.push(toLead(j));

        const fetched = (pageNo + 1) * settings.count;
        if (jobs.length < settings.count || fetched >= total) break;
      }
      ctx.log(`saramin: "${keyword}" → ${kept} entry-level posting(s)`);
    }

    ctx.log(`saramin: ${leads.length} posting(s) from ${calls} call(s) today; ${state.calls ?? 0}/${settings.daily_call_budget} used`);
    return leads;
  },
};
