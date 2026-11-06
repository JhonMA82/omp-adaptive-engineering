# Adaptive Engineering for Oh My Pi

OMP port of [RSC Harness](https://github.com/ericrisco/rsc-harness) v4.0.5, commit
`726aaf3` (MIT). RSC supplies the methodology, instructions, deterministic guards and tests; OMP
supplies the runtime, plugin discovery, extension lifecycle and tool approval. This package connects
them at a small `ExtensionAPI` boundary and keeps the upstream rules intact.

Verified against OMP `18.16.0`.

## What it does

- **Five deterministic Bash guards** on OMP’s `tool_call`, in RSC’s order: `ship` (sello + ASDD),
  `branch`, `gitmoji`, `danger`.
- **One post-edit nudge** (`ftd-nudge`) after the first code edit with no feature document.
- **Always-on methodology**: the original `suggest` body at session start and after compaction, and
  the original per-turn lane gate on every user prompt.
- **Native instruments** for the RSC CLI operations the skills call: risk, spec gate, review ledger,
  review consolidation and sello.
- **The engineering skills and agents** selected from RSC: `suggest`, `ftd`, `asdd` and the phase
  chain, plus the refuter/verifier agents.

No workflow engine, scheduler, database, telemetry, second plugin loader or parallel state store.

## Install

```bash
omp plugin link ~/Dev/omp-adaptive-engineering
# or: omp plugin install ~/Dev/omp-adaptive-engineering
omp plugin list
```

The link writes a symlink under `~/.omp/plugins/node_modules/adaptive-engineering` and an entry in
`~/.omp/plugins/omp-plugins.lock.json`. It does not modify OMP’s source.

Activation changes apply to **new sessions**. A session already open keeps what it loaded.

```bash
omp plugin disable adaptive-engineering   # guards, tools, commands, skills and agents disappear
omp plugin enable  adaptive-engineering   # they return on the next session
omp plugin uninstall adaptive-engineering # remove the link and plugin state
```

The plugin is project-agnostic. It reads project state from the session’s working directory:
`.rsc/`, `.rsc.json`, `02-DOCS/` or the nearest `.git`. Per-project opt-out files are the original
RSC switches (see below); no global configuration is written.

## Guards

The extension subscribes to `tool_call`. It only judges `bash` calls; every other tool passes
through. The order matches RSC’s `PreToolUse(Bash)` hooks:

| Guard | Source | Blocks when |
| --- | --- | --- |
| `ship-guard` | `targets/ship-guard.mjs` | A delivery command diverges from an enabled sello, a tier-2 branch has no linked spec or review panel, or the branch is left for the trunk with uncommitted/unpushed work. |
| `branch-guard` | `targets/branch-guard.mjs` | A commit/merge/ref move/push lands on a closed default branch, a worktree is created outside `.worktrees/`, or another session owns the checkout. |
| `gitmoji-guard` | `targets/gitmoji-guard.mjs` | A `git commit -m` message has no gitmoji before the Conventional Commits header. |
| `danger-guard` | `targets/danger-guard.mjs` | A destructive command matches RSC’s rule table. For a `technical` profile the destructive-work rules ask; for any other/missing profile they deny. |

### Allow, ask, deny

RSC’s `deny` maps to `{ block: true, reason }`. RSC’s `ask` maps to OMP’s native confirmation:

- interactive session (`ctx.hasUI`): `ctx.ui.confirm(...)`; declining blocks the call;
- no UI (print, headless, most subagents): the call is **blocked**, never silently allowed, and the
  reason says why.

A block cannot be overridden by OMP’s approval prompt: `tool_call` runs before the approval gate.

### Coverage and limits

The guards see Bash calls that reach OMP’s interceptable tool pipeline. They do **not** see:

- commands typed by a person in an external terminal;
- direct host/browser/computer interactions;
- shell text executed inside `eval`/`run_code` or another tool that is not `bash`;
- user `!`/`$` local execution paths.

Subagents **do** get the guards: OMP rebinds extension factories to child sessions, and the
`tool_call` handler runs there too. This was verified with a real `task` subagent.

## Settings

The plugin declares five settings in `package.json#omp.settings`, so OMP paints them in
**Settings → Plugins → adaptive-engineering** and persists them in
`~/.omp/plugins/omp-plugins.lock.json` under `settings["adaptive-engineering"]`.

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `guards.danger` | boolean | `true` | Irreversible-command guard |
| `guards.branch` | boolean | `true` | Closed-trunk and worktree-isolation guard |
| `guards.ship` | boolean | `true` | Delivery guard: sello, linked spec, branch hygiene |
| `guards.gitmoji` | boolean | `true` | Gitmoji required at the start of a commit message |
| `danger.mode` | `auto` \| `ask` \| `deny` | `auto` | `auto` follows the profile; `ask` only where the profile would ask or there is none; `deny` always denies |

Behaviour, in order of precedence:

1. **A change applies to the next session.** The values are read once at session start, never
   re-read mid-session — the same rule OMP applies to enabling and disabling plugins.
2. **A project opt-out always wins.** `.rsc/.no-danger-guard`, `.rsc/.no-trunk-guard`,
   `.rsc/.no-worktree-isolation`, `.rsc/.no-ship-guard` and `.rsc/.no-gitmoji` disable their guard
   even when the global switch is on. No global setting can force a guard on a repository that
   turned it off.
3. **`danger.mode` hardens, never loosens.** With a non-technical project profile, `ask` does not
   replace the denial; only `deny` and `auto` can change that verdict.
4. **Unreadable configuration falls back to the defaults.** A missing or malformed lock file leaves
   every guard on, and a guard never blocks a command because of its own settings error.

A project can override any key in `.omp/plugin-overrides.json` (or `.pi/`), which wins over the
global lock. That file is written by hand; the settings page only writes the global one.

When at least one guard is off, the session opens with a single line naming it, so the state is
visible even though it no longer lives in the repository.

## Native tools

The model calls these instead of the unavailable `npx @ericrisco/rsc` CLI:

| Tool | Upstream operation |
| --- | --- |
| `rsc_risk` | `rsc risk [--base] [paths…] [--json]` |
| `rsc_spec_gate` | `rsc spec gate [paths…]` |
| `rsc_review_ledger` | `rsc review ledger` and `rsc review escapes` |
| `rsc_review_consolidate` | `rsc review consolidate <reports…>` |
| `rsc_sello` | `rsc sello on/off/freeze/approve/block/budget/budget-check/check/report/status` |

`rsc_spec_gate` uses RSC’s completeness and status-claim checks against the containing repository. The
upstream CLI’s split-repo `project.root` subject resolution is not ported; a project that keeps specs
in one repository and code in a sibling should treat the status-drift line as advisory.

## Native commands

User-invoked project switches, the equivalent of RSC’s `main`/`isolation` commands:

| Command | Effect |
| --- | --- |
| `/adaptive-main-unlock` | write `.rsc/.no-trunk-guard` (agent may work on the default branch) |
| `/adaptive-main-lock` | write `.rsc/.no-trunk-open` (branches/PRs; the default branch stays closed) |
| `/adaptive-isolation-off` | write `.rsc/.no-worktree-isolation` |
| `/adaptive-isolation-on` | remove it |
| `/adaptive-status` | print trunk policy, worktree isolation and sello state |

These are project decisions. The commands write project-local markers only.

## Skills and agents

Bundled skills (28) are the original RSC `SKILL.md` files with only runtime references adapted:
`suggest`, `ftd`, `asdd`, `specify`, `clarify`, `plan`, `tasks`, `analyze`, `decision-challenge`,
`implement`, `source-grounded-development`, `verify`, `review`, `simplify-code`, `ship`, `debug`,
`worktrees`, `parallel`, `tidy`, `orient`, `constitution`, `sdd-init`, `secure-coding`,
`code-review`, `git-workflow`, `idea-refinement`, `deployment`, and `harness`.

Bundled agents: `developer`, `refuter-correctness`, `refuter-security`, `refuter-tests`,
`finding-verifier`.

The methodology is not re-written. The always-on `suggest` body is the exact upstream body; it is
injected as a custom message at session start and re-injected after compaction. The per-turn lane
gate is the upstream `SDD_GATE_TEXT` plus `trunk-policy`’s branch rule, appended to the system prompt
on every main-session prompt.

## Project state RSC reads

- `02-DOCS/wiki/harness/user-profile.md` — `technical_level` for the danger guard.
- `02-DOCS/wiki/sdd/specs/` — specs; frontmatter `branch: <name>` links a spec to a branch.
- `02-DOCS/wiki/sdd/` — ASDD artifacts.
- `.rsc.json` — optional onboarding `technicalLevel` fallback.
- `.rsc/review-ledger.jsonl` — review rounds, findings, outcomes and panels.
- `.rsc/sello-*.json` and `.rsc/sello-log.jsonl` — only when the sello is explicitly enabled.
- Opt-outs: `.rsc/.no-danger-guard`, `.no-ship-guard`, `.no-asdd-gate`, `.no-gitmoji`,
  `.no-feature-gate`, `.no-trunk-guard`, `.no-trunk-open`, `.no-worktree-isolation`.

## Differences from upstream RSC

These are deliberate, explicit consequences of the OMP runtime:

1. **Approval channel.** RSC’s `ask` has no exact `tool_call` equivalent. It becomes
   `ctx.ui.confirm` when a UI exists; headless sessions block instead of allowing. A block is not a
   human “no” and is not presented as one.
2. **No installer/onboarding layer.** RSC’s `init`, `doctor`, `sync`, `repair`, `catalog`, `add`,
   `consult` and `reassess` are not ported. OMP’s plugin manager installs the plugin; OMP’s skill
   discovery lists skills. `suggest` keeps its decisor and its “name the missing capability once”
   behavior without a package manager.
3. **Branch-guard rule B is inert.** “Another session is working in this checkout” needs RSC’s
   `session-memory-core` journal, which is not part of this port. The guard still enforces the closed
   trunk, ref moves/pushes and worktree placement. Rule B fails open, as upstream does when the
   module is missing.
4. **Worktree reaper and post-merge cleanup are not ported.** The `worktrees`, `tidy` and `ship`
   skills use the manual git checks (`git worktree list`, clean/merged verification, `git worktree
   remove`), with the same “keep on doubt” rule.
5. **Knowledge sync is not ported.** The feature-document close hook (`rsc/knowledge`) and its
   post-merge status update are RSC-specific; the FTD nudge still works.
6. **Stack skills are optional.** The phase skills name `fastapi`, `nextjs`, `go`, `postgresdb`,
   `flutter`, `design`, `docker`, etc. as optional stack handoffs; they are not bundled. A project
   supplies them through its own plugin/skill installation.
7. **Sello.** The deterministic gate and its CLI transitions are ported. A project with an existing
   `.rsc/sello-config.json` works; a project that has never used RSC’s sello starts with it off.
8. **Spec-gate subject.** The full split-repository subject resolver in `scripts/spec-gate.js` is not
   ported; the tool checks the repository that contains the spec.
9. **`rsc_review_consolidate` takes report paths.** The original CLI also accepted stdin; OMP tools
   have no stdin, so a report must be a file.

## Tests

```bash
node --test tests/*.test.js   # upstream tests, execution adapted where they invoked the RSC CLI
bun tests/adapter.test.ts     # OMP allow/ask/deny translation and native switches
```

At this commit: 179 Node tests, 178 pass, 1 skipped (the upstream materialized-copy drift test skips
when `.rsc/danger-guard.mjs` is absent), and the adapter test passes. The real-session checks covered
plugin loading, skill discovery, danger deny, headless ask blocking, FTD nudge, prompt injection,
subagent interception, native tools, and `omp plugin disable/enable/uninstall`.

## License

MIT. RSC Harness portions: Copyright (c) 2026 Eric Risco. See `LICENSE`, `LICENSE.rsc-harness` and
`NOTICE.md`.
