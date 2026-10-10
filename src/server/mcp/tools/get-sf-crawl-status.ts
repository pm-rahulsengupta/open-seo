import { z } from "zod";
import { callSfTool, isSfMcpConfigured } from "@/server/lib/screaming-frog/client";
import { mcpResponse } from "@/server/mcp/formatters";

const notConfigured = {
  configured: false,
  message: "SF_MCP_URL is not configured on this OpenSEO instance. Ask the administrator to set it to the Screaming Frog MCP bridge URL.",
};

function reply(data: Record<string, unknown>) {
  return mcpResponse({ text: JSON.stringify(data), structuredContent: data });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : { value };
}

const inputSchema = { crawlId: z.string().optional() } as const;
type Args = z.infer<z.ZodObject<typeof inputSchema>>;

export const getSfCrawlStatusTool = {
  name: "get_sf_crawl_status",
  config: {
    title: "Get Screaming Frog crawl status",
    description: "Returns current status and progress of a crawl, or lists recent crawls when no id is given.",
    inputSchema,
    outputSchema: z.object({ configured: z.boolean() }).passthrough(),
  },
  handler: async (args: Args) => {
    if (!isSfMcpConfigured()) return reply(notConfigured);
    try {
      if (args.crawlId) return reply({ configured: true, ...record(await callSfTool("crawl_status", { crawl_id: args.crawlId })) });
      const upstream = await callSfTool("list_crawls", {});
      const data = record(upstream);
      const crawls = Array.isArray(upstream) ? upstream : Array.isArray(data.crawls) ? data.crawls : [];
      return reply({ configured: true, ...data, upstream, crawls, mostRecent: crawls[0] ?? null });
    } catch (error) {
      return reply({ configured: true, error: error instanceof Error ? error.message : String(error) });
    }
  },
};
