---
type: ftd
title: FTD — Segundo pase de cierre: estado `.rsc` en worktrees, typecheck e invocación real
description: Completar los hallazgos que el primer pase dejó fuera (F-03, F-07) y verificar contra OMP 18.17.0 los ya corregidos, sin rediseñar el port ni añadir infraestructura de estado.
author: Juan
branch: feat/closing-pass
status: done
created: 2026-11-06
slug: closing-pass-2
---

# FTD — Segundo pase de cierre: estado `.rsc` en worktrees, typecheck e invocación real

## Intent

El primer pase cerró F-01, F-02, F-04, F-05, F-06, F-08, F-09, F-10, la regla B y la matriz
`danger.mode`. Quedaron fuera, por decisión explícita, F-03 (contrato `.rsc` en worktrees) y F-07
(typecheck). Este pase los resuelve y vuelve a comprobar los anteriores contra el OMP instalado
(18.17.0, no 18.16.0) antes de declarar el cierre.

## Scope

Dentro:

- F-03: contrato explícito entre checkout de trabajo, checkout principal y declaración de proyecto;
  herencia única de opt-outs de proyecto al worktree; estado por checkout para ledger, sello, nudge y
  memoria; pruebas con `git worktree` reales.
- F-07: `tsconfig.json`, `typecheck` reproducible, tipos oficiales de OMP y narrowing con
  `isToolCallEventType`.
- Revisión F-04/F-05/F-11/F-12 en todas las skills: invocación `xd://`/tool y limpieza manual.
- Re-ejecución de la matriz `danger.mode`, la regla B y la suite completa.
- README/NOTICE con el contrato final, los conteos reales y la versión probada.

Fuera:

- Reescribir algoritmos upstream, crear un registro/DB/servicio de estado, o añadir hooks.
- Publicar, mergear o instalar el plugin globalmente.
- Convertir los cinco tools a `essential`.

## Checklist

- [x] **F-03 roots** — probado cuando un repo temporal con worktree resuelve workRoot, mainRoot y la
      declaración; el worktree hereda una sola vez los opt-outs de proyecto y nunca escribe en main.
- [x] **F-03 estado por checkout** — probado cuando ledger y sello de main y worktree viven en su
      propio `.rsc/` y no se contaminan.
- [x] **F-03 contexto git** — probado cuando un commit evaluado desde el worktree usa su rama, no la
      de main.
- [x] **R-01 proyecto anidado** — probado cuando `.rsc` en `03-PROJECTS/a` se resuelve como proyecto
      propio, y un worktree de ese subproyecto mapea su contraparte en main.
- [x] **F-01/F-02** — probado con el handler real de `/adaptive-status` y `session_switch` en
      `new`, `resume` y `fork`.
- [x] **F-07** — probado con `bun run typecheck` (0 errores) y la suite sin regresiones.
- [x] **F-08/F-09/F-10** — probado con resultado exitoso/fallido, `window` inválido y error traducido.
- [x] **F-04/F-05/F-11/F-12** — probado con `grep` sin sintaxis CLI falsa y con los `xd://` reales.
- [x] **Regla B y matriz `danger.mode`** — probado con sus suites y, si el entorno lo permite, una
      sesión OMP real.
- [x] **Documentación** — README/NOTICE con conteos, límites y contrato final observados.

## Evidence

- **F-03, roots and one-time inheritance.** `node --test tests/worktree-state.test.js` → 13/13 pass
  with real `git worktree add` checkouts: workRoot is the worktree or its nested project root,
  mainRoot is the checkout (or counterpart project) it was linked from, a fresh worktree inherits
  `.rsc.json` opt-outs plus the main `.rsc/.no-*` markers once, a worktree's marker never writes
  back, one worktree never reads another's state, a later main decision does not rewrite an existing
  worktree, a branch's own `.rsc.json` wins, and a fresh clone materializes its committed
  `.rsc.json` once.
