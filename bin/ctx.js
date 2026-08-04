#!/usr/bin/env node

import { run } from "../src/cli.js";

run(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`ctx: ${error.message}\n`);
  if (process.env.CTX_DEBUG === "1" && error.stack) {
    process.stderr.write(`${error.stack}\n`);
  }
  process.exitCode = 1;
});
