---
type: verification
title: Verification — Ajustes del plugin en la TUI de OMP — 2026-11-06
description: Evidencia del gate de cierre: stack, done-checks y criterios de aceptación.
tags: [sdd, verification]
timestamp: 2026-11-06T02:45:00Z
topic: sdd
slug: plugin-settings-tui
source_state: c03bde6 (dirty)
---

# Verification — Ajustes del plugin en la TUI de OMP — 2026-11-06

> Rama: `feat/plugin-settings-tui` · Estado medido: `c03bde6`, árbol sucio por los ficheros del port
> que nunca se commitearon.

## Stack gate

- `node --test tests/*.test.js` → **PASS**: 198 tests, 197 pasan, 0 fallan, 1 omitido.
- `bun tests/adapter.test.ts` → **PASS**: las seis secciones, incluida la batería de referencia y el
  aviso de arranque, ejecutadas contra repositorios reales.

## Task done-checks

- [x] T001 cinco claves en el manifiesto — `omp plugin config list adaptive-engineering --json`.
- [x] T002/T003 lector con defaults, merge y fallo abierto — `tests/plugin-settings.test.js`, 10/10.
- [x] T004/T005 gate, modo y aviso — `tests/plugin-settings-gate.test.js`, 8/8.
- [x] T006 `technicalLevel` distingue ausente de no técnico — `tests/danger-guard.test.js`, 24/24.
- [x] T007 frontera carga el módulo — aserción en `tests/adapter.test.ts`.
- [x] T008–T011 snapshot, interruptores, modo y aviso — sección de settings del adaptador.
- [x] T012 documentación — claves en `README.md`, adaptación en `NOTICE.md`.
- [x] T013 batería de referencia — cuatro comandos, encendido/apagado, en fixtures reales.
- [x] T014 cierre — suite completa sin fallos.

## Acceptance criteria (spec)

- [x] AC1 cinco filas — **datos** probados por CLI. **Render de la página: sin verificar** (ver abajo).
- [x] AC2 defaults idénticos — los tests previos del adaptador (deny/ask/decline/allow) siguen verdes sin tocar ajustes.
- [x] AC3 `guards.danger` off permite — aserción del adaptador.
- [x] AC4 `guards.branch` off permite — commit en troncal cerrada, fixture real.
- [x] AC5 `guards.ship` off permite — salir de rama sucia, fixture real.
- [x] AC6 `guards.gitmoji` off permite — commit sin emoji.
- [x] AC7 volver a encender rechaza — misma sesión siguiente, mismo comando.
- [x] AC8 opt-out del repo manda — `.rsc/.no-gitmoji` con el ajuste encendido.
- [x] AC9 `auto` sigue el perfil — técnico pregunta y la aprobación permite; no técnico deniega.
- [x] AC10 `deny` deniega con perfil técnico — aserción con sesión interactiva que aprobaría.
- [x] AC11 `ask` con perfil no técnico deniega — aprobando también, bloquea.
- [x] AC12 aviso de arranque — una línea con el nombre, ninguna con todo encendido, y también en `session_switch`.
- [x] AC13 persistencia — el lector relee el fichero en cada arranque; valor guardado leído de disco.
- [x] AC14 sesión siguiente — cambiar el lock a mitad de sesión no altera el snapshot.

## Rollback plan

- `git revert c03bde6..6e8b826` sobre la rama, o abandonarla con `git switch master`.
- Sin migración de datos ni estado nuevo: al borrar `omp.settings` del manifiesto, el plugin vuelve al
  comportamiento anterior; los guardas leen defaults y todos quedan encendidos.

## Capas no ejecutadas

- **NO-APLICA** — auditoría de dependencias: `package.json` no declara ninguna.
- **NO-APLICA** — el test de deriva del estado de instalación (`danger-guard.test.js:170`) se omite
  porque este checkout no tiene `.rsc/danger-guard.mjs`.
- **SUSTITUIDA** — render de la página de ajustes: se ejecutó la lista por CLI, que lee el mismo
  manifiesto. No detecta un defecto de dibujado en la TUI.

## Hallazgos descartados

- Ninguno.

## Verdict: FAIL — 1 open item (AC1, render de la página)

El código, los interruptores, el modo y el aviso están probados con salida de comandos leída. Lo único
sin evidencia observable es que la página de Settings → Plugins dibuje las cinco filas: eso pide una
mirada humana con OMP abierto. No es un defecto conocido; es una comprobación que no se ejecutó.