- **R-01 nested project.** A nested `03-PROJECTS/a` with its own `.rsc`/`.rsc.json` is the project
  root, not the git toplevel; its adapter opt-out is honored, and a worktree of that subproject
  maps to `<main>/03-PROJECTS/a` for inherited decisions. The same boundary is covered in the
  adapter suite.
- **F-03, per-checkout state and git context.** `bun tests/adapter.test.ts` → the worktree section
  passes: the danger opt-out inherited from main allows `git reset --hard` in the worktree; a
  `rsc_review_ledger` round in the worktree does not append to main's ledger; a worktree
  `sello-config.json` turns the sello on there while main stays off; a `git commit` is judged on the
  worktree's branch (`feat/wt`) while main's closed trunk still blocks; `/adaptive-status` reports
  `project`, `state.worktree`, `state.mainCheckout`, `state.linkedWorktree` and the effective
  opt-outs.
- **F-01/F-02.** `tests/adapter.test.ts` runs the registered `/adaptive-status` handler (JSON with
  `trunkPolicy.closed: true`), and `session_switch` for `new`, `resume` and `fork`; an empty fork
  gets the body, a fork carrying `rsc-suggest` gets no duplicate. A real OMP 18.17.0 transcript
  contains exactly one `rsc-suggest` `custom_message` at session start.
- **F-07.** `bun run typecheck` (`tsc -p tsconfig.json`, TypeScript 7.0.2, OMP 18.17.0 types) →
  0 errors; `tool_call` uses `isToolCallEventType("bash", event)`.
- **F-08/F-09/F-10.** Same adapter suite: a failed `write` returns no nudge while a successful one
  does; `window: -1` and `1.5` are rejected, `0` is valid; the risk error names the `rsc_risk` tool
  and the `base` parameter, never `npx @ericrisco/rsc`.
- **F-04/F-05/F-11/F-12.** `grep` over `skills/` and `agents/` finds no `rsc_risk --base`,
  `rsc_review_consolidate <…>`, `rsc_review_ledger panel … --lenses`, `sello on --global`,
  `rsc_spec_gate <path>` or `rsc_risk <paths…>` invocation. The eval fixtures that described the
  upstream install now describe OMP's plugin manager. A real OMP 18.17.0 session read
  `xd://rsc_risk` and wrote `xd://rsc_risk` with `{"paths":["src/auth/login.js"],"json":true}`,
  returning `tier: 2`, `classes: ["auth"]`, `reviewers: 3`.
- **Rule B.** `node --test tests/session-peers.test.js` → 16/16, including the subdirectory boundary
  fix (a command run from a subdirectory still sees peers elsewhere in the same checkout), peers in
  another checkout, unheld leases, a fork as a live session and fail-open providers. The previous
  pass also recorded a real two-session check under OMP 18.16.0.
- **`danger.mode` matrix.** `node --test tests/danger-mode-matrix.test.js` → 5/5, and the adapter
  suite covers UI approval, UI decline, no UI, a non-technical profile never relaxed, `deny`
  hardening and `guards.danger` off.
- **Full suite.** `node --test tests/*.test.js` → **234 tests, 233 pass, 1 skipped, 0 fail** (the
  skip is the upstream materialized-copy drift test when `.rsc/danger-guard.mjs` is absent).
- **Real OMP 18.17.0.** A print session's `rm -rf /tmp/omp-rsc-should-not-exist` was blocked with
  the guard's verbatim `BLOCKED for a non-technical user` message and the target survived. `/adaptive-status`'s
  registered handler, executed inside a real session, returned JSON with both roots. OMP print mode
  does not expose slash-command dispatch, so that dispatch is covered by the adapter test, not
  claimed as a real-session check.

## Next

Ninguno: el pase está cerrado y se commitea en `feat/closing-pass`. Publicar, mergear o instalar
globalmente queda fuera de este cierre.
