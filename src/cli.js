import path from "node:path";
import { compileTask } from "./compiler.js";
import { formatDoctor, inspectProject } from "./doctor.js";
import { hydrateTask } from "./discover.js";
import { addEvidence } from "./evidence.js";
import { importGithubTask } from "./importers.js";
import { serveMcp } from "./mcp.js";
import { initializeProject, loadProject } from "./project.js";
import { inspectResult, scaffoldResult } from "./results.js";
import { createTask, listTasks, loadTask } from "./tasks.js";
import { flag, flagList, parseArgs } from "./util.js";
import { verifyTask } from "./verify.js";

const VERSION = "0.1.0";

const HELP = `context-brief ${VERSION} — compile trustworthy context for coding agents

Usage:
  ctx init [directory] [--name NAME] [--force]
  ctx task create ID [--title TITLE] [--force]
  ctx task import github:OWNER/REPO#NUMBER [--id ID] [--force]
  ctx task list
  ctx task show ID
  ctx evidence add TASK --summary TEXT (--file PATH | --url URL | --command CMD | --note TEXT)
      [--kind KIND] [--sensitivity LEVEL] [--id ID] [--expires DATE] [--excerpt TEXT]
  ctx hydrate TASK
  ctx doctor [TASK] [--json] [--strict]
  ctx build TASK [--target codex|claude|cursor|generic] [--tokens N] [--refresh] [--force] [--stdout]
  ctx verify TASK [--run] [--continue]
  ctx result scaffold TASK [--force]
  ctx result validate TASK [--json]
  ctx status
  ctx serve

Global options:
  --root PATH   Start project discovery from PATH.
  --help        Show this help.
  --version     Show the version.

Safety:
  ctx verify is a dry run unless --run is explicitly supplied. Build refuses validation errors
  unless --force is supplied. Compiled artifacts and run records live under .context/.
`;

function output(value = "") {
  process.stdout.write(`${value}\n`);
}

function required(value, description) {
  if (!value) throw new Error(`Missing ${description}. Run ctx --help for usage.`);
  return value;
}

function relative(filePath, root = process.cwd()) {
  const value = path.relative(root, filePath).split(path.sep).join("/");
  return value || ".";
}

async function projectFrom(flags) {
  const start = flag(flags, "root", process.cwd());
  return loadProject(path.resolve(String(start)));
}

async function commandInit(positionals, flags) {
  const directory = path.resolve(positionals[1] || process.cwd());
  const result = await initializeProject(directory, { name: flag(flags, "name"), force: Boolean(flag(flags, "force", false)) });
  output(`Initialized ${relative(result.configPath)}.`);
  output("Next: ctx task create <id> --title \"Observable outcome\"");
}

async function commandTask(positionals, flags) {
  const action = required(positionals[1], "task action");
  const project = await projectFrom(flags);
  if (action === "create") {
    const id = required(positionals[2], "task id");
    const result = await createTask(project, id, String(flag(flags, "title", id.replaceAll("-", " "))), { force: Boolean(flag(flags, "force", false)) });
    output(`Created ${relative(result.filePath, project.metadataRoot)}.`);
    return;
  }
  if (action === "import") {
    const reference = required(positionals[2], "import reference");
    if (!reference.startsWith("github:")) throw new Error("Only GitHub issue imports are supported in this release.");
    const result = await importGithubTask(project, reference, { id: flag(flags, "id"), force: Boolean(flag(flags, "force", false)) });
    output(`Imported ${result.task.source.reference} to ${relative(result.filePath, project.metadataRoot)}.`);
    return;
  }
  if (action === "list") {
    const tasks = await listTasks(project);
    if (!tasks.length) return output("No tasks. Create one with ctx task create <id>.");
    tasks.forEach((task) => output(`${task.id}\t${task.status}\t${task.title}`));
    return;
  }
  if (action === "show") {
    const { task } = await loadTask(project, required(positionals[2], "task id"));
    output(JSON.stringify(task, null, 2));
    return;
  }
  throw new Error(`Unknown task action: ${action}`);
}

async function commandEvidence(positionals, flags) {
  const action = required(positionals[1], "evidence action");
  if (action !== "add") throw new Error(`Unknown evidence action: ${action}`);
  const taskId = required(positionals[2], "task id");
  const project = await projectFrom(flags);
  const result = await addEvidence(project, taskId, flags);
  output(`Added evidence ${result.record.id} and linked it to ${taskId}.`);
}

async function commandHydrate(positionals, flags) {
  const id = required(positionals[1], "task id");
  const project = await projectFrom(flags);
  const { task } = await loadTask(project, id);
  const { snapshot, filePath } = await hydrateTask(project, task);
  output(`Indexed ${snapshot.stats.indexedFiles} files into ${relative(filePath, project.metadataRoot)}.`);
  output(`Selected ${snapshot.candidates.length} context candidates and ${snapshot.testMappings.length} source/test mappings.`);
  if (snapshot.stats.truncated) output(`Warning: discovery stopped at maxFiles=${project.config.discovery.maxFiles}.`);
}

