// Shared tool-result helpers: one place for JSON formatting, error shaping,
// and the response size cap that keeps local-model contexts from overflowing.

import { FigmaError } from "./figma.js";
import { PluginError } from "./bridge.js";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type ToolResult = {
  content: ContentBlock[];
  isError?: boolean;
};

/**
 * Hard cap on the characters a single text result may carry. Hermes spills
 * MCP results above 50k chars to disk, but a 27B-class model should not have
 * to digest even that much in one turn. Override with
 * FIGMA_MCP_MAX_RESULT_CHARS in .env.
 */
export const MAX_RESULT_CHARS = (() => {
  const raw = Number(process.env.FIGMA_MCP_MAX_RESULT_CHARS);
  return Number.isFinite(raw) && raw > 1000 ? Math.floor(raw) : 20_000;
})();

/** Cuts `text` to `maxChars`, appending a marker that says how much was dropped. */
export function truncateText(text: string, maxChars = MAX_RESULT_CHARS): string {
  if (text.length <= maxChars) return text;
  const dropped = text.length - maxChars;
  return (
    text.slice(0, maxChars) +
    `\n…[truncated: ${dropped.toLocaleString()} more chars. Narrow the request (node_ids, depth, limit, max_chars) instead of asking for everything.]`
  );
}

/** Serialises `data` compactly: strings as-is, everything else as JSON. */
export function render(data: unknown): string {
  return typeof data === "string" ? data : JSON.stringify(data, null, 1);
}

export function ok(data: unknown, maxChars?: number): ToolResult {
  return {
    content: [{ type: "text", text: truncateText(render(data), maxChars) }],
  };
}

export function fail(err: unknown): ToolResult {
  if (err instanceof FigmaError) {
    const hint =
      err.status === 403
        ? "\nHint: 403 usually means the token lacks a scope, or the endpoint needs an Enterprise plan (Variables REST). The plugin-side use_figma with figma.variables.* works on any plan."
        : err.status === 404
          ? "\nHint: check the file key / node id; node ids use ':' (12:34), not '-'."
          : err.status === 429
            ? "\nHint: rate limited. Wait a bit before retrying."
            : "";
    const body = truncateText(JSON.stringify(err.body), 1_000);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Figma API error ${err.status}: ${err.message}${hint}\n${body}`,
        },
      ],
    };
  }
  if (err instanceof PluginError) {
    const lines = [`Error: ${err.message}`];
    if (err.hint) lines.push(`Hint: ${err.hint}`);
    if (err.safeToRetry !== undefined) {
      lines.push(
        err.safeToRetry
          ? "safe_to_retry: true (fix the snippet and resend; the canvas did not change in a way you need to re-read)"
          : "safe_to_retry: false (re-read the canvas with get_current_page / find_nodes before retrying)",
      );
    }
    return { isError: true, content: [{ type: "text", text: lines.join("\n") }] };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text", text: `Error: ${msg}` }] };
}
