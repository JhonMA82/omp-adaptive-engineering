# Attribution

This plugin is a port of **RSC Harness** by Eric Risco:

- Repository: https://github.com/ericrisco/rsc-harness
- Branch: `main`
- Commit: `726aaf3ba87c584329fc821f243a7ce5e62450fd`
- Version: `4.0.5`
- License: MIT (see `LICENSE.rsc-harness`)

The deterministic modules below are copied from that commit. Their algorithms, regular
expressions, rule tables, messages and comments are preserved; only the execution boundary was
adapted for OMP. The tests under `tests/` are the upstream tests, with the execution harness adapted
where the original test invoked the RSC CLI.

| Upstream file | Here | Changes |
| --- | --- | --- |
| `targets/shell-unwrap.mjs` | `targets/shell-unwrap.mjs` | None |
| `targets/danger-guard.mjs` | `targets/danger-guard.mjs` | Added exported `evaluateDanger` and `technicalLevel` (the second so the settings layer can tell "no profile" from "a non-technical profile"); CLI main is gated by `isMain`. Rule list, regexes, messages and decision logic unchanged. |
| `targets/asdd-gate.mjs` | `targets/asdd-gate.mjs` | None |
| `targets/branch-guard.mjs` | `targets/branch-guard.mjs` | `evaluate` accepts an optional `peers` provider and passes it to rule B; `othersHere` prefers that provider and keeps the upstream `session-memory-core` import as its fallback. Rules A and C, their regexes, messages and the CLI path are unchanged. |
| `targets/ship-guard.mjs` | `targets/ship-guard.mjs` | Extracted `shipGuardDecision`; CLI main gated by `isMain`. Sello/ASDD calls, branch-hygiene rules and messages unchanged. |
| `targets/sello.mjs` | `targets/sello.mjs` | Added fixed `--src-prefix`/`--dst-prefix` to the content diff so a user’s `diff.mnemonicPrefix` cannot hide added lines. Algorithm and table unchanged. |
| `targets/spec-completeness.mjs` | `targets/spec-completeness.mjs` | None |
| `targets/gitmoji-guard.mjs` | `targets/gitmoji-guard.mjs` | Added exported `evaluateGitmoji`; CLI main uses it. Gitmoji table, parser and messages unchanged. |
| `targets/ftd-nudge.mjs` | `targets/ftd-nudge.mjs` | None |
| `targets/userprompt-gate.mjs` | `targets/userprompt-gate.mjs` | Added exported `gateText`; CLI main gated by `isMain`. Gate text and branch rule unchanged. |
| `targets/trunk-policy.mjs` | `targets/trunk-policy.mjs` | None |
| `targets/hook-once.mjs` | `targets/hook-once.mjs` | None; used for the upstream `SDD_GATE_TEXT`. |
| `scripts/lib/risk.js` | `scripts/lib/risk.js` | None |
| `scripts/lib/spec-gate.js` | `scripts/lib/spec-gate.js` | None |
| `scripts/lib/review-ledger.js` | `scripts/lib/review-ledger.js` | None |
| `scripts/lib/review-findings.js` | `scripts/lib/review-findings.js` | None |
| `targets/agents.js` (definitions) | `agents/*.md` | Agent bodies preserved; `model:` pins removed so OMP’s model selection applies. |
| 28 `skills/*/SKILL.md` + references/scripts | `skills/` | Content preserved; runtime-specific commands and relative skill links adapted for OMP. This closing pass also replaced the root-instruction file (`AGENTS.md` for OMP; `CLAUDE.md` only as compatibility) and the tool-invocation syntax, and removed claims about upstream hooks this port does not ship. See `README.md`. |

Three test files are additions, not upstream: `tests/session-peers.test.js` covers rule B through
OMP's session leases, `tests/danger-mode-matrix.test.js` covers the plugin's profile × mode matrix,
and `tests/worktree-state.test.js` covers the `.rsc` contract with real `git worktree` checkouts.
The closing checks for `/adaptive-status`, `session_switch` (`new`/`resume`/`fork`), the nudge,
`window`, the risk error and the per-checkout ledger/sello were appended to the existing
`tests/adapter.test.ts`.

One deliberate addition to the ported skills: `skills/tasks/SKILL.md` and `skills/implement/SKILL.md`
now instruct the agent to mirror the task table into OMP's `todo` tool, and to mark each task as it
opens and closes. Upstream leaves that to the runtime's own harness; OMP does not push a todo list,
so the port asks explicitly. The rest of both files is upstream.

`targets/omp-session-peers.mjs` is new integration code: it answers rule B with OMP's own session
records and ownership leases (`listSessions`, `listRecentSessions`, `probeSessionLeases`), so no
session registry is added. `targets/omp-state-roots.mjs` is new integration code for the boundary
upstream does not need: it resolves the working checkout and the main checkout, and performs the
one-time hydration of project opt-out markers into a fresh linked worktree (upstream does this at
install/sync time). It does not copy the sello, ledger, nudge or memory. `targets/plugin-settings.mjs`
is new code with no upstream counterpart: it reads the guard switches and the danger mode from OMP's
plugin settings, and gates the guards accordingly.
`src/index.ts`, `src/rsc-boundary.ts` and `src/sello-tool.mjs` are integration code written for OMP.
They call the upstream modules and do not reimplement their rules. `src/sello-tool.mjs` exposes the
state transitions of the upstream `rsc sello` CLI from `scripts/rsc.js`; its messages and checks are
the upstream ones. `tsconfig.json` and the pinned `typescript`, `@oh-my-pi/pi-coding-agent` and
`@types/node` dev dependencies exist only for the reproducible `bun run typecheck`; they do not
change the runtime.

The MIT license of RSC Harness is reproduced in `LICENSE.rsc-harness` and applies to all derived
files. The plugin as a whole is distributed under the same MIT terms.
