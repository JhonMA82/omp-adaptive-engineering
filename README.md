# Adaptive Engineering for Oh My Pi

OMP port of [RSC Harness](https://github.com/ericrisco/rsc-harness) v4.0.5, commit
`726aaf3` (MIT). RSC supplies the methodology, instructions, deterministic guards and tests; OMP
supplies the runtime, plugin discovery, extension lifecycle and tool approval. This package connects
them at a small `ExtensionAPI` boundary and keeps the upstream rules intact.

Verified against the installed OMP `18.17.0`; the previous closing pass verified `18.16.0`, the
original target.

## What it does

- **Four deterministic Bash guards** on OMP’s `tool_call`, in RSC’s order: `ship` (sello + ASDD
  sub-gates), `branch`, `gitmoji`, `danger`.
- **One post-edit nudge** (`ftd-nudge`) after the first code edit with no feature document.
- **Always-on methodology**: the `suggest` body at session start, after compaction and on
  `session_switch`, and the original per-turn lane gate on every user prompt.
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

The plugin is project-agnostic. It resolves the project root inside the session’s checkout: the
nearest ancestor with `.rsc/`, `.rsc.json` or `02-DOCS/`, never above the checkout’s git toplevel;
if no marker exists, the checkout toplevel is the project. Per-project opt-out files are the
original RSC switches (see below); no global configuration is written.

## Guards

The extension subscribes to `tool_call`. It only judges `bash` calls; every other tool passes
through. The order matches RSC’s `PreToolUse(Bash)` hooks:

| Guard | Source | Blocks when |
| --- | --- | --- |
| `ship-guard` | `targets/ship-guard.mjs` | A delivery command diverges from an enabled sello, a tier-2 branch has no linked spec or review panel, or the branch is left for the trunk with uncommitted/unpushed work. |
| `branch-guard` | `targets/branch-guard.mjs` | A commit/merge/ref move/push lands on a closed default branch, a worktree is created outside `.worktrees/`, or another live OMP session holds this checkout (OMP’s own session leases; see Limits). |
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
`tool_call` handler runs there too. Verified again in a real `task` subagent for this closing pass.

**Rule B is bounded by what OMP exposes.** It enumerates the sessions OMP records for this
checkout (the current session’s bucket and the git root’s bucket) plus the newest sessions across
every project, then asks `probeSessionLeases` which of them a live process owns. A session started
in a different subdirectory of the same repository and untouched for a long time may therefore not
be enumerated; the rule then fails open, as upstream does without its journal. There is no
registry, lockfile, heartbeat or database: OMP’s leases are the state. The denial names only that
another session is live and how long ago it last wrote; session ids, titles and paths stay out of
the message.

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
| `danger.mode` | `auto` \| `ask` \| `deny` | `auto` | `auto` is upstream RSC; `ask` turns a denial into a native confirmation where no non-technical profile protects it; `deny` turns any ask into a denial |

Behaviour, in order of precedence:

1. **A change applies to the next session.** The values are read at `session_start` and on
   `session_switch`, never re-read mid-session — the same rule OMP applies to enabling and disabling
   plugins. A switch refreshes the snapshot once, at its boundary.
2. **A project opt-out always wins.** `.rsc/.no-danger-guard`, `.rsc/.no-trunk-guard`,
   `.rsc/.no-worktree-isolation`, `.rsc/.no-ship-guard` and `.rsc/.no-gitmoji` disable their guard
   even when the global switch is on. No global setting can force a guard on a repository that
   turned it off.
3. **`danger.mode` is explicit, and `ask` is a real relaxation in one case.** `auto` is upstream
   RSC (technical → ask, non-technical or missing → deny). `ask` turns a denial into OMP’s native
   confirmation for a technical project **and for a project with no profile** — that second case is
   a deliberate, documented override, not a hardening. An explicitly non-technical profile is never
   relaxed: `ask` leaves its denial intact. `deny` hardens every ask into a denial; an allowed
   command stays allowed in every mode.
4. **Unreadable configuration falls back to the defaults.** A missing or malformed lock file leaves
   every guard on, and a guard never blocks a command because of its own settings error.

The complete `danger.mode` matrix, judged by the real guard and exercised by
`tests/danger-mode-matrix.test.js` and `tests/adapter.test.ts`:

| Profile | `auto` | `ask` | `deny` |
| --- | --- | --- | --- |
| `technical` | ask | ask | deny |
| `non-technical` | deny | deny | deny |
| no profile | deny | ask | deny |

`allow` stays `allow` in every cell. In an interactive session an `ask` cell calls OMP’s native
confirmation; declining blocks the call. With no UI the call is blocked with a reason, never
silently allowed. `auto` is upstream RSC; the `no profile` × `ask` cell is the port’s only deliberate
relaxation, and it is the one the first closing pass identified.

A project can override any key in `.omp/plugin-overrides.json`, which wins over the
global lock. That file is written by hand; the settings page only writes the global one.

When at least one guard is off, the session opens with a single line naming it, so the state is
visible even though it no longer lives in the repository.

## Native tools

The model calls these instead of the unavailable `npx @ericrisco/rsc` CLI. OMP registers extension
tools with `loadMode: "discoverable"` by default, so they surface as `xd://rsc_*` devices: `read
xd://rsc_risk` returns the schema and `write xd://rsc_risk` with a JSON object runs it. A model may
also call the tool by name when it is already mounted. They are not shell executables; a bash line
naming them fails with `command not found`.

Exact device form, as exercised in a real OMP `18.17.0` session:

```text
read  xd://rsc_risk
write xd://rsc_risk   {"paths":["src/auth/login.js"],"json":true}
```

The response carries the same assessment as the upstream CLI: tier, classes, reviewers, human
approval and escalation. `read` is how the model learns each tool’s parameters; the skills name the
tool and its arguments rather than pretending it is a command.

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

These are project decisions. The commands write `.rsc/.no-*` markers in the checkout they run in;
the port has no `.rsc.json` writer. A linked worktree inherits those markers once, when it has no
`.rsc/` yet (see *Project state*); a fresh clone materializes the opt-outs from a `.rsc.json` the
team committed, also once.

## Skills and agents

Bundled skills (28) are the original RSC `SKILL.md` files with only runtime references adapted:
`suggest`, `ftd`, `asdd`, `specify`, `clarify`, `plan`, `tasks`, `analyze`, `decision-challenge`,
`implement`, `source-grounded-development`, `verify`, `review`, `simplify-code`, `ship`, `debug`,
`worktrees`, `parallel`, `tidy`, `orient`, `constitution`, `sdd-init`, `secure-coding`,
`code-review`, `git-workflow`, `idea-refinement`, `deployment`, and `harness`.

Bundled agents: `developer`, `refuter-correctness`, `refuter-security`, `refuter-tests`,
`finding-verifier`.

The methodology is not re-written. **`suggest` is adapted, not the exact upstream body:** the
decisor, the three lanes, the one-suggestion rule and the orientation block are upstream, while the
installer/catalog/doctor sections are replaced by OMP’s plugin manager and the native-instrument
table. It is injected as a custom message at session start, re-injected after compaction and on
`session_switch` (`alreadyHasSuggest` prevents a duplicate on resume/fork). The per-turn lane gate is
the upstream `SDD_GATE_TEXT` plus `trunk-policy`’s branch rule, appended to the system prompt on
every main-session prompt. The agents keep their upstream bodies; the upstream `model:` pins were
removed so OMP chooses the model.

## Project state: two scopes

RSC keeps two different things, and this port preserves the split:

| Scope | Where | Shared with |
| --- | --- | --- |
| **Project decision** | `.rsc.json` (committed) and the `.rsc/.no-*` markers it declares | A linked worktree inherits them once; a fresh clone materializes its own committed `.rsc.json` once |
| **Checkout state** | `.rsc/` | Nothing: sello, review ledger, FTD nudge journal and session memory stay in the checkout that wrote them |

`02-DOCS/wiki/harness/user-profile.md` (`technical_level`) and `02-DOCS/wiki/sdd/` travel like any
other tracked file. `.rsc/review-ledger.jsonl`, `.rsc/sello-*.json` and `.rsc/sello-log.jsonl` are
checkout state. The project opt-outs are `.rsc/.no-danger-guard`, `.no-ship-guard`,
`.no-asdd-gate`, `.no-gitmoji`, `.no-feature-gate`, `.no-trunk-guard`, `.no-trunk-open` and
`.no-worktree-isolation`.

**How a worktree gets its state.** A linked worktree starts without `.rsc/` because it is ignored.
At `session_start`/`session_switch`, `targets/omp-state-roots.mjs` resolves two roots explicitly:

- `workRoot` — the nearest project root inside the checkout (`.rsc/`, `.rsc.json` or `02-DOCS/`
  below `git rev-parse --show-toplevel`); every guard receives this root, and the branch guard also
  receives the command’s own `cwd`;
- `mainRoot` — for a linked worktree, the checkout it was linked from (`git-common-dir`), mapped to
  the project’s counterpart path when the project is nested; used only to read the shared decision,
  never as the working root.

If the worktree has no `.rsc/` yet, the adapter hydrates the project opt-outs from the main
checkout’s `.rsc.json` `optOuts` and its `.rsc/.no-*` markers. A main checkout (a fresh clone) with
no `.rsc/` materializes its own committed `.rsc.json` the same way. That happens once. After the first
session the worktree’s own `.rsc/` is authoritative: deleting a marker re-arms that guard for this
worktree only, and a later decision in main does not rewrite it. A marker written inside a worktree
never writes back to main, and one worktree never reads another’s state. To pick up a later main
decision, remove the worktree’s `.rsc/` (it will re-hydrate on the next session) or run the
`/adaptive-*` command there. This is the closing contract: sello and review ledger are checkout
evidence and are deliberately **not** shared between worktrees; a sello from one branch cannot
certify another branch’s bytes.

`/adaptive-status` makes the contract inspectable: `project` is `workRoot`, and `state` reports
`worktree`, `mainCheckout`, `linkedWorktree` and the effective `projectOptOuts`.

The sello, review ledger and risk tools deliberately resolve through `sello.resolveRoot` to the
checkout (git toplevel), because their state and byte binding belong to the checkout; nested project
markers apply to guards, project settings and the spec gate. This is the same F-03 boundary, not a
second root model for review evidence.

## Differences from upstream RSC

These are deliberate, explicit consequences of the OMP runtime:

1. **Approval channel.** RSC’s `ask` has no exact `tool_call` equivalent. It becomes
   `ctx.ui.confirm` when a UI exists; headless sessions block instead of allowing. A block is not a
   human “no” and is not presented as one.
2. **No installer/onboarding layer.** RSC’s `init`, `doctor`, `sync`, `repair`, `catalog`, `add`,
   `consult` and `reassess` are not ported. OMP’s plugin manager installs the plugin; OMP’s skill
   discovery lists skills. `suggest` keeps its decisor and its “name the missing capability once”
   behavior without a package manager.
3. **Branch-guard rule B uses OMP’s memory.** Upstream reads the `session-memory-core` journal; the
   port injects a provider built from OMP’s session records and ownership leases
   (`targets/omp-session-peers.mjs`). Same rule, same message, same fail-open behaviour; only the
   source of “another session is here” changed. Its enumeration boundary is stated under Limits.
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
10. **Native tools are discoverable devices.** `loadMode` is left at OMP’s default, so the five
    `rsc_*` tools appear as `xd://` devices instead of top-level schemas. That keeps every request
    smaller; the skill text names the tool and the README shows both invocation forms.
11. **Worktree state is hydrated at the session boundary.** Upstream rebuilds the local opt-out
    markers from `.rsc.json` at install/sync time. This port has no installer, so the equivalent is
    the first session in a linked worktree with no `.rsc/` (`targets/omp-state-roots.mjs`). It is a
    one-time inheritance of project decisions only; the sello, ledger, nudge and memory remain per
    checkout. See *Project state: two scopes*.
12. **A typecheck exists.** The package declares `tsconfig.json` and pins `typescript`, the official
    OMP package and `@types/node` as dev dependencies; `bun run typecheck` is the barrier.

## Typecheck

```bash
bun install
bun run typecheck        # tsc -p tsconfig.json
```

The strict configuration covers `src/**/*.ts` and `tests/**/*.ts`; the upstream `.mjs` algorithms
stay untyped and
are described once in `src/rsc-boundary.ts`. The tool schemas are module-level constants because
TypeScript 7 cannot infer a tool’s parameters through the async factory when the schema is an
inline literal. `tool_call` narrows with OMP’s documented `isToolCallEventType` (imported from the
runtime barrel, because the package root also re-exports it as type-only).

## Tests

```bash
node --test tests/*.test.js   # upstream tests, execution adapted where they invoked the RSC CLI
bun tests/adapter.test.ts     # OMP allow/ask/deny translation, native tools and worktree state
bun run typecheck             # TypeScript barrier
```

Final run of this closing pass:

- `node --test tests/*.test.js` → **234 tests, 233 pass, 1 skipped, 0 fail**.
- `bun tests/adapter.test.ts` → all adapter checks pass, including `/adaptive-status`,
  `session_switch` for `new`/`resume`/`fork`, the error-path checks, the profile × mode matrix and
  the real-worktree state contract.
- `bun run typecheck` → 0 errors.
- The skipped test is the upstream materialized-copy drift test: it skips when
  `.rsc/danger-guard.mjs` is absent, which is the case in this checkout. It is not counted as
  evidence here.

Real OMP sessions, not the simulated API.

**This pass, OMP 18.17.0:**

- **Danger guard:** a real print session asked to run `rm -rf /tmp/omp-rsc-should-not-exist`
  returned the guard’s verbatim `BLOCKED for a non-technical user` message; the directory and its
  file were still present afterwards.
- **Native tool device:** the same runtime read `xd://rsc_risk` for the schema and wrote
  `xd://rsc_risk` with `{"paths":["src/auth/login.js"],"json":true}`; the result was `tier: 2`,
  `classes: ["auth"]`, `reviewers: 3`, `humanApproval: true`.
- **`suggest` injection:** the session transcript contains exactly one `rsc-suggest`
  `custom_message` at session start.
- **`/adaptive-status`:** its registered handler was executed inside a real session and returned
  JSON naming `project`, `state.worktree`, `state.mainCheckout` and `state.linkedWorktree`. OMP’s
  print mode does not expose slash-command dispatch, so the command’s dispatch itself is covered by
  `tests/adapter.test.ts`, not by this real-session check.
- **Worktrees:** the state contract and the guard/git context were exercised against real
  `git worktree add` checkouts (`tests/worktree-state.test.js` and the adapter suite), not mocks.

**Previous closing pass, OMP 18.16.0** (kept as recorded evidence; the code paths are the same):

- **Rule B, same checkout:** an RPC session held `/tmp/rsc-ruleb.vAwJC7`; a fresh print session's
  `git switch -c` was blocked with “Another session is working in this same folder”, and the branch
  was not created.
- **Rule B, other checkout:** the same live session did not block a switch in
  `/tmp/rsc-ruleb-other.*`.
- **Guards:** `rm -rf` denied with no profile; a quoted `echo "rm -rf …"` allowed; a commit without
  gitmoji blocked; the same commit with `📝` allowed and created; a commit on a closed trunk blocked;
  leaving a dirty `feat/x` blocked; a tier-2 `feat/auth` push blocked for lack of a linked spec.
- **Subagents:** a `task` subagent's gitmoji-less commit was blocked by the same handler; its
  innocuous `echo ok` passed; a technical-profile `--no-verify` commit was blocked by the danger
  guard because the subagent has no approval UI.
- **Lifecycle:** `omp plugin disable adaptive-engineering` → a new session ran the destructive
  command with no harness intervention; `omp plugin enable adaptive-engineering` → the next session
  blocked it again. `omp plugin list --json` ended with `enabled: true`, the lock still holds only
  the plugin entry (`settings: {}`), and the repository has no plugin residue. This session's
  discovered list contains the 28 skills and the 5 agents, which is OMP's own discovery reporting
  them.
- **Native tools:** exercised through the `xd://` device form (`read` for the schema, `write` to
  execute); the risk tool returned the expected tier for an auth path.

## License

MIT. RSC Harness portions: Copyright (c) 2026 Eric Risco. See `LICENSE`, `LICENSE.rsc-harness` and
`NOTICE.md`.
