import { contextPath } from "./project.js";
import { loadEvidence } from "./evidence.js";
import { CONFIG_SCHEMA, EVIDENCE_SCHEMA, TASK_SCHEMA, validateDocument } from "./schema-validator.js";
import { exists, hashFile, hashValue, readJson, resolveExistingInside, resolveInside } from "./util.js";

const SECRET_PATTERNS = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["github-token", /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/],
  ["openai-key", /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ["assigned-secret", /\b(?:password|passwd|secret|api[_-]?key)\s*[:=]\s*["'][^"']{8,}["']/i]
];

function issue(issues, severity, code, pointer, message) {
  issues.push({ severity, code, path: pointer, message });
}

function scanSecrets(issues, value, pointer) {
  const serialized = JSON.stringify(value);
  for (const [name, pattern] of SECRET_PATTERNS) {
    if (pattern.test(serialized)) {
      issue(issues, "error", "possible-secret", pointer, `Possible ${name} detected. Redact it before compiling context.`);
    }
  }
}

export function validateConfig(config) {
  return validateDocument(config, CONFIG_SCHEMA);
}

export function validateTaskShape(task) {
  const issues = validateDocument(task, TASK_SCHEMA);
  if (Array.isArray(task?.acceptance)) {
    const ids = new Set();
    task.acceptance.forEach((criterion, index) => {
      if (ids.has(criterion?.id)) issue(issues, "error", "duplicate-acceptance", `acceptance[${index}].id`, `Duplicate acceptance id: ${criterion.id}`);
      ids.add(criterion?.id);
    });
  }
  if (Array.isArray(task?.verification?.commands)) {
    task.verification.commands.forEach((command, index) => {
      if (typeof command?.run === "string" && /(?:^|\s)(?:sudo\s+)?rm\s+-[a-z]*r|git\s+reset\s+--hard|curl\b[^|]*\|\s*(?:sh|bash)/i.test(command.run)) {
        issue(issues, "warning", "destructive-command", `verification.commands[${index}].run`, "Command looks destructive; ctx verify requires --run but review it carefully.");
      }
    });
  }

  const overlap = (Array.isArray(task?.scope?.in) ? task.scope.in : []).filter((item) => (Array.isArray(task?.scope?.out) ? task.scope.out : []).includes(item));
  overlap.forEach((item) => issue(issues, "error", "scope-conflict", "scope", `Appears in both in-scope and out-of-scope: ${item}`));
  if (/describe the observable outcome/i.test(task.outcome || "")) {
    issue(issues, "warning", "placeholder", "outcome", "Replace the generated outcome placeholder.");
  }
  if (task?.status && task.status !== "draft" && Array.isArray(task.evidence) && !task.evidence.length) {
    issue(issues, "warning", "no-evidence", "evidence", "A non-draft task has no evidence records.");
  }
  scanSecrets(issues, task, "task");
  return issues;
}

async function validatePaths(project, task, issues) {
  const groups = [
    ["context.entryPoints", task.context?.entryPoints || [], true],
    ["context.relatedPaths", task.context?.relatedPaths || [], true],
    ["protectedPaths", task.protectedPaths || [], false]
  ];
  for (const [pointer, paths, required] of groups) {
    for (const candidate of paths) {
      if (/[*?{}[\]]/.test(candidate)) continue;
      let absolute;
      try {
        absolute = resolveInside(project.root, candidate);
      } catch (error) {
        issue(issues, "error", "path-escape", pointer, error.message);
        continue;
      }
      if (!(await exists(absolute))) {
        issue(issues, required ? "error" : "warning", "missing-path", pointer, `Path does not exist: ${candidate}`);
      } else {
        try {
          await resolveExistingInside(project.root, candidate);
        } catch (error) {
          issue(issues, "error", "symlink-escape", pointer, error.message);
        }
      }
    }
  }
  for (let index = 0; index < (task.verification?.commands || []).length; index += 1) {
    const cwd = task.verification.commands[index].cwd || ".";
    try {
      const absolute = resolveInside(project.root, cwd);
      if (!(await exists(absolute))) issue(issues, "error", "missing-cwd", `verification.commands[${index}].cwd`, `Directory does not exist: ${cwd}`);
      else await resolveExistingInside(project.root, cwd);
    } catch (error) {
      issue(issues, "error", "path-escape", `verification.commands[${index}].cwd`, error.message);
    }
  }
}

