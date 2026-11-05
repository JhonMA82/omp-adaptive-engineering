# Adaptive Engineering for Oh My Pi

Plugin opcional para OMP que añade una política de ingeniería adaptativa: el agente elige el nivel de rigor (N0–N3) según el impacto, la reversibilidad, el acoplamiento de decisiones y la incertidumbre, usando las capacidades nativas de OMP.

No es un workflow engine, no es un router de modelos, no es un sistema de seguridad y no depende de RSC Harness.

## Qué problema resuelve

OMP ya tiene plan mode, goal mode, `todo`, `task`, `scout`, `reviewer`, `security-reviewer`, skills y memoria. Lo que no trae de fábrica es una política que decida **cuándo** usar cada cosa y **cuándo no**.

Sin esa política, el agente tiende a dos extremos:

- resolver con demasiada ceremonia un cambio trivial;
- empezar sin spec un cambio de autenticación, datos o infraestructura.

Adaptive Engineering añade solo esa decisión, más el procedimiento compacto para el nivel de mayor riesgo.

## Requisitos

- OMP `18.16.0` (versión verificada durante el desarrollo).
- Ninguna dependencia externa.
- Ningún servicio, base de datos, scheduler ni telemetría.
- El plugin se carga con el sistema nativo de plugins de OMP.

## Instalación local

Desde cualquier directorio:

```bash
omp plugin link ~/Dev/omp-adaptive-engineering
```

`omp plugin install ~/Dev/omp-adaptive-engineering` también funciona: para una ruta local, OMP la enruta al mismo mecanismo de link.

Verificar:

```bash
omp plugin list
```

Debe aparecer `adaptive-engineering@0.1.0` como habilitado.

La instalación crea un symlink en `~/.omp/plugins/node_modules/adaptive-engineering` y una entrada en `~/.omp/plugins/omp-plugins.lock.json`. No modifica el código de OMP.

## Activación y desactivación

Desactivar:

```bash
omp plugin disable adaptive-engineering
```

Activar:

```bash
omp plugin enable adaptive-engineering
```

Los cambios de estado se leen al iniciar una sesión nueva. Una sesión ya abierta conserva las reglas que cargó hasta que se reinicie o se abra otra sesión.

Cuando el plugin está desactivado, OMP no descubre su regla ni su skill: no hay instrucciones residuales en archivos globales, porque la metodología vive dentro del paquete del plugin.

## Actualización

El plugin está enlazado desde el repositorio local, que está inicializado con git y no tiene remoto. Actualizar es editar los archivos o hacer `git pull` si más adelante se añade un remoto; la siguiente sesión carga el contenido nuevo.

Si cambia `package.json` o la versión, volver a enlazar para refrescar el estado:

```bash
omp plugin link ~/Dev/omp-adaptive-engineering
```

## Desinstalación

```bash
omp plugin uninstall adaptive-engineering
```

Esto elimina el symlink y el estado del plugin. No borra el repositorio local ni los `docs/decisions.md` de los proyectos.

## Qué aporta el plugin

| Archivo | Función |
|---|---|
| `rules/adaptive-engineering.md` | Regla always-apply con la política N0–N3, autonomía, evidencia y reglas negativas. |
| `skills/asdd-lite/SKILL.md` | Procedimiento compacto para N3: spec, criterios de aceptación, fases, review y decisiones. |

No hay comandos, hooks, extensiones, agentes, MCPs ni herramientas propias en esta versión.

## Cómo llegan las instrucciones

- `rules/adaptive-engineering.md` se descubre como regla del plugin y se carga como **always-apply**.
- `skills/asdd-lite/SKILL.md` se descubre como skill y se lista por nombre y descripción; el cuerpo se lee solo cuando el agente lo necesita con `skill://asdd-lite`.
- La regla se propaga a los subagentes, igual que las reglas de OMP. La skill se lista en la sesión del subagente; el subagente puede leerla si la necesita.
- `AGENTS.md` del proyecto sigue siendo contexto del proyecto y **no** se propaga a subagentes. Para restricciones duras que los subagentes deban cumplir, el proyecto puede usar `.omp/RULES.md`.

## Comportamiento esperado

