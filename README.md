# Lapointe Labs Context Brief

A small, practical system for giving ChatGPT, Cursor, Claude Code, and other coding agents enough context to do useful work without guessing.

Created by [Marc Lapointe](https://lapointelabs.com/about) at [Lapointe Labs](https://lapointelabs.com). Read more field notes at [lapointelabs.com/notes](https://lapointelabs.com/notes).

## The problem

Most disappointing AI-assisted work is not a prompting problem. It is a missing-context problem.

Copying one file into a chat hides imports, versions, conventions, tests, and the reason the code exists. Giving an agent the whole repository without a clear task creates a different failure: the model can see everything but does not know what matters, what is safe to change, or how success will be judged.

A context brief sits between those extremes. It records the outcome, evidence, boundaries, and verification steps for one piece of work.

## Start in 10 minutes

1. Copy [`templates/task-brief.md`](templates/task-brief.md) into your repository or working document.
2. Fill the outcome, current behavior, evidence, constraints, and definition of done.
3. Delete sections that truly do not apply. Do not fill gaps with guesses.
4. Give the brief to the model with the relevant files or repository access.
5. Review the result against the brief, not against whether the answer sounds confident.

If you use a repository-aware agent, also adapt [`templates/AGENTS.md`](templates/AGENTS.md) for the stable rules that apply to every task in the project.

## What belongs where

| Context | Lifetime | Examples |
| --- | --- | --- |
| Project instructions | Many tasks | Architecture, commands, conventions, protected areas |
| Task brief | One task | Outcome, evidence, scope, constraints, definition of done |
| Runtime evidence | One investigation | Logs, screenshots, failing output, traces |

See [`docs/context-layers.md`](docs/context-layers.md) for how to keep these layers separate.

## A good brief is not a giant prompt

A useful context brief is:

- **specific about the outcome** without prescribing every implementation detail;
- **grounded in evidence** such as an error, screenshot, test, or user report;
- **explicit about boundaries** so unrelated cleanup does not enter the diff;
- **honest about unknowns** so the model investigates instead of inventing;
- **verifiable** with commands and observable acceptance checks.

The brief should make the next decision easier. It should not attempt to contain the entire repository.

## Worked example

[`examples/upload-error-brief.md`](examples/upload-error-brief.md) turns a vague request—“fix uploads”—into a bounded task an agent can investigate and verify.

[`examples/before-and-after.md`](examples/before-and-after.md) shows why each added detail changes the quality of the work.

## When you only have ChatGPT

You can still use the same structure. Add a short file map and paste only the smallest complete set of files needed to preserve imports, types, and call sites. Ask the model to identify missing context before proposing a patch.

Do not ask it to pretend it ran commands or inspected files it cannot access. Put verification commands in the brief, run them yourself, and return the real output if the first attempt fails.

## When you have Cursor, Claude Code, or another agent

Give the agent repository access plus the task brief. Let it discover relevant files, but name likely entry points and protected areas. Require it to inspect project instructions before editing and to report the exact checks it ran.

Repository access reduces copying. It does not replace task context.

## License

MIT. Use and adapt the templates for your team.
