import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FigmaClient, FigmaError } from "./figma.js";

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function fail(err: unknown): ToolResult {
  if (err instanceof FigmaError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            `Figma API error ${err.status}: ${err.message}\n` +
            JSON.stringify(err.body, null, 2),
        },
      ],
    };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text", text: `Error: ${msg}` }] };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const cacheDir = path.resolve(here, "../.cache");

function cacheFile(teamId: string): string {
  const safe = teamId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(cacheDir, `design-system-${safe}.json`);
}

interface CachedItem {
  kind: "component" | "component_set" | "style";
  key: string;
  name: string;
  description?: string;
  file_key?: string;
  thumbnail_url?: string;
  style_type?: string;
}

interface DSCache {
  team_id: string;
  indexed_at: string;
  items: CachedItem[];
}

async function fetchAllPages<T>(
  fetcher: (params: {
    page_size?: number;
    after?: number | string;
  }) => Promise<unknown>,
  extract: (resp: any) => { rows: T[]; nextCursor: string | number | null },
  pageSize: number,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | number | undefined = undefined;
  for (let i = 0; i < 200; i++) {
    const resp = await fetcher({
      page_size: pageSize,
      after: cursor,
    });
    const { rows, nextCursor } = extract(resp);
    out.push(...rows);
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return out;
}

function scoreMatch(query: string, name: string, description?: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const n = name.toLowerCase();
  const d = (description ?? "").toLowerCase();
  let score = 0;
  if (n === q) score += 100;
  if (n.startsWith(q)) score += 30;
  if (n.includes(q)) score += 15;
  if (d.includes(q)) score += 5;
  for (const word of q.split(/\s+/).filter(Boolean)) {
    if (n.includes(word)) score += 5;
    if (d.includes(word)) score += 1;
  }
  return score;
}

export function registerDesignSystemTools(
  server: McpServer,
  figma: FigmaClient,
): void {
  server.registerTool(
    "index_design_system",
    {
      title: "Index a team's design system",
      description:
        "Fetches every component, component set, and style published by a Figma team and writes a local JSON cache (.cache/design-system-<team_id>.json) for fast searches. Paginates through the team library endpoints. Re-run to refresh.",
      inputSchema: {
        team_id: z
          .string()
          .min(1)
          .describe(
            "Figma team id (from https://www.figma.com/files/team/<TEAM_ID>/...).",
          ),
        page_size: z
          .number()
          .int()
          .positive()
          .max(30)
          .optional()
          .default(30)
          .describe("Page size per Figma API call. Max 30."),
      },
    },
    async ({ team_id, page_size }) => {
      try {
        const components = await fetchAllPages<CachedItem>(
          (p) => figma.getTeamComponents(team_id, p),
          (resp) => ({
            rows: (resp?.meta?.components ?? []).map((c: any) => ({
              kind: "component",
              key: c.key,
              name: c.name,
              description: c.description,
              file_key: c.file_key,
              thumbnail_url: c.thumbnail_url,
            })),
            nextCursor: resp?.meta?.cursor?.after ?? null,
          }),
          page_size,
        );
        const sets = await fetchAllPages<CachedItem>(
          (p) => figma.getTeamComponentSets(team_id, p),
          (resp) => ({
            rows: (resp?.meta?.component_sets ?? []).map((c: any) => ({
              kind: "component_set",
              key: c.key,
              name: c.name,
              description: c.description,
              file_key: c.file_key,
              thumbnail_url: c.thumbnail_url,
            })),
            nextCursor: resp?.meta?.cursor?.after ?? null,
          }),
          page_size,
        );
        const styles = await fetchAllPages<CachedItem>(
          (p) => figma.getTeamStyles(team_id, p),
          (resp) => ({
            rows: (resp?.meta?.styles ?? []).map((s: any) => ({
              kind: "style",
              key: s.key,
              name: s.name,
              description: s.description,
              file_key: s.file_key,
              style_type: s.style_type,
              thumbnail_url: s.thumbnail_url,
            })),
            nextCursor: resp?.meta?.cursor?.after ?? null,
          }),
          page_size,
        );

        const cache: DSCache = {
          team_id,
          indexed_at: new Date().toISOString(),
          items: [...components, ...sets, ...styles],
        };
        if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
        const file = cacheFile(team_id);
        writeFileSync(file, JSON.stringify(cache, null, 2));
        return ok({
          cache_file: file,
          team_id,
          counts: {
            components: components.length,
            component_sets: sets.length,
            styles: styles.length,
            total: cache.items.length,
          },
          indexed_at: cache.indexed_at,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "search_design_system",
    {
      title: "Search the indexed design system",
      description:
        "Searches the local cache built by index_design_system. Case-insensitive scoring on name + description.",
      inputSchema: {
        query: z.string().min(1),
        team_id: z
          .string()
          .optional()
          .describe(
            "Restrict to one team's cache. Omit to search all cached teams.",
          ),
        type: z
          .enum(["component", "component_set", "style"])
          .optional()
          .describe("Filter by item kind."),
        limit: z.number().int().positive().max(100).optional().default(20),
      },
    },
    async ({ query, team_id, type, limit }) => {
      try {
        if (!existsSync(cacheDir)) {
          throw new Error(
            "No design system cache found. Run `index_design_system` first.",
          );
        }
        const files = team_id
          ? [cacheFile(team_id)]
          : readdirSync(cacheDir)
              .filter((f) => f.startsWith("design-system-") && f.endsWith(".json"))
              .map((f) => path.join(cacheDir, f));
        if (files.length === 0) {
          throw new Error(
            "No design system cache files. Run `index_design_system` first.",
          );
        }
        const scored: { item: CachedItem & { team_id: string }; score: number }[] = [];
        for (const file of files) {
          if (!existsSync(file)) continue;
          const cache: DSCache = JSON.parse(readFileSync(file, "utf8"));
          for (const item of cache.items) {
            if (type && item.kind !== type) continue;
            const score = scoreMatch(query, item.name, item.description);
            if (score > 0) {
              scored.push({ item: { ...item, team_id: cache.team_id }, score });
            }
          }
        }
        scored.sort((a, b) => b.score - a.score);
        return ok({
          query,
          total_matches: scored.length,
          results: scored.slice(0, limit).map((s) => ({
            score: s.score,
            ...s.item,
          })),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "clear_design_system_cache",
    {
      title: "Clear cached design system data",
      description:
        "Deletes design-system-*.json cache files. Pass team_id to clear one team; omit to clear all.",
      inputSchema: {
        team_id: z.string().optional(),
      },
    },
    async ({ team_id }) => {
      try {
        if (!existsSync(cacheDir)) {
          return ok({ deleted: [], note: "No cache directory exists." });
        }
        const targets: string[] = [];
        if (team_id) {
          const f = cacheFile(team_id);
          if (existsSync(f)) targets.push(f);
        } else {
          for (const f of readdirSync(cacheDir)) {
            if (f.startsWith("design-system-") && f.endsWith(".json")) {
              targets.push(path.join(cacheDir, f));
            }
          }
        }
        for (const t of targets) unlinkSync(t);
        return ok({ deleted: targets, count: targets.length });
      } catch (err) {
        return fail(err);
      }
    },
  );
}
