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
  with Screaming Frog installed. That machine must be powered on.
- If `run_sf_crawl` returns `configured: false`, tell the user the bridge is
  not configured on this instance (SF_MCP_URL) and stop there.
- If calls time out or fail to connect, the bridge machine is likely offline -
  say so instead of retrying in a loop.

## Procedure

1. Start the crawl with `run_sf_crawl` (siteUrl, optional label such as
   "acme 2026-10-14"). It returns a crawl id as soon as the crawl starts. It
   does not wait for the crawl to finish - crawls take minutes.
2. Poll `get_sf_crawl_status` with the crawl id between other work. Without a
   crawl id it lists recent crawls, which is useful to resume a conversation
   about an earlier crawl.
3. When the crawl is finished, call `read_sf_crawl_data` once without `file`
   to get the export id and the list of export files, then call it with the
   `file` that answers the question. Keep `limit` small (50 is fine); page
   with `offset` or narrow with `filterColumn` / `filterValue` when needed.
4. Summarize with numbers first (how many 4xx, how many missing titles), then
   the worst offenders with their URLs. Quote exact URLs, not paraphrases.

## Notes

- One crawl at a time per site is plenty; do not start parallel crawls of the
  same site.
- Export files map to Screaming Frog tabs (internal, external, response codes,
  page titles, meta description, redirects, and so on).
