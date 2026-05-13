import { z } from "zod";
import path from "node:path";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { spawn } from "node:child_process";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FigmaClient, FigmaError, parseFileKey } from "./figma.js";

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

// ---- Filesystem helpers --------------------------------------------------

const CC_EXTENSIONS = [".figma.ts", ".figma.tsx", ".figma.js", ".figma.jsx"];

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "out",
  ".turbo",
  ".cache",
  "coverage",
]);

function walkCodeConnectFiles(rootDir: string, max: number): string[] {
  const found: string[] = [];
  const stack: string[] = [rootDir];

  while (stack.length > 0 && found.length < max) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
        stack.push(full);
      } else if (e.isFile()) {
        if (CC_EXTENSIONS.some((ext) => e.name.endsWith(ext))) {
          found.push(full);
          if (found.length >= max) break;
        }
      }
    }
  }
  return found;
}

interface ParsedConnection {
  file_path: string;
  component_name: string | null;
  figma_url: string;
  file_key: string | null;
  node_id: string | null; // normalized "12:345"
}

// `figma.connect(Component, "https://figma.com/...", { ... })`
// or `figma.connect("https://figma.com/...", { ... })` (HTML)
const CONNECT_RE =
  /figma\s*\.\s*connect\s*\(\s*(?:([A-Za-z_$][\w$]*)\s*,\s*)?["'`]([^"'`]+)["'`]/g;

const URL_RE = /figma\.com\/(?:file|design|proto)\/([A-Za-z0-9]+)/;
const NODE_RE = /[?&]node-id=([^&]+)/;

function parseCodeConnectFile(filePath: string): ParsedConnection[] {
  const content = readFileSync(filePath, "utf8");
  const conns: ParsedConnection[] = [];
  for (const m of content.matchAll(CONNECT_RE)) {
    const componentName = m[1] ?? null;
    const url = m[2]!;
    const fileKey = url.match(URL_RE)?.[1] ?? null;
    const nodeRaw = url.match(NODE_RE)?.[1] ?? null;
    const nodeId = nodeRaw
      ? decodeURIComponent(nodeRaw).replace(/-/g, ":")
      : null;
    conns.push({
      file_path: filePath,
      component_name: componentName,
      figma_url: url,
      file_key: fileKey,
      node_id: nodeId,
    });
  }
  return conns;
}

// ---- Code Connect template builder --------------------------------------

interface FigmaProperty {
  type: "BOOLEAN" | "INSTANCE_SWAP" | "TEXT" | "VARIANT";
  defaultValue?: string | boolean;
  variantOptions?: string[];
  preferredValues?: unknown;
}

interface ParsedProps {
  [propName: string]: FigmaProperty;
}

function extractPropertyDefinitions(nodeResp: any): ParsedProps {
  // getFileNodes returns { nodes: { "12:345": { document: { componentPropertyDefinitions } } } }
  const nodes = nodeResp?.nodes;
  if (!nodes || typeof nodes !== "object") return {};
  for (const k of Object.keys(nodes)) {
    const doc = nodes[k]?.document;
    if (doc?.componentPropertyDefinitions) {
      return doc.componentPropertyDefinitions as ParsedProps;
    }
  }
  return {};
}

function propsToCodeConnect(props: ParsedProps): string {
  const lines: string[] = [];
  const keys = Object.keys(props);
  if (keys.length === 0) {
    return "  props: {},";
  }
  lines.push("  props: {");
  for (const fullKey of keys) {
    // Figma prop keys often look like "Label#1234:0" — strip the suffix.
    const name = fullKey.split("#")[0]!;
    const camel = toCamelCase(name);
    const def = props[fullKey]!;
    let expr: string;
    switch (def.type) {
      case "BOOLEAN":
        expr = `figma.boolean(${JSON.stringify(name)})`;
        break;
      case "TEXT":
        expr = `figma.string(${JSON.stringify(name)})`;
        break;
      case "INSTANCE_SWAP":
        expr = `figma.instance(${JSON.stringify(name)})`;
        break;
      case "VARIANT": {
        const options = (def.variantOptions ?? []).reduce<Record<string, string>>(
          (acc, opt) => {
            acc[opt] = JSON.stringify(opt);
            return acc;
          },
          {},
        );
        const optsLiteral =
          Object.keys(options).length === 0
            ? "{}"
            : `{ ${Object.entries(options)
                .map(([k, v]) => `${JSON.stringify(k)}: ${v}`)
                .join(", ")} }`;
        expr = `figma.enum(${JSON.stringify(name)}, ${optsLiteral})`;
        break;
      }
      default:
        expr = `figma.string(${JSON.stringify(name)})`;
    }
    lines.push(`    ${camel}: ${expr},`);
  }
  lines.push("  },");
  return lines.join("\n");
}

function toCamelCase(input: string): string {
  return input
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^[A-Z]/, (c) => c.toLowerCase())
    .replace(/[^a-zA-Z0-9]/g, "");
}

function buildFigmaUrl(fileKey: string, nodeId: string): string {
  const nodeParam = encodeURIComponent(nodeId.replace(/:/g, "-"));
  return `https://www.figma.com/design/${fileKey}/?node-id=${nodeParam}`;
}

type Framework = "react" | "vue" | "html";

function generateTemplate(opts: {
  framework: Framework;
  url: string;
  componentName: string;
  componentImport: string;
  propsBlock: string;
  propNames: string[];
}): string {
  const { framework, url, componentName, componentImport, propsBlock } = opts;
  const propsForExample = opts.propNames
    .map((n) => toCamelCase(n.split("#")[0]!))
    .filter((v, i, a) => a.indexOf(v) === i);

  if (framework === "react") {
    const spread =
      propsForExample.length === 0
        ? ""
        : `{ ${propsForExample.join(", ")} }`;
    const usage =
      propsForExample.length === 0
        ? `<${componentName} />`
        : `<${componentName} ${propsForExample.map((p) => `${p}={${p}}`).join(" ")} />`;
    return `import figma from "@figma/code-connect";
${componentImport}

figma.connect(${componentName}, ${JSON.stringify(url)}, {
${propsBlock}
  example: (${spread}) => (
    ${usage}
  ),
});
`;
  }

  if (framework === "vue") {
    const usage =
      propsForExample.length === 0
        ? `<${componentName} />`
        : `<${componentName} ${propsForExample.map((p) => `:${kebab(p)}="${p}"`).join(" ")} />`;
    return `import figma from "@figma/code-connect/vue";
${componentImport}

figma.connect(${componentName}, ${JSON.stringify(url)}, {
${propsBlock}
  example: (props) => \`${usage}\`,
});
`;
  }

  // html
  const tag = kebab(componentName);
  const usage =
    propsForExample.length === 0
      ? `<${tag}></${tag}>`
      : `<${tag} ${propsForExample.map((p) => `${kebab(p)}="\${props.${p}}"`).join(" ")}></${tag}>`;
  return `import figma from "@figma/code-connect/html";

figma.connect(${JSON.stringify(url)}, {
${propsBlock}
  example: (props) => figma.html\`${usage}\`,
});
`;
}

function kebab(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

function defaultImportFor(framework: Framework, componentName: string): string {
  switch (framework) {
    case "react":
      return `import { ${componentName} } from "./${componentName}";`;
    case "vue":
      return `import ${componentName} from "./${componentName}.vue";`;
    case "html":
      return "";
  }
}

// ---- Tool registration ---------------------------------------------------

const FRAMEWORK = z.enum(["react", "vue", "html"]);

export function registerCodeConnectTools(
  server: McpServer,
  figma: FigmaClient,
): void {
  const key = (input?: string): string =>
    figma.resolveFileKey(input ? parseFileKey(input) : undefined);

  server.registerTool(
    "scan_code_connect",
    {
      title: "Scan project for Code Connect files",
      description:
        "Walks a directory looking for *.figma.ts(x) / *.figma.js(x) and returns each figma.connect() call with its target file key and node id.",
      inputSchema: {
        directory: z
          .string()
          .optional()
          .describe(
            "Absolute directory to scan. Default is the MCP server's working directory.",
          ),
        max_files: z
          .number()
          .int()
          .positive()
          .max(5000)
          .optional()
          .default(500),
      },
    },
    async ({ directory, max_files }) => {
      try {
        const root = directory ?? process.cwd();
        if (!existsSync(root) || !statSync(root).isDirectory()) {
          throw new Error(`Not a directory: ${root}`);
        }
        const files = walkCodeConnectFiles(root, max_files);
        const connections: ParsedConnection[] = [];
        for (const f of files) {
          try {
            connections.push(...parseCodeConnectFile(f));
          } catch {
            // skip unreadable file
          }
        }
        return ok({
          root,
          files_scanned: files.length,
          connections_found: connections.length,
          connections,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "read_code_connect",
    {
      title: "Read a Code Connect file",
      description:
        "Returns the contents of a single *.figma.ts(x) / *.figma.js(x) file plus parsed connection metadata.",
      inputSchema: {
        file_path: z.string().min(1),
      },
    },
    async ({ file_path }) => {
      try {
        if (!existsSync(file_path)) {
          throw new Error(`File not found: ${file_path}`);
        }
        const content = readFileSync(file_path, "utf8");
        const connections = parseCodeConnectFile(file_path);
        return ok({ file_path, content, connections });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "find_node_mapping",
    {
      title: "Find local Code Connect mapping for a Figma node",
      description:
        "Scans a project for any *.figma.ts(x) file connected to the given Figma node.",
      inputSchema: {
        file_key: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Figma file key or full URL. Optional if FIGMA_DEFAULT_FILE_KEY is set.",
          ),
        node_id: z.string().min(1),
        directory: z
          .string()
          .optional()
          .describe("Project directory to scan. Default: cwd."),
      },
    },
    async ({ file_key, node_id, directory }) => {
      try {
        const targetFileKey = key(file_key);
        const normalized = node_id.replace(/-/g, ":");
        const root = directory ?? process.cwd();
        const files = walkCodeConnectFiles(root, 5000);
        const matches: ParsedConnection[] = [];
        for (const f of files) {
          for (const c of parseCodeConnectFile(f)) {
            if (
              c.file_key === targetFileKey &&
              c.node_id === normalized
            ) {
              matches.push(c);
            }
          }
        }
        return ok({
          file_key: targetFileKey,
          node_id: normalized,
          match_count: matches.length,
          matches,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_node_props_for_connect",
    {
      title: "Get a node's component property definitions",
      description:
        "Returns the componentPropertyDefinitions of a Figma component or component set, simplified for use in Code Connect templates.",
      inputSchema: {
        file_key: z.string().min(1).optional(),
        node_id: z.string().min(1),
      },
    },
    async ({ file_key, node_id }) => {
      try {
        const fileKey = key(file_key);
        const normalized = node_id.replace(/-/g, ":");
        const resp = (await figma.getFileNodes(fileKey, [normalized])) as any;
        const definitions = extractPropertyDefinitions(resp);
        const simplified = Object.entries(definitions).map(([k, def]) => ({
          key: k,
          name: k.split("#")[0],
          camel_name: toCamelCase(k.split("#")[0]!),
          type: def.type,
          default_value: def.defaultValue,
          variant_options: def.variantOptions,
        }));
        return ok({
          file_key: fileKey,
          node_id: normalized,
          count: simplified.length,
          properties: simplified,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "generate_code_connect",
    {
      title: "Generate a Code Connect template",
      description:
        "Generates a *.figma.ts template for React, Vue, or HTML. Fetches the node's componentPropertyDefinitions and renders props using figma.boolean / figma.string / figma.enum / figma.instance.",
      inputSchema: {
        file_key: z.string().min(1).optional(),
        node_id: z.string().min(1),
        framework: FRAMEWORK,
        component_name: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Name used in the generated import + figma.connect call. Defaults to the node's name (sanitized).",
          ),
        component_import: z
          .string()
          .optional()
          .describe(
            "Custom import line (e.g. `import { Button } from '@/components/Button'`). Overrides the auto-generated import.",
          ),
      },
    },
    async ({
      file_key,
      node_id,
      framework,
      component_name,
      component_import,
    }) => {
      try {
        const fileKey = key(file_key);
        const normalized = node_id.replace(/-/g, ":");
        const resp = (await figma.getFileNodes(fileKey, [normalized])) as any;
        const definitions = extractPropertyDefinitions(resp);
        const doc =
          resp?.nodes?.[Object.keys(resp?.nodes ?? {})[0] ?? ""]?.document;
        const rawName =
          component_name ?? doc?.name ?? "Component";
        const cleanName =
          rawName
            .split(/[^A-Za-z0-9]+/)
            .filter(Boolean)
            .map((part: string) => part[0]!.toUpperCase() + part.slice(1))
            .join("") || "Component";
        const propsBlock = propsToCodeConnect(definitions);
        const importLine =
          component_import ??
          defaultImportFor(framework as Framework, cleanName);
        const url = buildFigmaUrl(fileKey, normalized);
        const code = generateTemplate({
          framework: framework as Framework,
          url,
          componentName: cleanName,
          componentImport: importLine,
          propsBlock,
          propNames: Object.keys(definitions),
        });
        return ok({
          file_key: fileKey,
          node_id: normalized,
          framework,
          component_name: cleanName,
          suggested_filename: `${cleanName}.figma.${framework === "react" ? "tsx" : "ts"}`,
          code,
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "save_code_connect",
    {
      title: "Save a Code Connect file",
      description:
        "Writes a *.figma.ts(x) file to disk. By default refuses to overwrite an existing file — pass overwrite=true to replace it.",
      inputSchema: {
        file_path: z.string().min(1),
        content: z.string().min(1),
        overwrite: z.boolean().optional().default(false),
      },
    },
    async ({ file_path, content, overwrite }) => {
      try {
        if (existsSync(file_path) && !overwrite) {
          throw new Error(
            `Refusing to overwrite existing file. Pass overwrite=true to replace: ${file_path}`,
          );
        }
        const dir = path.dirname(file_path);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(file_path, content, "utf8");
        return ok({ file_path, bytes: Buffer.byteLength(content) });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "publish_code_connect",
    {
      title: "Publish Code Connect mappings to Figma",
      description:
        "Runs `npx --yes @figma/code-connect connect publish` in the given directory. Requires the user to have the Figma Code Connect CLI accessible (npx will install on demand). The Figma access token must be available in the CLI's environment (FIGMA_ACCESS_TOKEN). Pass dry_run=true to preview without publishing.",
      inputSchema: {
        directory: z
          .string()
          .optional()
          .describe(
            "Project directory containing your *.figma.ts(x) files and a `figma.config.json`. Default: cwd.",
          ),
        dry_run: z.boolean().optional().default(false),
      },
    },
    async ({ directory, dry_run }) => {
      try {
        const cwd = directory ?? process.cwd();
        if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
          throw new Error(`Not a directory: ${cwd}`);
        }
        const args = ["--yes", "@figma/code-connect", "connect", "publish"];
        if (dry_run) args.push("--dry-run");
        // Propagate token from our .env into the CLI environment.
        const token = process.env.FIGMA_TOKEN;
        const env = token
          ? { ...process.env, FIGMA_ACCESS_TOKEN: token }
          : process.env;
        const result = await new Promise<{
          exit: number;
          stdout: string;
          stderr: string;
        }>((resolve) => {
          const proc = spawn("npx", args, {
            cwd,
            env,
            shell: process.platform === "win32",
          });
          let stdout = "";
          let stderr = "";
          proc.stdout.on("data", (b) => (stdout += b.toString()));
          proc.stderr.on("data", (b) => (stderr += b.toString()));
          proc.on("error", (err) => {
            resolve({
              exit: -1,
              stdout,
              stderr: stderr + "\n" + err.message,
            });
          });
          proc.on("close", (code) => {
            resolve({ exit: code ?? -1, stdout, stderr });
          });
        });
        return ok({
          directory: cwd,
          dry_run: Boolean(dry_run),
          exit_code: result.exit,
          stdout: result.stdout.slice(-8000),
          stderr: result.stderr.slice(-8000),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );
}
