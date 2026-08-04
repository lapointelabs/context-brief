import path from "node:path";
import { contextPath } from "./project.js";
import { loadTask } from "./tasks.js";
import { exists, flagList, hashFile, isoNow, readJson, resolveExistingInside, resolveInside, slugify, writeJson } from "./util.js";

const KINDS = new Set([
  "log",
  "screenshot",
  "trace",
  "test-output",
  "support-report",
  "request-response",
  "observation",
  "other"
]);
const SENSITIVITIES = new Set(["public", "internal", "confidential", "restricted"]);

export async function loadEvidence(project, id) {
  const filePath = contextPath(project, "evidence", `${id}.json`);
  if (!(await exists(filePath))) throw new Error(`Evidence not found: ${id}`);
  return { evidence: await readJson(filePath), filePath };
}

export async function addEvidence(project, taskId, options) {
  const { task, filePath: taskPath } = await loadTask(project, taskId);
  const kind = options.kind || "observation";
  const sensitivity = options.sensitivity || "internal";
  if (!KINDS.has(kind)) throw new Error(`Unsupported evidence kind: ${kind}`);
  if (!SENSITIVITIES.has(sensitivity)) throw new Error(`Unsupported sensitivity: ${sensitivity}`);
  if (!options.summary) throw new Error("Evidence requires --summary.");

  const sources = [options.file && "file", options.url && "url", options.command && "command", options.note && "manual"].filter(Boolean);
  if (sources.length !== 1) throw new Error("Provide exactly one source: --file, --url, --command, or --note.");
  const sourceType = sources[0];
  let sourceValue = options[sourceType === "manual" ? "note" : sourceType];
  let sha256;
  if (sourceType === "file") {
    const lexical = resolveInside(project.root, sourceValue);
    if (!(await exists(lexical))) throw new Error(`Evidence file does not exist: ${sourceValue}`);
    const absolute = await resolveExistingInside(project.root, sourceValue);
    sourceValue = path.relative(project.root, lexical).split(path.sep).join("/");
    sha256 = await hashFile(absolute);
  }

  const suffix = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const id = options.id || slugify(`${taskId}-${kind}-${suffix}`);
  if (!id) throw new Error("Could not derive an evidence id; provide --id.");
  const evidencePath = contextPath(project, "evidence", `${id}.json`);
  if (await exists(evidencePath)) throw new Error(`Evidence ${id} already exists; provide a unique --id.`);

  let expiresAt;
  if (options.expires) {
    const parsed = new Date(options.expires);
    if (Number.isNaN(parsed.valueOf())) throw new Error(`Invalid --expires value: ${options.expires}`);
    expiresAt = parsed.toISOString();
  }

  const record = {
    $schema: "../schemas/evidence.schema.json",
    schemaVersion: 1,
    id,
    task: taskId,
    kind,
    summary: options.summary,
    source: { type: sourceType, value: String(sourceValue) },
    capturedAt: isoNow(),
    ...(expiresAt ? { expiresAt } : {}),
    ...(sha256 ? { sha256 } : {}),
    sensitivity,
    ...(options.excerpt ? { excerpt: options.excerpt } : {}),
    ...(flagList(options, "redaction").length ? { redactions: flagList(options, "redaction") } : {})
  };
  await writeJson(evidencePath, record);
  task.evidence = [...new Set([...(task.evidence || []), id])];
  await writeJson(taskPath, task);
  return { record, evidencePath, taskPath };
}
