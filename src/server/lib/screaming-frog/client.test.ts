import { describe, expect, it, vi } from "vitest";
import { extractJsonRpcMessage, parseSseDataFrames, callSfTool, sanitizedSfSnippet } from "./client";

describe("Screaming Frog streamable HTTP", () => {
  it("parses event stream frames and ignores comments", () => {
    const raw = ': heartbeat\n\nevent: message\ndata: {"id":1,"result":{}}\n\nevent: message\ndata: {"id":2,"result":true}\n';
    expect(parseSseDataFrames(raw)).toEqual(['{"id":1,"result":{}}', '{"id":2,"result":true}']);
  });

  it("extracts JSON and selects the matching SSE id", () => {
    expect(extractJsonRpcMessage('{"id":1,"result":42}', "application/json", 1)).toEqual({ id: 1, result: 42 });
    const raw = 'data: {"id":99,"result":"other"}\n\ndata: {"id":2,"result":"wanted"}\n\n';
    expect(extractJsonRpcMessage(raw, "text/event-stream", 2)).toEqual({ id: 2, result: "wanted" });
    expect(() => extractJsonRpcMessage(raw, "text/event-stream", 3)).toThrow("No MCP response matched");
  });

  it("redacts sensitive upstream snippets before truncating to 200 characters", () => {
    const snippet = sanitizedSfSnippet(`Bearer secret-token ${"a".repeat(48)} ${"x".repeat(250)}`);
    expect(snippet).not.toContain("secret-token");
    expect(snippet).not.toContain("a".repeat(48));
    expect(snippet).toContain("[redacted]");
    expect(snippet.length).toBeLessThanOrEqual(200);
  });

  it("returns structured not-configured results without contacting the bridge", async () => {
    const { runSfCrawlTool } = await import("@/server/mcp/tools/run-sf-crawl");
    const { getSfCrawlStatusTool } = await import("@/server/mcp/tools/get-sf-crawl-status");
    const { readSfCrawlDataTool } = await import("@/server/mcp/tools/read-sf-crawl-data");
    vi.stubEnv("SF_MCP_URL", "");
    for (const result of [
      await runSfCrawlTool.handler({ siteUrl: "https://example.com" }),
      await getSfCrawlStatusTool.handler({}),
      await readSfCrawlDataTool.handler({ limit: 50, offset: 0 }),
    ]) {
      expect(result.structuredContent).toMatchObject({ configured: false, message: expect.stringContaining("SF_MCP_URL") });
    }
    vi.unstubAllEnvs();
  });

  it("initializes, forwards session headers, parses JSON-in-text and maps tool errors", async () => {
    vi.stubEnv("SF_MCP_URL", "https://bridge.example/mcp");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), { headers: { "content-type": "application/json", "mcp-session-id": "session-1", "mcp-protocol-version": "2025-03-26" } }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: '{"crawl_id":"crawl-1"}' }] } }), { headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: "2.0", id: 3, result: { isError: true, content: [{ type: "text", text: "bad crawl" }] } }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await callSfTool("crawl_site", { url: "https://example.com" })).toEqual({ crawl_id: "crawl-1" });
    expect(fetchMock.mock.calls[2][1].headers["mcp-session-id"]).toBe("session-1");
    expect(fetchMock.mock.calls[2][1].headers["mcp-protocol-version"]).toBe("2025-03-26");
    await expect(callSfTool("crawl_site", {})).rejects.toThrow("bad crawl");
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
