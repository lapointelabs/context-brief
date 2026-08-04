import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const schemaDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "schemas");

function load(name) {
  return JSON.parse(readFileSync(path.join(schemaDirectory, `${name}.schema.json`), "utf8"));
}

export const CONFIG_SCHEMA = load("config");
export const TASK_SCHEMA = load("task");
export const EVIDENCE_SCHEMA = load("evidence");
export const RESULT_SCHEMA = load("result");

function childPath(parent, key) {
  if (typeof key === "number") return `${parent}[${key}]`;
  return parent === "$" ? `$.${key}` : `${parent}.${key}`;
}

function resolveReference(root, reference) {
  if (!reference.startsWith("#/")) throw new Error(`Only local schema references are supported: ${reference}`);
  return reference.slice(2).split("/").reduce((value, segment) => value?.[segment.replaceAll("~1", "/").replaceAll("~0", "~")], root);
}

function actualType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value === "object" ? "object" : typeof value;
}

function matchesType(value, expected) {
  if (expected === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (expected === "array") return Array.isArray(value);
  if (expected === "integer") return Number.isInteger(value);
  if (expected === "number") return typeof value === "number" && Number.isFinite(value);
  if (expected === "null") return value === null;
  return typeof value === expected;
}

function add(issues, keyword, pointer, message) {
  issues.push({ severity: "error", code: `schema-${keyword}`, path: pointer, message });
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function visit(value, schema, root, pointer, issues) {
  if (schema.$ref) {
    const resolved = resolveReference(root, schema.$ref);
    if (!resolved) add(issues, "ref", pointer, `Unresolved schema reference: ${schema.$ref}`);
    else visit(value, resolved, root, pointer, issues);
    return;
  }
  if (Object.hasOwn(schema, "const") && !equal(value, schema.const)) {
    add(issues, "const", pointer, `Must equal ${JSON.stringify(schema.const)}.`);
  }
  if (schema.enum && !schema.enum.some((candidate) => equal(value, candidate))) {
    add(issues, "enum", pointer, `Must be one of: ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}.`);
  }
  if (schema.type && !matchesType(value, schema.type)) {
    add(issues, "type", pointer, `Expected ${schema.type}; received ${actualType(value)}.`);
    return;
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) add(issues, "minLength", pointer, `Must contain at least ${schema.minLength} character(s).`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) add(issues, "pattern", pointer, `Does not match ${schema.pattern}.`);
    if (schema.format === "date-time" && (!value.includes("T") || Number.isNaN(Date.parse(value)))) add(issues, "format", pointer, "Must be a valid RFC 3339 date-time.");
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) add(issues, "minimum", pointer, `Must be at least ${schema.minimum}.`);
    if (schema.maximum !== undefined && value > schema.maximum) add(issues, "maximum", pointer, `Must be at most ${schema.maximum}.`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) add(issues, "minItems", pointer, `Must contain at least ${schema.minItems} item(s).`);
    if (schema.uniqueItems) {
      const seen = new Set();
      value.forEach((item, index) => {
        const encoded = JSON.stringify(item);
        if (seen.has(encoded)) add(issues, "uniqueItems", childPath(pointer, index), "Duplicate array item.");
        seen.add(encoded);
      });
    }
    if (schema.items) value.forEach((item, index) => visit(item, schema.items, root, childPath(pointer, index), issues));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties || {};
    for (const required of schema.required || []) {
      if (!Object.hasOwn(value, required)) add(issues, "required", childPath(pointer, required), "Required property is missing.");
    }
    for (const [key, child] of Object.entries(value)) {
      if (properties[key]) visit(child, properties[key], root, childPath(pointer, key), issues);
      else if (schema.additionalProperties === false) add(issues, "additionalProperties", childPath(pointer, key), "Unknown property is not allowed.");
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") visit(child, schema.additionalProperties, root, childPath(pointer, key), issues);
    }
  }
}

export function validateDocument(value, schema, pointer = "$") {
  const issues = [];
  visit(value, schema, schema, pointer, issues);
  return issues;
}
