# Architecture

Context Brief treats context as a small compilation pipeline instead of an ever-growing prompt.

## Design goals

1. **Deterministic before probabilistic.** Paths, manifests, imports, tests, git state, and task terms are inspectable inputs. Semantic retrieval can be added later without becoming the only explanation for why a file was selected.
2. **Native instructions remain authoritative.** `AGENTS.md`, `CLAUDE.md`, and Cursor rules are discovered, not replaced.
3. **Provenance travels with evidence.** Evidence is useful only when its source, capture time, sensitivity, and integrity are known.
4. **Compilation is bounded.** Each target has a token budget. Required task semantics are preserved; optional repository detail is omitted with an explicit note.
5. **Execution requires authority.** Discovery and compilation do not run task commands. Verification is a separate, explicit action.
6. **Results map back to intent.** Acceptance IDs survive from the task into the completion record.

## Components

### Onboarding orchestrator

`ctx start` is the user-facing composition layer. It discovers or safely initializes the project, detects runtime and agent clients, creates or imports a task, supplies repository-derived entry points and verification commands, hydrates, validates, and compiles one selected target. Each underlying command remains available for automation and debugging, but users do not need to learn the pipeline before receiving a useful artifact.

Initialization is idempotent: existing configuration and task data are preserved, bundled editor schemas are refreshed, and only missing generated-artifact entries are appended to `.gitignore`.

MCP onboarding uses the installed Codex and Claude CLIs instead of generating their configuration formats directly. Cursor's CLI exposes management for servers configured in `.cursor/mcp.json` but no add command, so Context Brief performs an atomic merge into that project-local file while preserving unrelated servers.

### Typed records

JSON is the canonical representation because it is unambiguous, available in every supported runtime, and works with JSON Schema-aware editors. Human-readable Markdown is generated from those records.

Four versioned schemas describe configuration, tasks, evidence, and results. The CLI also performs semantic validation that JSON Schema cannot express conveniently, including file existence, evidence hashes, age policies, task/snapshot agreement, and scope overlap.

### Repository discovery

`ctx hydrate` walks the configured root while honoring include, exclude, byte, and file-count limits. It captures:

- manifests and runnable package scripts;
- native agent instructions;
- language and import metadata;
- likely source/test relationships;
- scored task candidates with human-readable reasons;
- git commit, branch, dirty paths, and recent history.

Snapshots include hashes of the task and configuration. `doctor` detects when either has changed.

### Compiler

The compiler joins the task, evidence, snapshot, policies, and target adapter. Required semantics—outcome, behavior, scope, constraints, acceptance, verification, unknowns, evidence, and handoff—are never silently dropped. Optional repository sections consume the remaining token budget.

Every Markdown output has a machine-readable manifest recording its inputs, output digest, selected paths, approximate tokens, omissions, and validation state.

### MCP server

The stdio server exposes the same canonical graph without forcing a client to ingest a complete build up front. Resources provide task, evidence, and compiled artifacts. Tools list tasks, fetch individual records, compile context, and validate a task.

The implementation deliberately avoids an SDK dependency. It supports JSON-RPC over newline-delimited stdio and `Content-Length` framing, negotiates the client's protocol version, and keeps stdout reserved for protocol messages.

### Verification and result records

Verification commands live in the task but remain inert until `ctx verify --run`. Runs capture exact commands, cwd, time, exit status, timeout state, stdout, stderr, task digest, and repository commit.

The result schema is the final accountability boundary. It records changed files, per-acceptance status and evidence, verification-run references, remaining risks, and completion time.

## Extension points

The current release keeps extension points explicit and small:

- add an importer in `src/importers.js`;
- add a target contract in `src/compiler.js`;
- add language import extraction in `src/discover.js`;
- add semantic rules to `src/doctor.js`;
- add read-oriented MCP tools in `src/mcp.js`.

Future adapters should preserve the canonical schemas rather than inventing parallel task formats.