async function commandDoctor(positionals, flags) {
  const project = await projectFrom(flags);
  const id = positionals[1];
  const task = id ? (await loadTask(project, id)).task : null;
  const report = await inspectProject(project, task);
  output(flag(flags, "json", false) ? JSON.stringify(report, null, 2) : formatDoctor(report));
  const strict = Boolean(flag(flags, "strict", false) || project.config.policies?.failOnWarnings);
  if (!report.ok || (strict && report.counts.warning > 0)) process.exitCode = 1;
}

async function commandBuild(positionals, flags) {
  const id = required(positionals[1], "task id");
  const project = await projectFrom(flags);
  const { task } = await loadTask(project, id);
  const requested = flagList(flags, "target");
  const targets = requested.length ? requested : project.config.targets;
  if (flag(flags, "stdout", false) && targets.length !== 1) throw new Error("--stdout requires exactly one --target.");
  for (const target of targets) {
    const result = await compileTask(project, task, {
      target,
      tokenBudget: flag(flags, "tokens"),
      refresh: Boolean(flag(flags, "refresh", false)),
      force: Boolean(flag(flags, "force", false))
    });
    if (flag(flags, "stdout", false)) {
      process.stdout.write(result.output);
    } else {
      output(`Built ${target}: ${relative(result.outputPath, project.metadataRoot)} (${result.manifest.approximateTokens}/${result.manifest.tokenBudget} approximate tokens).`);
      if (result.manifest.omittedSections.length) output(`  Omitted for budget: ${result.manifest.omittedSections.join(", ")}`);
    }
  }
}

async function commandVerify(positionals, flags) {
  const id = required(positionals[1], "task id");
  const project = await projectFrom(flags);
  const { task } = await loadTask(project, id);
  const result = await verifyTask(project, task, {
    run: Boolean(flag(flags, "run", false)),
    continueOnFailure: Boolean(flag(flags, "continue", false))
  });
  if (!result.executed) {
    output("Dry run. The following commands would execute:");
    if (!result.commands.length) output("  (none)");
    result.commands.forEach((command) => output(`  ${command.name}: ${command.run}${command.cwd ? ` [cwd: ${command.cwd}]` : ""}`));
    output("Run with --run to execute and record them.");
    return;
  }
  result.record.commands.forEach((command) => output(`${command.passed ? "PASS" : "FAIL"} ${command.name} (${command.exitCode ?? command.signal ?? "unknown"})`));
  output(`Recorded ${relative(result.runPath, project.metadataRoot)}.`);
  if (!result.record.passed) process.exitCode = 1;
}

async function commandResult(positionals, flags) {
  const action = required(positionals[1], "result action");
  const project = await projectFrom(flags);
  const { task } = await loadTask(project, required(positionals[2], "task id"));
  if (action === "scaffold") {
    const result = await scaffoldResult(project, task, { force: Boolean(flag(flags, "force", false)) });
    output(`Created ${relative(result.filePath, project.metadataRoot)}.`);
    return;
  }
  if (action === "validate") {
    const report = await inspectResult(project, task);
    output(flag(flags, "json", false) ? JSON.stringify(report, null, 2) : formatDoctor(report));
    if (!report.ok) process.exitCode = 1;
    return;
  }
  throw new Error(`Unknown result action: ${action}`);
}

async function commandStatus(flags) {
  const project = await projectFrom(flags);
  const tasks = await listTasks(project);
  output(`${project.config.project.name}: ${tasks.length} task(s)`);
  tasks.forEach((task) => output(`  ${task.id.padEnd(24)} ${task.status.padEnd(12)} ${task.title}`));
}

export async function run(args) {
  const { positionals, flags } = parseArgs(args);
  const command = positionals[0];
  if (!command || flag(flags, "help", false) || command === "help") return output(HELP.trimEnd());
  if (flag(flags, "version", false) || command === "version") return output(VERSION);
  if (command === "init") return commandInit(positionals, flags);
  if (command === "task") return commandTask(positionals, flags);
  if (command === "evidence") return commandEvidence(positionals, flags);
  if (command === "hydrate") return commandHydrate(positionals, flags);
  if (command === "doctor") return commandDoctor(positionals, flags);
  if (command === "build") return commandBuild(positionals, flags);
  if (command === "verify") return commandVerify(positionals, flags);
  if (command === "result") return commandResult(positionals, flags);
  if (command === "status") return commandStatus(flags);
  if (command === "serve" || command === "mcp") return serveMcp(await projectFrom(flags));
  throw new Error(`Unknown command: ${command}. Run ctx --help for usage.`);
}
