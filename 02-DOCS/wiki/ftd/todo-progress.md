---
type: ftd
title: FTD — Checklist vivo en la TUI durante una implementación
description: El flujo portado debe espejar su tabla de tareas en la herramienta todo de OMP, para que el progreso se vea y se marque en la TUI.
author: Juan
branch: feat/plugin-settings-tui
status: done
created: 2026-11-06
slug: todo-progress
---

# FTD — Checklist vivo en la TUI durante una implementación

## Intent

Durante una implementación larga, el flujo portado escribe una tabla de tareas y un ledger en
`02-DOCS`, pero no toca la herramienta `todo`. La persona se queda sin la vista que usa en Claude
Code: el checklist que avanza en la TUI. Se quiere esa vista, alimentada por la tabla que ya existe,
sin crear un segundo sistema de estado.

## Scope

Dentro:

- `skills/tasks/SKILL.md`: al cerrar la tabla, crear el `todo` con una fase por grupo de secuencia y
  un ítem por tarea.
- `skills/implement/SKILL.md`: marcar cada tarea al empezar y al cerrar, bloquear lo aparcado y
  reconciliar tras una compactación.
- `NOTICE.md`: registrar la divergencia deliberada del upstream.

Fuera:

- Código del plugin. Una extensión no puede invocar ni escribir todos: `invokeTool` es same-tool y
  `setTodos` es interno del modo interactivo.
- Un renderer propio con `setStatus`/`setWidget`.
- Cambiar el ledger `progress/<slug>.md`: sigue siendo la fuente de verdad durable.

## Checklist

- [x] **Escribir el FTD** — hecho cuando este fichero existe y está indexado.
- [x] **Instruir `tasks` a espejar la tabla en `todo`** — hecho cuando el SKILL.md describe la
      llamada (`op: init`), el mapeo fase/ítem y qué hacer si no hay herramienta.
- [x] **Instruir `implement` a marcar por tarea** — hecho cuando el SKILL.md tiene `start`/`done`/
      `block` y la regla de reconciliación tras compactar.
- [x] **Anotar la divergencia en NOTICE** — hecho cuando una línea del NOTICE dice qué se añadió
      respecto al upstream y por qué.
- [x] **Comprobar que las instrucciones son ejecutables** — hecho cuando un `grep` encuentra el
      bloque en cada SKILL.md y el `todo` de esta misma sesión ha avanzado con el trabajo.
- [x] **Evidencia en el FTD** — hecho cuando la sección Evidence cita fichero, línea y resultado.

## Evidence

- `skills/tasks/SKILL.md:178` — «Mirror the table into OMP's `todo` tool»: `op: "init"`, una fase por
  grupo de secuencia, un ítem por fila, y qué hacer cuando no hay herramienta.
- `skills/implement/SKILL.md:220` — «Keep the TUI checklist in step with the table»: `todo start`,
  `todo done` solo tras el done-check y la entrada de progreso, `todo block` para lo aparcado,
  `todo view` al reanudar. Tres operaciones citadas en el fichero.
- `NOTICE.md:37` — la divergencia registrada como adición deliberada, con el motivo.
- Prueba de ejecución: el `todo` de esta misma sesión existe, tiene 3 fases y 6 ítems, y avanzó con
  cada paso de este cambio. El flujo se usó para producirse a sí mismo.

## Next

Cerrar el ciclo cuando el usuario confirme. Si funciona, el mismo patrón sirve para `debug` y
`parallel` más adelante.
