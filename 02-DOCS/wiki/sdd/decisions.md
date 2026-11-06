# SDD decisions

Append-only. Newest last. One entry per significant decision, with the options weighed and the
reason. Scope decisions, not implementation notes.

## 2026-11-06 — Alcance de los ajustes del plugin en la TUI

**Requisito.** El usuario quiere cambiar los guards del plugin desde la página de ajustes de OMP
en vez de crear ficheros por repositorio.

**Verificado antes de decidir.** OMP declara ajustes de plugin en el manifiesto (`omp.settings`) y
los pinta en Settings → Plugins, con cuatro tipos: booleano, enum, texto y número. Persisten en
`~/.omp/plugins/omp-plugins.lock.json`; el proyecto puede sobrescribir en
`.omp/plugin-overrides.json`, pero la TUI no escribe ahí. La extensión no recibe los valores por
API y OMP no la reinstancia al cambiarlos.

**Opciones presentadas.** (a) solo guards on/off más el modo del guard peligroso; (b) además rutas
de specs y tamaño del panel; (c) migrar a la TUI toda la configuración que hoy vive en `.rsc.json`.

**Elegida.** (a). La política del proyecto (rutas, panel, sello, tier) se queda en `.rsc.json`.

**Motivo.** Dos fuentes de verdad crearían una clase de bug concreta —el guard leyendo una y la
herramienta la otra—. Con el reparto por dominio no hay solapamiento ni precedencia que resolver.

**Decisiones derivadas.** `danger.mode` por defecto `auto`, que hereda el perfil y reproduce el
comportamiento actual. Los ajustes aplican en la sesión siguiente, no en la actual. Un solo
interruptor para el guard de rama, que cubre trunk y aislamiento de worktree.

**Riesgo aceptado.** Apagar el guard peligroso desde la TUI es una tecla, sin confirmación y sin
dejar rastro en el repositorio. Se registra como punto abierto en la spec, con la propuesta de
anunciar en el arranque qué guards están apagados.

**Spec.** `02-DOCS/wiki/sdd/specs/plugin-settings-tui.md`.

## 2026-11-06 — Aprobación de la spec

**Aprobada explícitamente** por el usuario, tras leerla y tras la revisión en frío. No fue un
«sigue tú»: la pregunta era aprobar o pedir cambios, y respondió «Apruebo la spec».

Estado: diseño aprobado. Los siete puntos abiertos siguen sin resolver y son el trabajo de
`clarify`. La implementación no empieza hasta que exista plan y lista de tareas.

Nota de entorno: el guard de rama cierra `master` por la señal de equipo (dos correos distintos
en los últimos 50 commits), así que cualquier commit futuro en la rama por defecto pide decisión
explícita. Este registro queda en el árbol de trabajo, sin commit.

## 2026-11-06 — Clarify

Tres preguntas cerradas con el usuario, dos de ellas cambiando el contrato:

1. **Aviso al arrancar.** Sí: una línea, solo si algún guard está apagado. Motivo: la TUI quita
   la trazabilidad que daba el fichero del repositorio. Entra como criterio de aceptación.
2. **`ask` contra perfil no técnico.** Gana el perfil. El ajuste global endurece la protección,
   nunca la afloja; si no, el ajuste de la máquina rompería la política del proyecto.
3. **Constitución.** No se escribe ahora. Los principios aplicables se citan en la spec.

Validado sin cambios: `auto` sobre el perfil, ajustes por máquina, un solo interruptor de rama.
Diferido: interruptores por proyecto en la UI. Sin graduar: la vista del colaborador no técnico.

Spec en `status: clarified`, 14 criterios de aceptación, gate PASS.

## 2026-11-06 — Plan técnico

**Snapshot por sesión** en vez de lectura por llamada. Motivo: el contrato dice que un cambio
aplica en la sesión siguiente; leer por llamada lo aplicaría al instante. Además saca el disco del
camino caliente de `tool_call`.

**Ruta del lock**: dos candidatas derivadas de `getAgentDir()` de OMP, la primera existente gana.
Si ninguna existe, defaults. Probado que `omp plugin config list adaptive-engineering --json`
devuelve hoy `{settings:{}, schema:{}}`, así que la superficie del manifiesto es alcanzable.

**Adaptación upstream**: `danger-guard.mjs` exporta `technicalLevel` para distinguir «sin perfil» de
«perfil no técnico». Se anota en `NOTICE.md`.

**Sin dependencias nuevas**, sin almacén de estado propio.
