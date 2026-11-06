# Progress — Ajustes del plugin en la TUI de OMP

Append-only. Newest last. Each entry: what was built, the evidence observed, and the controls.

## T001 — 2026-11-06
- status: complete
- evidence: `omp plugin config list adaptive-engineering --json` lists exactly the five keys, with `type`, non-empty `description`, and `danger.mode` carrying `values: ["auto","ask","deny"]` + `default: "auto"`.
- files: `package.json`
- controls: traceability AC1 ✅

## T002 — 2026-11-06
- status: complete
- red: `node --test tests/plugin-settings.test.js` failed — `targets/plugin-settings.mjs` did not exist.
- files: `tests/plugin-settings.test.js`

## T003 — 2026-11-06
- status: complete
- red: with the module stubbed, 5 of 10 tests failed on assertions (`resolveLockPath`, stored boolean, mode, project override).
- green: `node --test tests/plugin-settings.test.js` → pass 10, fail 0.
- files: `targets/plugin-settings.mjs`

## T004 / T005 — 2026-11-06
- status: complete
- red: with stubs, 5 gate tests failed on assertions.
- green: `node --test tests/plugin-settings-gate.test.js` → pass 8, fail 0.
- files: `tests/plugin-settings-gate.test.js`, `targets/plugin-settings.mjs`

## T006 — 2026-11-06
- status: complete
- evidence: `technicalLevel` exported; `node --test tests/danger-guard.test.js` → pass 24, fail 0, including the three profile cases (technical, non-technical, absent, plus the `.rsc.json` fallback).
- files: `targets/danger-guard.mjs`, `tests/danger-guard.test.js`

## T007 — 2026-11-06
- status: complete (enabling task, no acceptance criterion of its own)
- evidence: `bun tests/adapter.test.ts` green; `loadRsc().settings` exposes the six functions.
- files: `src/rsc-boundary.ts`, `tests/adapter.test.ts`

## T008 – T011 — 2026-11-06
- status: complete
- evidence, all observed through the real adapter against real repositories:
  - snapshot at session start; a mid-session lock change does not apply (`git commit` still blocked);
  - `guards.gitmoji=false` lets the commit through, turning it back on rejects it in the next session;
  - `guards.branch=false` lets a commit on a closed trunk through; with it on, the guard blocks;
  - `guards.ship=false` lets a dirty feature branch be left; with it on, the guard blocks;
  - `danger.mode=deny` blocks what a technical profile would only be asked about;
  - `danger.mode=ask` with a non-technical profile still blocks;
  - `danger.mode=auto` with a technical profile asks and the approval allows;
  - one startup line names disabled guards; none when all are on;
  - `session_switch` refreshes the snapshot and emits the same notice.
- files: `src/index.ts`, `tests/adapter.test.ts`

## Review — 2026-11-06 (round 1 of 3)
- tier: 1 for this slice (`rsc_risk` over `package.json`, `src/`, `targets/`, `tests/`, docs → `default` + `docs`). The whole-branch diff against `master` reports tier 2 because it includes the port files that were untracked at session start — not this feature.
- reviewer: one fresh-context reviewer, spec + diff + §0 constraints, no session reasoning.
- reported 3 → unique 3 → confirmed 3:
  - **should-fix**: the guards-off notice was only sent on `session_start`, not `session_switch`. Fixed: a shared `announceGuards()` runs on both.
  - **nit**: a verdict rewritten by `danger.mode` kept the reason written for the opposite decision (a deny showing "the person confirms it"; a confirmation showing "BLOCKED"). Fixed: `rewritten: true` marks the flip and the adapter writes the accurate message.
  - **question**: `.pi/plugin-overrides.json` could outrank `.omp`, diverging from what OMP's own settings view reads. Fixed: only `.omp` is read, matching plan §0.
- re-check: `node --test tests/*.test.js` → 198 tests, 197 pass, 0 fail, 1 skipped; `bun tests/adapter.test.ts` → all sections green, including the new switch/reason assertions.

## T012 — 2026-11-06
- status: complete
- evidence: `README.md` carries the five keys and the precedence rules; `NOTICE.md` records the `technicalLevel` export and `targets/plugin-settings.mjs` as new code.
- files: `README.md`, `NOTICE.md`

## T013 — 2026-11-06
- status: complete with one limit
- battery: the four reference commands run through the real adapter against fixture repositories — `git reset --hard HEAD`, `git commit -m "📝 prueba"` on a closed trunk, `git switch main` with uncommitted work, `git commit -m "fix: no emoji"` — each blocked with the guard on and allowed with it off.
- limit: the screenshot of Settings → Plugins needs a human look. The manifest behind it is proven with `omp plugin config list adaptive-engineering --json`, which reads the same declaration the page draws.
- files: `tests/adapter.test.ts`

## T014 — 2026-11-06
- status: complete
- evidence: `node --test tests/*.test.js && bun tests/adapter.test.ts` → 0 failures.

## Notes for whoever resumes
- The working tree carried an uncommitted port when this branch started; several commits therefore contain pre-existing untracked files alongside this feature. Nothing from the port was modified by this change except `danger-guard.mjs` (one `export`).
- No blocking decision queue entries. No `review-after` entries.

## Cierre — 2026-11-06

- **Feature cerrada.** `feat/plugin-settings-tui` en `a144312`; gate de verificación PASS (r2) con la
  captura de la página. Sin entradas bloqueantes en la cola.
- **Sin remoto**: no hay PR. Para aterrizar en `master`:
  `git switch master && git merge --no-ff feat/plugin-settings-tui`
- **Cambio hermano**: `feat/todo-progress` en `e3b2f27` — `tasks` e `implement` espejan la tabla en la
  herramienta `todo`, más el FTD y su evidencia.
  `git switch master && git merge --no-ff feat/todo-progress`
- **No ejecutado**: la revisión de rama completa (stage 5). Se puede lanzar cuando se pida.
- El port sigue parcialmente sin trackear (`targets/`, `agents/`, `scripts/`, `skills/*`); los commits
  de estas ramas arrastraron parte de esos ficheros.

## Revisión de cierre — 2026-11-06
- veredicto inicial: CHANGES REQUESTED — 1 should-fix, 1 nit.
- should-fix: `resolveLockPath` no miraba `$XDG_DATA_HOME/omp/plugins`, que es donde OMP escribe con
  XDG activo. Corregido con candidato XDG primero y dos tests (con root XDG y sin él).
- nit: el README prometía `.pi/`; eliminado.
- fix: `1452b21`. Suite: 200 tests, 199 pasan, 0 fallan, 1 omitido.
