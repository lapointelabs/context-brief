# Context template for Claude Code

A context template for Claude Code, Cursor, ChatGPT, and coding agents. Context Brief is a schema-backed context compiler that turns a task, live repository structure, native project instructions, and provenance-tracked evidence into a validated, target-specific execution brief for prompt engineering and context engineering workflows.

It supports Codex, Claude Code, Cursor, generic repository-aware agents, and on-demand access over MCP. The CLI has no runtime dependencies beyond Node.js 20.1 or newer.

Created by [Marc Lapointe](https://lapointelabs.com/about) at [Lapointe Labs](https://lapointelabs.com).

## Why this exists

Most disappointing AI-assisted work is not a prompting problem. It is a missing-context problem.

Copying one file into a chat hides imports, versions, conventions, tests, and the reason the code exists. Giving an agent the whole repository without a clear task creates a different failure: the model can see everything but does not know what matters, what is safe to change, or how success will be judged.

A useful context brief sits between those extremes. It records the outcome, evidence, boundaries, and verification steps for one piece of work.

The original version of this project stopped there: it was a Markdown template. This version makes the brief executable infrastructure:

- JSON Schema provides a versioned contract for tasks, evidence, configuration, and results.
- Repository discovery indexes manifests, languages, imports, tests, instructions, git state, and task-relevant paths.
- Evidence records include provenance, timestamps, sensitivity, expiration, and content hashes.
- `ctx doctor` detects missing paths, stale snapshots, changed evidence, scope conflicts, dangerous verification commands, and likely secrets.
- Target adapters compile different contracts for Codex, Claude Code, Cursor, and generic agents.
- `ctx verify` runs only with explicit authorization and stores the real command results.
- `ctx serve` exposes tasks, evidence, compiled context, and validation through MCP.

Markdown is now a compiled view, not the source of truth.

## Quick start

Run without installing globally:

```sh
npx --yes @lapointelabs/context-brief start
```

Or install the CLI once:

```sh
npm install --global @lapointelabs/context-brief
cd /path/to/your/project
ctx start
```

`ctx start` detects the project, initializes `.context`, suggests existing verification commands, asks for the outcome and scope, selects an installed agent, validates the task, and produces the first compiled brief.

For an unattended or issue-driven workflow:

```sh
ctx start upload-error \
  --title "Explain rejected uploads before submission" \
  --outcome "Oversized images are rejected before upload with a specific message." \
  --target codex \
  --yes

ctx start github:OWNER/REPOSITORY#42 --target codex --yes
```

The compiled artifact is written to `.context/build/<task>/<target>.md`. Its adjacent manifest records task and configuration hashes, snapshot time, selected paths, attached evidence, validation counts, token use, and omitted sections.

Connect the project to the selected client without manually editing configuration:

```sh
ctx mcp show codex       # preview the exact change
ctx mcp install codex    # install through the Codex CLI
```

Use `ctx start --mcp` to perform MCP setup as part of the first run.

Verification is deliberately a two-step operation:

```sh
ctx verify upload-error          # print the commands; execute nothing
ctx verify upload-error --run    # execute and record results
ctx result scaffold upload-error
```

## Lifecycle

```text
Task source ───────┐
Repository ────────┼──> start ──> hydrate ──> doctor ──> build ──> agent
Runtime evidence ──┘                  │                    │
                                     └── refuses errors   └──> verify ──> result
```

1. `start` auto-detects the repository and runs the complete first-use workflow.
2. `init` remains available for explicit or automated setup and is safe to rerun.
3. `task create` creates a typed task, or `task import` imports a GitHub issue.
4. `evidence add` records a source with provenance and integrity metadata.
5. `hydrate` takes a deterministic snapshot of relevant repository context.
6. `doctor` validates the full input graph.
7. `build` compiles a bounded target-specific Markdown artifact and manifest.
8. An agent can use the artifact directly or query the same data over MCP.
9. `verify --run` records actual command output; a result record maps delivery back to acceptance criteria.

## Commands

| Command | Purpose |
| --- | --- |
| `ctx start [ID or issue]` | Initialize, create/import, hydrate, validate, and compile in one guided command. |
| `ctx init [directory]` | Detect the project, create `.context`, install schemas, and update `.gitignore`. |
| `ctx task create ID` | Scaffold a typed task. |
| `ctx task import github:OWNER/REPO#123` | Import a GitHub issue; uses `GITHUB_TOKEN` for private repositories. |
| `ctx task list` / `show` | List or inspect canonical tasks. |
| `ctx evidence add TASK …` | Attach file, URL, command, or manual evidence. |
| `ctx hydrate TASK` | Discover repository context and write a snapshot. |
| `ctx doctor [TASK]` | Validate configuration or the complete task graph. |
| `ctx build TASK` | Compile all configured targets, or one with `--target`. |
| `ctx verify TASK` | Preview verification commands. Add `--run` to execute them. |
| `ctx result scaffold TASK` | Create a typed completion record. |
| `ctx result validate TASK` | Validate result shape and acceptance coverage. |
| `ctx mcp show TARGET` | Preview client-specific MCP setup without changing configuration. |
| `ctx mcp install TARGET` | Install MCP through the client CLI or a safe project-local merge. |
| `ctx status` | Show tasks and lifecycle status. |
| `ctx serve` | Run the MCP server on stdio. |

Run `ctx --help` for all options.

## What gets discovered

Discovery is deterministic and repository-native. It does not require embeddings or send source code to an external service.

- package and runtime manifests;
- package scripts, engines, and dependency names;
- `AGENTS.md`, `CLAUDE.md`, and matching `.cursor/rules/*.mdc` files;
- language distribution and file metadata;
- JavaScript/TypeScript, Python, Go, and Rust imports;
- likely source-to-test mappings;
- task-named entry points and related paths;
- lexical matches against outcome and scope terms;
- current commit, branch, working-tree changes, and recent commits.

Every candidate includes a score and reasons. Discovery produces a map; agents still inspect live files before editing.

## Native agent adapters

The task and evidence model is shared, but the compiled contract is not identical:

- **Codex** is directed to the applicable `AGENTS.md` hierarchy and the live working tree.
- **Claude Code** is directed to `CLAUDE.md` and repository-native instructions.
- **Cursor** is directed to matching `.cursor/rules/*.mdc` rules and symbol/call-site inspection.
- **Generic** avoids client-specific assumptions.

Context Brief never overwrites native instruction files. It references and snapshots them with digests so native behavior remains authoritative.

## MCP

MCP setup is client-aware:

- Codex setup uses `codex mcp add` and creates a project-specific server name.
- Claude Code setup uses `claude mcp add --scope project`.
- Cursor setup preserves existing entries while merging into `.cursor/mcp.json`.

`ctx mcp show TARGET` previews the exact command or JSON merge. `ctx mcp install TARGET` applies it. Repeated installation is idempotent; use `--force` to replace an existing CLI registration.

The server publishes task, evidence, and previously compiled artifacts as resources. It exposes read-oriented tools for listing tasks, getting typed tasks or evidence, compiling bounded context, and running `doctor`. Both newline and `Content-Length` stdio framing are accepted.

## Files

```text
.context/
├── config.json                 # project discovery and policy configuration
├── schemas/                    # local JSON Schemas for editor support
├── tasks/<id>.json             # canonical task records
├── evidence/<id>.json          # provenance and integrity records
├── snapshots/<task>.json       # generated discovery state
├── build/<task>/<target>.md    # generated agent view
├── build/<task>/*.manifest.json
├── runs/<task>-<time>.json     # actual verification output
└── results/<task>.json         # acceptance-oriented handoff
```

Generated snapshots, builds, runs, and results are ignored by this repository's default `.gitignore`. Teams can commit any of those selectively when audit requirements call for it.

## Safety model

- Paths are resolved inside the configured project root; lexical and symbolic-link traversal outside it is rejected.
- Evidence files are hashed when attached and checked before compilation.
- Expired and stale evidence is reported.
- Likely credentials and private keys in task or evidence records block compilation.
- Confidential and restricted evidence excerpts are omitted from compiled Markdown.
- Task verification commands are never run by `hydrate`, `doctor`, or `build`.
- Verification commands require `ctx verify --run`; destructive-looking commands produce warnings.
- Builds with validation errors are refused unless the caller explicitly supplies `--force`.
- MCP configuration can be previewed before installation and preserves unrelated Cursor servers.

See [installation and onboarding](docs/install.md), [the architecture](docs/architecture.md), [the artifact model](docs/artifact-model.md), and [the three context layers](docs/context-layers.md).

## Development

```sh
npm run check
npm test
npm run release:check
```

The integration suite creates isolated projects and exercises one-command onboarding, project detection, idempotent initialization, schema installation, task creation, evidence hashing, discovery, validation, compilation, MCP configuration, tamper detection, verification, result scaffolding, and MCP transport.

## License

MIT. Use and adapt the compiler and schemas for your team.
