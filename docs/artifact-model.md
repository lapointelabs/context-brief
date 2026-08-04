# Artifact model

Context Brief separates four kinds of state that are often mixed into one prompt.

## Configuration

`.context/config.json` defines repository discovery and organization policy:

- project root;
- include and exclude patterns;
- maximum indexed file size and count;
- native instruction patterns;
- token budget and evidence age policy;
- enabled compilation targets;
- optional tracker integration defaults.

The configuration controls the compiler. It must not contain task-specific requirements.

## Task

A task is the canonical intent record. Its stable fields are:

- observable outcome and reason;
- current and expected behavior;
- evidence references;
- likely entry points, related paths, and external contracts;
- in-scope and out-of-scope behavior;
- constraints and protected paths;
- acceptance criteria with stable IDs;
- automated and manual verification;
- unknowns, safe assumptions, and stop conditions;
- required handoff information;
- source provenance, such as a GitHub issue.

Task status is lifecycle metadata, not evidence that work actually succeeded.

## Evidence

Evidence is stored separately so it can expire, be redacted, or change sensitivity without rewriting the task. Each record includes:

- task ownership and kind;
- concise summary;
- file, URL, command, or manual source;
- capture and optional expiration time;
- SHA-256 for file evidence;
- public, internal, confidential, or restricted sensitivity;
- optional excerpt and redaction notes.

The compiler includes summaries and provenance. It omits confidential and restricted excerpts.

## Snapshot and build manifest

A snapshot is generated repository state. It is disposable and becomes stale when the task or configuration hash changes.

A build manifest makes compilation reproducible enough to audit. It contains input hashes, snapshot time, output hash, selected files, evidence IDs, target, token budget, approximate use, omissions, and validation counts.

## Verification run

A run is immutable evidence of commands that actually executed. It is not inferred from what an agent claims to have done.

## Result

A result is the implementer's structured handoff. Each acceptance ID must be marked passed, failed, or not run with supporting evidence. This prevents a confident summary from replacing the task's actual success criteria.

## Versioning

Every record contains `schemaVersion`. Breaking changes require a new version and an explicit migration. Unknown versions are rejected rather than interpreted optimistically.
