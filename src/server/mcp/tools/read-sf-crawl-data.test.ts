import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSfCrawlDataTool } from "./read-sf-crawl-data";

type Reply = { status?: number; body?: unknown; contentType?: string };

let exportReply: Reply;
let readReply: Reply;

function response(reply: Reply): Response {
  return new Response(
    reply.body === undefined
      ? null
      : typeof reply.body === "string"
        ? reply.body
        : JSON.stringify(reply.body),
    {
      status: reply.status ?? 200,
      headers: { "content-type": reply.contentType ?? "application/json" },
    },
  );
}

function localFetchMock() {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    if (typeof init?.body !== "string")
      throw new Error("Missing JSON-RPC body");
    const request: unknown = JSON.parse(init.body);
    if (
      typeof request !== "object" ||
      request === null ||
      !("method" in request)
    ) {
      throw new Error("Invalid JSON-RPC request");
    }
    if (request.method === "initialize") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "id" in request ? request.id : null,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            serverInfo: {},
          },
        }),
        {
          headers: {
            "content-type": "application/json",
            "mcp-session-id": "test-session",
          },
        },
      );
    }
    if (request.method === "notifications/initialized")
      return new Response(null, { status: 202 });
    if (request.method !== "tools/call")
      throw new Error(`Unexpected method: ${String(request.method)}`);
    const params = "params" in request ? request.params : undefined;
    if (typeof params !== "object" || params === null || !("name" in params))
      throw new Error("Invalid tools/call params");
    return response(params.name === "export_crawl" ? exportReply : readReply);
  });
}

beforeEach(() => {
  process.env.SF_MCP_URL = "http://bridge.test/mcp";
  delete process.env.SF_MCP_TOKEN;
  exportReply = {
    body: {
      jsonrpc: "2.0",
      id: 3,
      result: { export_id: "export-json-id", files: ["internal_all.csv"] },
    },
  };
  readReply = {
    body: {
      jsonrpc: "2.0",
      id: 4,
      result: { rows: [{ address: "https://example.com" }] },
    },
  };
});

afterEach(() => {
  delete process.env.SF_MCP_URL;
  delete process.env.SF_MCP_TOKEN;
  vi.unstubAllGlobals();
});

describe("read_sf_crawl_data", () => {
  it("extracts export id and CSV filename from plain-text export response", async () => {
    exportReply = {
      body: {
        jsonrpc: "2.0",
        id: 3,
        result: {
          content: [
            {
              type: "text",
              text: "Export completed. 9 CSV files generated.\nExport ID: export-7a953408\nFiles:\n  2026.10.11.02.51.50\\internal_all.csv (4.5 KB)",
            },
          ],
        },
      },
    };
    vi.stubGlobal("fetch", localFetchMock());
    const result = await readSfCrawlDataTool.handler({
      crawlId: "c9dcbf2e-e1d8-4959-99a8-2c69961db1d7",
      limit: 3,
      offset: 0,
    });
    expect(result.structuredContent).toMatchObject({
      configured: true,
      exportId: "export-7a953408",
      files: ["2026.10.11.02.51.50\\internal_all.csv"],
    });
  });

  it("reports a missing export id when the response has none", async () => {
    exportReply = {
      body: {
        jsonrpc: "2.0",
        id: 3,
        result: { content: [{ type: "text", text: "Export failed" }] },
      },
    };
    vi.stubGlobal("fetch", localFetchMock());
    const result = await readSfCrawlDataTool.handler({
      crawlId: "c9dcbf2e-e1d8-4959-99a8-2c69961db1d7",
      limit: 3,
      offset: 0,
    });
    expect(result.structuredContent).toMatchObject({
      configured: true,
      error: "Export did not return an export_id.",
    });
  });
});
