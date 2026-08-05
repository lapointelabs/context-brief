import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runProcess } from "../src/util.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(packageRoot, "bin", "ctx.js");

async function run(args, cwd, expectedCode = 0) {
  const result = await runProcess(process.execPath, [cli, ...args], { cwd, timeoutMs: 20_000 });
  assert.equal(result.code, expectedCode, `ctx ${args.join(" ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result;
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "context-brief-test-"));
  await run(["init", ".", "--name", "fixture"], root);
  await writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "fixture",
    type: "module",
    scripts: { test: "node --test" }
  }, null, 2));
  await writeFile(path.join(root, "AGENTS.md"), "# Fixture rules\n\nRun tests before handoff.\n");
  await mkdir(path.join(root, "src"));
  await mkdir(path.join(root, "test"));
  await writeFile(path.join(root, "src", "add.js"), "export const add = (left, right) => left + right;\n");
  await writeFile(path.join(root, "test", "add.test.js"), [
    "import assert from 'node:assert/strict';",
    "import test from 'node:test';",
    "import { add } from '../src/add.js';",
    "test('adds', () => assert.equal(add(2, 3), 5));",
    ""
  ].join("\n"));
  await run(["task", "create", "add-numbers", "--title", "Add numbers reliably"], root);
  const taskPath = path.join(root, ".context", "tasks", "add-numbers.json");
  const task = JSON.parse(await readFile(taskPath, "utf8"));
  Object.assign(task, {
    status: "ready",
    outcome: "Calling add with two numbers returns their sum.",
    why: "Consumers rely on deterministic arithmetic.",
    behavior: { current: ["The function exists."], expected: ["The function returns the sum."] },
    context: { entryPoints: ["src/add.js"], relatedPaths: ["test/add.test.js"], contracts: ["add(left, right)"] },
    scope: { in: ["The add function"], out: ["Other arithmetic operations"] },
    constraints: ["Keep the public export stable."],
    protectedPaths: ["package.json"],
    acceptance: [{ id: "AC-1", criterion: "The focused test passes.", verification: "automated" }],
    verification: { commands: [{ name: "focused test", run: "node --test test/add.test.js", timeoutSeconds: 30 }], manual: [] },
    unknowns: [],
    delivery: { required: ["Report the test result."] }
  });
  await writeFile(taskPath, `${JSON.stringify(task, null, 2)}\n`);
  await writeFile(path.join(root, "failure.log"), "Expected 5, received 4\n");
  await run([
    "evidence", "add", "add-numbers", "--id", "addition-failure", "--kind", "test-output",
    "--summary", "The focused assertion failed before the fix.", "--file", "failure.log", "--sensitivity", "internal"
  ], root);
  return root;
}

test("prints a concise version for installation smoke checks", async () => {
  const result = await run(["--version"], packageRoot);
  assert.match(result.stdout, /^0\.2\.2\n$/);
});

test("initializes a self-contained project with editor schemas", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "context-brief-init-"));
  await run(["init", ".", "--name", "sample"], root);
  const config = JSON.parse(await readFile(path.join(root, ".context", "config.json"), "utf8"));
  assert.equal(config.project.name, "sample");
  assert.equal(config.$schema, "./schemas/config.schema.json");
  for (const schema of ["config", "task", "evidence", "result"]) {
    assert.equal(JSON.parse(await readFile(path.join(root, ".context", "schemas", `${schema}.schema.json`), "utf8")).$schema, "https://json-schema.org/draft/2020-12/schema");
  }
});

test("starts a useful task in one command with detected defaults", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "context-brief-start-"));
  await runProcess("git", ["init", "-q"], { cwd: root });
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "index.js"), "export const ready = true;\n");
  await writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "onboarding-fixture",
    main: "src/index.js",
    scripts: { test: "node --test", lint: "node --check src/index.js" }
  }, null, 2));

  const started = await run([
    "start", "ship-onboarding", "--title", "Ship polished onboarding",
    "--outcome", "A new user produces a validated brief in one command.",
    "--target", "generic", "--yes"
  ], root);
  assert.match(started.stdout, /Initialized \.context\/config\.json/);
  assert.match(started.stdout, /Created task ship-onboarding/);
  assert.match(started.stdout, /Ready\./);

  const config = JSON.parse(await readFile(path.join(root, ".context", "config.json"), "utf8"));
  assert.equal(config.project.name, "onboarding-fixture");
  const task = JSON.parse(await readFile(path.join(root, ".context", "tasks", "ship-onboarding.json"), "utf8"));
  assert.deepEqual(task.context.entryPoints, ["src/index.js"]);
  assert.deepEqual(task.verification.commands.map((command) => command.run), ["npm run test", "npm run lint"]);
  assert.equal(task.outcome, "A new user produces a validated brief in one command.");
  assert.ok((await readFile(path.join(root, ".gitignore"), "utf8")).includes(".context/build/"));
  assert.match(await readFile(path.join(root, ".context", "build", "ship-onboarding", "generic.md"), "utf8"), /Ship polished onboarding/);

  const resumed = await run(["start", "ship-onboarding", "--target", "generic", "--yes"], root);
  assert.match(resumed.stdout, /Loaded task ship-onboarding/);
  const initialized = await run(["init"], root);
  assert.match(initialized.stdout, /Already initialized; refreshed schemas/);
  const ignored = (await readFile(path.join(root, ".gitignore"), "utf8")).split(/\r?\n/);
  assert.equal(ignored.filter((line) => line === ".context/build/").length, 1);
});

test("previews MCP setup and safely merges Cursor project configuration", async () => {
  const root = await fixture();
  const preview = await run(["mcp", "show", "cursor"], root);
  assert.match(preview.stdout, /Preview only/);
  await assert.rejects(readFile(path.join(root, ".cursor", "mcp.json"), "utf8"), (error) => error.code === "ENOENT");
  await mkdir(path.join(root, ".cursor"));
  await writeFile(path.join(root, ".cursor", "mcp.json"), `${JSON.stringify({ mcpServers: { existing: { command: "existing" } } }, null, 2)}\n`);
  const applied = await run(["mcp", "install", "cursor"], root);
  assert.match(applied.stdout, /Configured context-brief-fixture/);
  const config = JSON.parse(await readFile(path.join(root, ".cursor", "mcp.json"), "utf8"));
  assert.equal(config.mcpServers.existing.command, "existing");
  assert.equal(config.mcpServers["context-brief-fixture"].command, process.execPath);
  assert.ok(config.mcpServers["context-brief-fixture"].args.includes("serve"));
});

test("hydrates, validates, compiles, verifies, and scaffolds a result", async () => {
  const root = await fixture();
  const hydrate = await run(["hydrate", "add-numbers"], root);
  assert.match(hydrate.stdout, /Selected \d+ context candidates/);

  const doctor = await run(["doctor", "add-numbers", "--json"], root);
  const report = JSON.parse(doctor.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.counts.error, 0);

  const build = await run(["build", "add-numbers", "--target", "codex"], root);
  assert.match(build.stdout, /Built codex/);
  const compiled = await readFile(path.join(root, ".context", "build", "add-numbers", "codex.md"), "utf8");
  assert.match(compiled, /# Context brief: Add numbers reliably/);
  assert.match(compiled, /Evidence with provenance/);
  assert.match(compiled, /`src\/add.js`/);
  assert.match(compiled, /Read every applicable `AGENTS\.md`/);
  const manifest = JSON.parse(await readFile(path.join(root, ".context", "build", "add-numbers", "codex.manifest.json"), "utf8"));
  assert.equal(manifest.task, "add-numbers");
  assert.ok(manifest.approximateTokens <= manifest.tokenBudget);
  await run(["build", "add-numbers"], root);
  for (const target of ["codex", "claude", "cursor", "generic"]) {
    assert.match(await readFile(path.join(root, ".context", "build", "add-numbers", `${target}.md`), "utf8"), new RegExp(`Compiled for \\*\\*${target}\\*\\*`));
  }

  const dryRun = await run(["verify", "add-numbers"], root);
  assert.match(dryRun.stdout, /Dry run/);
  const verified = await run(["verify", "add-numbers", "--run"], root);
  assert.match(verified.stdout, /PASS focused test/);

  await run(["result", "scaffold", "add-numbers"], root);
  const resultPath = path.join(root, ".context", "results", "add-numbers.json");
  const result = JSON.parse(await readFile(resultPath, "utf8"));
  assert.deepEqual(result.acceptance, [{ id: "AC-1", status: "not-run", evidence: "" }]);
  const validation = await run(["result", "validate", "add-numbers", "--json"], root);
  assert.equal(JSON.parse(validation.stdout).ok, true);

  result.status = "complete";
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  const incomplete = await run(["result", "validate", "add-numbers", "--json"], root, 1);
  assert.ok(JSON.parse(incomplete.stdout).issues.some((issue) => issue.code === "incomplete-acceptance"));
});

test("detects evidence tampering and refuses compilation", async () => {
  const root = await fixture();
  await run(["hydrate", "add-numbers"], root);
  await writeFile(path.join(root, "failure.log"), "mutated evidence\n");
  const doctor = await run(["doctor", "add-numbers", "--json"], root, 1);
  const report = JSON.parse(doctor.stdout);
  assert.ok(report.issues.some((issue) => issue.code === "evidence-changed"));
  const build = await run(["build", "add-numbers", "--target", "codex"], root, 1);
  assert.match(build.stderr, /validation errors/i);
});

test("rejects evidence that escapes the project through a symbolic link", async () => {
  const root = await fixture();
  const outside = await mkdtemp(path.join(os.tmpdir(), "context-brief-outside-"));
  await writeFile(path.join(outside, "external.log"), "outside project\n");
  await symlink(outside, path.join(root, "linked-outside"));
  const result = await run([
    "evidence", "add", "add-numbers", "--id", "escaped-evidence", "--kind", "log",
    "--summary", "Should be rejected.", "--file", "linked-outside/external.log"
  ], root, 1);
  assert.match(result.stderr, /symbolic link/i);
});

test("serves tasks and tools over newline-framed MCP stdio", async () => {
  const root = await fixture();
  const child = spawn(process.execPath, [cli, "serve"], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "";
  const messages = [];
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) messages.push(JSON.parse(line));
    }
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
  const deadline = Date.now() + 5000;
  while (messages.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  child.stdin.end();
  await once(child, "exit");
  assert.equal(messages[0].result.serverInfo.name, "context-brief");
  assert.ok(messages[1].result.tools.some((tool) => tool.name === "ctx_get_context"));
});

test("accepts Content-Length framed MCP stdio", async () => {
  const root = await fixture();
  const child = spawn(process.execPath, [cli, "serve"], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  const message = JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping", params: {} });
  child.stdin.end(`Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`);
  await once(child, "exit");
  const [header, body] = stdout.split("\r\n\r\n");
  assert.match(header, /^Content-Length: \d+$/);
  assert.deepEqual(JSON.parse(body), { jsonrpc: "2.0", id: 7, result: {} });
});
