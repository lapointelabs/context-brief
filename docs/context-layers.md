# Three layers of useful context

Context becomes noisy when stable repository rules, one-off task requirements, and live debugging evidence are mixed into one permanent prompt. Keep them in three layers.

## 1. Project instructions

Project instructions explain how work is done in this repository across many tasks.

Good examples:

- the supported runtime and package manager;
- architecture boundaries and public contracts;
- install, test, typecheck, lint, and build commands;
- security, privacy, accessibility, and migration rules;
- generated or protected files.

Avoid active ticket details, temporary errors, and speculative implementation plans. Update this layer when the repository itself changes.

## 2. Task brief

The task brief explains what outcome is needed now and how it will be judged.

Good examples:

- current and expected behavior;
- reproduction steps and known evidence;
- likely entry points;
- scope, constraints, and explicitly excluded work;
- definition of done and verification commands;
- unknowns and stop conditions.

Write a new brief for each meaningful task. A brief can link to durable documentation instead of copying it.

## 3. Runtime evidence

Runtime evidence is what the system is doing in a particular environment at a particular moment.

Good examples:

- the complete failing test output;
- a redacted request and response;
- a screenshot or recording;
- an application log excerpt with timestamps;
- a trace, query plan, or profiler result.

Capture evidence as close to the failure as possible. Redact secrets and personal data. Do not promote a one-time observation to a project rule without confirming it.

## How the layers work together

Start the agent with project instructions and a task brief. Let it inspect the repository. Add runtime evidence when the task is a bug or when its investigation requests a specific missing signal.

When the output is wrong, diagnose the context layer before adding more prose:

- Wrong convention or command? Fix project instructions.
- Wrong outcome or scope? Fix the task brief.
- Wrong diagnosis? Improve runtime evidence.

More context is not always better. Better placement makes context reusable and easier to trust.