async function validateEvidenceRecords(project, task, issues) {
  for (const id of task.evidence || []) {
    let record;
    try {
      ({ evidence: record } = await loadEvidence(project, id));
    } catch (error) {
      issue(issues, "error", "missing-evidence", "evidence", error.message);
      continue;
    }
    issues.push(...validateDocument(record, EVIDENCE_SCHEMA, `evidence.${id}`));
    if (record.task !== task.id) issue(issues, "error", "evidence-task-mismatch", `evidence.${id}.task`, `Evidence belongs to ${record.task}, not ${task.id}.`);
    const captured = new Date(record.capturedAt);
    if (Number.isNaN(captured.valueOf())) issue(issues, "error", "invalid-date", `evidence.${id}.capturedAt`, "Invalid capture timestamp.");
    const maxAge = project.config.policies?.evidenceMaxAgeDays ?? 30;
    if (!Number.isNaN(captured.valueOf()) && maxAge > 0 && Date.now() - captured.valueOf() > maxAge * 86_400_000) {
      issue(issues, "warning", "stale-evidence", `evidence.${id}`, `Evidence is older than ${maxAge} days.`);
    }
    if (record.expiresAt && new Date(record.expiresAt) < new Date()) issue(issues, "error", "expired-evidence", `evidence.${id}.expiresAt`, "Evidence has expired.");
    if (record.source?.type === "file") {
      if (!record.sha256) issue(issues, "error", "missing-evidence-hash", `evidence.${id}.sha256`, "File evidence requires a SHA-256 integrity hash.");
      let absolute;
      try {
        absolute = resolveInside(project.root, record.source.value);
      } catch (error) {
        issue(issues, "error", "path-escape", `evidence.${id}.source`, error.message);
        continue;
      }
      if (!(await exists(absolute))) {
        issue(issues, "error", "missing-evidence-file", `evidence.${id}.source`, `File not found: ${record.source.value}`);
      } else if (record.sha256) {
        try {
          await resolveExistingInside(project.root, record.source.value);
        } catch (error) {
          issue(issues, "error", "symlink-escape", `evidence.${id}.source`, error.message);
          continue;
        }
        const currentHash = await hashFile(absolute);
        if (currentHash !== record.sha256) issue(issues, "error", "evidence-changed", `evidence.${id}.sha256`, "Evidence file changed after capture.");
      }
    }
    scanSecrets(issues, record, `evidence.${id}`);
  }
}

async function validateSnapshot(project, task, issues) {
  const snapshotPath = contextPath(project, "snapshots", `${task.id}.json`);
  if (!(await exists(snapshotPath))) {
    issue(issues, "info", "no-snapshot", "snapshot", "No discovery snapshot. Run ctx hydrate before building.");
    return;
  }
  try {
    const snapshot = await readJson(snapshotPath);
    if (snapshot.taskHash !== hashValue(task)) issue(issues, "warning", "stale-snapshot", "snapshot", "Task changed after discovery. Run ctx hydrate again.");
  } catch (error) {
    issue(issues, "error", "invalid-snapshot", "snapshot", error.message);
  }
}

export async function inspectProject(project, task = null) {
  const issues = validateConfig(project.config);
  if (!task) return summarize(issues);
  issues.push(...validateTaskShape(task));
  await validatePaths(project, task, issues);
  await validateEvidenceRecords(project, task, issues);
  await validateSnapshot(project, task, issues);
  return summarize(issues);
}

export function summarize(issues) {
  const counts = { error: 0, warning: 0, info: 0 };
  issues.forEach((item) => {
    counts[item.severity] = (counts[item.severity] || 0) + 1;
  });
  return { ok: counts.error === 0, counts, issues };
}

export function formatDoctor(report) {
  if (!report.issues.length) return "✓ No issues found.";
  const symbols = { error: "✗", warning: "!", info: "·" };
  const lines = report.issues.map((item) => `${symbols[item.severity]} ${item.severity.toUpperCase()} ${item.code} ${item.path}: ${item.message}`);
  lines.push(`\n${report.counts.error} error(s), ${report.counts.warning} warning(s), ${report.counts.info} info`);
  return lines.join("\n");
}
