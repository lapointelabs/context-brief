import { readdir } from "node:fs/promises";
import path from "node:path";
import { detectProject } from "./detect.js";
import { contextPath } from "./project.js";
import { exists, isoNow, readJson, slugify, writeJson } from "./util.js";

export function taskScaffold(id, title, options = {}) {
  const verificationCommands = options.verificationCommands || [];
  const entryPoints = options.entryPoints || [];
  return {
    $schema: "../schemas/task.schema.json",
    schemaVersion: 1,
    id,
    title,
    status: "draft",
    outcome: "Describe the observable outcome.",
    why: "",
    behavior: { current: [], expected: [] },
    evidence: [],
    context: { entryPoints, relatedPaths: [], contracts: [] },
    scope: { in: [], out: [] },
    constraints: [],
    protectedPaths: [],
    acceptance: [
      { id: "AC-1", criterion: "The observable outcome is satisfied.", verification: "manual" }
    ],
    verification: { commands: verificationCommands, manual: [] },
    unknowns: [],
    delivery: {
      required: [
        "Summarize the outcome and approach.",
        "List changed files.",
        "Report checks actually run and their results.",
        "Call out remaining risks and assumptions."
      ]
    },
    source: { type: "manual", reference: "ctx task create", importedAt: isoNow() }
  };
}

export function assertTaskId(id) {
  if (!id || slugify(id) !== id) {
    throw new Error("Task id must use lowercase letters, numbers, and single hyphens.");
  }
}

export async function createTask(project, id, title, options = {}) {
  assertTaskId(id);
  const filePath = contextPath(project, "tasks", `${id}.json`);
  if ((await exists(filePath)) && !options.force) {
    throw new Error(`Task ${id} already exists. Use --force to replace it.`);
  }
  const detection = options.detection || await detectProject(project.root);
  const task = taskScaffold(id, title || id.replaceAll("-", " "), {
    verificationCommands: detection.verificationCommands,
    entryPoints: detection.entryPoints
  });
  await writeJson(filePath, task);
  return { task, filePath };
}

export async function loadTask(project, id) {
  assertTaskId(id);
  const filePath = contextPath(project, "tasks", `${id}.json`);
  if (!(await exists(filePath))) throw new Error(`Task not found: ${id}`);
  return { task: await readJson(filePath), filePath };
}

export async function listTasks(project) {
  const directory = contextPath(project, "tasks");
  if (!(await exists(directory))) return [];
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  const tasks = [];
  for (const name of names) {
    const filePath = path.join(directory, name);
    try {
      const task = await readJson(filePath);
      tasks.push({ id: task.id || name.slice(0, -5), title: task.title || "", status: task.status || "invalid", filePath });
    } catch (error) {
      tasks.push({ id: name.slice(0, -5), title: error.message, status: "invalid", filePath });
    }
  }
  return tasks;
}
