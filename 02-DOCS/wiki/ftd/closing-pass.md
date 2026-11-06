---
type: ftd
title: FTD — Pase de cierre del port: aislamiento, defectos y fidelidad
description: Cerrar el port de RSC Harness a OMP resolviendo la regla B del Branch Guard con primitivas nativas, los defectos del adaptador y las contradicciones de skills y README, sin rediseñar nada.
author: Juan
branch: feat/closing-pass
status: done
created: 2026-11-06
slug: closing-pass
---

# FTD — Pase de cierre del port: aislamiento, defectos y fidelidad

## Intent

El port funciona, pero no está cerrado: la regla B del Branch Guard es inerte, `/adaptive-status`
lanza `ReferenceError`, `suggest` no se inyecta al cambiar de sesión, `worktrees`/`ftd` prometen
hooks que no existen, y el README afirma cosas que el código no hace. Se cierra el port conservando
lo que funciona: módulos upstream reutilizados, metodología, skills y tests originales.

El aislamiento se resuelve con lo que OMP ya ofrece (leases de propiedad por sesión + listado de
sesiones), no con un registro propio.

## Scope

Dentro:

- `targets/branch-guard.mjs`: la regla B recibe un proveedor de sesiones pares; reglas A y C intactas.
- `targets/omp-session-peers.mjs`: frontera OMP de la regla B (nativo: `listSessions`,
  `listRecentSessions`, `probeSessionLeases`).
- `src/index.ts`: cableado de peers; F-01 status, F-02 suggest en `session_switch`, F-08 nudge,
  F-09 `window`, F-10 error traducido.
- Tests: adaptador (status y switch), peers unitarios, matriz `danger.mode`, suite completa.
- Skills: `worktrees`, `ftd`, `harness` y referencias operativas a `CLAUDE.md`/tools.
- `README.md`, `NOTICE.md`: estado real, límites y conteos.

Fuera:

- Reescribir guards, reglas o regexes; implementar un CLI de RSC.
- Registro de sesiones, locks, daemon, base de datos o estado paralelo.
- Herencia de estado `.rsc` entre worktrees (se documenta como contrato por checkout).
- `loadMode` de los tools (se mantiene el diseño discoverable de OMP y se documenta).
- Typecheck con dependencias nuevas (no se añaden devDependencies).

## Checklist

- [x] **Regla B nativa** — probado cuando dos sesiones reales sobre un mismo checkout bloquean
      `git switch` y una sesión en otro checkout no lo hace.
- [x] **Reglas A y C intactas** — probado cuando el diff de `branch-guard.mjs` solo toca
      `othersHere`/firma de `evaluate` y la suite original sigue verde.
- [x] **F-01** — probado cuando el handler de `/adaptive-status` devuelve JSON en el adaptador.
- [x] **F-02** — probado cuando `session_switch` inyecta `rsc-suggest` una vez y no duplica.
- [x] **F-08/F-09/F-10** — probado con un test que cubre cada camino.
- [x] **Matriz `danger.mode`** — probado con perfiles técnico/no técnico/sin perfil × auto/ask/deny.
- [x] **Skills sin referencias falsas** — probado con `grep` de `npx`, hooks prometidos, `CLAUDE.md`
      operativo y sintaxis CLI de tools. Alcance: los fixtures de `skills/*/evals/` conservan el CLI
      upstream a propósito y llevan nota de puerto; no se ejecutan como instrucciones.
- [x] **Tests reales de guards** — probado con repos temporales: destructivo, inocuo, gitmoji, troncal.
- [x] **Subagente** — probado con un `task` real que recibe bloqueo y con un comando inocuo.
- [x] **Ciclo del plugin** — probado con `omp plugin disable/enable/list` sin residuos.
- [x] **Documentación** — probado cuando README y NOTICE citan los resultados de esta ejecución.

## Evidence

- **Aislamiento, mismo checkout (regla B).** Sesión RPC viva en `/tmp/rsc-ruleb.vAwJC7`
  (`omp session lease --json` → `held`), luego una sesión OMP nueva:
  `git -C /tmp/rsc-ruleb.vAwJC7 switch -c feat/probe2` → bloqueado con «Another session is working in
  this same folder (another OMP session, just now)» y la salida `/adaptive-isolation-off`. La rama no
  se creó.
- **Aislamiento, otro checkout.** Con la misma sesión viva, `git -C /tmp/rsc-ruleb-other.xexzNB
  switch -c feat/other` → permitido (`Cambiado a nueva rama 'feat/other'`). Sin falso positivo.
- **Re-verificación con el código final.** Sesión RPC viva en `/tmp/rsc-final.FYakXl`
  (`held` confirmado con `omp session lease`), sesión nueva: `git switch -c feat/final` → bloqueado
  con el mensaje de regla B y la rama no se creó.
- **Reglas A y C.** `node --test tests/session-peers.test.js` → 7/7. El diff de `branch-guard.mjs`
  solo añade el parámetro `peers` y su paso a `othersHere`/denegaciones; regexes, reglas y mensajes
  intactos.
- **Guards reales** (`omp -p --auto-approve`, repos temporales):
  - `rm -rf /tmp/rsc-danger-should-not-exist` → bloqueado (perfil ausente → deny).
  - `echo "rm -rf /tmp/x"` → permitido (texto entre comillas, no comando).
  - `git commit --allow-empty -m "no emoji"` → bloqueado por gitmoji.
  - `git switch main` con `pending.txt` sin commit en `feat/x` → bloqueado por ship.
  - commit en `main` con `.rsc/.no-trunk-open` → bloqueado, con `/adaptive-main-unlock` en el mensaje.
- **Subagentes reales.** `task` con `git commit --allow-empty -m "no emoji"` → bloqueado por el
  gitmoji guard dentro del hijo; `echo ok` → permitido; `git commit --allow-empty --no-verify -m
  "📝 ok"` con perfil técnico → bloqueado con «No interactive approval is available in this
  session», y sin commit creado.
- **Push tier 2.** Rama `feat/auth` con `src/auth/login.js` y remoto local: `git push -u origin
  feat/auth` → bloqueado por el gate ASDD por no haber spec enlazada.
- **Panel de refuters (tier 2).** `rsc_risk` clasificó el cambio como tier 2 (default+auth+docs).
  `refuter-correctness` encontró un should-fix real — `parentSessionPath` descartaba también forks y
  continuaciones, no solo hijos de subagente — corregido con `isChildSession` y pruebas de fork.
  `refuter-tests` encontró huecos de cobertura (cableado `peers:`, dedupe de `suggest`, fail-open,
  bucket reciente, repo anidado, identidad, nudge positivo, `window: 0`); todos tienen prueba nueva.
  `refuter-security` se aparcó sin informe; el relanzado acotado encontró dos endurecimientos:
  un registro con `cwd` malformado descartaba todos los pares (ahora el error se aísla por registro)
  y `within` fallaba con una raíz de filesystem (corregido y probado). También señaló que un fork
  puede llevar `parentSessionPath` con forma de ruta; por eso el filtro de padre se eliminó: los
  journals de subagente viven anidados y no se enumeran, y los forks sí deben contar.
- **Suite:** `node --test tests/*.test.js` → 220 tests, 219 pass, 1 skipped, 0 fail;
  `bun tests/adapter.test.ts` → verde con los casos nuevos de status, `session_switch`, dedupe, nudge,
  `window`, error de `rsc_risk` y cableado de `peers`.

## Next

Ninguno: el pase está cerrado. Queda fuera de este FTD la decisión de commitear/abrir PR (no autorizada) y el typecheck (no se añaden dependencias).
