---
type: review
title: Review — Ajustes del plugin en la TUI de OMP (cierre)
description: Revisión de rama completa: veredicto, hallazgos y desenlaces.
tags: [sdd, review]
timestamp: 2026-11-06T04:10:00Z
topic: sdd
slug: plugin-settings-tui
source_state: 1452b21 (dirty)
---

# Review — Ajustes del plugin en la TUI de OMP (cierre)

> Estado revisado: `671f805` en `main`. Fix posterior: `1452b21`.

## Veredicto

**CHANGES REQUESTED** en la pasada inicial: 1 should-fix, 1 nit. Ambos corregidos; el estado final
queda **APPROVE WITH NITS resueltos**.

## Cobertura

Los 14 criterios de aceptación se recorrieron contra el estado final: los cinco ajustes, los cuatro
interruptores, la tabla de modo, el aviso de una línea y el snapshot por sesión. Ningún criterio
quedó sin implementar. No se encontró ningún test que no pudiera fallar.

## Hallazgos y desenlaces

| # | Severidad | Dónde | Qué | Desenlace |
|---|---|---|---|---|
| 1 | should-fix | `targets/plugin-settings.mjs` | `resolveLockPath` no probaba el directorio XDG donde OMP escribe el lock cuando ese root existe | **fixed** en `1452b21`: candidato XDG primero, con test que lo reproduce y otro que comprueba que sin root XDG no cambia nada |
| 2 | nit | `README.md:108` | Prometía un override en `.pi/` que el código no lee | **fixed** en `1452b21` |

## Nota del revisor, no defecto

AC2 se sostiene por construcción y por los tests previos del adaptador; la línea base «antes/después»
que pide la spec no está guardada en el árbol. No es un fallo de código; es evidencia más débil de lo
que la spec pedía.

## Proceso

- Un revisor de contexto fresco, con contrato, spec, FTD, diff y estado exacto. Sin la conversación.
- No se despachó `finding-verifier`: el hallazgo 1 traía reproducción ejecutada por el revisor
  (`XDG_DATA_HOME` temporal) y el fix lleva test de regresión. Se anota como desviación consciente.
- `rsc_review_ledger`: ronda 1 de 3; dos hallazgos registrados y cerrados como `fixed`.
