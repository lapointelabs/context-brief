# Installation and onboarding

## Requirements

- Node.js 20.1 or newer.
- Git is recommended for repository-state discovery.
- Codex, Claude Code, or Cursor is optional; Context Brief falls back to a generic target.

The package has no third-party runtime dependencies.

## Run without installing

```sh
npx --yes @lapointelabs/context-brief start
```

## Install globally

```sh
npm install --global @lapointelabs/context-brief
ctx --version
```

## Install from source

For contributors working from a checkout:

```sh
git clone https://github.com/lapointelabs/context-brief.git
cd context-brief
npm install
npm link
```

Confirm the linked executable is available:

```sh
ctx --version
```

Before publishing, `npm run release:check` verifies syntax, the complete integration suite, version agreement, and package contents.

## First run

From the repository that needs context:

```sh
ctx start
```

The guided path:

1. Detects the project name, runtime, package manager, entry points, verification scripts, native instructions, GitHub remote, and installed agent clients.
2. Creates or refreshes `.context` and its local editor schemas.
3. Adds generated artifact paths to `.gitignore` when the project uses Git.
4. Asks for a task title, observable outcome, scope, and agent target.
5. Creates a typed task with detected verification commands and entry points.
6. Hydrates repository context, validates the input graph, and compiles the selected target.
7. Prints the artifact path and the exact next command.

`ctx init` is idempotent. Rerunning it preserves configuration and canonical task data while refreshing bundled schemas and missing `.gitignore` entries. Use `--force` only when intentionally replacing configuration.

## Non-interactive use

```sh
ctx start improve-timeouts \
  --title "Explain request timeouts" \
  --outcome "Timed-out requests display a specific recovery message." \
  --scope "The request status component" \
  --path src/request-status.tsx \
  --target codex \
  --yes
```

Repeat `--scope`, `--path`, or `--acceptance` to supply multiple values.

Importing a public GitHub issue requires no token. Set `GITHUB_TOKEN` for a private repository:

```sh
ctx start github:OWNER/REPOSITORY#42 --target claude --yes
```

## Connect an agent over MCP

Preview first if desired:

```sh
ctx mcp show codex
ctx mcp show claude
ctx mcp show cursor
```

Install for the current project:

```sh
ctx mcp install codex
ctx mcp install claude
ctx mcp install cursor
```

Codex registration follows the scope provided by the installed Codex CLI. Claude is explicitly installed at project scope. Cursor is written to the project-local `.cursor/mcp.json` with unrelated entries preserved. Server names include the project slug so multiple repositories do not collide.

Use `--force` to replace an existing registration. `ctx start --mcp` installs the selected target during onboarding.

## Update

From a source checkout:

```sh
git pull --ff-only
npm install
npm link
ctx init
```

The final `ctx init` refreshes the local schemas without overwriting project configuration.

After npm publication:

```sh
npm install --global @lapointelabs/context-brief@latest
ctx init
```

## Remove the CLI

For a source-linked installation:

```sh
npm unlink --global @lapointelabs/context-brief
```

For an npm installation:

```sh
npm uninstall --global @lapointelabs/context-brief
```

Uninstalling the CLI deliberately does not delete `.context`, tasks, evidence, or agent configuration. Those contain project data and should be removed only through an explicit repository change.
