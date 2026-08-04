import { constants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { exists, git, readJson } from "./util.js";

async function readableJson(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

async function executableOnPath(name) {
  const directories = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32" ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const directory of directories) {
    for (const extension of extensions) {
      try {
        await access(path.join(directory, `${name}${extension}`), constants.X_OK);
        return true;
      } catch {
        // Continue searching PATH.
      }
    }
  }
  return false;
}

function npmRun(packageManager, script) {
  if (packageManager === "npm") return `npm run ${script}`;
  return `${packageManager} ${script}`;
}

async function nodeDetection(root, packageJson) {
  if (!packageJson) return null;
  let packageManager = packageJson.packageManager?.split("@")[0];
  if (!packageManager) {
    if (await exists(path.join(root, "pnpm-lock.yaml"))) packageManager = "pnpm";
    else if (await exists(path.join(root, "yarn.lock"))) packageManager = "yarn";
    else if (await exists(path.join(root, "bun.lock")) || await exists(path.join(root, "bun.lockb"))) packageManager = "bun";
    else packageManager = "npm";
  }
  const scripts = packageJson.scripts || {};
  const commands = [];
  const candidates = [
    ["test", "tests"],
    ["typecheck", "typecheck"],
    ["lint", "lint"],
    ["build", "build"]
  ];
  for (const [script, name] of candidates) {
    if (typeof scripts[script] === "string" && !/no test specified/i.test(scripts[script])) {
      commands.push({ name, run: npmRun(packageManager, script), timeoutSeconds: script === "test" ? 300 : 180 });
    }
  }
  const rawEntryPoints = [packageJson.main, packageJson.module, packageJson.types]
    .concat(typeof packageJson.bin === "string" ? [packageJson.bin] : Object.values(packageJson.bin || {}))
    .filter((value) => typeof value === "string");
  const entryPoints = [];
  for (const candidate of rawEntryPoints) {
    if (await exists(path.join(root, candidate))) entryPoints.push(candidate.split(path.sep).join("/"));
  }
  if (!entryPoints.length) {
    for (const candidate of ["src/index.ts", "src/index.js", "index.ts", "index.js"]) {
      if (await exists(path.join(root, candidate))) entryPoints.push(candidate);
    }
  }
  return {
    runtime: "node",
    packageManager,
    projectName: packageJson.name,
    installCommand: packageManager === "npm" ? "npm install" : `${packageManager} install`,
    commands,
    entryPoints
  };
}

async function nonNodeDetection(root) {
  if (await exists(path.join(root, "pyproject.toml")) || await exists(path.join(root, "requirements.txt"))) {
    const manager = await exists(path.join(root, "uv.lock")) ? "uv" : "python";
    return {
      runtime: "python",
      packageManager: manager,
      installCommand: manager === "uv" ? "uv sync" : "python -m pip install -r requirements.txt",
      commands: [{ name: "tests", run: manager === "uv" ? "uv run pytest" : "python -m pytest", timeoutSeconds: 300 }],
      entryPoints: []
    };
  }
  if (await exists(path.join(root, "go.mod"))) {
    return { runtime: "go", packageManager: "go", installCommand: "go mod download", commands: [{ name: "tests", run: "go test ./...", timeoutSeconds: 300 }], entryPoints: [] };
  }
  if (await exists(path.join(root, "Cargo.toml"))) {
    return { runtime: "rust", packageManager: "cargo", installCommand: "cargo fetch", commands: [{ name: "tests", run: "cargo test", timeoutSeconds: 300 }, { name: "lint", run: "cargo clippy --all-targets --all-features -- -D warnings", timeoutSeconds: 300 }], entryPoints: [] };
  }
  if (await exists(path.join(root, "Gemfile"))) {
    return { runtime: "ruby", packageManager: "bundler", installCommand: "bundle install", commands: [{ name: "tests", run: "bundle exec rspec", timeoutSeconds: 300 }], entryPoints: [] };
  }
  return { runtime: "unknown", packageManager: null, installCommand: null, commands: [], entryPoints: [] };
}

function githubRepository(remote) {
  if (!remote) return null;
  const match = remote.match(/github\.com[/:]([^/]+\/.+?)(?:\.git)?$/i);
  return match?.[1] || null;
}

async function instructionFiles(root) {
  const found = [];
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    if (await exists(path.join(root, name))) found.push(name);
  }
  const cursorRules = path.join(root, ".cursor", "rules");
  if (await exists(cursorRules)) {
    for (const name of await readdir(cursorRules)) {
      if (name.endsWith(".mdc")) found.push(`.cursor/rules/${name}`);
    }
  }
  return found;
}

export async function detectProject(root) {
  const packageJson = await readableJson(path.join(root, "package.json"));
  const detected = await nodeDetection(root, packageJson) || await nonNodeDetection(root);
  const remote = await git(root, ["config", "--get", "remote.origin.url"]);
  const clients = {
    codex: await executableOnPath("codex"),
    claude: await executableOnPath("claude"),
    cursor: await executableOnPath("cursor-agent") || await executableOnPath("cursor")
  };
  const defaultTarget = clients.codex ? "codex" : clients.claude ? "claude" : clients.cursor ? "cursor" : "generic";
  return {
    projectName: detected.projectName || path.basename(root),
    runtime: detected.runtime,
    packageManager: detected.packageManager,
    installCommand: detected.installCommand,
    verificationCommands: detected.commands,
    entryPoints: detected.entryPoints,
    instructionFiles: await instructionFiles(root),
    githubRepository: githubRepository(remote),
    clients,
    defaultTarget
  };
}

export function formatDetection(detection) {
  const available = Object.entries(detection.clients).filter(([, present]) => present).map(([name]) => name);
  return [
    `Project: ${detection.projectName}`,
    `Runtime: ${detection.runtime}${detection.packageManager ? ` (${detection.packageManager})` : ""}`,
    `Verification: ${detection.verificationCommands.length ? detection.verificationCommands.map((command) => command.run).join(", ") : "none detected"}`,
    `Instructions: ${detection.instructionFiles.length ? detection.instructionFiles.join(", ") : "none detected"}`,
    `Agents: ${available.length ? available.join(", ") : "generic"}`
  ].join("\n");
}
