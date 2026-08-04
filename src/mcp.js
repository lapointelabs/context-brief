import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { compileTask } from "./compiler.js";
import { contextPath } from "./project.js";
import { formatDoctor, inspectProject } from "./doctor.js";
import { loadEvidence } from "./evidence.js";
import { listTasks, loadTask } from "./tasks.js";
import { exists } from "./util.js";
import { VERSION } from "./version.js";

async function listJson(directory) {
  if (!(await exists(directory))) return [];
  return (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
}

async function resources(project) {
  const output = [];
  for (const task of await listTasks(project)) {
    output.push({ uri: `ctx://task/${task.id}`, name: `Task: ${task.title}`, description: `Typed task ${task.id}`, mimeType: "application/json" });
  }
  for (const name of await listJson(contextPath(project, "evidence"))) {
    const id = name.slice(0, -5);
    output.push({ uri: `ctx://evidence/${id}`, name: `Evidence: ${id}`, mimeType: "application/json" });
  }
  for (const task of await listTasks(project)) {
    const directory = contextPath(project, "build", task.id);
    if (!(await exists(directory))) continue;
    for (const name of (await readdir(directory)).filter((item) => item.endsWith(".md")).sort()) {
      const target = name.slice(0, -3);
      output.push({ uri: `ctx://build/${task.id}/${target}`, name: `Compiled ${task.id} for ${target}`, mimeType: "text/markdown" });
    }
  }
  return output;
}

async function readResource(project, uri) {
  let match = uri.match(/^ctx:\/\/task\/([a-z0-9-]+)$/);
  if (match) return JSON.stringify((await loadTask(project, match[1])).task, null, 2);
  match = uri.match(/^ctx:\/\/evidence\/([a-z0-9-]+)$/);
  if (match) return JSON.stringify((await loadEvidence(project, match[1])).evidence, null, 2);
  match = uri.match(/^ctx:\/\/build\/([a-z0-9-]+)\/(codex|claude|cursor|generic)$/);
  if (match) return readFile(contextPath(project, "build", match[1], `${match[2]}.md`), "utf8");
  throw new Error(`Unknown resource: ${uri}`);
}

function toolDefinitions() {
  return [
    {
      name: "ctx_list_tasks",
      description: "List available context-brief tasks and their status.",
      inputSchema: { type: "object", additionalProperties: false },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    {
      name: "ctx_get_task",
      description: "Read one canonical typed task record.",
      inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string" } } },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    {
      name: "ctx_get_context",
      description: "Compile and return the current context artifact for a task and agent target.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: {
          id: { type: "string" },
          target: { enum: ["codex", "claude", "cursor", "generic"] },
          tokenBudget: { type: "integer", minimum: 1000 }
        }
      },
      annotations: { readOnlyHint: false, idempotentHint: true }
    },
    {
      name: "ctx_get_evidence",
      description: "Read an evidence record with provenance and integrity metadata.",
      inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string" } } },
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    {
      name: "ctx_doctor",
      description: "Validate a task, its evidence, paths, commands, secrets, and snapshot freshness.",
      inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string" } } },
      annotations: { readOnlyHint: true, idempotentHint: true }
    }
  ];
}

async function callTool(project, name, args = {}) {
  if (name === "ctx_list_tasks") return JSON.stringify(await listTasks(project), null, 2);
  if (name === "ctx_get_task") return JSON.stringify((await loadTask(project, args.id)).task, null, 2);
  if (name === "ctx_get_evidence") return JSON.stringify((await loadEvidence(project, args.id)).evidence, null, 2);
  if (name === "ctx_get_context") {
    const { task } = await loadTask(project, args.id);
    return (await compileTask(project, task, { target: args.target || "generic", tokenBudget: args.tokenBudget })).output;
  }
  if (name === "ctx_doctor") {
    const { task } = await loadTask(project, args.id);
    return formatDoctor(await inspectProject(project, task));
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function dispatch(project, message) {
  const { id, method, params = {} } = message;
  if (!method || method.startsWith("notifications/")) return null;
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params.protocolVersion || "2025-06-18",
        capabilities: { resources: { listChanged: false }, tools: { listChanged: false } },
        serverInfo: { name: "context-brief", version: VERSION }
      }
    };
  }
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "resources/list") return { jsonrpc: "2.0", id, result: { resources: await resources(project) } };
  if (method === "resources/read") {
    const text = await readResource(project, params.uri);
    return { jsonrpc: "2.0", id, result: { contents: [{ uri: params.uri, mimeType: params.uri.includes("/build/") ? "text/markdown" : "application/json", text }] } };
  }
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: toolDefinitions() } };
  if (method === "tools/call") {
    try {
      const text = await callTool(project, params.name, params.arguments || {});
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], isError: false } };
    } catch (error) {
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: error.message }], isError: true } };
    }
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}

export async function serveMcp(project, streams = { input: process.stdin, output: process.stdout }) {
  let buffer = Buffer.alloc(0);
  let framing = "newline";
  const send = (message) => {
    if (!message) return;
    const body = Buffer.from(JSON.stringify(message), "utf8");
    if (framing === "header") streams.output.write(`Content-Length: ${body.length}\r\n\r\n`);
    streams.output.write(body);
    if (framing === "newline") streams.output.write("\n");
  };

  async function handle(raw) {
    let message;
    try {
      message = JSON.parse(raw.toString("utf8"));
      send(await dispatch(project, message));
    } catch (error) {
      send({ jsonrpc: "2.0", id: message?.id ?? null, error: { code: -32700, message: error.message } });
    }
  }

  return new Promise((resolve, reject) => {
    let chain = Promise.resolve();
    streams.input.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      while (buffer.length) {
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (buffer.subarray(0, 15).toString("ascii").toLowerCase().startsWith("content-length:")) {
          if (headerEnd === -1) break;
          framing = "header";
          const header = buffer.subarray(0, headerEnd).toString("ascii");
          const length = Number(header.match(/content-length:\s*(\d+)/i)?.[1]);
          if (!Number.isFinite(length) || buffer.length < headerEnd + 4 + length) break;
          const body = buffer.subarray(headerEnd + 4, headerEnd + 4 + length);
          buffer = buffer.subarray(headerEnd + 4 + length);
          chain = chain.then(() => handle(body));
          continue;
        }
        const newline = buffer.indexOf("\n");
        if (newline === -1) break;
        framing = "newline";
        const body = buffer.subarray(0, newline).toString("utf8").trim();
        buffer = buffer.subarray(newline + 1);
        if (body) chain = chain.then(() => handle(Buffer.from(body)));
      }
    });
    streams.input.on("end", () => chain.then(resolve, reject));
    streams.input.on("error", reject);
  });
}
