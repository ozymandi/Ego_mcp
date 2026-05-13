import { z } from "zod";
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
    const enterpriseHint =
      err.status === 403
        ? "\n\nNote: Variables and library-scope endpoints often require an Enterprise-tier Figma plan."
        : "";
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            `Figma API error ${err.status}: ${err.message}${enterpriseHint}\n` +
            JSON.stringify(err.body, null, 2),
        },
      ],
    };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text", text: `Error: ${msg}` }] };
}

const fileKeyArg = z
  .string()
  .min(1)
  .describe(
    "Figma file key or full Figma URL. Optional if FIGMA_DEFAULT_FILE_KEY is set.",
  )
  .optional();

const teamIdArg = z
  .string()
  .min(1)
  .describe(
    "Figma team id. Find it in the team URL: https://www.figma.com/files/team/<TEAM_ID>/...",
  );

const pageSizeArg = z
  .number()
  .int()
  .positive()
  .max(30)
  .optional()
  .describe("Page size (max 30 per Figma API).");

const afterArg = z
  .union([z.string(), z.number()])
  .optional()
  .describe("Cursor for the next page (from previous response's `cursor.after`).");

export function registerLibraryTools(
  server: McpServer,
  figma: FigmaClient,
): void {
  const key = (input?: string): string =>
    figma.resolveFileKey(input ? parseFileKey(input) : undefined);

  // ---- Variables (Enterprise) -------------------------------------------

  server.registerTool(
    "get_local_variables",
    {
      title: "Get local variables",
      description:
        "Returns local variables and variable collections defined in a Figma file. Requires Enterprise-tier plan; returns 403 otherwise.",
      inputSchema: { file_key: fileKeyArg },
    },
    async ({ file_key }) => {
      try {
        return ok(await figma.getLocalVariables(key(file_key)));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_published_variables",
    {
      title: "Get published variables",
      description:
        "Returns variables published from a Figma file as a library. Requires Enterprise-tier plan.",
      inputSchema: { file_key: fileKeyArg },
    },
    async ({ file_key }) => {
      try {
        return ok(await figma.getPublishedVariables(key(file_key)));
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ---- File-scoped --------------------------------------------------------

  server.registerTool(
    "get_file_component_sets",
    {
      title: "List component sets in a file",
      description:
        "Returns component sets (variants groups) defined in a Figma file.",
      inputSchema: { file_key: fileKeyArg },
    },
    async ({ file_key }) => {
      try {
        return ok(await figma.getFileComponentSets(key(file_key)));
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ---- Lookup by global key ---------------------------------------------

  server.registerTool(
    "get_component_by_key",
    {
      title: "Get component by global key",
      description:
        "Fetches a single component by its global key (component.key from a library reference).",
      inputSchema: { key: z.string().min(1) },
    },
    async ({ key: componentKey }) => {
      try {
        return ok(await figma.getComponentByKey(componentKey));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_component_set_by_key",
    {
      title: "Get component set by global key",
      description:
        "Fetches a single component set (variants group) by its global key.",
      inputSchema: { key: z.string().min(1) },
    },
    async ({ key: setKey }) => {
      try {
        return ok(await figma.getComponentSetByKey(setKey));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_style_by_key",
    {
      title: "Get style by global key",
      description:
        "Fetches a single paint/text/effect/grid style by its global key.",
      inputSchema: { key: z.string().min(1) },
    },
    async ({ key: styleKey }) => {
      try {
        return ok(await figma.getStyleByKey(styleKey));
      } catch (err) {
        return fail(err);
      }
    },
  );

  // ---- Team library (paginated) -----------------------------------------

  server.registerTool(
    "get_team_components",
    {
      title: "List team library components",
      description:
        "Returns components published in a team's library. Paginated — pass `after` to fetch the next page.",
      inputSchema: {
        team_id: teamIdArg,
        page_size: pageSizeArg,
        after: afterArg,
      },
    },
    async ({ team_id, page_size, after }) => {
      try {
        return ok(await figma.getTeamComponents(team_id, { page_size, after }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_team_component_sets",
    {
      title: "List team library component sets",
      description:
        "Returns component sets published in a team's library. Paginated.",
      inputSchema: {
        team_id: teamIdArg,
        page_size: pageSizeArg,
        after: afterArg,
      },
    },
    async ({ team_id, page_size, after }) => {
      try {
        return ok(
          await figma.getTeamComponentSets(team_id, { page_size, after }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_team_styles",
    {
      title: "List team library styles",
      description:
        "Returns styles published in a team's library. Paginated.",
      inputSchema: {
        team_id: teamIdArg,
        page_size: pageSizeArg,
        after: afterArg,
      },
    },
    async ({ team_id, page_size, after }) => {
      try {
        return ok(await figma.getTeamStyles(team_id, { page_size, after }));
      } catch (err) {
        return fail(err);
      }
    },
  );
}
