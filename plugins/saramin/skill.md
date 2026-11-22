---
name: career-ops-plugin-saramin
description: How to pull entry-level job postings from the Saramin Open API into the career-ops pipeline.
license: MIT
---

# saramin plugin

Searches the Saramin Open API for each configured keyword, keeps active
postings whose experience level is 신입 / 신입·경력 / 경력무관, dedupes them and
returns them as leads. The engine writes them to the pipeline and applies
`portals.yml` `title_filter`, the blacklist and scan history.

## Command

- `node plugins.mjs run saramin` — ingest new postings.

## Setup

Put `SARAMIN_ACCESS_KEY` in `.env`. Configure in `config/plugins.yml`:

```yaml
plugins:
  saramin:
    enabled: true
    keywords: ["AI", "LLM", "백엔드"]
    loc_cd: [101000, 102180, 102410, 102420]
```

## Limits

The API allows 500 calls a day and 110 postings per call. The plugin counts
its own calls in `data/saramin-state.json` and stops at `daily_call_budget`
(default 300). The API returns summary fields only; read the posting page for
the full description.

Powered by 취업 사람인 (http://www.saramin.co.kr)
