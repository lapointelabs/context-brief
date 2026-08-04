import path from "node:path";
import { contextPath } from "./project.js";
import {
  git,
  hashValue,
  isoNow,
  matchesAny,
  readJson,
  readText,
  truncate,
  walkFiles,
  writeJson
} from "./util.js";

const LANGUAGES = new Map([
  [".js", "javascript"], [".mjs", "javascript"], [".cjs", "javascript"],
  [".ts", "typescript"], [".mts", "typescript"], [".cts", "typescript"], [".tsx", "typescript"], [".jsx", "javascript"],
  [".py", "python"], [".go", "go"], [".rs", "rust"], [".rb", "ruby"], [".php", "php"],
  [".java", "java"], [".kt", "kotlin"], [".swift", "swift"], [".cs", "csharp"], [".cpp", "cpp"], [".c", "c"],
  [".md", "markdown"], [".mdc", "markdown"], [".json", "json"], [".yaml", "yaml"], [".yml", "yaml"],
  [".toml", "toml"], [".sh", "shell"], [".sql", "sql"], [".html", "html"], [".css", "css"]
]);

const MANIFESTS = new Set([
  "package.json", "pyproject.toml", "requirements.txt", "go.mod", "Cargo.toml", "Gemfile", "composer.json",
  "pom.xml", "build.gradle", "build.gradle.kts", "Package.swift", ".tool-versions", ".nvmrc", "Dockerfile"
]);

const STOP_WORDS = new Set([
  "about", "after", "agent", "before", "brief", "change", "context", "could", "from", "have", "into", "must",
  "should", "task", "that", "their", "there", "these", "this", "when", "where", "which", "with", "without"
]);

function languageFor(filePath) {
  return LANGUAGES.get(path.extname(filePath).toLowerCase()) || "other";
}

function taskTerms(task) {
  const source = [task.title, task.outcome, ...(task.scope?.in || []), ...(task.context?.contracts || [])].join(" ").toLowerCase();
  return [...new Set(source.match(/[a-z][a-z0-9_-]{3,}/g) || [])]
    .filter((term) => !STOP_WORDS.has(term))
    .slice(0, 30);
}

