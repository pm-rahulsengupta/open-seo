import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSfCrawlTool } from "./run-sf-crawl";

type Reply = { status?: number; body?: unknown; contentType?: string };

let toolReply: () => Reply;

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
    return response(toolReply());
  });
}

beforeEach(() => {
  process.env.SF_MCP_URL = "http://bridge.test/mcp";
  delete process.env.SF_MCP_TOKEN;
  toolReply = () => ({
    body: { jsonrpc: "2.0", id: 3, result: { value: "ok" } },
  });
});

afterEach(() => {
  delete process.env.SF_MCP_URL;
  delete process.env.SF_MCP_TOKEN;
  vi.unstubAllGlobals();
});

describe("run_sf_crawl", () => {
  it("extracts the crawl id from a plain-text crawl_site response", async () => {
    toolReply = () => ({
      body: {
        jsonrpc: "2.0",
        id: 3,
        result: {
          content: [
            {
              type: "text",
              text: "Crawl started in background.\nCrawl ID: crawl-bb20a3e9",
            },
          ],
        },
      },
    });
    vi.stubGlobal("fetch", localFetchMock());
    const result = await runSfCrawlTool.handler({
      siteUrl: "https://example.com",
      label: "e2e",
    });
    expect(result.structuredContent).toMatchObject({
      configured: true,
      started: true,
      crawlId: "crawl-bb20a3e9",
    });
  });

  it("reports no id when the response has none", async () => {
    toolReply = () => ({
      body: {
        jsonrpc: "2.0",
        id: 3,
        result: { content: [{ type: "text", text: "no id here" }] },
      },
    });
    vi.stubGlobal("fetch", localFetchMock());
    const result = await runSfCrawlTool.handler({
      siteUrl: "https://example.com",
    });
    expect(result.structuredContent).toMatchObject({
      configured: true,
      started: false,
    });
  });
});
