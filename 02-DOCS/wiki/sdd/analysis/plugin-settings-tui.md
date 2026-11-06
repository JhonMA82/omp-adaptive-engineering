---
type: analysis
title: Analysis — Ajustes del plugin en la TUI de OMP
description: Gate de consistencia spec ↔ plan ↔ tareas antes de implementar.
tags: [sdd, analysis]
timestamp: 2026-11-06T02:07:00Z
topic: sdd
slug: plugin-settings-tui
status: pass
---

# Analysis — Ajustes del plugin en la TUI de OMP

> Spec: [../specs/plugin-settings-tui.md](../specs/plugin-settings-tui.md) · Plan:
> [../plans/plugin-settings-tui.md](../plans/plugin-settings-tui.md) · Constitución: ausente por
> decisión registrada (2026-11-06).

**GATE: PASS** — 0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW. Re-ejecución tras resolver los cuatro
hallazgos de la pasada anterior.

La ausencia de constitución no es un hallazgo: se decidió en `clarify` y está registrada. Sin
constitución no hay principios contra los que comparar, así que esa comprobación no aplica.

## Mapa de cobertura

| AC | Requisito (corto) | Plan § | Tareas | Estado |
| --- | --- | --- | --- | --- |
| AC1 | Cinco filas con descripción y valor | §3, §5 | T001, T012 | covered |
| AC2 | Defaults idénticos a hoy | §2, §5 | T002, T003 | covered |
| AC3 | `guards.danger` off permite | §3, §5 | T004, T005, T009 | covered |
| AC4 | `guards.branch` off permite | §3, §5 | T004, T005, T009 | covered |
| AC5 | `guards.ship` off permite | §3, §5 | T004, T005, T009 | covered |
| AC6 | `guards.gitmoji` off permite | §3, §5 | T004, T005, T009 | covered |
| AC7 | Volver a encender rechaza | §3, §5 | T004, T005, T009 | covered |
| AC8 | Opt-out del repo manda | §0, §3 | T004, T005, T009 | covered |
| AC9 | `auto`: técnico pregunta, no técnico deniega | §0, §3, §5 | T006, T010 | covered |
| AC10 | `deny` deniega con perfil técnico | §0, §3, §5 | T006, T010 | covered |
| AC11 | `ask` con no técnico sigue denegando | §0, §3, §5 | T006, T010 | covered |
| AC12 | Una línea al arrancar, o ninguna | §3, §5 | T004, T005, T011 | covered |
| AC13 | Persistencia tras reinicio | §5 | T002, T003 | covered |
| AC14 | Aplica en la sesión siguiente | §0, §2, §5 | T008 | covered |

Sin GAP. Sin DRIFT.

## Hallazgos de la pasada anterior, resueltos

| # | Severidad | Qué era | Resolución |
| --- | --- | --- | --- |
| 1 | HIGH | El plan no nombraba la batería de referencia que la spec le delega | Plan §5: tabla con los cuatro comandos y su precondición de fixture |
| 2 | MEDIUM | T007 (frontera) trazaba a AC2 sin satisfacerlo | Fila marcada `— (habilitante)` |
| 3 | MEDIUM | `technicalLevel` podía devolver `mixed` y el plan no lo mapeaba | Plan §0 y §3: solo `technical` es técnico; ausente → sin perfil; el resto → no técnico |
| 4 | LOW | `session_switch` podía leerse como recarga en caliente | Plan §0: cuenta como sesión nueva, no hay relectura dentro de una sesión |

## Comprobación de portadores (implementador aislado)

- §0 lleva los valores verbatim: cinco claves, valores de enum, defaults, almacenamiento, momento de
  aplicación, opt-outs, fallo abierto, toolchain. Presente.
- Tareas con contrato cruzado (T007–T010) llevan bloque **Interfaces** con lo que consumen y lo que
  producen. Presente.
- Ninguna tarea depende de una firma que solo exista en prosa.

## Ruta

`GATE: PASS`. Siguiente fase: `implement`, en la rama `feat/plugin-settings-tui`.
