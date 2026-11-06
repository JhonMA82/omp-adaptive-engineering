---
type: plan
title: Plan — Ajustes del plugin en la TUI de OMP
description: Estructura del cambio para exponer cuatro interruptores de guard y danger.mode, leídos una vez por sesión.
tags: [sdd, plan]
timestamp: 2026-11-06T01:51:22Z
topic: sdd
slug: plugin-settings-tui
status: approved
---

# Plan — Ajustes del plugin en la TUI de OMP

> Spec: [../specs/plugin-settings-tui.md](../specs/plugin-settings-tui.md) · Constitution: none
> Status: draft · Last updated: 2026-11-06

## 0. Global Constraints

- **Claves exactas:** `guards.danger`, `guards.branch`, `guards.ship`, `guards.gitmoji`, `danger.mode`. Nada más se expone.
- **Valores de `danger.mode`:** exactamente `auto`, `ask`, `deny`. Por defecto `auto`.
- **Booleanos:** por defecto `true` en los cuatro.
- **Mapeo de perfil:** exactamente `technical` → técnico; ausente o vacío → sin perfil; cualquier otro valor (`non-technical`, `mixed`, …) → no técnico.
- **`session_switch` cuenta como sesión nueva** para el snapshot. No es recarga en caliente: no hay relectura dentro de una misma sesión.
- **Almacenamiento:** `settings["adaptive-engineering"][<clave>]` en `<plugins>/omp-plugins.lock.json`. Override por proyecto en `<root>/.omp/plugin-overrides.json`, y el proyecto gana sobre el global.
- **Momento de aplicación:** se lee al empezar la sesión. Un cambio a mitad de sesión no altera nada hasta la siguiente.
- **Opt-outs del repo:** `.rsc/.no-danger-guard`, `.rsc/.no-trunk-guard`, `.rsc/.no-worktree-isolation`, `.rsc/.no-ship-guard`, `.rsc/.no-gitmoji` desactivan siempre, con independencia del ajuste global.
- **Semántica upstream:** con un guard encendido, su veredicto y su mensaje no cambian. Cualquier cambio en un fichero de `targets/` se anota en `NOTICE.md`.
- **Fallo abierto:** configuración ilegible o inválida → valores por defecto. Error interno del guard → deja pasar, nunca bloquea.
- **Sin dependencias nuevas** y sin directorio de estado nuevo.
- **Aviso de arranque:** exactamente una línea, solo cuando al menos un guard está apagado.
- **Toolchain:** Node ≥ 18. JS: `node --test tests/*.test.js`. Adaptador TS: `bun tests/adapter.test.ts`.

## 1. Context & constraints

- Criterios que fijan el diseño: spec AC #1 (las cinco filas salen del manifiesto), #3–#7 (encendido/apagado por guard), #8 (el opt-out del repo manda), #9–#11 (`danger.mode` nunca afloja un perfil no técnico), #12 (aviso), #14 (aplica en la sesión siguiente).
- Barra no funcional: el camino caliente es `tool_call` en cada comando de shell. Cero lectura de fichero por llamada.
- Sin constitución: los principios aplicables vienen de `README.md` (sin motor de workflow, sin segundo almacén de estado) y `NOTICE.md` (semántica upstream intacta).
- Fuera de alcance que el diseño no debe invadir: rutas de specs, panel de revisión, sello, tier, interruptores por proyecto en la UI, recarga en caliente.

## 2. Architecture

```text
package.json (omp.settings)          <- EXTERNAL: OMP lo lee y pinta la página
        |
        | la TUI escribe
        v
<plugins>/omp-plugins.lock.json      <- EXTERNAL: almacén de OMP
        |
        | readSettings(), una vez por sesión
        v
[ settings snapshot ] (internal) ---- session_start ---> [ aviso de una línea ] (internal)
        |
        | guardEnabled / applyDangerMode
        v
[ gate en tool_call ] (internal) ---> ship | branch | gitmoji | danger (internal, sin cambios)
```

- **Manifiesto** (external) — declara el esquema; OMP lo pinta y valida. El plugin no dibuja nada.
- **Snapshot** (internal) — resuelve la ruta del lock, mezcla el override del proyecto, valida y congela los valores al empezar la sesión.
- **Gate** (internal) — decide si cada guard se ejecuta y ajusta el veredicto de `danger` según el modo.
- **Aviso** (internal) — una línea al arrancar si hay guards apagados.
- **Guards** (internal) — los módulos de `targets/` siguen decidiendo lo mismo.

