# Auditoría del port de RSC Harness a Oh My Pi

- **Fecha:** 2026-11-05
- **Repositorio auditado:** `omp-adaptive-engineering`
- **Upstream de referencia:** [`ericrisco/rsc-harness`](https://github.com/ericrisco/rsc-harness), commit `726aaf3` (v4.0.5, MIT)
- **Runtime:** OMP `18.16.0`
- **Alcance:** revisión de solo lectura. No se modificó código, configuración ni estado del proyecto.
- **Artefacto:** este informe es el único archivo creado.

> **Actualización 2026-11-06 — cierre aplicado.** Las secciones 1–8 conservan el snapshot original
> de la auditoría. El estado final de aplicación, las decisiones tomadas y la verificación de cierre
> están en la sección 9. El port queda cerrado: F-01…F-12 resueltos y R-01 corregido; F-03 se cierra
> como contrato de estado por checkout, no como estado compartido entre worktrees.

---

## 1. Veredicto

El port es una adaptación real y mayormente fiel: conserva los guards deterministas, la tabla de riesgo, el ledger de review y el sello; los tests pasan y OMP carga el plugin. **No está cerrado**: hay dos fallos funcionales duros, un problema de estado en worktrees y varios desajustes de adaptación/documentación que pueden hacer que el flujo no se comporte como promete el README.

Prioridad de corrección:

1. `/adaptive-status` (falla siempre).
2. Inyección del cuerpo `suggest` en `session_switch`.
3. Contrato de estado `.rsc` para worktrees.
4. Alineación de `skills/worktrees` y `skills/ftd` con lo que realmente existe.
5. Typecheck y ajustes menores.

---

## 2. Resumen de hallazgos

| ID | Severidad | Hallazgo | Estado |
|---|---|---|---|
| F-01 | Alta | `/adaptive-status` lanza `ReferenceError` por una auto-referencia `const trunk = trunk` | Confirmado |
| F-02 | Alta | El cuerpo `suggest` no se inyecta en `session_switch` (`/new`, resume, fork) | Confirmado |
| F-03 | Media | En un worktree, el estado `.rsc` se resuelve al worktree y no al checkout principal | Confirmado en reproducción |
| F-04 | Media | `worktrees` y `ftd` siguen prometiendo cleanup y knowledge sync automáticos que no están portados | Confirmado por lectura |
| F-05 | Media | Los tools nativos son `discoverable` (`xd://`), no tools top-level como sugiere el README | Confirmado en OMP y en sesión real |
| F-06 | Baja | README con datos obsoletos: “cinco guards”, 179 tests, “exact upstream body” | Confirmado |
| F-07 | Baja | No hay `tsconfig` ni typecheck; el bug de `trunk` habría sido detectado por `tsc` | Confirmado |
| F-08 | Baja | El nudge FTD también se dispara tras un `write`/`edit` fallido | Confirmado por lectura |
| F-09 | Baja | `rsc_review_consolidate` no valida `window` (entero no negativo) | Confirmado por comparación con upstream |
| F-10 | Baja | El error de `rsc_risk` no pasa por `translate()` y filtra el CLI inexistente | Confirmado por lectura |
| F-11 | Baja | Skills piden `rsc_review_ledger record <findings.json>` aunque el tool espera JSON inline | Confirmado por lectura |
| F-12 | Baja | Varias skills presentan los tools como comandos de shell (`rsc_risk --base …`) | Confirmado por lectura |

---

## 3. Hallazgos funcionales

### F-01 — `/adaptive-status` falla siempre

**Dónde:** [src/index.ts](src/index.ts#L547)

```ts
handler: async (_args, ctx) => {
  const root = projectRoot(ctx.cwd);
  const trunk = trunk;          // ← auto-referencia en TDZ
  const policy = trunk.trunkPolicy(root);
```

El `const trunk` local tapa el `trunk` importado y se lee a sí mismo antes de inicializarse. El handler lanza:

```text
ReferenceError: Cannot access 'trunk' before initialization.
```

**Impacto:** el comando está registrado pero es inutilizable. Lo referencian el decisor y el flujo de ship:

- [skills/suggest/SKILL.md](skills/suggest/SKILL.md#L126)
- [skills/ship/SKILL.md](skills/ship/SKILL.md#L108)
- [skills/asdd/SKILL.md](skills/asdd/SKILL.md#L107)
- [README.md](README.md#L140)

**Reproducción:** cargar la extensión con una `ExtensionAPI` mínima y ejecutar el handler de `adaptive-status`. Devuelve el `ReferenceError` anterior.

**Recomendación:** eliminar la línea y usar `trunk.trunkPolicy(root)`, o renombrar la variable local. Añadir un test del comando al adaptador; actualmente [tests/adapter.test.ts](tests/adapter.test.ts) no lo ejercita.

---

### F-02 — `suggest` no se inyecta al cambiar o crear una sesión

**Dónde:** [src/index.ts](src/index.ts#L178-L187)

```ts
pi.on("session_start", async (_event, ctx) => {
  refreshSettings(ctx.cwd);
  injectSuggest(ctx);
  announceGuards();
});

pi.on("session_switch", async (_event, ctx) => {
  refreshSettings(ctx.cwd);
  announceGuards();
});
```

`session_switch` refresca settings y avisa de guards apagados, pero **no llama a `injectSuggest`**. En OMP 18.16.0:

- `session_start` se emite al inicializar el runner.
- `/new`, resume y fork emiten `session_switch` con `reason: "new" | "resume" | "fork"`.

**Reproducción:** con un handler falso y un `sessionManager` sin entradas:

```text
messages after session_switch: []
messages after session_start: ["rsc-suggest"]
```

**Impacto:** una sesión nueva creada con `/new` queda sin el bloque always-on de metodología. Una sesión reanudada que no lo tenga en el transcript tampoco lo recibe. El propio cuerpo de [skills/suggest/SKILL.md](skills/suggest/SKILL.md#L10-L12) y el README ([README.md](README.md#L155-L156)) prometen lo contrario.

**Recomendación:** llamar a `injectSuggest(ctx)` también en `session_switch`. `alreadyHasSuggest` ya evita duplicarlo en resume/fork; para `reason: "new"` el transcript está vacío y la inyección es la primera.

---

### F-03 — El estado `.rsc` se pierde al trabajar desde un worktree

**Dónde:** [src/index.ts](src/index.ts#L31-L44)

```ts
function projectRoot(cwd: string): string {
  let dir = resolve(cwd);
  for (;;) {
    if (
      existsSync(join(dir, ".rsc")) ||
      existsSync(join(dir, ".rsc.json")) ||
      existsSync(join(dir, "02-DOCS")) ||
      existsSync(join(dir, ".git"))
    ) return dir;
    ...
```

En un worktree enlazado, `.git` es un archivo en la raíz del worktree, así que el loop devuelve el worktree. Como `.rsc/` está en `.gitignore`, un worktree nuevo no hereda los opt-outs, la configuración del sello, el review ledger ni los marcadores de `main` del checkout principal.

**Reproducción ejecutada:**

1. Repo temporal con `.rsc/.no-danger-guard` y perfil `technical` en el checkout principal.
2. `git worktree add .worktrees/wt -b wt`.
3. Sesión con `ctx.cwd` en `.worktrees/wt`.
4. Comando `git reset --hard HEAD`.

Resultado:

```json
{"block":true,"reason":"... No interactive approval is available in this session ..."}
```

El opt-out del checkout principal no se aplicó; el guard leyó el estado vacío del worktree.

**Impacto:** el flujo de worktrees que el port recomienda para sesiones paralelas pierde las decisiones de proyecto. También puede hacer que el ship guard de un worktree no vea el review ledger o el sello registrados en el checkout principal.

**Recomendación:** decidir explícitamente el contrato:

- resolver el estado del proyecto al checkout principal (por ejemplo, con `git rev-parse --git-common-dir`), manteniendo el `cwd` del comando para las operaciones git; o
- documentar y crear `.rsc` por worktree, si se quiere aislamiento total de estado.

La opción actual —ni una cosa ni la otra— es la que produce el fallo.

---

## 4. Desajustes de adaptación

### F-04 — `worktrees` y `ftd` prometen hooks que no existen

El README reconoce que el reaper y el post-merge cleanup no están portados ([README.md](README.md#L186-L190)). Sin embargo:

- [skills/worktrees/SKILL.md](skills/worktrees/SKILL.md#L104-L108): “un `post-merge` hook retira el worktree y su rama por sí solo… Nothing to run”.
- [skills/ftd/SKILL.md](skills/ftd/SKILL.md#L52-L53): “rsc's post-merge hook sets `status: done`… (on a closed default branch, via `rsc/knowledge`)”.
- [skills/ftd/SKILL.md](skills/ftd/SKILL.md#L97-L98): “Una vez la rama aterriza, el cleanup es automático y no ejecutas nada”.

El mismo [skills/worktrees/SKILL.md](skills/worktrees/SKILL.md#L147-L160) sí describe las comprobaciones manuales porque el reaper no está portado, y [skills/ship/SKILL.md](skills/ship/SKILL.md#L148) ya fue adaptado a la realidad. La contradicción dentro de `worktrees` es directa.

**Impacto:** el agente puede omitir la limpieza del worktree y el cierre del documento FTD porque cree que un hook inexistente lo hará. Es un fallo de comportamiento del flujo, no solo de redacción.

**Recomendación:** alinear ambos skills con `ship`: comprobaciones manuales de `git worktree list`, estado limpio, rama mergeada y `git worktree remove`; y decir explícitamente que el cierre del FTD es manual en este port.

---

### F-05 — Los tools nativos son dispositivos `xd://`, no tools top-level

**Dónde:** los cinco `registerTool` de [src/index.ts](src/index.ts#L267) no declaran `loadMode`.

OMP 18.16.0 aplica a los tools de extensión un `loadMode` por defecto `"discoverable"`. Con `tools.xdev` en su valor por defecto (`true`), esos tools se montan como dispositivos `xd://` y el modelo debe:

```text
read  xd://rsc_risk      → documentación + schema
write xd://rsc_risk      → ejecutar con el JSON de argumentos
```

En una sesión real de OMP 18.16.0 el modelo hizo exactamente eso y los tools funcionaron. No es un fallo de cálculo, pero el README dice que “el modelo llama estos tools” ([README.md](README.md#L116-L124)) y las skills los presentan como comandos directos. Un modelo que intente invocar `rsc_risk` como tool top-level no lo encontrará en el esquema de la petición.

**Recomendación:** elegir una de las dos opciones y documentarla:

- añadir `loadMode: "essential"` a los cinco tools para que sean top-level; o
- mantener el diseño discoverable de OMP y explicar `xd://` en el README y en las skills.

---

### F-06 — README con datos obsoletos o inexactos

- **“Five deterministic Bash guards”** ([README.md](README.md#L12)): la tabla ([README.md](README.md#L52-L57)) y el adaptador tienen cuatro: ship, branch, gitmoji y danger. ASDD y sello son sub-gates dentro de ship, no guards independientes.
- **“179 Node tests, 178 pass, 1 skipped”** ([README.md](README.md#L208)): la ejecución real da **200 tests, 199 pasan, 1 omitido, 0 fallos**. El número y el resultado están desactualizados.
- **“The always-on `suggest` body is the exact upstream body”** ([README.md](README.md#L15), [README.md](README.md#L155)): el cuerpo de [skills/suggest/SKILL.md](skills/suggest/SKILL.md) fue reescrito en las secciones de instalación, entorno, capacidades y `/adaptive-main-unlock`; además `injectSuggest` elimina el frontmatter con `stripFrontmatter` ([src/index.ts](src/index.ts#L145-L146)). Es una adaptación razonable, pero no es el texto exacto.
- **“The `worktrees`, `tidy` and `ship` skills use the manual git checks”** ([README.md](README.md#L186-L188)): `ship` sí; `worktrees` y `ftd` conservan las promesas de hooks automáticos descritas en F-04.
- **“another session owns the checkout”** ([README.md](README.md#L55)): la propia diferencia 3 del README ([README.md](README.md#L182-L185)) dice que la regla B es inerte porque falta `session-memory-core`.

**Recomendación:** actualizar el README después de corregir el código, no antes; y usar el conteo real de tests en el mismo commit.

---

## 5. Hallazgos menores

### F-07 — No hay typecheck

No existe `tsconfig.json` ni un script de tipos en [package.json](package.json#L46-L50). Un typecheck estricto de referencia (TypeScript 7.0.2 con los tipos de OMP 18.16.0) reporta, entre otros:

```text
src/index.ts(547,21): error TS2448: Block-scoped variable 'trunk' used before its declaration.
```

También aparecen errores de narrowing en `tool_call`: OMP documenta que `event.toolName === "bash"` no estrecha la unión de eventos y que debe usarse `isToolCallEventType`, así que `event.input` queda como `unknown` para TypeScript. En runtime funciona porque OMP transpila con Bun, pero no hay ninguna barrera que impida que un bug como F-01 llegue a `main`.

**Recomendación:** añadir `tsconfig.json`, un script `test:types` y los tipos de OMP como `devDependency`; ejecutarlo en la misma puerta que los tests.

### F-08 — El nudge FTD se dispara tras un edit/write fallido

**Dónde:** [src/index.ts](src/index.ts#L252-L263)

El handler de `tool_result` comprueba `toolName` y la ruta, pero no `event.isError`. Un `write`/`edit` que falla (permisos, ruta inválida, cancelación) también ejecuta `nudge.decide`; si la sesión no tenía documento, inyecta el aviso “estás cambiando código sin documento” aunque no se haya cambiado nada. En Claude, `PostToolUse` corre tras una ejecución exitosa; OMP entrega también el resultado de error.

**Recomendación:** `if (event.isError) return;` antes de calcular el nudge.

### F-09 — `rsc_review_consolidate` no valida `window`

**Dónde:** [src/index.ts](src/index.ts#L434-L437)

El schema acepta cualquier `z.number()`. El CLI original validaba entero no negativo (`Number.isInteger(window) && window >= 0`) y rechazaba el resto. Un `-1` o `1.5` entra en `findingsLib.consolidate` y produce agrupaciones sin contrato claro.

**Recomendación:** `z.number().int().min(0).optional()` o una comprobación runtime antes de llamar a `consolidate`.

### F-10 — El error de `rsc_risk` filtra el CLI inexistente

**Dónde:** [src/index.ts](src/index.ts#L286)

```ts
if (!changed.ok) throw new Error(changed.message);
```

`changed.message` viene de [scripts/lib/risk.js](scripts/lib/risk.js#L22-L25) y dice `npx @ericrisco/rsc risk …`. El adaptador traduce los mensajes de los guards y de `rsc_sello`/`rsc_review_ledger`, pero no este. El modelo recibe una instrucción para ejecutar un CLI que no existe en el port.

**Recomendación:** `throw new Error(translate(changed.message))` y añadir un test de ese camino.

### F-11 — `record <findings.json>` no coincide con el schema del tool

**Dónde:** [skills/implement/SKILL.md](skills/implement/SKILL.md#L132)

La skill dice `rsc_review_ledger record <findings.json>`, pero el tool espera `findingsJson` con el JSON inline ([src/index.ts](src/index.ts#L369)). Un modelo que pase la ruta del archivo recibe un error de parseo. En la sesión real el modelo leyó la documentación del tool y usó JSON inline, pero la skill no lo garantiza.

**Recomendación:** adaptar la skill a `findingsJson` inline o ampliar el tool para aceptar una ruta de archivo. Hacer lo mismo con las formas abreviadas `review ledger panel` de [skills/implement/SKILL.md](skills/implement/SKILL.md#L118) y [skills/ship/SKILL.md](skills/ship/SKILL.md#L244), que deberían nombrar el tool completo.

### F-12 — Skills con sintaxis de CLI en bloques `bash`

**Dónde:** por ejemplo [skills/ship/SKILL.md](skills/ship/SKILL.md#L64), [skills/implement/SKILL.md](skills/implement/SKILL.md#L101) y [skills/implement/SKILL.md](skills/implement/SKILL.md#L129).

Los bloques presentan `rsc_risk --base main` o `rsc_review_consolidate <reports…>` como comandos de shell. En este port no hay ejecutable `rsc_risk`; el modelo debe usar el tool o `xd://`. Las sesiones reales muestran que un modelo capaz lo adapta, pero la skill no lo dice. Es una fricción que puede producir intentos de `bash: rsc_risk: command not found`.

**Recomendación:** unificar el lenguaje: “usa el tool `rsc_risk`” o “ejecuta `write xd://rsc_risk`”, no un bloque bash con el nombre del tool.

---

## 6. Verificación positiva

### Fidelidad del código portado

Comparación contra el upstream `726aaf3`:

- **Idénticos byte a byte:** `targets/asdd-gate.mjs`, `branch-guard.mjs`, `ftd-nudge.mjs`, `hook-once.mjs`, `shell-unwrap.mjs`, `spec-completeness.mjs`, `trunk-policy.mjs`, `scripts/lib/review-findings.js`, `review-ledger.js`, `risk.js`, `spec-gate.js`.
- **Modificados solo en el boundary:** `targets/danger-guard.mjs` (exporta `evaluateDanger` y `technicalLevel`), `gitmoji-guard.mjs` (exporta `evaluateGitmoji`), `ship-guard.mjs` (exporta `shipGuardDecision`), `userprompt-gate.mjs` (exporta `gateText`), `sello.mjs` (prefijos de diff fijos).
- **Nuevo:** `targets/plugin-settings.mjs`, `src/index.ts`, `src/rsc-boundary.ts`, `src/sello-tool.mjs`.

Los algoritmos, las tablas de reglas y los mensajes de los guards no se reescribieron.

### Tests ejecutados

Sobre una copia limpia del workspace:

```text
node --test tests/*.test.js
ℹ tests 200
ℹ pass 199
ℹ fail 0
ℹ skipped 1
```

```text
bun tests/adapter.test.ts
adapter: deny, ask-with-UI, ask-without-UI, decline and allow all pass
adapter: native project switches write the expected project-local state
adapter: rsc_risk and rsc_spec_gate registrations execute the upstream algorithms
adapter: rsc_review_consolidate merges lens reports
adapter: settings snapshot, guard switches, danger mode and notice
adapter: reference battery — branch and ship switches
```

El test omitido es el de deriva del estado de instalación (`NO-APLICA`: este checkout no tiene `.rsc/danger-guard.mjs` materializado).

### OMP y plugin

- `omp/18.16.0` instalado y funcionando desde `~/.bun/bin/omp`.
- `omp plugin list` reconoce `adaptive-engineering@0.2.0`.
- `omp plugin doctor` → 4 comprobaciones OK, 0 warnings, 0 errores.
- `omp plugin config list adaptive-engineering --json` expone exactamente las cinco claves declaradas en `package.json#omp.settings`:
  - `guards.danger`, `guards.branch`, `guards.ship`, `guards.gitmoji`: boolean.
  - `danger.mode`: enum `auto | ask | deny`.
- 28 skills y 5 agentes presentes; el descubrimiento de OMP los lista y las sesiones reales los cargan.

### Guards

La batería de referencia del adaptador verifica:

- deny para perfil no técnico;
- ask con UI y aprobación;
- ask sin UI → bloqueo, nunca allow silencioso;
- rechazo en la UI → bloqueo;
- comando inofensivo → paso;
- switches de proyecto escriben los marcadores correctos;
- `guards.danger`, `guards.branch`, `guards.ship`, `guards.gitmoji` y `danger.mode` funcionan por sesión;
- el orden es ship → branch → gitmoji → danger, como RSC.

### Herramientas nativas

En una sesión real de OMP 18.16.0, el modelo:

1. leyó `xd://rsc_risk` para obtener el schema;
2. ejecutó `write xd://rsc_risk` con `{"paths":[...],"json":true}`;
3. recibió el tier, clases, reviewers y human approval correctos.

Es decir, los tools funcionan; la observación F-05 es de presentación/documentación, no de cálculo.

---

## 7. Recomendaciones finales

### Antes de considerar el port cerrado

1. **Corregir F-01** y añadir un test de `/adaptive-status` al adaptador.
2. **Corregir F-02**: inyectar `suggest` en `session_switch`, con test para `reason: "new"` y para no duplicar en `resume`.
3. **Definir el contrato de estado en worktrees** (F-03) y probarlo con un repo temporal y un worktree real.
4. **Alinear `worktrees` y `ftd`** con la realidad (F-04), como ya está `ship`.
5. **Decidir `loadMode`** de los tools y documentarlo (F-05).
6. **Añadir typecheck** (F-07) y usarlo en la misma puerta que los tests.

### Después

- Corregir nudge en error (F-08).
- Validar `window` (F-09).
- Traducir el error de `rsc_risk` (F-10).
- Adaptar las skills a `findingsJson` y a la invocación por tool/`xd://` (F-11, F-12).
- Actualizar el README: cuatro guards, 200 tests, cuerpo `suggest` adaptado y alcance real de worktrees.

### Criterio de salida sugerido

- `node --test tests/*.test.js` verde y con el conteo actualizado en README.
- `bun tests/adapter.test.ts` verde, incluyendo `/adaptive-status` y `session_switch`.
- Un test de worktree que demuestre que el opt-out del checkout principal se respeta, o una decisión explícita de que no se comparte.
- `tsc --noEmit` sin errores.
- README y skills sin referencias a hooks, comandos o conteos que no existen en el port.

---

## 8. Limitaciones de esta auditoría

- No se ejecutó una sesión interactiva nueva de OMP con modelo; se usaron las sesiones reales ya presentes en `~/.omp/agent/sessions`, los tests del repo y reproducciones con una `ExtensionAPI` falsa.
- El typecheck se hizo con TypeScript 7.0.2 y los tipos de OMP 18.16.0, aunque el repo no declara esa herramienta. El error `TS2448` de `trunk` es independiente de la versión.
- La reproducción de worktree usa un repo temporal; no se tocó el repo auditado.
- No se probó el flujo completo de ASDD de punta a punta con un modelo en esta pasada; la auditoría se centró en el adaptador, los guards, los tools, los skills y la documentación.

---

## 9. Estado de aplicación — 2026-11-06

Se aplicaron los cambios de la auditoría en el working tree de `feat/closing-pass` y se verificaron
contra OMP **18.17.0**.

| Hallazgo | Estado final | Evidencia |
|---|---|---|
| F-01 `/adaptive-status` | Resuelto | El handler ya no se auto-referencia; el adaptador ejecuta y valida su JSON |
| F-02 `suggest` en `session_switch` | Resuelto | Inyección en `new`/`resume`/`fork`, con deduplicación; test del adaptador |
| F-03 estado `.rsc` en worktrees | Cerrado como contrato | Opt-outs de proyecto se hidratan una vez; sello/ledger/nudge/memoria por checkout, documentado y probado |
| F-04 cleanup/knowledge en skills | Resuelto | `worktrees` y `ftd` describen la limpieza manual; no queda promesa de hooks no portados |
| F-05 tools `xd://` | Resuelto como decisión + documentación | Se mantiene `discoverable`; README y skills explican `read`/`write xd://` |
| F-06 README obsoleto | Resuelto | Cuatro guards, 235 tests, `suggest` adaptado, contrato de estado actualizado |
| F-07 typecheck | Resuelto | `tsconfig.json` incluye `src/**/*.ts` y `tests/**/*.ts`; `bun run typecheck` = 0 errores |
| F-08 nudge en write fallido | Resuelto | `if (event.isError) return;` + test |
| F-09 validación de `window` | Resuelto | Schema `int().min(0)` + guard runtime; test de `-1`, `1.5` y `0` |
| F-10 error de `rsc_risk` | Resuelto | `translate(changed.message)` + test |
| F-11/F-12 sintaxis de skills | Resuelto | Referencias operativas usan el tool/`xd://`; `per-task-review.md` actualizado |
| R-01 proyecto anidado | Resuelto | `projectRoot`/`resolveRoots` buscan `.rsc`/`.rsc.json`/`02-DOCS` dentro del checkout; tests de proyecto anidado y worktree anidado |

### Decisiones de cierre

- **F-03 — no se comparten sello ni ledger entre worktrees.** El sello certifica bytes y el ledger
  registra rondas de una rama concreta; compartirlos mezclaría evidencias de ramas distintas. Los
  opt-outs de proyecto sí se heredan una vez. Está documentado en `README.md` y probado en
  `tests/worktree-state.test.js` y `tests/adapter.test.ts`. Los tools de sello, ledger y risk
  resuelven al checkout (git toplevel), coherente con esta separación; los marcadores de proyecto
  anidado aplican a guards, settings y spec gate.
- **R-01 — se preserva el layout de subproyectos.** `projectRoot`/`resolveRoots` buscan marcadores
  RSC por debajo del toplevel del checkout y no cruzan al checkout principal desde un worktree. Un
  worktree de un subproyecto mapea su contraparte en `main` para leer las decisiones de proyecto.
- **F-05 — se mantiene `discoverable`.** Los cinco tools se usan vía `xd://`; añadir `essential`
  queda como una alternativa si un modelo débil no los descubre, no como necesidad del port.
- **Autopilot con una sola llave.** `sdd.execution_mode: automatic` es el único switch; `specify` ya
  no menciona `sdd.autopilot` y `sdd-init` declara el contrato. `tests/sdd-config.test.js` lo fija
  para que no reaparezca la llave duplicada.

### Verificación final

```text
node --test tests/*.test.js
tests 235 · pass 234 · fail 0 · skipped 1

bun tests/adapter.test.ts
adapter: status, session_switch injection and error paths pass
adapter: rule-B peers wiring and suggest dedupe pass
adapter: worktree state contract, per-checkout ledger/sello and git context pass

bun run typecheck
tsc -p tsconfig.json → 0 errors
```

El test omitido es el de deriva de `.rsc/danger-guard.mjs`, que no existe en este checkout. La
verificación cubre además un proyecto anidado real: un `.rsc/.no-danger-guard` en
`03-PROJECTS/a` se lee como proyecto propio y no se aplana al git toplevel.

---

*Fin del informe.*
