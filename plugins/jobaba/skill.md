---
name: career-ops-plugin-jobaba
description: How to pull open entry-level job postings from the Gyeonggi-do Jobaba Open API into the career-ops pipeline.
license: MIT
---

# jobaba plugin

Reads the 경기도 잡아바 채용정보 feed (경기데이터드림 `GGJOBABARECRUSTM`). The API
has no search parameters, so the plugin pages through the feed and keeps
postings that are still open (`RCPT_END_DE` not passed), entry-level
(`CAREER_DIV` contains 신입 or 무관) and in a configured city. The engine
then applies `portals.yml` `title_filter`, the blacklist and scan history.

## Command

- `node plugins.mjs run jobaba` — ingest new postings.

## Setup

Put `GG_OPENAPI_KEY` (경기데이터드림 인증키) in `.env`. Configure in `config/plugins.yml`:

```yaml
plugins:
  jobaba:
    enabled: true
    regions: ["성남시", "용인시", "수원시"]
```

## Limits

No daily call limit is published. The feed is appended to over time (page 1
is oldest) and repeats postings, so the plugin reads from the last page
backwards, `concurrency` pages at a time (default 8), up to `max_pages`
(default 100), and dedupes by URL. It stops after `stop_after_stale_pages`
pages in a row with under `stale_open_ratio` open rows, or when
`time_budget_ms` (default 12 s) runs out — career-ops ends an ingest hook
at 15 s. Without a key the API returns a fixed 5-row sample, so a key is required.
Posting links point to the original site (job.gg.go.kr, 잡코리아, 고용24).

출처: 경기도 (경기데이터드림)