**Decisión principal:** congelar los ajustes al empezar la sesión, en vez de leerlos en cada llamada. Motivo: el contrato dice que un cambio aplica en la sesión siguiente (#14), y leer por llamada lo haría aplicarse al instante. De regalo, `tool_call` no toca el disco y la semántica de "sesión siguiente" sale por construcción, no por una caché que hay que acertar.

## 3. Interfaces & contracts

```text
readSettings({ lockPath, projectPaths }) -> Settings
  - never throws: fichero ausente, JSON inválido, tipo incorrecto → defaults
  - merge: el override del proyecto gana clave a clave
  - invariant: devuelve siempre las cinco claves, con tipo válido
Settings = {
  guards: { danger: boolean, branch: boolean, ship: boolean, gitmoji: boolean },
  dangerMode: 'auto' | 'ask' | 'deny'
}

resolveLockPath({ agentDir }) -> string | null
  - prueba <agentDir>/plugins/omp-plugins.lock.json y <dirname(agentDir)>/plugins/omp-plugins.lock.json
  - null cuando ninguna existe → defaults
  - precondition: agentDir viene de OMP, no se inventa

guardEnabled(settings, name) -> boolean
  - false si el ajuste es false; el opt-out del repo lo aplica el guard, no esta función

applyDangerMode(mode, verdict, profile) -> verdict
  - profile ∈ 'technical' | 'non-technical' | null
  - mapeo desde el valor crudo del perfil: exactamente 'technical' → 'technical';
    ausente o vacío → null; cualquier otro valor ('non-technical', 'mixed', …) → 'non-technical'
  - auto  → verdict intacto
  - deny  → cualquier verdict no-allow pasa a deny
  - ask   → deny solo si profile === 'non-technical'; si profile es technical o null, ask
  - allow no se toca nunca

startupNotice(settings) -> string | null
  - una línea, o null si los cuatro están encendidos
```

Dos adaptaciones fuera de `src/`, ambas anotadas en `NOTICE.md`:

- `targets/danger-guard.mjs` exporta `technicalLevel(root)` (hoy es función privada) para que el modo distinga «sin perfil» de «perfil no técnico».
- `src/rsc-boundary.ts` gana `plugin-settings` en `loadRsc()` y su interfaz tipada.

## 4. Data model & flow

**Entidades**

- **Settings** — cinco valores validados; sin estado propio en disco.
- **Snapshot** — un `Settings` por sesión, en memoria del proceso de la extensión.

**Flujo principal** (`abrir la página, cambiar, siguiente sesión`)

1. La TUI escribe `settings["adaptive-engineering"]["guards.gitmoji"] = false` en el lock de OMP.
2. La sesión en curso no cambia: su snapshot ya está congelado.
3. Al empezar la sesión siguiente, `session_start` → `resolveLockPath` → `readSettings` → snapshot nuevo.
4. `tool_call` consulta `guardEnabled(snapshot, 'gitmoji')`; si es `false`, no llama al guard.
5. `session_start` emite el aviso con `startupNotice(snapshot)`.

- Frontera de consistencia: el snapshot es inmutable durante la sesión; el único punto que lo sustituye es `session_start` (y `session_switch`).
- Impacto de migración: ninguno. Sin ajustes guardados, defaults = comportamiento actual.

## 5. Testing strategy

| Criterio de aceptación | Nivel | Qué afirma | Qué falsea |
| --- | --- | --- | --- |
| #1 cinco filas | contrato | `omp plugin config list --json` devuelve exactamente las cinco claves con descripción y tipo | nada; lee el manifiesto real |
| #2 defaults idénticos | integración | la batería de referencia da el mismo veredicto y mensaje antes y después | el lock (fichero temporal vacío) |
| #3–#6 un guard apagado permite | unidad | `guardEnabled` corta la llamada al guard correspondiente | el lock |
| #7 volver a encender rechaza | unidad | con el valor a `true` el guard vuelve a decidir | el lock |
| #8 opt-out del repo manda | unidad | el gate no puede reactivar lo que el repo apagó | el lock |
| #9–#11 `danger.mode` | unidad | tabla `mode × profile × verdict`; `ask` con no técnico sigue denegando | el perfil (se pasa como argumento) |
| #12 aviso | unidad | una línea con nombres cuando hay apagados; `null` con todos encendidos | el lock |
| #13 persistencia | contrato | releyendo el lock tras reinicio, el valor sigue | nada; el fichero real de un tmpdir |
| #14 sesión siguiente | unidad | cambiar el fichero no altera el snapshot vigente; `refresh()` sí | el reloj: se llama a `refresh` explícitamente |

- La línea e2e: la página de la TUI no se automatiza. Se prueba el mismo manifiesto por CLI y se guarda una captura; el criterio se apoya en la lista, no en la imagen.
- Dependencia real obligatoria: el lock en disco y el manifiesto en `package.json`. No se mockean: son el contrato.

**Batería de referencia** (los cuatro comandos que la spec delega al plan). Cada uno se ejecuta en
un repositorio temporal con la precondición indicada; el veredicto esperado con los valores por
defecto es «rechazado».

| Guard | Comando | Precondición del fixture |
| --- | --- | --- |
| `danger` | `git reset --hard HEAD` | perfil técnico en `02-DOCS/wiki/harness/user-profile.md` → pide confirmación; sin perfil o no técnico → deniega |
| `branch` | `git commit -m "📝 prueba"` | rama por defecto con `.rsc/.no-trunk-open` |
| `ship` | `git switch master` | rama de trabajo con un fichero sin commitear |
| `gitmoji` | `git commit -m "fix: prueba"` | repositorio limpio, sin opt-out |

## 6. Sequencing & dependencies

1. Manifiesto `omp.settings` en `package.json` + comprobación con `omp plugin config list --json` — depende de: nada — serial.
2. `targets/plugin-settings.mjs`: `resolveLockPath`, `readSettings`, `guardEnabled`, `applyDangerMode`, `startupNotice` + `tests/plugin-settings.test.js` — depende de: #1 — serial.
3. `technicalLevel` exportado en `danger-guard.mjs` + su test — depende de: nada — paralelizable con #2.
4. Wire en `src/index.ts`: snapshot en `session_start`/`session_switch`, gate en `tool_call`, aviso — depende de: #2, #3 — serial.
5. `src/rsc-boundary.ts`: interfaz y carga del módulo nuevo — depende de: #2 — serial.
6. Documentación: tabla de ajustes en `README.md` y nota de adaptación en `NOTICE.md` — depende de: #4 — paralelizable con #7.
7. Verificación: batería de referencia antes/después, captura de la página, evidencia en `02-DOCS/wiki/sdd/progress/plugin-settings-tui.md` — depende de: #4, #5 — serial.

- Paralelizables: #2 y #3 (ficheros disjuntos); #6 con #7.
- Orden duro: el wire no existe sin el módulo (#2) ni sin `technicalLevel` (#3); la verificación no existe sin el wire.

## 7. Risks & open decisions

**Riesgos**

| Riesgo | Disparador | Impacto | Mitigación |
| --- | --- | --- | --- |
| Ruta del lock mal resuelta (perfiles, XDG) | Instalación con `PI_CONFIG_DIR`, perfil o `omp config init-xdg` | Los ajustes se ignoran en silencio | Dos rutas candidatas desde `getAgentDir()`; si ninguna existe, defaults (guardas encendidas). Se prueba con tmpdir |
| El manifiesto no llega a la TUI | OMP cachea el paquete al enlazarlo | Cinco filas ausentes | Comprobar con `omp plugin config list --json`; si no aparece, recargar el plugin antes de seguir |
| `applyDangerMode` cambia el veredicto del perfil técnico | `deny` sobre un `ask` | Un comando que preguntaba ahora se bloquea | Es el contrato (#10). Cubierto por tabla de casos |
| Cambio de `cwd` a mitad de sesión | `session_switch` no dispara | Override del proyecto obsoleto | Se refresca también en `session_switch`; se anota como límite conocido |
| Lectura de `technicalLevel` duplicada | Exportar la función toca un fichero upstream | Deriva entre guard y modo | Una sola fuente: el export; `NOTICE.md` lo registra |

**Decisiones abiertas**

- Ninguna que bloquee. El caso del colaborador no técnico sigue sin formularse (spec, *área no formulable*) y no toca este plan.

## Tasks
<!-- generated by tasks on 2026-11-06; IDs are stable, do not renumber -->

| ID | [P] | Task | Done-check | Depends-on | Trace | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| T001 |  | Declarar `omp.settings` con las cinco claves en `package.json` | `omp plugin config list adaptive-engineering --json` devuelve las cinco claves; cada una con `type` y descripción no vacía; `danger.mode` con `values: ["auto","ask","deny"]` y `default: "auto"` | — | AC1 | 1 |
| T002 | [P] | Escribir los tests del lector de ajustes, en rojo | `node --test tests/plugin-settings.test.js` falla porque `targets/plugin-settings.mjs` no existe | — | AC2, AC13 | 1 |
| T003 |  | Implementar `resolveLockPath` y `readSettings` | T002 en verde, incluidos defaults, merge de proyecto, JSON inválido y fichero ausente | T002 | AC2, AC13 | 1 |
| T004 | [P] | Escribir los tests del gate y del modo, en rojo | `node --test tests/plugin-settings-gate.test.js` falla por módulo ausente | — | AC3–AC12 | 1 |
| T005 |  | Implementar `guardEnabled`, `applyDangerMode` y `startupNotice` | T004 en verde; la tabla modo × perfil × veredicto cubre los nueve casos | T004 | AC3–AC12 | 1 |
| T006 | [P] | Exportar `technicalLevel` desde `danger-guard.mjs` y probarlo | `node --test tests/danger-guard.test.js` verde con los tres casos (technical, no técnico, sin perfil); los tests existentes de `evaluateDanger` siguen verdes | — | AC9–AC11 | 1 |
| T007 |  | Añadir `plugin-settings` a `src/rsc-boundary.ts` | `bun tests/adapter.test.ts` verde y `loadRsc()` expone las cinco funciones | T003, T005 | — (habilitante) | 1 |
| T008 |  | Congelar el snapshot en `session_start` y `session_switch` | Test del adaptador: tras `session_start` con un lock que apaga `gitmoji`, el snapshot lo refleja; cambiado el fichero sin nuevo `session_start`, no | T007, T006 | AC14 | 1 |
| T009 |  | Saltar cada guard apagado en `tool_call` | Test del adaptador: con `guards.gitmoji=false` un commit sin gitmoji pasa; con `true` se bloquea | T008 | AC3–AC8 | 1 |
| T010 |  | Aplicar `applyDangerMode` al veredicto de danger | Test del adaptador: `deny` + perfil técnico bloquea; `ask` + perfil no técnico bloquea; `auto` sin perfil bloquea | T009 | AC9–AC11 | 1 |
| T011 |  | Emitir el aviso de arranque | Test del adaptador: un guard apagado → un mensaje con su nombre; todos encendidos → ninguno | T008 | AC12 | 1 |
| T012 | [P] | Documentar los ajustes en `README.md` y la adaptación en `NOTICE.md` | `grep` encuentra las cinco claves en README y la exportación de `technicalLevel` en NOTICE | T001 | AC1 | 0 |
| T013 |  | Batería de referencia y evidencia | Los comandos de referencia se ejecutan con defaults y con cada guard apagado; la salida queda en `02-DOCS/wiki/sdd/progress/plugin-settings-tui.md`, con captura de la página | T009, T010, T011 | todas | 1 |
| T014 |  | Cierre: todas las comprobaciones | `node --test tests/*.test.js && bun tests/adapter.test.ts` sale 0; cada fila marcada con su evidencia | todas | todas | — |

**T007 — Interfaces**
- Consume: `resolveLockPath({agentDir}) -> string | null`, `readSettings({lockPath, projectPaths}) -> Settings`, `guardEnabled(s, name) -> boolean`, `applyDangerMode(mode, verdict, profile) -> verdict`, `startupNotice(s) -> string | null`
- Produce: `loadRsc().settings` con esas cinco funciones, y el tipo `SettingsModule` en `src/rsc-boundary.ts`

**T008 — Interfaces**
- Consume: `loadRsc().settings.readSettings`
- Produce: un `Settings` inmutable por sesión, sustituido solo en `session_start` y `session_switch`

**T009 — Interfaces**
- Consume: `guardEnabled(snapshot, 'danger'|'branch'|'ship'|'gitmoji')`
- Produce: si el valor es `false`, el guard correspondiente no se invoca; los opt-outs del repo siguen actuando dentro del guard

**T010 — Interfaces**
- Consume: `applyDangerMode(snapshot.dangerMode, verdict, technicalLevel(root))`
- Produce: `{ block: true }` o el `ask` existente; `allow` nunca se convierte

## Review Workload Forecast

| Dimension | Forecast | Why |
| --- | --- | --- |
| Líneas cambiadas | 400–550 | Módulo nuevo (~120), tests (~220), wiring (~50), manifiesto y docs (~60) |
| Ficheros / áreas | 8: `package.json`, `targets/plugin-settings.mjs`, `targets/danger-guard.mjs`, `src/index.ts`, `src/rsc-boundary.ts`, `tests/` (3), README, NOTICE | Código + tests + docs |
| Riesgo | Tier 1; 0 tareas tier 2 | `rsc_risk` sobre el conjunto de rutas: `default` + `docs`, 1 revisor |
| Entrega sugerida | `ask-on-risk` | El pronóstico roza el presupuesto de 400 líneas; si el diff real lo supera, se parte |
