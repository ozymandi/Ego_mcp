// Wire protocol shared between MCP server and the Figma plugin.
// The plugin imports an inlined copy (esbuild bundles its sources), so
// duplicate this if you change the shape.

export type RequestType =
  | "ping"
  | "exec"
  | "get_selection"
  | "get_current_page"
  | "get_screenshot"
  | "place_image";

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
  // Present when the plugin recognised the error: what to do about it, and
  // whether the same snippet (fixed) can be re-sent without re-reading the
  // canvas first.
  hint?: string;
  safe_to_retry?: boolean;
}

export interface ExecPayload {
  // Body of an async function; `return` surfaces the result.
  code: string;
  // Collect created/changed/deleted node ids during the run and return
  // { result, created_ids, changed_ids, deleted_ids } instead of the bare result.
  track?: boolean;
  // With track: export the top-level created nodes (max 2) after the run.
  screenshot?: boolean;
  // Soft limit on nodes created per call; exceeding it adds a warning.
  max_created?: number;
}

export interface ScreenshotPayload {
  // Node IDs to render. Empty array = use current selection.
  node_ids?: string[];
  format?: "PNG" | "JPG" | "SVG";
  scale?: number;
  // Largest output dimension in px; the plugin lowers the scale to respect it.
  max_px?: number;
}
