import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

export async function initializeProject(directory, options = {}) {
  const root = path.resolve(directory);
  const configPath = path.join(root, CONTEXT_DIR, "config.json");
  if ((await exists(configPath)) && !options.force) {
    throw new Error(`${configPath} already exists. Use --force to replace the configuration.`);
  }
  const name = options.name || slugify(path.basename(root)) || "project";
  await mkdir(path.join(root, CONTEXT_DIR, "tasks"), { recursive: true });
  await mkdir(path.join(root, CONTEXT_DIR, "evidence"), { recursive: true });
  const bundledSchemas = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "schemas");
  const targetSchemas = path.join(root, CONTEXT_DIR, "schemas");
  await mkdir(targetSchemas, { recursive: true });
  for (const name of ["config.schema.json", "task.schema.json", "evidence.schema.json", "result.schema.json"]) {
    await copyFile(path.join(bundledSchemas, name), path.join(targetSchemas, name));
  }
  await writeJson(configPath, defaultConfig(name));
  return { root, configPath };
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
