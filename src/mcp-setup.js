import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { detectProject } from "./detect.js";
import { exists, readJson, runProcess, slugify, writeJson } from "./util.js";
import { VERSION } from "./version.js";

const binPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "ctx.js");

function quote(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./:@=-]+$/.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`;
}

function invocation(project) {
  const ephemeralNpx = binPath.includes(`${path.sep}_npx${path.sep}`) || binPath.includes(`${path.sep}.npm${path.sep}_npx${path.sep}`);
  if (ephemeralNpx) {
    return {
      command: "npx",
      args: ["--yes", `@lapointelabs/context-brief@${VERSION}`, "serve", "--root", project.metadataRoot]
    };
  }
  return {
    command: process.execPath,
    args: [binPath, "serve", "--root", project.metadataRoot]
  };
}

export function defaultMcpName(project) {
  return `context-brief-${slugify(project.config.project.name) || "project"}`;
}

export async function mcpPlan(project, target, options = {}) {
  const name = options.name || defaultMcpName(project);
  const server = invocation(project);
  if (target === "codex") {
    const args = ["mcp", "add", name, "--", server.command, ...server.args];
    return { target, name, method: "cli", executable: "codex", args, display: ["codex", ...args].map(quote).join(" "), server };
  }
  if (target === "claude") {
    const args = ["mcp", "add", "--scope", "project", name, "--", server.command, ...server.args];
    return { target, name, method: "cli", executable: "claude", args, display: ["claude", ...args].map(quote).join(" "), server };
  }
  if (target === "cursor") {
    const filePath = path.join(project.root, ".cursor", "mcp.json");
    return {
      target,
      name,
      method: "json",
      filePath,
      display: `Merge ${JSON.stringify({ mcpServers: { [name]: server } })} into ${filePath}`,
      server
    };
  }
  throw new Error(`MCP installation is not available for target: ${target}`);
}

export async function installMcp(project, target, options = {}) {
  const plan = await mcpPlan(project, target, options);
  if (!options.apply) return { applied: false, plan };
  const detection = await detectProject(project.root);
  if (plan.method === "cli") {
    if (!detection.clients[target]) throw new Error(`${target} CLI was not found on PATH. Install it, then rerun with --apply.`);
    const getArgs = ["mcp", "get", plan.name, ...(target === "codex" ? ["--json"] : [])];
    const current = await runProcess(plan.executable, getArgs, { cwd: project.root, timeoutMs: 30_000 });
    if (current.code === 0 && !options.force) return { applied: false, unchanged: true, plan };
    if (current.code === 0 && options.force) {
      const removeArgs = ["mcp", "remove", ...(target === "claude" ? ["--scope", "project"] : []), plan.name];
      const removed = await runProcess(plan.executable, removeArgs, { cwd: project.root, timeoutMs: 30_000 });
      if (removed.code !== 0) throw new Error(`${target} MCP replacement failed while removing the existing server: ${removed.stderr.trim() || removed.stdout.trim()}`);
    }
    const result = await runProcess(plan.executable, plan.args, { cwd: project.root, timeoutMs: 30_000 });
    if (result.code !== 0) throw new Error(`${target} MCP setup failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`}`);
    return { applied: true, plan, output: result.stdout.trim() };
  }
  const current = await exists(plan.filePath) ? await readJson(plan.filePath) : {};
  if (current.mcpServers?.[plan.name] && !options.force) {
    return { applied: false, unchanged: true, plan };
  }
  const next = {
    ...current,
    mcpServers: {
      ...(current.mcpServers || {}),
      [plan.name]: plan.server
    }
  };
  await mkdir(path.dirname(plan.filePath), { recursive: true });
  await writeJson(plan.filePath, next);
  return { applied: true, plan };
}

export function formatMcpResult(result, root = process.cwd()) {
  if (!result.applied) {
    if (result.unchanged) return `Already configured: ${result.plan.name}`;
    return `Preview only; no configuration changed.\n${result.plan.display}\nRun ctx mcp install ${result.plan.target} to install.`;
  }
  if (result.plan.filePath) return `Configured ${result.plan.name} in ${path.relative(root, result.plan.filePath) || result.plan.filePath}.`;
  return `Configured ${result.plan.name} for ${result.plan.target}.${result.output ? `\n${result.output}` : ""}`;
}