### N0 — Answer

Consultas, explicaciones, auditorías y revisiones read-only. No modifica archivos. No usa `/plan`, `/goal`, `todo`, subagentes ni documentos de seguimiento por defecto. Una investigación amplia sigue siendo N0 si es solo lectura.

### N1 — Direct Work

Cambio pequeño, claro, localizado y reversible. Inspecciona lo mínimo, hace el cambio y ejecuta el check más estrecho. No usa `/plan`, `/goal`, spec, `todo` para menos de tres pasos, reviewer ni documentación adicional.

### N2 — FTD

Feature, bug complejo o cambio de varios componentes que requiere investigación, sin decisiones críticas acopladas. Define el resultado, investiga, identifica riesgos, acota, implementa, verifica y reporta. Usa `todo` si hay varias tareas, `scout` si desconoce las áreas y `reviewer` si el cambio lo justifica. No usa `/plan`, `/goal` ni spec formal automáticamente.

### N3 — ASDD-lite

Seguridad, autenticación, secretos, pagos, datos, migraciones, CI, infraestructura, APIs públicas, cambios irreversibles, requisitos contradictorios o decisiones de producto acopladas. Lee `skill://asdd-lite`, escribe una spec compacta con las cuatro preguntas, criterios observables y fuera de alcance, planifica por fases, ejecuta con autonomía, verifica cada fase, revisa de forma independiente cuando corresponde y registra decisiones.

El mínimo N3 es spec + verificación observada + decisiones cuando hagan falta. No es una cadena de cinco artefactos.

## Decisiones y autonomía

- Decisiones técnicas reversibles: las toma el agente, respetando requisitos, arquitectura y patrones existentes.
- Decisiones de producto o negocio: las reserva al usuario cuando cambian funcionalidad, alcance, UX, prioridad, precio o compromisos externos.
- Acciones irreversibles: se detienen y requieren autorización explícita.
- Bloqueos: se registran, se continúa con el trabajo independiente y se muestra el bloqueo al cerrar.
- Aprobaciones: no se pide una aprobación extra de la spec si el usuario ya autorizó comportamiento y alcance.

## Decisiones persistentes

El plugin no crea `docs/decisions.md` automáticamente. Solo lo usa cuando una decisión debe sobrevivir a la sesión. El formato está en la regla y en la skill.

No hay base de datos, servicio externo ni backend de memoria nuevo. La memoria local de OMP sigue siendo contexto heurístico, no fuente de verdad.

## Capacidades nativas que utiliza

- `scout` para exploración read-only.
- `task` para trabajo delegado.
- `todo` para seguimiento.
- `reviewer` para revisión independiente.
- `security-reviewer` para superficie de seguridad.
- `/plan` cuando el usuario lo activa.
- `/goal` cuando el usuario lo activa, con budget.
- Memoria, `--resume`, `--restore` y `/handoff` para continuidad.

`/plan` y `/goal` son modos interactivos del usuario. El agente puede proponerlos, pero no puede activarlos por sí mismo. Si no se activan, continúa con spec/plan en archivo y fases de `todo`.

## Limitaciones

- Es una política de instrucciones, no un mecanismo de enforcement. No bloquea comandos ni valida specs automáticamente.
- No sustituye approvals, Git Guard, `bash.patterns` ni `tools.restrictedFolders`. La configuración de seguridad es independiente y sigue siendo válida con el plugin desactivado.
- No implementa un motor de estados, un clasificador LLM adicional, un ledger de reviews ni un sistema de métricas.
- No crea comandos propios.
- No modifica `RULES.md` global, `AGENTS.md` de proyectos ni configuración de OMP.
- Los cambios de activación se aplican a sesiones nuevas; una sesión abierta conserva lo cargado.
- No puede impedir que el agente ignore una instrucción; para eso harían falta hooks o approvals, que esta versión evita deliberadamente.

## Verificación rápida

```bash
omp plugin list
```

Con el plugin activo, en una sesión nueva:

```text
Read rule://adaptive-engineering and reply with its first heading.
```

Con el plugin desactivado, la misma lectura debe responder que la regla no existe.

## Licencia

MIT.
