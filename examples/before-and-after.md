# Before and after: from request to context brief

## The vague request

> Fix uploads. Users get an error with large images.

This identifies a symptom, but it leaves the implementer to guess:

- which upload surface is affected;
- what “large” means;
- whether to reject, resize, or compress;
- where the error appears;
- which behavior must remain unchanged;
- how to reproduce and verify the fix.

An AI tool will often fill those gaps with a plausible implementation. Plausible is not the same as correct.

## The context brief

See the original human worksheet in [`upload-error-brief.md`](upload-error-brief.md),
the canonical typed task in [`upload-error.task.json`](upload-error.task.json), and
its separate provenance record in [`upload-error.evidence.json`](upload-error.evidence.json).

The revised brief adds only information that changes a decision:

- **Outcome:** reject before sending and explain the limit.
- **Evidence:** the endpoint returns `413` for a known file and the issue is reproducible.
- **Source of truth:** the server's 5 MB limit remains authoritative.
- **Boundaries:** no compression, redesign, dependency, or work on other upload surfaces.
- **User needs:** keyboard and live-region behavior are part of acceptance.
- **Verification:** the exact focused and broader checks are named.
- **Stop condition:** changing the API contract requires a conversation.

## What the brief deliberately does not decide

It does not dictate the component state shape, validation helper name, or exact test implementation. Those choices can be made from the repository's existing patterns.

Context should constrain the important decisions while leaving room for the implementer to use evidence and judgment.
