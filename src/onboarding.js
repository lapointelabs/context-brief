import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { compileTask } from "./compiler.js";
import { detectProject } from "./detect.js";
import { hydrateTask } from "./discover.js";
import { inspectProject } from "./doctor.js";
import { importGithubTask } from "./importers.js";
import { installMcp } from "./mcp-setup.js";
import { contextPath } from "./project.js";
import { createTask, loadTask } from "./tasks.js";
import { exists, flagList, slugify, writeJson } from "./util.js";

async function promptText(readline, label, fallback = "") {
  const suffix = fallback ? ` [${fallback}]` : "";
  const answer = (await readline.question(`${label}${suffix}: `)).trim();
  return answer || fallback;
}

async function promptTarget(readline, detection) {
  const available = Object.entries(detection.clients).filter(([, present]) => present).map(([name]) => name);
  const choices = [...new Set([...available, "generic"])];
  while (true) {
    const answer = await promptText(readline, `Agent target (${choices.join("/")})`, detection.defaultTarget);
    if (choices.includes(answer)) return answer;
    output.write(`Choose one of: ${choices.join(", ")}\n`);
  }
}

function displayTitle(id) {
  return id.split("-").filter(Boolean).map((word) => `${word[0]?.toUpperCase() || ""}${word.slice(1)}`).join(" ");
}

async function existingTask(project, source) {
  if (!source || !/^[a-z0-9][a-z0-9-]*$/.test(source)) return null;
  return await exists(contextPath(project, "tasks", `${source}.json`)) ? loadTask(project, source) : null;
}

export async function startExperience(project, source, flags = {}) {
  const detection = await detectProject(project.root);
  const interactive = !flags.yes && input.isTTY && output.isTTY;
  const readline = interactive ? createInterface({ input, output }) : null;
  let target = typeof flags.target === "string" ? flags.target : null;
  let taskRecord;
  let created = false;
  try {
    taskRecord = await existingTask(project, source);
    if (!taskRecord && source?.startsWith("github:")) {
      taskRecord = await importGithubTask(project, source, { id: flags.id, force: Boolean(flags.force), detection });
      created = true;
    }
    if (!taskRecord) {
      let title = typeof flags.title === "string" ? flags.title : source ? displayTitle(source) : "";
      if (interactive) title = await promptText(readline, "Task title", title);
      if (!title) throw new Error("A task title is required in non-interactive mode. Pass --title or run in a terminal.");
      const id = typeof flags.id === "string" ? flags.id : source && slugify(source) === source ? source : slugify(title);
      if (!id) throw new Error("Could not derive a task id. Pass --id.");
      let outcome = typeof flags.outcome === "string" ? flags.outcome : "";
      if (interactive) outcome = await promptText(readline, "Observable outcome", outcome || title);
      if (!outcome) {
        if (flags.yes) outcome = title;
        else throw new Error("An observable outcome is required in non-interactive mode. Pass --outcome or --yes.");
      }
      let scope = flagList(flags, "scope");
      if (interactive && !scope.length) scope = [await promptText(readline, "In scope", title)];
      const acceptance = flagList(flags, "acceptance");
      taskRecord = await createTask(project, id, title, { force: Boolean(flags.force), detection });
      const task = taskRecord.task;
      task.outcome = outcome;
      task.why = typeof flags.why === "string" ? flags.why : "";
      task.behavior.expected = [outcome];
      task.scope.in = scope.length ? scope : [title];
      task.context.entryPoints = [...new Set([...task.context.entryPoints, ...flagList(flags, "path")])];
      task.acceptance = (acceptance.length ? acceptance : [outcome]).map((criterion, index) => ({
        id: `AC-${index + 1}`,
        criterion,
        verification: detection.verificationCommands.length ? "automated" : "manual"
      }));
      await writeJson(taskRecord.filePath, task);
      created = true;
    }
    if (!target) target = interactive ? await promptTarget(readline, detection) : detection.defaultTarget;
  } finally {
    readline?.close();
  }

  const { task, filePath: taskPath } = taskRecord;
  const hydrated = await hydrateTask(project, task);
  const report = await inspectProject(project, task);
  if (!report.ok) {
    const details = report.issues.filter((item) => item.severity === "error").map((item) => `${item.path}: ${item.message}`).join("\n");
    throw new Error(`Onboarding stopped because the task is invalid. Fix ${path.relative(project.metadataRoot, taskPath)} and rerun ctx start ${task.id}.\n${details}`);
  }
  const compiled = await compileTask(project, task, { target });
  let mcp;
  if (flags.mcp) mcp = await installMcp(project, target, { apply: true, force: Boolean(flags.force) });
  return { created, detection, task, taskPath, snapshotPath: hydrated.filePath, report, target, compiled, mcp };
}
