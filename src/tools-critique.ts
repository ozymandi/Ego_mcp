import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PluginBridge } from "./bridge.js";
import { ok, fail } from "./result.js";
import { snapshotScript, type Snapshot } from "./critique/snapshot.js";
import { RULES, RULE_IDS, runRules, type Finding } from "./critique/rules.js";

// critique_design: deterministic design review of a live subtree. The plugin
// takes one snapshot, the rules run here, the model gets a short list of
// findings with node ids and the tool to fix each.

function formatReport(snap: Snapshot, findings: Finding[], ruleCount: number, maxFindings: number): string {
  const root = snap.nodes[snap.context.rootIds[0] ?? ""];
  const nodes = Object.keys(snap.nodes).length;
  const primary = findings.filter((x) => x.severity === "primary").length;
  const advisory = findings.length - primary;
  const head = root
    ? `critique: ${root.type} ${JSON.stringify(root.name)} id=${root.id} — ${primary} primary, ${advisory} advisory (${ruleCount} rules, ${nodes} nodes${snap.truncated ? ", truncated" : ""})`
    : `critique: ${primary} primary, ${advisory} advisory`;
  if (findings.length === 0) return `${head}\nNo findings. Clean against the deterministic rules; judgement calls (hierarchy, voice, emotion) still need a look at the screenshot.`;
  const lines = findings.slice(0, maxFindings).map((x) => {
    const sev = x.severity === "primary" ? "P" : "A";
    const where = x.node ? `${snap.nodes[x.node]?.type ?? ""} ${JSON.stringify(x.name)} ${x.node}`.trim() : "";
    return `${sev} ${x.rule.padEnd(26)} ${where}  ${x.detail}${x.fix ? `  -> ${x.fix}` : ""}`;
  });
  const more = findings.length > maxFindings ? `\n… ${findings.length - maxFindings} more (raise max_findings or pass rules=[…])` : "";
  return `${head}\n${lines.join("\n")}${more}`;
}

export function registerCritiqueTools(server: McpServer, bridge: PluginBridge): void {
  server.registerTool(
    "critique_design",
    {
      title: "Critique a design (deterministic rules)",
      description:
        "Review a node's subtree (or the selection) against ~40 design-cliché and quality rules: type hierarchy, contrast, gray-on-color, nested cards, spacing rhythm, text overflow, buzzwords, hardcoded colors vs variables, Figma hygiene. Returns findings with node ids and the tool to fix each. Run once after building a screen.",
      inputSchema: {
        node_id: z.string().optional().describe("Default: current selection."),
        rules: z.array(z.string()).optional().describe("Subset of rule ids (see list_critique_rules)."),
        min_severity: z.enum(["primary", "advisory"]).optional().default("advisory"),
        max_findings: z.number().int().positive().max(200).optional().default(60),
        format: z.enum(["text", "json"]).optional().default("text"),
        max_nodes: z.number().int().positive().max(5000).optional().default(2000),
      },
    },
    async ({ node_id, rules, min_severity, max_findings, format, max_nodes }) => {
      try {
        if (rules?.length) {
          const unknown = rules.filter((r) => !RULE_IDS.includes(r));
          if (unknown.length) throw new Error(`Unknown rule(s): ${unknown.join(", ")}. See list_critique_rules.`);
        }
        const snap = (await bridge.send("exec", { code: snapshotScript(node_id ? [node_id] : null, max_nodes) }, 90_000)) as Snapshot;
        const findings = runRules(snap, { rules, minSeverity: min_severity });
        const ruleCount = rules?.length ? rules.length : RULES.length;
        if (format === "json") {
          return ok({ root: snap.context.rootIds, nodes: Object.keys(snap.nodes).length, truncated: snap.truncated, rules: ruleCount, findings: findings.slice(0, max_findings) });
        }
        return ok(formatReport(snap, findings, ruleCount, max_findings));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "list_critique_rules",
    {
      title: "List critique rules",
      description: "The rule ids critique_design checks, with severity, group and a one-line meaning.",
      inputSchema: { group: z.enum(["typography", "color", "composition", "text", "design-system", "figma"]).optional() },
    },
    async ({ group }) => {
      try {
        const rows = RULES.filter((r) => !group || r.group === group).map((r) => `${r.severity === "primary" ? "P" : "A"} ${r.id.padEnd(26)} ${r.group.padEnd(13)} ${r.title}${r.figmaOnly ? " (figma-only)" : ""}`);
        return ok(`${rows.length} rules (P = primary, A = advisory; ids follow Impeccable's detector where one exists)\n${rows.join("\n")}`);
      } catch (err) {
        return fail(err);
      }
    },
  );
}
