# Task brief: [short, outcome-oriented title]

> This worksheet is a human drafting aid. The canonical executable format is
> `.context/tasks/<id>.json`, created with `ctx task create`. Run `ctx doctor`
> before compiling it for an agent.

## Outcome

Describe the user or business outcome in one or two sentences. State what should be true when the work is finished, not merely which code should be written.

## Why this matters

Explain who is affected and the cost of the current behavior. Include urgency only when it changes the implementation or rollout.

## Current behavior and evidence

- What happens now:
- What should happen instead:
- Reproduction steps:
- Error, log, screenshot, trace, or support report:
- First observed / frequency / affected environments:

Use facts here. Put interpretations and open questions below.

## Relevant context

- Likely entry points:
- Related files or modules:
- Calling code / downstream consumers:
- Existing tests or documentation:
- Versions, flags, environment details, or external contracts:

For chat-only tools, include a small file map and the complete contents of the minimum set of relevant files. For repository-aware agents, these are starting points rather than a closed list.

## Scope

### In scope

- [required behavior or area]

### Out of scope

- [adjacent work that should remain unchanged]

## Constraints

- Compatibility requirements:
- Security, privacy, or data-handling requirements:
- Performance or accessibility requirements:
- Project conventions that must be preserved:
- Dependencies or APIs that may not be changed:

## Definition of done

- [ ] The observable user behavior matches the outcome.
- [ ] The original failure has a regression test when practical.
- [ ] Existing relevant tests still pass.
- [ ] No unrelated refactor or formatting churn is included.
- [ ] Documentation or operational notes are updated if behavior changed.

## Verification

Commands the implementer can actually run:

```sh
# focused test

# broader safety check
```

Manual acceptance checks:

1. [action and expected result]

## Do not change

- [files, public interfaces, behavior, content, or infrastructure that must stay intact]

## Unknowns and assumptions

- Unknown:
- Working assumption, if progress is safe without an answer:
- Stop and ask when:

## Delivery notes

Ask the implementer to report:

- the outcome and approach;
- files changed;
- verification performed and its result;
- any remaining risk, assumption, or follow-up.
