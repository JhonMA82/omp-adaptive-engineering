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
