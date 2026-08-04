import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { contextPath, TARGETS } from "./project.js";
import { inspectProject } from "./doctor.js";
import { loadEvidence } from "./evidence.js";
import { hydrateTask } from "./discover.js";
import { approximateTokens, exists, hashValue, readJson, truncate, writeJson } from "./util.js";

const TARGET_GUIDANCE = {
  codex: [
    "Read every applicable `AGENTS.md` from the repository root to each file before editing.",
    "Use repository tools to verify the live working tree; this artifact is a scoped map, not a substitute for inspection.",
    "Keep user changes intact and report only checks that actually ran."
  ],
  claude: [
    "Load the applicable `CLAUDE.md` and repository instructions before editing.",
    "Use repository tools to verify the live working tree; this artifact is a scoped map, not a substitute for inspection.",
    "Keep user changes intact and report only checks that actually ran."
  ],
  cursor: [
    "Apply matching `.cursor/rules/*.mdc` rules and repository instructions before editing.",
    "Inspect referenced symbols and call sites in the live working tree before proposing a change.",
    "Keep user changes intact and report only checks that actually ran."
  ],
  generic: [
    "Inspect the live repository before changing code; do not treat this artifact as a complete file bundle.",
    "Resolve missing context explicitly instead of inventing requirements.",
    "Keep user changes intact and report only checks that actually ran."
  ]
};

function bullets(items, empty = "- None recorded.") {
  return items?.length ? items.map((item) => `- ${item}`).join("\n") : empty;
}

function numbered(items) {
  return items?.length ? items.map((item, index) => `${index + 1}. ${item}`).join("\n") : "1. None recorded.";
}

function section(title, body) {
  return `## ${title}\n\n${body}\n`;
}

class Budget {
  constructor(limit) {
    this.limit = limit;
    this.parts = [];
    this.omitted = [];
  }

  add(name, content, required = false) {
    const next = [...this.parts, content].join("\n");
    if (!required && approximateTokens(next) > this.limit - 100) {
      this.omitted.push(name);
      return false;
    }
    this.parts.push(content);
    return true;
  }

  text() {
    if (this.omitted.length) {
      this.parts.push(section("Budget note", `Omitted optional sections: ${this.omitted.join(", ")}. Query the repository or MCP resources on demand.`));
    }
    return `${this.parts.join("\n").trim()}\n`;
  }
}

async function getSnapshot(project, task, refresh) {
  const snapshotPath = contextPath(project, "snapshots", `${task.id}.json`);
  if (!refresh && await exists(snapshotPath)) {
    const snapshot = await readJson(snapshotPath);
    if (snapshot.taskHash === hashValue(task) && snapshot.configHash === hashValue(project.config)) return { snapshot, snapshotPath };
  }
  const { snapshot, filePath } = await hydrateTask(project, task);
  return { snapshot, snapshotPath: filePath };
}

async function evidenceFor(project, task) {
  const records = [];
  for (const id of task.evidence || []) records.push((await loadEvidence(project, id)).evidence);
  return records;
}

function evidenceMarkdown(records) {
  if (!records.length) return "No evidence records are attached.";
  return records.map((record) => {
    const details = [
      `- Kind: ${record.kind}`,
      `- Summary: ${record.summary}`,
      `- Captured: ${record.capturedAt}`,
      `- Source: ${record.source.type} — ${record.source.value}`,
      `- Sensitivity: ${record.sensitivity}`,
      ...(record.sha256 ? [`- SHA-256: \`${record.sha256}\``] : []),
      ...(record.expiresAt ? [`- Expires: ${record.expiresAt}`] : [])
    ];
    if (record.excerpt && !["confidential", "restricted"].includes(record.sensitivity)) {
      details.push(`\nExcerpt:\n\n\`\`\`text\n${truncate(record.excerpt, 3000)}\n\`\`\``);
    } else if (record.excerpt) {
      details.push("\nExcerpt omitted from compiled output because of its sensitivity classification.");
    }
    return `### ${record.id}\n\n${details.join("\n")}`;
  }).join("\n\n");
}

function candidateMarkdown(snapshot, maximum = 50) {
  if (!snapshot.candidates.length) return "No relevant files were discovered. Inspect the repository before proceeding.";
  return snapshot.candidates.slice(0, maximum).map((candidate) =>
    `- \`${candidate.path}\` — score ${candidate.score}; ${candidate.reasons.join("; ")}`
  ).join("\n");
}

function manifestMarkdown(snapshot) {
  if (!snapshot.manifests.length) return "No recognized manifests were found.";
  return snapshot.manifests.map((manifest) => {
    const lines = [`### \`${manifest.path}\``];
    if (manifest.name) lines.push(`- Package: ${manifest.name}`);
    if (manifest.packageManager) lines.push(`- Package manager: ${manifest.packageManager}`);
    if (manifest.engines && Object.keys(manifest.engines).length) lines.push(`- Engines: \`${JSON.stringify(manifest.engines)}\``);
    if (manifest.scripts && Object.keys(manifest.scripts).length) lines.push(`- Scripts: ${Object.keys(manifest.scripts).map((name) => `\`${name}\``).join(", ")}`);
    if (manifest.preview) lines.push(`\n\`\`\`text\n${manifest.preview}\n\`\`\``);
    if (manifest.error) lines.push(`- Parse error: ${manifest.error}`);
    return lines.join("\n");
  }).join("\n\n");
}

function instructionMarkdown(snapshot) {
  if (!snapshot.instructions.length) return "No native agent instruction files were discovered.";
  return snapshot.instructions.map((instruction) =>
    `### \`${instruction.path}\`\n\nSource digest: \`${instruction.sha256}\`\n\n\`\`\`markdown\n${instruction.content}\n\`\`\``
  ).join("\n\n");
}

