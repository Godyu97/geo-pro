import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const APP_DIR = path.join(ROOT, "src", "app");
const MAP_DIR = path.join(ROOT, "docs", "feature-map");
const MAX_LINES = 120;

const errors = [];

function walk(dir, predicate, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, predicate, out);
    } else if (predicate(full)) {
      out.push(full);
    }
  }
  return out;
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

const actualPages = walk(APP_DIR, (p) => path.basename(p) === "page.tsx")
  .map((p) => toPosix(path.relative(ROOT, p)))
  .sort();

if (!fs.existsSync(MAP_DIR)) {
  console.error("ERROR: docs/feature-map directory not found");
  process.exit(1);
}

const mapFiles = fs
  .readdirSync(MAP_DIR)
  .filter((name) => name.endsWith(".md"))
  .sort();

const documentedPages = new Map();
const pathRefs = [];

for (const fileName of mapFiles) {
  const fullPath = path.join(MAP_DIR, fileName);
  const content = fs.readFileSync(fullPath, "utf8");
  const lines = content.split(/\r?\n/);

  if (lines.length > MAX_LINES) {
    errors.push(`docs/feature-map/${fileName} exceeds ${MAX_LINES} lines (${lines.length})`);
  }

  for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) continue;
    const [relPart] = target.split("#");
    const resolved = path.resolve(MAP_DIR, relPart);
    if (!fs.existsSync(resolved)) {
      errors.push(`Broken markdown link in ${fileName}: ${target}`);
    }
  }

  if (fileName === "README.md") continue;

  for (const match of content.matchAll(/`(src\/[^`]+)`/g)) {
    const refPath = match[1];
    pathRefs.push({ fileName, refPath });
    if (refPath.endsWith("/page.tsx")) {
      documentedPages.set(refPath, (documentedPages.get(refPath) ?? 0) + 1);
    }
    if (refPath.endsWith("/")) {
      const rest = content.slice(match.index + match[0].length);
      const groupMatch = rest.match(/^（([^）]+)）/);
      if (groupMatch) {
        for (const sub of groupMatch[1].matchAll(/`([^`]+\.(?:ts|tsx))`/g)) {
          pathRefs.push({ fileName, refPath: `${refPath}${sub[1]}` });
        }
      }
    }
  }
}

for (const page of actualPages) {
  const count = documentedPages.get(page) ?? 0;
  if (count === 0) {
    errors.push(`Missing route page in feature map: ${page}`);
  } else if (count > 1) {
    errors.push(`Duplicate route page in feature map (${count}x): ${page}`);
  }
}

for (const [docPage] of documentedPages) {
  if (!actualPages.includes(docPage)) {
    errors.push(`Stale/ghost route page in feature map: ${docPage}`);
  }
}

for (const { fileName, refPath } of pathRefs) {
  const clean = refPath.replace(/\/$/, "");
  const full = path.join(ROOT, clean);
  if (!fs.existsSync(full)) {
    errors.push(`Dead path reference in ${fileName}: ${refPath}`);
  }
}

if (errors.length > 0) {
  for (const err of errors) {
    console.error(`ERROR: ${err}`);
  }
  process.exit(1);
}

console.log(
  `PASS: ${actualPages.length}/${actualPages.length} pages mapped, ${pathRefs.length} code paths verified, ${mapFiles.length} map files <= ${MAX_LINES} lines`,
);
