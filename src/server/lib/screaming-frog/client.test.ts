import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callSfTool, isSfMcpConfigured } from "./client";

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

function fetchMock(): ReturnType<typeof vi.fn> {
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
          id:
            "id" in request && typeof request.id === "number"
              ? request.id
              : null,
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

describe("Screaming Frog MCP client", () => {
  it("returns a plain JSON tools/call result", async () => {
    toolReply = () => ({
      body: { jsonrpc: "2.0", id: 3, result: { value: "ok" } },
    });
    vi.stubGlobal("fetch", fetchMock());
    await expect(callSfTool("crawl_site", {})).resolves.toEqual({
      value: "ok",
    });
  });

  it("selects the matching SSE response after an unrelated id", async () => {
    toolReply = () => ({
      contentType: "text/event-stream",
      body: 'data: {"jsonrpc":"2.0","id":99,"result":{"value":"wrong"}}\n\ndata: {"jsonrpc":"2.0","id":3,"result":{"value":"right"}}\n\n',
    });
    vi.stubGlobal("fetch", fetchMock());
    await expect(callSfTool("crawl_site", {})).resolves.toEqual({
      value: "right",
    });
  });

  it("rejects with upstream JSON-RPC error text", async () => {
    toolReply = () => ({
      body: {
        jsonrpc: "2.0",
        id: 3,
        error: { code: -1, message: "upstream denied" },
      },
    });
    vi.stubGlobal("fetch", fetchMock());
    await expect(callSfTool("crawl_site", {})).rejects.toThrow(
      "upstream denied",
    );
  });

  it("redacts bearer tokens in HTTP errors", async () => {
    process.env.SF_MCP_TOKEN = "tok_abc123def456";
    toolReply = () => ({
      status: 401,
      body: "invalid token Bearer tok_abc123def456",
    });
    vi.stubGlobal("fetch", fetchMock());
    const result = callSfTool("crawl_site", {});
    await expect(result).rejects.toThrow("SF MCP HTTP 401");
    await expect(result).rejects.toThrow("[redacted]");
    await expect(result).rejects.not.toThrow("tok_abc123def456");
  });

  it("reinitializes once after an HTTP 404 and retries the tool call", async () => {
    let calls = 0;
    toolReply = () =>
      ++calls === 1
        ? { status: 404, body: "session expired" }
        : { body: { jsonrpc: "2.0", id: 5, result: { value: "recovered" } } };
    vi.stubGlobal("fetch", fetchMock());
    await expect(callSfTool("crawl_site", {})).resolves.toEqual({
      value: "recovered",
    });
  });

  it("reports whether SF_MCP_URL is configured", () => {
    expect(isSfMcpConfigured()).toBe(true);
    delete process.env.SF_MCP_URL;
    expect(isSfMcpConfigured()).toBe(false);
  });
});
