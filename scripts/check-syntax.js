import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess } from "../src/util.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directories = ["src", "bin", "scripts", "test"];
const files = [];
for (const directory of directories) {
  const absolute = path.join(root, directory);
  try {
    for (const name of await readdir(absolute, { recursive: true })) {
      if (name.endsWith(".js")) files.push(path.join(absolute, name));
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
for (const file of files.sort()) {
  const result = await runProcess(process.execPath, ["--check", file], { cwd: root });
  if (result.code !== 0) {
    process.stderr.write(result.stderr);
    process.exitCode = 1;
  }
}
if (!process.exitCode) process.stdout.write(`Checked ${files.length} JavaScript files.\n`);
