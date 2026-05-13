const FIGMA_API = "https://api.figma.com";

export class FigmaError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "FigmaError";
  }
}

export interface FigmaClientOptions {
  token: string;
  defaultFileKey?: string;
}

export type ImageFormat = "jpg" | "png" | "svg" | "pdf";

export class FigmaClient {
  private readonly token: string;
  readonly defaultFileKey: string | undefined;

  constructor(opts: FigmaClientOptions) {
    if (!opts.token) {
      throw new Error("FIGMA_TOKEN is required");
    }
    this.token = opts.token;
    this.defaultFileKey = opts.defaultFileKey;
  }

  resolveFileKey(fileKey?: string): string {
    const key = fileKey ?? this.defaultFileKey;
    if (!key) {
      throw new Error(
        "file_key is required (no FIGMA_DEFAULT_FILE_KEY set in .env)",
      );
    }
    return key;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const url = `${FIGMA_API}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        "X-Figma-Token": this.token,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // leave as raw text
    }

    if (!res.ok) {
      throw new FigmaError(
        `Figma API ${res.status} ${res.statusText} on ${init.method ?? "GET"} ${path}`,
        res.status,
        body,
      );
    }

    return body as T;
  }

  me(): Promise<unknown> {
    return this.request("/v1/me");
  }

  getFile(
    fileKey: string,
    params: { depth?: number; geometry?: "paths"; branch_data?: boolean } = {},
  ): Promise<unknown> {
    const qs = buildQuery(params);
    return this.request(`/v1/files/${fileKey}${qs}`);
  }

  getFileNodes(fileKey: string, nodeIds: string[]): Promise<unknown> {
    if (nodeIds.length === 0) {
      throw new Error("node_ids must not be empty");
    }
    const qs = buildQuery({ ids: nodeIds.join(",") });
    return this.request(`/v1/files/${fileKey}/nodes${qs}`);
  }

  getComponents(fileKey: string): Promise<unknown> {
    return this.request(`/v1/files/${fileKey}/components`);
  }

  getStyles(fileKey: string): Promise<unknown> {
    return this.request(`/v1/files/${fileKey}/styles`);
  }

  getComments(fileKey: string, as_md = false): Promise<unknown> {
    const qs = buildQuery({ as_md: as_md ? true : undefined });
    return this.request(`/v1/files/${fileKey}/comments${qs}`);
  }

  postComment(
    fileKey: string,
    message: string,
    comment_id?: string,
  ): Promise<unknown> {
    return this.request(`/v1/files/${fileKey}/comments`, {
      method: "POST",
      body: JSON.stringify({ message, comment_id }),
    });
  }

  getImages(
    fileKey: string,
    params: {
      ids: string[];
      format?: ImageFormat;
      scale?: number;
      svg_include_id?: boolean;
      svg_simplify_stroke?: boolean;
      use_absolute_bounds?: boolean;
      version?: string;
    },
  ): Promise<unknown> {
    if (params.ids.length === 0) {
      throw new Error("ids must not be empty");
    }
    const qs = buildQuery({
      ids: params.ids.join(","),
      format: params.format,
      scale: params.scale,
      svg_include_id: params.svg_include_id,
      svg_simplify_stroke: params.svg_simplify_stroke,
      use_absolute_bounds: params.use_absolute_bounds,
      version: params.version,
    });
    return this.request(`/v1/images/${fileKey}${qs}`);
  }
}

function buildQuery(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== "",
  );
  if (entries.length === 0) return "";
  const usp = new URLSearchParams();
  for (const [k, v] of entries) {
    usp.set(k, String(v));
  }
  return `?${usp.toString()}`;
}

export function parseFileKey(input: string): string {
  // Accepts a raw key or a Figma URL like
  //   https://www.figma.com/file/<KEY>/<NAME>
  //   https://www.figma.com/design/<KEY>/<NAME>
  //   https://www.figma.com/proto/<KEY>/<NAME>
  const trimmed = input.trim();
  const m = trimmed.match(
    /figma\.com\/(?:file|design|proto)\/([A-Za-z0-9]+)/,
  );
  return m ? m[1]! : trimmed;
}
