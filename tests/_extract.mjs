// Static content_scripts entries can't use ES module import/export (see the
// comment at the top of content/shield.js), so that file is one dependency-
// free classic script. These helpers pull real slices of its source out and
// run them in a sandboxed Function scope, so tests exercise the actual
// shipped code rather than a reimplementation that could drift from it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SHIELD_SRC = readFileSync(
  path.join(__dirname, "..", "content", "shield.js"),
  "utf-8"
);

export function between(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  if (start === -1) throw new Error(`extract: start marker not found: ${startMarker}`);
  const end = src.indexOf(endMarker, start);
  if (end === -1) throw new Error(`extract: end marker not found: ${endMarker}`);
  return src.slice(start, end);
}
