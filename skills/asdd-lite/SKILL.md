---
name: asdd-lite
description: "Use only for N3 work: high-cost changes involving architecture, migrations, security, secrets, payments, data, CI, public APIs, irreversible actions, contradictory requirements, or coupled product decisions. Produces a compact specification, observable acceptance criteria, phased execution, decision records, and independent review without a five-phase SDD chain."
---

# ASDD-lite — specification-led work for high-cost changes

This is the N3 procedure for Adaptive Engineering. Do not load it for N0, N1, or ordinary N2 work. It is deliberately smaller than a full spec-driven chain: one specification, one decision record when needed, observed verification.

## 1. Establish the contract

Write the specification to `docs/specs/<slug>.md`; use `SPEC.md` at the repository root only when the project has no docs convention.

Before writing anything, read:

- the literal request and its constraints;
- `AGENTS.md`, `docs/decisions.md`, and any existing specification;
- the code, tests, CI, migrations, and configuration that the change touches;
- the project's existing patterns for the same kind of change.

Separate facts from assumptions. If a fact can be discovered in the repository, discover it instead of asking. If a decision changes **what** is built, it belongs to the user.

## 2. The four questions

**Hard gate:** write the specification before editing source. A one-paragraph specification is valid; skipping it is not. The specification is a working artifact, not optional documentation: creating it is part of the requested N3 work, and a general “do not create docs” instruction does not override this gate. If you are about to edit a source file and the specification does not exist, stop and write it first.

The specification must answer all four. If one is missing, the specification is not ready.

| Question | What it must contain |
|---|---|
| **What can the user do?** | The action, who is allowed, and the starting conditions. |
| **What result do they get?** | An observable result against a reference the human approved: expected output, response, screenshot, or deterministic diff. |
| **What must it respect?** | Prior decisions, existing behavior, security, privacy, accessibility, performance floors, and data already present. |
| **How does it prove it?** | The exact check, the environment, and the evidence that remains afterwards. |
| **What is out of scope?** | What the agent must not add “just in case”. |

Add **Out of scope**: what the agent must not add “just in case”.

Do not put implementation details in the specification unless they are a constraint. Do not turn it into a design document.

## 3. Clarify before planning

Walk this checklist once:

- Who can and cannot perform the action?
- What happens on empty, missing, error, duplicate, concurrent, first-run, and boundary cases?
- Is there an approved reference, or only the agent's judgment?
- Does this contradict a recorded decision or an existing specification?
- What current behavior must not break?
- Which acceptance criterion cannot be checked as written? Sharpen it or move it to open questions.

Ask one question at a time, with a recommendation first, only when the answer changes what gets built. Record every other decision as a reversible assumption with its basis.

## 4. Acceptance criteria

Use binary, observable statements. Prefer Given/When/Then.

```text
Given a signed-in user with an empty cart
When they open checkout
Then they see the empty-cart message and the pay button is disabled
```

A criterion that needs a human to decide whether it is “good enough” is not ready. If it cannot be observed, it is not a criterion.

## 5. Plan by phases

Each phase must have:

- a narrow outcome;
- the files or boundaries it touches;
- a concrete check that proves the phase;
- its dependencies and whether it can run independently.

Order phases so the tree builds and existing tests pass after each one. Do not plan a mechanical cleanup tail (changelog, formatting, docs) as a phase; run those after the behavior works.

Use `todo` with one phase per group when the work spans several steps. Keep phase names stable; they are the tracking contract.

## 6. Execute

- Use the smallest change that satisfies the current phase.
- Reuse existing functions, patterns, and conventions; do not introduce a second way to do the same thing.
- For a rename, signature change, or removal, update every caller and delete the old path. No compatibility shims unless the user requested one.
- If a phase reveals a new material decision, record it and continue with independent phases.
- If a phase reveals that the premise is wrong, stop that phase and surface the contradiction; do not build around it silently.
- Do not ask “should I continue?” between phases. Continue until the work is complete, blocked, or irreversible.

## 7. Verify

For each phase, record:

```text
Evidence: <command or action>
Result: <observed output, exit code, screenshot, URL>
Scope: <what this proves and what it does not>
Date: <YYYY-MM-DD>
```

Mandatory controls:

- affected tests;
- build/typecheck;
- the project's security check when the change has a security surface;
- an end-to-end check for the new behavior, not only the existing suite.

A control that did not run is reported as **not run**, never as passed.

## 8. Independent review

Use `reviewer` when the diff is large, cross-cutting, hard to verify by tests, or the user asks. Use `security-reviewer` when the change touches authentication, authorization, secrets, untrusted input, data exposure, or destructive operations.

Give the reviewer:

- the specification and acceptance criteria;
- the diff;
- the verification evidence;
- the known limitations.

The reviewer reports findings; the agent verifies them. Do not treat reviewer approval as human approval. Stop after three fix rounds; if the issue does not converge, park the task or rethink the approach.

## 9. Decisions and close-out

Create `docs/decisions.md` only if a decision must survive the session. Use:

```markdown
## Open

- [blocking] Q1 — Decision required; evidence; affected task.
- [review-after] Q2 — Reversible assumption; reason; affected task.

## Resolved

- Q3 — Decision; decided by; date; reason.
```

Rules:

- `review-after` never stops independent work.
- `blocking` stops only the dependent task.
- Only a human resolves a human decision.
- Promote durable architecture decisions to an ADR; do not create an ADR for every choice.

Before closing, check:

- every acceptance criterion has observed evidence;
- every phase is done or explicitly parked;
- every open decision is listed with its impact;
- the final report states what was verified, what was not, and what remains;
- no temporary files, debug output, or scaffolds remain.

## Anti-patterns

| If you are about to… | Stop |
|---|---|
| Write code before the four questions are answered | Write the specification first. |
| Treat “tests pass” as proof of the requested behavior | Trace the acceptance criteria to observed checks. |
| Add a feature nobody asked for | Move it to out of scope. |
| Ask the user to choose a technical detail you can investigate | Investigate, decide, and record. |
| Decide product scope silently | Ask or park as `blocking`. |
| Wait for an answer while independent work remains | Park and continue. |
| Run a fourth review round on the same finding | Rethink the approach or park. |
| Claim `/plan` or `/goal` is active | They are user-activated; propose them instead. |
