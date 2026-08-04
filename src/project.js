import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectProject } from "./detect.js";
import { CONTEXT_DIR, exists, findProjectRoot, readJson, resolveInside, slugify, writeJson } from "./util.js";

export const TARGETS = ["codex", "claude", "cursor", "generic"];

export function defaultConfig(projectName) {
  return {
    $schema: "./schemas/config.schema.json",
    schemaVersion: 1,
    project: { name: projectName, root: "." },
    discovery: {
      include: ["**/*"],
      exclude: [
        ".git",
        "node_modules",
        "vendor",
        "dist",
        "build",
        "coverage",
        ".next",
        ".context/build",
        ".context/runs",
        ".context/snapshots",
        ".context/results"
      ],
      maxFileBytes: 262144,
      maxFiles: 10000,
      instructionFiles: ["AGENTS.md", "CLAUDE.md", ".cursor/rules/**/*.mdc"]
    },
    policies: {
      tokenBudget: 12000,
      evidenceMaxAgeDays: 30,
      failOnWarnings: false
    },
    targets: [...TARGETS]
  };
}

async function syncSchemas(root) {
  const bundledSchemas = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "schemas");
  const targetSchemas = path.join(root, CONTEXT_DIR, "schemas");
  await mkdir(targetSchemas, { recursive: true });
  for (const name of ["config.schema.json", "task.schema.json", "evidence.schema.json", "result.schema.json"]) {
    await copyFile(path.join(bundledSchemas, name), path.join(targetSchemas, name));
  }
}

async function updateGitignore(root) {
  if (!await exists(path.join(root, ".git"))) return false;
  const filePath = path.join(root, ".gitignore");
  const current = await exists(filePath) ? await readFile(filePath, "utf8") : "";
  const patterns = [".context/build/", ".context/runs/", ".context/snapshots/", ".context/results/"];
  const missing = patterns.filter((pattern) => !current.split(/\r?\n/).includes(pattern));
  if (!missing.length) return false;
  const separator = current && !current.endsWith("\n") ? "\n" : "";
  await writeFile(filePath, `${current}${separator}${current ? "\n" : ""}# Context Brief generated artifacts\n${missing.join("\n")}\n`, "utf8");
  return true;
}

export async function initializeProject(directory, options = {}) {
  const root = path.resolve(directory);
  const configPath = path.join(root, CONTEXT_DIR, "config.json");
  const alreadyInitialized = await exists(configPath);
  const detection = await detectProject(root);
  if (alreadyInitialized && !options.force) {
    await syncSchemas(root);
    const gitignoreChanged = options.gitignore === false ? false : await updateGitignore(root);
    return { root, configPath, detection, alreadyInitialized: true, gitignoreChanged };
  }
  const name = options.name || detection.projectName || slugify(path.basename(root)) || "project";
  await mkdir(path.join(root, CONTEXT_DIR, "tasks"), { recursive: true });
  await mkdir(path.join(root, CONTEXT_DIR, "evidence"), { recursive: true });
  await syncSchemas(root);
  const config = defaultConfig(name);
  if (detection.githubRepository) config.integrations = { github: { repository: detection.githubRepository } };
  await writeJson(configPath, config);
  const gitignoreChanged = options.gitignore === false ? false : await updateGitignore(root);
  return { root, configPath, detection, alreadyInitialized, gitignoreChanged };
}

export async function loadProject(start = process.cwd()) {
  const root = await findProjectRoot(start);
  const configPath = path.join(root, CONTEXT_DIR, "config.json");
  const config = await readJson(configPath);
  const configuredRoot = resolveInside(root, config.project?.root || ".");
  return { root: configuredRoot, metadataRoot: root, configPath, config };
}

export function contextPath(project, ...parts) {
  return path.join(project.metadataRoot, CONTEXT_DIR, ...parts);
}
