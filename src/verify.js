import path from "node:path";
import { contextPath } from "./project.js";
import { git, hashValue, isoNow, resolveExistingInside, runProcess, truncate, writeJson } from "./util.js";

async function execute(command, root) {
  const cwd = await resolveExistingInside(root, command.cwd || ".");
  const startedAt = isoNow();
  const result = await runProcess(command.run, [], {
    cwd,
    shell: true,
    timeoutMs: (command.timeoutSeconds || 300) * 1000,
    env: { ...process.env, CI: process.env.CI || "1" }
  });
  return {
    name: command.name,
    run: command.run,
    cwd: path.relative(root, cwd).split(path.sep).join("/") || ".",
    startedAt,
    completedAt: isoNow(),
    exitCode: result.code,
    signal: result.signal || null,
    timedOut: result.timedOut,
    passed: result.code === 0 && !result.timedOut,
    stdout: truncate(result.stdout, 50_000),
    stderr: truncate(result.stderr, 50_000)
  };
}

export async function verifyTask(project, task, options = {}) {
  const commands = task.verification?.commands || [];
  if (!options.run) return { executed: false, commands };
  const startedAt = isoNow();
  const results = [];
  for (const command of commands) {
    const result = await execute(command, project.root);
    results.push(result);
    if (!result.passed && !options.continueOnFailure) break;
  }
  const timestamp = startedAt.replace(/\D/g, "").slice(0, 14);
  const runPath = contextPath(project, "runs", `${task.id}-${timestamp}.json`);
  const record = {
    schemaVersion: 1,
    task: task.id,
    taskHash: hashValue(task),
    repositoryHead: await git(project.root, ["rev-parse", "HEAD"]),
    startedAt,
    completedAt: isoNow(),
    passed: results.length === commands.length && results.every((result) => result.passed),
    commands: results
  };
  await writeJson(runPath, record);
  return { executed: true, record, runPath };
}
