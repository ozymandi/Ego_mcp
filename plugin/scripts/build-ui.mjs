// Inlines the bundled UI JS into the HTML template so the Figma plugin
// runtime (which doesn't serve files) can execute it.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const templatePath = resolve(root, "src/ui.html");
const jsPath = resolve(root, "dist/ui.js");
const outPath = resolve(root, "dist/ui.html");

const template = readFileSync(templatePath, "utf8");
const js = readFileSync(jsPath, "utf8");

const out = template.replace(
  "/*INLINE_UI_JS*/",
  () => "\n" + js + "\n",
);

if (out === template) {
  throw new Error(
    "build-ui: placeholder '/*INLINE_UI_JS*/' not found in src/ui.html",
  );
}

if (!existsSync(dirname(outPath))) mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, out);
console.log(`build-ui: wrote ${outPath} (${out.length} bytes)`);