function verificationMarkdown(task) {
  const commands = task.verification.commands.length
    ? task.verification.commands.map((command) => `- **${command.name}:** \`${command.run}\`${command.cwd ? ` (from \`${command.cwd}\`)` : ""}`).join("\n")
    : "- No automated commands recorded.";
  return `### Commands\n\n${commands}\n\n### Manual checks\n\n${numbered(task.verification.manual)}`;
}

function unknownsMarkdown(unknowns) {
  if (!unknowns.length) return "No unknowns recorded.";
  return unknowns.map((unknown, index) => [
    `### Unknown ${index + 1}`,
    `- Question: ${unknown.question || "Not stated"}`,
    `- Working assumption: ${unknown.assumption || "None"}`,
    `- Stop when: ${unknown.stopWhen || "Not stated"}`
  ].join("\n")).join("\n\n");
}

export async function compileTask(project, task, options = {}) {
  const target = options.target || "generic";
  if (!TARGETS.includes(target)) throw new Error(`Unsupported target: ${target}`);
  const report = await inspectProject(project, task);
  if (!report.ok && !options.force) {
    const errors = report.issues.filter((item) => item.severity === "error").map((item) => `${item.code}: ${item.message}`);
    throw new Error(`Task has validation errors. Run ctx doctor ${task.id}.\n${errors.join("\n")}`);
  }
  const { snapshot, snapshotPath } = await getSnapshot(project, task, options.refresh);
  const evidence = await evidenceFor(project, task);
  const tokenBudget = Number(options.tokenBudget || project.config.policies.tokenBudget || 12000);
  if (!Number.isInteger(tokenBudget) || tokenBudget < 1000) throw new Error("Token budget must be an integer of at least 1000.");
  const budget = new Budget(tokenBudget);
  const header = [
    `# Context brief: ${task.title}`,
    "",
    `> Compiled for **${target}** from task \`${task.id}\`.`,
    `> Task digest: \`${hashValue(task)}\`. Snapshot: ${snapshot.capturedAt}.`,
    "> Repository files and live runtime evidence remain the source of truth.",
    ""
  ].join("\n");
  budget.add("header", header, true);
  budget.add("target guidance", section("Agent contract", bullets(TARGET_GUIDANCE[target])), true);
  budget.add("outcome", section("Outcome", task.outcome), true);
  if (task.why) budget.add("why", section("Why this matters", task.why), true);
  budget.add("behavior", section("Behavior", `### Current\n\n${bullets(task.behavior.current)}\n\n### Expected\n\n${bullets(task.behavior.expected)}`), true);
  budget.add("scope", section("Scope", `### In scope\n\n${bullets(task.scope.in)}\n\n### Out of scope\n\n${bullets(task.scope.out)}`), true);
  budget.add("constraints", section("Constraints and protected paths", `${bullets(task.constraints)}\n\nProtected paths:\n\n${bullets(task.protectedPaths)}`), true);
  budget.add("acceptance", section("Acceptance criteria", task.acceptance.map((item) => `- [ ] **${item.id}** (${item.verification}) — ${item.criterion}`).join("\n")), true);
  budget.add("verification", section("Verification", verificationMarkdown(task)), true);
  budget.add("unknowns", section("Unknowns and stop conditions", unknownsMarkdown(task.unknowns)), true);
  budget.add("evidence", section("Evidence with provenance", evidenceMarkdown(evidence)), true);
  budget.add("delivery", section("Required handoff", bullets(task.delivery.required)), true);

  const repo = snapshot.repository;
  budget.add("repository state", section("Repository state", [
    `- Commit: ${repo.head ? `\`${repo.head}\`` : "not a git repository"}`,
    `- Branch: ${repo.branch || "unknown"}`,
    `- Working tree dirty at discovery: ${repo.dirty ? "yes" : "no"}`,
    `- Indexed files: ${snapshot.stats.indexedFiles}${snapshot.stats.truncated ? ` of ${snapshot.stats.totalEligibleFiles} (limit reached)` : ""}`,
    `- Languages: ${Object.entries(snapshot.stats.languages).map(([name, count]) => `${name} ${count}`).join(", ")}`
  ].join("\n")));
  budget.add("relevant files", section("Discovered context map", candidateMarkdown(snapshot)));
  budget.add("manifests", section("Runtime and command manifests", manifestMarkdown(snapshot)));
  budget.add("native instructions", section("Native repository instructions", instructionMarkdown(snapshot)));
  const output = budget.text();
  if (approximateTokens(output) > tokenBudget) {
    throw new Error(`Required task context exceeds the ${tokenBudget}-token budget. Shorten the canonical task or raise --tokens; required semantics will not be silently truncated.`);
  }

  const outputDirectory = contextPath(project, "build", task.id);
  const outputPath = path.join(outputDirectory, `${target}.md`);
  const manifestPath = path.join(outputDirectory, `${target}.manifest.json`);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, output, "utf8");
  const manifest = {
    schemaVersion: 1,
    task: task.id,
    target,
    taskHash: hashValue(task),
    configHash: hashValue(project.config),
    snapshot: path.relative(project.metadataRoot, snapshotPath).split(path.sep).join("/"),
    snapshotCapturedAt: snapshot.capturedAt,
    outputHash: hashValue(output),
    approximateTokens: approximateTokens(output),
    tokenBudget,
    omittedSections: budget.omitted,
    selectedPaths: snapshot.candidates.slice(0, 50).map((candidate) => candidate.path),
    evidence: evidence.map((record) => record.id),
    validation: report.counts
  };
  await writeJson(manifestPath, manifest);
  return { output, outputPath, manifest, manifestPath, report };
}
