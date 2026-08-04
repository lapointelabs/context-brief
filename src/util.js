import { createHash } from "node:crypto";
import { access, mkdir, open, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export const CONTEXT_DIR = ".context";

export async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(`Cannot read ${filePath}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

export async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

export function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableJson(value[key])]),
    );
  }
  return value;
}

export function hashValue(value) {
  return createHash("sha256").update(JSON.stringify(stableJson(value))).digest("hex");
}

export async function hashFile(filePath) {
  const handle = await open(filePath, "r");
  const hash = createHash("sha256");
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

export function slugify(input) {
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function toPosix(value) {
  return value.split(path.sep).join("/");
}

export function relativePath(root, absolutePath) {
  return toPosix(path.relative(root, absolutePath)) || ".";
}

export function resolveInside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Path escapes the project root: ${candidate}`);
  }
  return resolved;
}

export async function resolveExistingInside(root, candidate) {
  const lexical = resolveInside(root, candidate);
  const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(lexical)]);
  if (realCandidate !== realRoot && !realCandidate.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error(`Path resolves outside the project root through a symbolic link: ${candidate}`);
  }
  return lexical;
}

export async function findProjectRoot(start = process.cwd()) {
  let current = path.resolve(start);
  while (true) {
    if (await exists(path.join(current, CONTEXT_DIR, "config.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`No ${CONTEXT_DIR}/config.json found. Run \"ctx init\" first.`);
}

export function parseArgs(args) {
  const positionals = [];
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (item === "--") {
      positionals.push(...args.slice(index + 1));
      break;
    }
    if (!item.startsWith("--")) {
      positionals.push(item);
      continue;
    }
    const equals = item.indexOf("=");
    const key = item.slice(2, equals === -1 ? undefined : equals);
    let value = equals === -1 ? true : item.slice(equals + 1);
    if (equals === -1 && args[index + 1] && !args[index + 1].startsWith("--")) {
      value = args[index + 1];
      index += 1;
    }
    if (Object.hasOwn(flags, key)) {
      flags[key] = Array.isArray(flags[key]) ? [...flags[key], value] : [flags[key], value];
    } else {
      flags[key] = value;
    }
  }
  return { positionals, flags };
}

export function flag(flags, name, fallback = undefined) {
  return Object.hasOwn(flags, name) ? flags[name] : fallback;
}

export function flagList(flags, name) {
  const value = flag(flags, name, []);
  if (value === true || value === false || value === undefined) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function globToRegExp(glob) {
  const normalized = toPosix(glob).replace(/^\.\//, "");
  if (normalized === "**" || normalized === "**/*") return /^.*$/;
  let expression = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*" && normalized[index + 1] === "*" && normalized[index + 2] === "/") {
      expression += "(?:.*/)?";
      index += 2;
    } else if (character === "*" && normalized[index + 1] === "*") {
      expression += ".*";
      index += 1;
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`^${expression}(?:/.*)?$`);
}

export function matchesAny(relative, patterns = []) {
  const candidate = toPosix(relative).replace(/^\.\//, "");
  return patterns.some((pattern) => globToRegExp(pattern).test(candidate));
}

export async function walkFiles(root, options = {}) {
  const { exclude = [], include = ["**/*"], maxFileBytes = Infinity } = options;
  const output = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = relativePath(root, absolute);
      if (matchesAny(relative, exclude)) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!entry.isFile() || !matchesAny(relative, include)) continue;
      const details = await stat(absolute);
      if (details.size <= maxFileBytes) {
        output.push({ absolute, relative, bytes: details.size, modifiedAt: details.mtime.toISOString() });
      }
    }
  }

  await visit(root);
  return output;
}

export function runProcess(command, args, options = {}) {
  const { cwd = process.cwd(), env = process.env, input, timeoutMs = 30_000, shell = false } = options;
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, shell, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 200_000) stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 200_000) stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}${error.message}`, timedOut });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

export async function git(root, args) {
  const result = await runProcess("git", args, { cwd: root, timeoutMs: 10_000 });
  return result.code === 0 ? result.stdout.trim() : null;
}

export function approximateTokens(text) {
  return Math.ceil(String(text).length / 4);
}

export function truncate(text, length = 4000) {
  const value = String(text);
  if (value.length <= length) return value;
  return `${value.slice(0, length)}\n… [truncated ${value.length - length} characters]`;
}

export function isoNow() {
  return new Date().toISOString();
}

export function oneLine(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

export async function readText(filePath, maxBytes = 100_000) {
  const details = await stat(filePath);
  if (details.size > maxBytes) return null;
  const buffer = await readFile(filePath);
  if (buffer.includes(0)) return null;
  return buffer.toString("utf8");
}
