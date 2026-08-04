import { contextPath } from "./project.js";
import { RESULT_SCHEMA, validateDocument } from "./schema-validator.js";
import { exists, isoNow, readJson, resolveExistingInside, resolveInside, writeJson } from "./util.js";

export async function scaffoldResult(project, task, options = {}) {
  const filePath = contextPath(project, "results", `${task.id}.json`);
  if (await exists(filePath) && !options.force) throw new Error(`Result for ${task.id} already exists. Use --force to replace it.`);
  const result = {
    $schema: "../schemas/result.schema.json",
    schemaVersion: 1,
    task: task.id,
    status: "partial",
    summary: "",
    changedFiles: [],
    acceptance: task.acceptance.map((criterion) => ({ id: criterion.id, status: "not-run", evidence: "" })),
    verificationRuns: [],
    risks: [],
    completedAt: isoNow()
  };
  await writeJson(filePath, result);
  return { result, filePath };
}

function add(issues, code, pointer, message) {
  issues.push({ severity: "error", code, path: pointer, message });
}

export async function inspectResult(project, task) {
  const filePath = contextPath(project, "results", `${task.id}.json`);
  if (!(await exists(filePath))) {
    return { ok: false, counts: { error: 1, warning: 0, info: 0 }, issues: [{ severity: "error", code: "missing-result", path: "result", message: `No result exists for ${task.id}.` }] };
  }
  const result = await readJson(filePath);
  const issues = validateDocument(result, RESULT_SCHEMA);
  if (result.task !== task.id) add(issues, "result-task-mismatch", "$.task", `Result belongs to ${result.task}, not ${task.id}.`);
  const expected = new Set(task.acceptance.map((criterion) => criterion.id));
  const actual = new Set();
  for (const [index, acceptance] of (result.acceptance || []).entries()) {
    if (actual.has(acceptance.id)) add(issues, "duplicate-result-acceptance", `$.acceptance[${index}].id`, `Duplicate acceptance id: ${acceptance.id}`);
    actual.add(acceptance.id);
    if (!expected.has(acceptance.id)) add(issues, "unknown-result-acceptance", `$.acceptance[${index}].id`, `Task does not define ${acceptance.id}.`);
  }
  for (const id of expected) {
    if (!actual.has(id)) add(issues, "missing-result-acceptance", "$.acceptance", `Result is missing ${id}.`);
  }
  if (result.status === "complete") {
    if (!result.summary?.trim()) add(issues, "missing-result-summary", "$.summary", "A complete result requires a summary.");
    for (const acceptance of result.acceptance || []) {
      if (acceptance.status !== "passed") add(issues, "incomplete-acceptance", "$.acceptance", `${acceptance.id} is ${acceptance.status}; a complete result requires every criterion to pass.`);
    }
  }
  for (const [index, reference] of (result.verificationRuns || []).entries()) {
    let runPath;
    try {
      runPath = resolveInside(contextPath(project, "runs"), reference);
    } catch (error) {
      add(issues, "run-path-escape", `$.verificationRuns[${index}]`, error.message);
      continue;
    }
    if (!(await exists(runPath))) add(issues, "missing-verification-run", `$.verificationRuns[${index}]`, `Run not found: ${reference}`);
    else {
      try {
        await resolveExistingInside(contextPath(project, "runs"), reference);
      } catch (error) {
        add(issues, "run-symlink-escape", `$.verificationRuns[${index}]`, error.message);
      }
    }
  }
  const counts = { error: issues.length, warning: 0, info: 0 };
  return { ok: issues.length === 0, counts, issues, result, filePath };
}
