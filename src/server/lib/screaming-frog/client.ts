type JsonRpcMessage = {
  id?: number;
  result?: unknown;
  error?: { message?: string; code?: number };
};

function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

let sessionId: string | undefined;
let protocolVersion: string | undefined;
let requestId = 0;
let initialized = false;
let initialization: Promise<void> | undefined;
let sessionUrl: string | undefined;

export function sanitizedSfSnippet(value: string): string {
  return value
    .slice(0, 200)
    .replace(/Bearer\s+\S+/gi, "[redacted]")
    .replace(/[A-Za-z0-9+/_=-]{32,}/g, "[redacted]");
}

export function isSfMcpConfigured(): boolean {
  return Boolean(process.env.SF_MCP_URL?.trim());
}

function parseSseDataFrames(raw: string): string[] {
  const frames: string[] = [];
  let data: string[] = [];
  for (const line of `${raw}\n`.split(/\r?\n/)) {
    if (line === "") {
      if (data.length) frames.push(data.join("\n"));
      data = [];
    } else if (line.startsWith("data:")) {
      data.push(line.slice(5).replace(/^ /, ""));
    }
  }
  return frames;
}

function extractJsonRpcMessage(
  rawBody: string,
  contentType: string,
  expectedId: number | null,
): JsonRpcMessage {
  if (!contentType.toLowerCase().includes("text/event-stream")) {
    const message: unknown = JSON.parse(rawBody);
    if (isJsonRpcMessage(message)) return message;
    throw new Error("Invalid MCP JSON-RPC response");
  }
  const messages = parseSseDataFrames(rawBody).flatMap((frame) => {
    try {
      const message: unknown = JSON.parse(frame);
      return isJsonRpcMessage(message) ? [message] : [];
    } catch {
      return [];
    }
  });
  const matched =
    expectedId === null
      ? undefined
      : messages.find((message) => message.id === expectedId);
  const fallback = messages.find(
    (message) => "result" in message || "error" in message,
  );
  if (matched) return matched;
  if (messages.some((message) => message.id !== undefined)) {
    throw new Error(`No MCP response matched request ${expectedId}`);
  }
  if (fallback) return fallback;
  throw new Error("No MCP JSON-RPC response found in event stream");
}

function resultText(result: unknown): string {
  if (typeof result !== "object" || result === null || !("content" in result))
    return "";
  const content = result.content;
  if (!Array.isArray(content)) return "";
  const parts: unknown[] = content;
  return parts
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

function parseSfResult(result: unknown): unknown {
  const text = resultText(result);
  if (!text) return result;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function send(
  message: Record<string, unknown>,
  id: number | null,
): Promise<unknown> {
  const url = process.env.SF_MCP_URL;
  if (!url?.trim()) throw new Error("SF_MCP_URL is not configured");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (process.env.SF_MCP_TOKEN)
    headers.Authorization = `Bearer ${process.env.SF_MCP_TOKEN}`;
  if (sessionId) headers["mcp-session-id"] = sessionId;
  if (protocolVersion) headers["mcp-protocol-version"] = protocolVersion;
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", ...message }),
    signal: AbortSignal.timeout(20_000),
  });
  const newSession = response.headers.get("mcp-session-id");
  const newVersion = response.headers.get("mcp-protocol-version");
  if (newSession) sessionId = newSession;
  if (newVersion) protocolVersion = newVersion;
  const body = await response.text();
  if (!response.ok)
    throw new Error(
      `SF MCP HTTP ${response.status}: ${sanitizedSfSnippet(body)}`,
    );
  if (id === null) return undefined;
  const rpc = extractJsonRpcMessage(
    body,
    response.headers.get("content-type") ?? "",
    id,
  );
  if (rpc.error)
    throw new Error(
      `SF MCP error ${rpc.error.code ?? ""}: ${rpc.error.message ?? body}`,
    );
  if (!("result" in rpc)) throw new Error("SF MCP response has no result");
  return rpc.result;
}

async function initialize(): Promise<void> {
  const id = ++requestId;
  await send(
    {
      id,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "open-seo", version: "1" },
      },
    },
    id,
  );
  await send({ method: "notifications/initialized" }, null);
  initialized = true;
}

async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  initialization ??= initialize().finally(() => {
    initialization = undefined;
  });
  await initialization;
}

export async function callSfTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (sessionUrl !== undefined && sessionUrl !== process.env.SF_MCP_URL) {
    sessionId = undefined;
    protocolVersion = undefined;
    initialized = false;
  }
  sessionUrl = process.env.SF_MCP_URL;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await ensureInitialized();
      return await send(
        {
          id: ++requestId,
          method: "tools/call",
          params: { name, arguments: args },
        },
        requestId,
      ).then((result) => {
        if (
          typeof result === "object" &&
          result !== null &&
          "isError" in result &&
          result.isError
        ) {
          throw new Error(
            `SF MCP tool error: ${resultText(result) || JSON.stringify(result)}`,
          );
        }
        return parseSfResult(result);
      });
    } catch (error) {
      if (
        attempt === 0 &&
        error instanceof Error &&
        error.message.startsWith("SF MCP HTTP 404:")
      ) {
        sessionId = undefined;
        protocolVersion = undefined;
        initialized = false;
        continue;
      }
      throw error;
    }
  }
  throw new Error("SF MCP session recovery failed");
}
