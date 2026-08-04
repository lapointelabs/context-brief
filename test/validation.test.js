import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateConfig, validateTaskShape } from "../src/doctor.js";
import { importGithubTask } from "../src/importers.js";
import { defaultConfig, initializeProject, loadProject } from "../src/project.js";
import { matchesAny } from "../src/util.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the worked example satisfies the canonical task shape", async () => {
  const task = JSON.parse(await readFile(path.join(root, "examples", "upload-error.task.json"), "utf8"));
  assert.deepEqual(validateTaskShape(task), []);
});

test("default configuration satisfies semantic validation", () => {
  assert.deepEqual(validateConfig(defaultConfig("sample")), []);
});

test("semantic validation catches scope conflicts and likely secrets", async () => {
  const task = JSON.parse(await readFile(path.join(root, "examples", "upload-error.task.json"), "utf8"));
  task.scope.out.push(task.scope.in[0]);
  task.constraints.push("api_key='not-a-real-secret-value'");
  const issues = validateTaskShape(task);
  assert.ok(issues.some((issue) => issue.code === "scope-conflict"));
  assert.ok(issues.some((issue) => issue.code === "possible-secret"));
});

test("schema validation rejects unknown properties and malformed nested records", async () => {
  const task = JSON.parse(await readFile(path.join(root, "examples", "upload-error.task.json"), "utf8"));
  task.magicPrompt = true;
  task.acceptance[0].verification = "probably";
  const issues = validateTaskShape(task);
  assert.ok(issues.some((issue) => issue.code === "schema-additionalProperties" && issue.path === "$.magicPrompt"));
  assert.ok(issues.some((issue) => issue.code === "schema-enum" && issue.path.endsWith("acceptance[0].verification")));
});

test("glob matching handles root files, recursive patterns, and directory exclusions", () => {
  assert.equal(matchesAny("README.md", ["**/*"]), true);
  assert.equal(matchesAny(".cursor/rules/frontend.mdc", [".cursor/rules/**/*.mdc"]), true);
  assert.equal(matchesAny(".git/objects/abc", [".git"]), true);
  assert.equal(matchesAny("src/index.js", ["test/**/*.js"]), false);
});

test("imports a GitHub issue into the canonical task model", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "context-brief-import-"));
  await initializeProject(directory, { name: "import-test" });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    title: "Handle an expired session",
    body: "Users should be sent through the existing sign-in flow.",
    html_url: "https://github.com/example/project/issues/42"
  }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    const project = await loadProject(directory);
    const { task } = await importGithubTask(project, "github:example/project#42");
    assert.equal(task.id, "gh-42-handle-an-expired-session");
    assert.equal(task.source.type, "github");
    assert.deepEqual(validateTaskShape(task), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
