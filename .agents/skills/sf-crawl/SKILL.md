---
name: sf-crawl
description: Run a headless Screaming Frog crawl and read its findings via the SF MCP bridge. Use when the user asks for a Screaming Frog audit, a site crawl, or crawl-level diagnostics like broken links, redirect chains, duplicate titles, or response code breakdowns.
---

# Screaming Frog crawl

## When to use

The user wants a Screaming Frog crawl, an SF audit, or crawl-level data: status
codes, redirects, titles and meta descriptions, broken internal or external
links, image alt text, word counts.

## Prerequisites

- The crawl tools call a Screaming Frog MCP bridge that runs on the machine
  with Screaming Frog installed. That machine must be powered on and logged
  in.
- If `run_sf_crawl` returns `configured: false`, tell the user the bridge is
  not configured on this instance (SF_MCP_URL) and stop there.
- If calls time out or fail to connect, the bridge machine is likely offline -
  say so instead of retrying in a loop.

## Two id types

- `run_sf_crawl` returns a crawl handle like `crawl-1a2b3c4d`. Use it with
  `get_sf_crawl_status` only.
- Finished crawls are saved in Screaming Frog's database under a separate
  Database Id (a UUID). `read_sf_crawl_data` needs that UUID as its `crawlId`,
  not the crawl handle.

## Procedure

1. Start the crawl with `run_sf_crawl` (siteUrl, optional label such as
   "acme 2026-10-14"). It returns a crawl handle as soon as the crawl starts.
   It does not wait for the crawl to finish - crawls take minutes. Note the
   time you started it; you will need it to find the Database Id later.
2. Poll `get_sf_crawl_status` with the crawl handle between other work.
3. If a crawl fails within seconds with "crawl.seospider exists in output
   directory", a just-finished crawl's leftover file was in the way; it is
   archived automatically within about 10 seconds. Wait 15 seconds and retry
   the crawl once.
4. When the crawl is finished, call `get_sf_crawl_status` with no crawl id:
   it lists recent saved crawls with their Database Ids. Take the UUID whose
   URL matches the site you crawled (the start time from step 1 breaks ties).
5. Call `read_sf_crawl_data` with that UUID as `crawlId` and no `file` to get
   the export id and the list of export files, then call it again with the
   `file` that answers the question. Keep `limit` small (50 is fine); page
   with `offset` or narrow with `filterColumn` / `filterValue` when needed.
6. Summarize with numbers first (how many 4xx, how many missing titles), then
   the worst offenders with their URLs. Quote exact URLs, not paraphrases.

## Notes

- One crawl at a time per site is plenty; do not start parallel crawls of the
  same site.
- Export files map to Screaming Frog tabs (internal, external, response codes,
  page titles, meta description, redirects, and so on).
- Export files auto-delete after 60 minutes; calling `read_sf_crawl_data`
  without `file` again starts a fresh export, which is fine.
