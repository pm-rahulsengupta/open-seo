import { z } from "zod";
import {
  callSfTool,
  isSfMcpConfigured,
  sanitizedSfSnippet,
} from "@/server/lib/screaming-frog/client";
import { mcpResponse } from "@/server/mcp/formatters";

const notConfigured = {
  configured: false,
  message:
    "SF_MCP_URL is not configured on this OpenSEO instance. Ask the administrator to set it to the Screaming Frog MCP bridge URL.",
};

function reply(data: Record<string, unknown>) {
  return mcpResponse({ text: JSON.stringify(data), structuredContent: data });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : { value };
}

const inputSchema = {
  siteUrl: z.string().url(),
  label: z.string().optional(),
} as const;

type Args = z.infer<z.ZodObject<typeof inputSchema>>;

export const runSfCrawlTool = {
  name: "run_sf_crawl",
  config: {
    title: "Run Screaming Frog crawl",
    description:
      "Starts a headless Screaming Frog crawl and returns immediately with a crawl id; does not wait for completion. Poll with get_sf_crawl_status. The machine hosting Screaming Frog must be online.",
    inputSchema,
    outputSchema: z.object({ configured: z.boolean() }).passthrough(),
  },
  handler: async (args: Args) => {
    if (!isSfMcpConfigured()) return reply(notConfigured);
    try {
      const upstream = await callSfTool("crawl_site", {
        url: args.siteUrl,
        ...(args.label ? { label: args.label } : {}),
      });
      const data = record(upstream);
      const crawlId = data.crawl_id ?? data.id ?? data.db_id ?? data.crawlId;
      if (crawlId === undefined || crawlId === null || crawlId === "") {
        return reply({
          configured: true,
          started: false,
          message: `Crawl response had no id: ${sanitizedSfSnippet(JSON.stringify(upstream) ?? String(upstream))}`,
          upstream,
        });
      }
      return reply({
        configured: true,
        started: true,
        crawlId,
        message: "Crawl started. Poll get_sf_crawl_status for progress.",
        upstream,
      });
    } catch (error) {
      return reply({
        configured: true,
        started: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};
