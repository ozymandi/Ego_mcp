// Wire protocol shared between MCP server and the Figma plugin.
// The plugin imports an inlined copy (esbuild bundles its sources), so
// duplicate this if you change the shape.

export type RequestType =
  | "ping"
  | "exec"
  | "get_selection"
  | "get_current_page"
  | "get_screenshot";

export interface Request {
  id: string;
  type: RequestType;
  payload?: unknown;
}

export interface Response {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface ExecPayload {
  code: string;
  // When true, the snippet is wrapped so its last expression / returned value
  // is awaited and used as the result. When false, the snippet must call
  // `return <value>` (or be a function body returning a promise).
  async?: boolean;
}

export interface ScreenshotPayload {
  // Node IDs to render. Empty array = use current selection.
  node_ids?: string[];
  format?: "PNG" | "JPG" | "SVG";
  scale?: number;
}
