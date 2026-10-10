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

const inputSchema = {
  crawlId: z.string().optional(),
  exportId: z.string().optional(),
  file: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().min(0).default(0),
  filterColumn: z.string().optional(),
  filterValue: z.union([z.string(), z.number()]).optional(),
} as const;
type Args = z.infer<z.ZodObject<typeof inputSchema>>;

export const readSfCrawlDataTool = {
  name: "read_sf_crawl_data",
  config: {
    title: "Read Screaming Frog crawl data",
    description: "Exports and reads crawl data - call once without file to list files, again with file for rows.",
    inputSchema,
    outputSchema: z.object({ configured: z.boolean() }).passthrough(),
  },
  handler: async (args: Args) => {
    if (!isSfMcpConfigured()) return reply(notConfigured);
    if (!args.exportId && !args.crawlId) return reply({ configured: true, error: "Provide a crawlId or exportId." });
    try {
      if (args.exportId && !args.crawlId && !args.file) {
        return reply({ configured: true, exportId: args.exportId, files: null, message: "file is required when reusing an export id without a crawl id" });
      }
      const exported = args.exportId ? undefined : record(await callSfTool("export_crawl", { db_id: args.crawlId }));
      const exportId = args.exportId ?? exported?.export_id;
      if (typeof exportId !== "string") return reply({ configured: true, error: "Export did not return an export_id.", upstream: exported });
      if (!args.file) return reply({ configured: true, exportId, files: exported?.files ?? [], message: "call again with a file to read rows" });
      const upstream = await callSfTool("read_crawl_data", {
        export_id: exportId, file: args.file, limit: args.limit, offset: args.offset,
        ...(args.filterColumn ? { filter_column: args.filterColumn } : {}),
        ...(args.filterValue !== undefined ? { filter_value: args.filterValue } : {}),
      });
      return reply({ configured: true, exportId, ...record(upstream) });
    } catch (error) {
      return reply({ configured: true, error: error instanceof Error ? error.message : String(error) });
    }
  },
};
