import { z } from "zod";
import path from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PluginBridge } from "./bridge.js";
import type { WorkspaceRegistry } from "./workspaces.js";

import { ok, fail } from "./result.js";

const workspaceArg = z
  .string()
  .min(1)
  .describe("Workspace name (list_workspaces).");

const pathArg = z
  .string()
  .describe(
    "Path relative to the workspace root; '' = root.",
  );

function detectMime(file: string): string {
  const ext = path.extname(file).toLowerCase();
  return (
    {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".bmp": "image/bmp",
      ".svg": "image/svg+xml",
    }[ext] ?? "application/octet-stream"
  );
}

export function registerFilesystemTools(
  server: McpServer,
  registry: WorkspaceRegistry,
  bridge: PluginBridge,
): void {
  // ---- Workspace management ---------------------------------------------

  server.registerTool(
    "register_workspace",
    {
      title: "Register a workspace directory",
      description:
      "Register an absolute, existing directory as a named workspace the model may read/write.",
      inputSchema: {
        name: z
          .string()
          .min(1)
          .max(50)
          .describe(
            "Short name: letters, digits, _ or -.",
          ),
        path: z.string().min(1).describe("Absolute filesystem path."),
        description: z.string().optional(),
        force: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            "Allow system folders.",
          ),
      },
    },
    async ({ name, path: p, description, force }) => {
      try {
        const w = registry.register({
          name,
          path: p,
          description,
          force: Boolean(force),
        });
        return ok({ registered: w });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "unregister_workspace",
    {
      title: "Unregister a workspace",
      description:
        "Removes a workspace from the registry. Files on disk are NOT touched.",
      inputSchema: { name: workspaceArg },
    },
    async ({ name }) => {
      try {
        const w = registry.unregister(name);
        return ok({ unregistered: w });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "list_workspaces",
    {
      title: "List registered workspaces",
      description: "Returns all workspaces along with their on-disk status.",
      inputSchema: {},
    },
    async () => ok({ workspaces: registry.list() }),
  );

  // ---- File operations --------------------------------------------------

  server.registerTool(
    "list_dir",
    {
      title: "List directory contents inside a workspace",
      description: "Lists files and folders under workspace/path.",
      inputSchema: { workspace: workspaceArg, path: pathArg.optional() },
    },
    async ({ workspace, path: p }) => {
      try {
        const full = registry.resolveInside(workspace, p ?? "");
        if (!existsSync(full)) {
          throw new Error(`Path does not exist: ${p ?? "(root)"}`);
        }
        const st = statSync(full);
        if (!st.isDirectory()) {
          throw new Error(`Not a directory: ${p ?? "(root)"}`);
        }
        const entries = readdirSync(full, { withFileTypes: true });
        const items = entries.map((e) => {
          const child = path.join(full, e.name);
          let size: number | null = null;
          let mtime: string | null = null;
          try {
            const s = statSync(child);
            size = e.isFile() ? s.size : null;
            mtime = s.mtime.toISOString();
          } catch {
            // skip unreadable
          }
          return {
            name: e.name,
            type: e.isDirectory()
              ? "directory"
              : e.isFile()
                ? "file"
                : "other",
            size,
            mtime,
          };
        });
        return ok({
          workspace,
          path: p ?? "",
          count: items.length,
          entries: items,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "read_text_file",
    {
      title: "Read a text file",
      description:
      "Read a workspace file as text.",
      inputSchema: {
        workspace: workspaceArg,
        path: pathArg,
        encoding: z
          .enum(["utf8", "utf16le", "latin1", "ascii"])
          .optional()
          .default("utf8"),
        max_bytes: z
          .number()
          .int()
          .positive()
          .max(2_000_000)
          .optional()
          .default(1_000_000)
          .describe("Size limit; default 1 MB."),
      },
    },
    async ({ workspace, path: p, encoding, max_bytes }) => {
      try {
        const full = registry.resolveInside(workspace, p);
        if (!existsSync(full)) throw new Error(`File not found: ${p}`);
        const st = statSync(full);
        if (!st.isFile()) throw new Error(`Not a regular file: ${p}`);
        if (st.size > max_bytes) {
          throw new Error(
            `File too large: ${st.size} bytes > ${max_bytes}. Increase max_bytes or read a slice manually.`,
          );
        }
        const text = readFileSync(full, encoding);
        return ok({
          workspace,
          path: p,
          encoding,
          bytes: st.size,
          content: text,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "read_binary_file",
    {
      title: "Read a file as base64",
      description:
      "Read a workspace file as base64.",
      inputSchema: {
        workspace: workspaceArg,
        path: pathArg,
        max_bytes: z
          .number()
          .int()
          .positive()
          .max(20_000_000)
          .optional()
          .default(5_000_000),
      },
    },
    async ({ workspace, path: p, max_bytes }) => {
      try {
        const full = registry.resolveInside(workspace, p);
        if (!existsSync(full)) throw new Error(`File not found: ${p}`);
        const st = statSync(full);
        if (!st.isFile()) throw new Error(`Not a regular file: ${p}`);
        if (st.size > max_bytes) {
          throw new Error(
            `File too large: ${st.size} bytes > ${max_bytes}.`,
          );
        }
        const buf = readFileSync(full);
        return ok({
          workspace,
          path: p,
          bytes: buf.length,
          mime_type: detectMime(full),
          base64: buf.toString("base64"),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "write_text_file",
    {
      title: "Write a text file",
      description:
      "Write a text file (creates parent dirs). Refuses to overwrite unless overwrite=true.",
      inputSchema: {
        workspace: workspaceArg,
        path: pathArg,
        content: z.string(),
        overwrite: z.boolean().optional().default(false),
        encoding: z
          .enum(["utf8", "utf16le", "latin1", "ascii"])
          .optional()
          .default("utf8"),
      },
    },
    async ({ workspace, path: p, content, overwrite, encoding }) => {
      try {
        const full = registry.resolveInside(workspace, p);
        if (existsSync(full) && !overwrite) {
          throw new Error(
            `Refusing to overwrite existing file. Pass overwrite=true: ${p}`,
          );
        }
        const dir = path.dirname(full);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(full, content, encoding);
        return ok({
          workspace,
          path: p,
          bytes: Buffer.byteLength(content, encoding),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "make_dir",
    {
      title: "Create a directory",
      description:
        "Creates a directory (including parents) inside a workspace.",
      inputSchema: { workspace: workspaceArg, path: pathArg },
    },
    async ({ workspace, path: p }) => {
      try {
        const full = registry.resolveInside(workspace, p);
        mkdirSync(full, { recursive: true });
        return ok({ workspace, path: p, created: full });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "move_path",
    {
      title: "Move or rename a path within a workspace",
      description:
      "Rename/move within the same workspace.",
      inputSchema: {
        workspace: workspaceArg,
        from: pathArg,
        to: pathArg,
        overwrite: z.boolean().optional().default(false),
      },
    },
    async ({ workspace, from, to, overwrite }) => {
      try {
        const src = registry.resolveInside(workspace, from);
        const dst = registry.resolveInside(workspace, to);
        if (!existsSync(src)) throw new Error(`Source not found: ${from}`);
        if (existsSync(dst) && !overwrite) {
          throw new Error(
            `Destination exists. Pass overwrite=true to replace: ${to}`,
          );
        }
        const dir = path.dirname(dst);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        if (existsSync(dst) && overwrite) {
          rmSync(dst, { recursive: true, force: true });
        }
        renameSync(src, dst);
        return ok({ workspace, from, to });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "delete_path",
    {
      title: "Delete a file or directory",
      description:
      "Delete a file or directory (recursive=true for non-empty).",
      inputSchema: {
        workspace: workspaceArg,
        path: pathArg,
        recursive: z.boolean().optional().default(false),
      },
    },
    async ({ workspace, path: p, recursive }) => {
      try {
        const full = registry.resolveInside(workspace, p);
        if (!existsSync(full)) throw new Error(`Path not found: ${p}`);
        const st = statSync(full);
        if (st.isDirectory()) {
          if (!recursive) {
            const entries = readdirSync(full);
            if (entries.length > 0) {
              throw new Error(
                `Directory not empty (${entries.length} entries). Pass recursive=true to delete it and its contents.`,
              );
            }
            rmSync(full, { recursive: false, force: false });
          } else {
            rmSync(full, { recursive: true, force: true });
          }
        } else {
          unlinkSync(full);
        }
        return ok({ workspace, deleted: p });
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ---- Figma integration -----------------------------------------------

  server.registerTool(
    "import_image_to_figma",
    {
      title: "Import an image from a workspace onto the Figma canvas",
      description:
      "Place a PNG/JPG/GIF/WEBP from a workspace on the canvas as a rectangle with an image fill (natural size unless width/height given).",
      inputSchema: {
        workspace: workspaceArg,
        path: pathArg,
        x: z.number(),
        y: z.number(),
        width: z.number().positive().optional(),
        height: z.number().positive().optional(),
        name: z.string().optional(),
        parent_id: z
          .string()
          .optional()
          .describe("Optional Figma parent node id."),
        fit: z
          .enum(["FILL", "FIT", "CROP", "TILE"])
          .optional()
          .default("FILL"),
        max_bytes: z
          .number()
          .int()
          .positive()
          .max(20_000_000)
          .optional()
          .default(10_000_000),
      },
    },
    async ({
      workspace,
      path: p,
      x,
      y,
      width,
      height,
      name,
      parent_id,
      fit,
      max_bytes,
    }) => {
      try {
        const full = registry.resolveInside(workspace, p);
        if (!existsSync(full)) throw new Error(`File not found: ${p}`);
        const st = statSync(full);
        if (!st.isFile()) throw new Error(`Not a regular file: ${p}`);
        if (st.size > max_bytes) {
          throw new Error(
            `File too large: ${st.size} bytes > ${max_bytes}. Raise max_bytes or downscale first.`,
          );
        }
        const buf = readFileSync(full);
        const result = await bridge.send(
          "place_image",
          {
            base64: buf.toString("base64"),
            mime_type: detectMime(full),
            x,
            y,
            width,
            height,
            name: name ?? path.basename(full),
            parent_id,
            fit,
          },
          60_000,
        );
        return ok({
          workspace,
          path: p,
          source_bytes: st.size,
          ...((result ?? {}) as Record<string, unknown>),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}