function importsFor(text, language) {
  if (!text) return [];
  const imports = new Set();
  const expressions = [];
  if (["javascript", "typescript"].includes(language)) {
    expressions.push(/(?:from\s+|require\s*\(|import\s*\()["']([^"']+)["']/g);
  } else if (language === "python") {
    expressions.push(/^\s*(?:from|import)\s+([A-Za-z0-9_.]+)/gm);
  } else if (language === "go") {
    expressions.push(/^\s*["`]([^"`]+)["`]\s*$/gm);
  } else if (language === "rust") {
    expressions.push(/^\s*(?:use|mod)\s+([^;{]+)/gm);
  }
  for (const expression of expressions) {
    for (const match of text.matchAll(expression)) imports.add(match[1].trim());
  }
  return [...imports].sort().slice(0, 200);
}

function isInstruction(relative, patterns) {
  const basename = path.posix.basename(relative);
  return basename === "AGENTS.md" || basename === "CLAUDE.md" || matchesAny(relative, patterns);
}

function isLikelyTest(relative) {
  return /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|(?:\.test|\.spec|_test)\.[^.]+$/i.test(relative);
}

function stem(relative) {
  return path.posix.basename(relative)
    .replace(/(?:\.test|\.spec|_test)?\.[^.]+$/i, "")
    .replace(/[-_.]/g, "")
    .toLowerCase();
}

async function readManifest(file) {
  if (path.posix.basename(file.relative) === "package.json") {
    try {
      const parsed = await readJson(file.absolute);
      return {
        path: file.relative,
        kind: "package.json",
        name: parsed.name,
        packageManager: parsed.packageManager,
        engines: parsed.engines || {},
        scripts: parsed.scripts || {},
        dependencies: Object.keys(parsed.dependencies || {}).sort(),
        devDependencies: Object.keys(parsed.devDependencies || {}).sort()
      };
    } catch (error) {
      return { path: file.relative, kind: "package.json", error: error.message };
    }
  }
  const text = await readText(file.absolute, 64_000);
  return { path: file.relative, kind: path.posix.basename(file.relative), preview: truncate(text || "", 3000) };
}

async function repositoryState(root) {
  const [head, branch, status, log] = await Promise.all([
    git(root, ["rev-parse", "HEAD"]),
    git(root, ["branch", "--show-current"]),
    git(root, ["status", "--porcelain"]),
    git(root, ["log", "-5", "--date=iso-strict", "--pretty=format:%H%x09%ad%x09%s"])
  ]);
  return {
    head,
    branch,
    dirty: Boolean(status),
    changedPaths: status ? status.split("\n").map((line) => line.slice(3).trim()).filter(Boolean) : [],
    recentCommits: log ? log.split("\n").map((line) => {
      const [commit, date, ...subject] = line.split("\t");
      return { commit, date, subject: subject.join("\t") };
    }) : []
  };
}

export async function discoverProject(project, task) {
  const configured = project.config.discovery;
  const allFiles = await walkFiles(project.root, {
    include: configured.include,
    exclude: configured.exclude,
    maxFileBytes: configured.maxFileBytes
  });
  const truncatedFiles = allFiles.length > configured.maxFiles;
  const sourceFiles = allFiles.slice(0, configured.maxFiles);
  const terms = taskTerms(task);
  const explicitPaths = [...(task.context?.entryPoints || []), ...(task.context?.relatedPaths || [])];
  const files = [];
  const candidates = [];
  const instructions = [];
  const manifests = [];

  for (const file of sourceFiles) {
    const language = languageFor(file.relative);
    const instruction = isInstruction(file.relative, configured.instructionFiles);
    const manifest = MANIFESTS.has(path.posix.basename(file.relative));
    const explicit = explicitPaths.some((candidate) => candidate === file.relative || matchesAny(file.relative, [candidate]));
    const test = isLikelyTest(file.relative);
    const shouldRead = instruction || manifest || explicit || language !== "other";
    const text = shouldRead ? await readText(file.absolute, configured.maxFileBytes) : null;
    const imports = importsFor(text, language);
    files.push({ path: file.relative, bytes: file.bytes, modifiedAt: file.modifiedAt, language, test, imports });

    if (instruction) {
      instructions.push({ path: file.relative, sha256: text ? hashValue(text) : null, content: truncate(text || "", 12_000) });
    }
    if (manifest) manifests.push(await readManifest(file));

    let score = 0;
    const reasons = [];
    if (explicit) { score += 100; reasons.push("named by task"); }
    if (instruction) { score += 60; reasons.push("project instructions"); }
    if (manifest) { score += 40; reasons.push("project manifest"); }
    const lowerPath = file.relative.toLowerCase();
    const pathTerms = terms.filter((term) => lowerPath.includes(term));
    if (pathTerms.length) { score += Math.min(40, pathTerms.length * 10); reasons.push(`path matches: ${pathTerms.join(", ")}`); }
    if (text && score < 100) {
      const lowerText = text.toLowerCase();
      const contentTerms = terms.filter((term) => lowerText.includes(term));
      if (contentTerms.length) { score += Math.min(24, contentTerms.length * 4); reasons.push(`content matches: ${contentTerms.slice(0, 5).join(", ")}`); }
    }
    if (score > 0) candidates.push({ path: file.relative, score, reasons });
  }

  const tests = files.filter((file) => file.test);
  const testMappings = files
    .filter((file) => !file.test && file.language !== "other")
    .map((file) => ({ source: file.path, tests: tests.filter((test) => stem(test.path) === stem(file.path)).map((test) => test.path) }))
    .filter((mapping) => mapping.tests.length);
  for (const mapping of testMappings) {
    const sourceCandidate = candidates.find((candidate) => candidate.path === mapping.source);
    if (!sourceCandidate) continue;
    for (const testPath of mapping.tests) {
      const existing = candidates.find((candidate) => candidate.path === testPath);
      if (existing) {
        existing.score += 30;
        existing.reasons.push(`tests ${mapping.source}`);
      } else {
        candidates.push({ path: testPath, score: 30, reasons: [`tests ${mapping.source}`] });
      }
    }
  }
  candidates.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));

  const repo = await repositoryState(project.root);
  return {
    schemaVersion: 1,
    task: task.id,
    taskHash: hashValue(task),
    configHash: hashValue(project.config),
    capturedAt: isoNow(),
    repository: repo,
    stats: {
      indexedFiles: files.length,
      totalEligibleFiles: allFiles.length,
      truncated: truncatedFiles,
      languages: Object.fromEntries([...new Set(files.map((file) => file.language))].sort().map((language) => [language, files.filter((file) => file.language === language).length]))
    },
    manifests,
    instructions,
    candidates: candidates.slice(0, 200),
    testMappings,
    files
  };
}

export async function hydrateTask(project, task) {
  const snapshot = await discoverProject(project, task);
  const filePath = contextPath(project, "snapshots", `${task.id}.json`);
  await writeJson(filePath, snapshot);
  return { snapshot, filePath };
}
