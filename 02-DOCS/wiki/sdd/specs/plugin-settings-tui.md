---
type: spec
title: Spec — Ajustes del plugin en la TUI de OMP
description: Exponer los cuatro interruptores de guard y el modo del guard peligroso en la página de ajustes de plugins de OMP.
tags: [sdd, spec]
timestamp: 2026-11-06T01:27:53Z
topic: sdd
slug: plugin-settings-tui
status: planned
---

# Spec — Ajustes del plugin en la TUI de OMP

> Slug: `plugin-settings-tui` · Status: planned · Created: 2026-11-06
> Inherits: no constitution in this repo. The principles this cycle honours are cited inline from
> README and NOTICE (decided 2026-11-06; see Clarifications).

## Problem & why

Los cuatro guards del plugin se apagan creando un fichero oculto dentro de **cada
repositorio**. Ese interruptor es del proyecto, no de la persona: quien quiere el guard
de gitmoji apagado esta semana tiene que repetir el fichero en cada repo, o pelearse con
él. No existe ningún sitio donde ver de un vistazo qué guards están apagados.

## Cost of not building it

Nada se rompe si no se construye. El coste es fricción, y es pequeño: cuatro nombres que
recordar, un fichero por repo, y ningún sitio que muestre el estado. Lo que el mecanismo
actual no resuelve es el caso «quiero apagarlo para mí, en todas partes, sin ensuciar
repos» — y hoy la única respuesta a ese caso es no apagarlo.

## The cheapest alternative

Seguir con los ficheros, o un alias de shell que cree los cuatro de golpe. Cuesta cero
código nuevo. No basta porque sigue siendo por repositorio: el alias escribe marcadores
que git ve, y una compañera en la misma máquina no hereda la preferencia — la hereda el
repo.

## Goals

- Apagar o encender cada guard sin tocar ningún repositorio.
- Ver en un solo sitio el estado de los cuatro guards y el modo del guard peligroso.
- Elegir si el guard peligroso pregunta o deniega, sin editar el perfil de usuario.

## Non-goals / out of scope

- Mover a la TUI la política del proyecto: rutas de specs, tamaño del panel de revisión,
  sello, tier de riesgo. Eso se queda en el proyecto.
- Interruptores para el aviso posterior al primer edit o para el gate por turno.
- Cambiar el veredicto de un guard encendido, salvo lo que `danger.mode` decide entre
  preguntar y denegar.
- Ajustes por proyecto en la UI: el opt-out del repositorio sigue siendo un fichero.
- Recarga en caliente dentro de la sesión en curso.
- Comandos nuevos y telemetría sobre los interruptores.

## Users & context

Juan, perfil técnico, en su propia máquina, saltando entre varios repositorios con OMP.
Quiere un interruptor personal, no un cambio de política del repositorio. No hay un
segundo usuario conocido en esta máquina.

## What the user can do

- Cualquiera que abra los ajustes de OMP en esa máquina puede cambiar los cinco valores,
  con el plugin instalado y activo. No necesita tener un repositorio abierto ni permisos
  sobre él.
- No puede, desde ahí: cambiar el opt-out de un proyecto, ni la política que vive en el
  repositorio.

## What result they get

La página del plugin en los ajustes de OMP lista cinco filas de ajuste — además del
interruptor de activación y de las features del plugin — cada una con una descripción de
una línea:

| Fila | Valores | Qué describe |
| --- | --- | --- |
| `guards.danger` | on / off | Comandos irreversibles |
| `guards.branch` | on / off | Commits y pushes en la rama por defecto, y aislamiento en worktrees |
| `guards.ship` | on / off | Entrega: sello, spec enlazada y limpieza de rama |
| `guards.gitmoji` | on / off | Gitmoji obligatorio en los mensajes de commit |
| `danger.mode` | auto / ask / deny | Si el guard peligroso pregunta, deniega, o hereda el perfil |

Referencia para verificar: esa tabla, aprobada en esta spec, más una captura de la página
real en el momento de verificar. El criterio 1 se comprueba sobre la lista de ajustes que
el plugin expone, no sobre una interpretación de la captura.

`danger.mode` puede endurecer la protección, nunca aflojarla: con un perfil no técnico, `ask`
no sustituye la negativa del perfil.

## What it must respect

- Con un guard encendido y su ajuste por defecto, su decisión es idéntica a la de hoy,
  incluidos sus mensajes. La única excepción deliberada es `danger.mode` distinto de `auto`:
  ahí el mismo comando que hoy pregunta pasa a denegarse, y es el único cambio de veredicto
  que esta spec autoriza.
- El opt-out del proyecto sigue funcionando: si el repositorio lo tiene, el guard no actúa
  aunque el ajuste global esté encendido. Ningún ajuste global fuerza un guard sobre un
  repositorio que lo apagó.
- `auto` reproduce el comportamiento actual: perfil técnico pregunta; cualquier otro
  perfil, o ninguno, deniega.
- `danger.mode` nunca relaja lo que el perfil del proyecto ya protege: `deny` deniega siempre;
  `ask` solo se aplica donde el perfil preguntaría o donde no hay perfil; con perfil no técnico
  sigue denegando.
- Si la configuración del plugin no se puede leer, o su valor no es válido, cada guard actúa
  como con su valor por defecto (`auto` incluido) y sigue funcionando. Un error interno del
  propio guard nunca bloquea la shell: el guard deja pasar y lo registra.
- Un solo origen por dominio: interruptores personales aquí; política del proyecto en el
  repositorio. Sin solapamiento.
- Sin ficheros nuevos en el repositorio del usuario.

## How it proves it

- Se fija una batería de referencia: un comando por guard que, con los valores por defecto,
  ese guard rechaza. El plan nombra los comandos; la verificación los ejecuta.
- Antes del cambio se registra el veredicto y el mensaje de cada guard sobre esa batería. Ese
  registro es la línea base; después del cambio se repite y se compara contra ella.
- Cada interruptor se comprueba en dos pasos sobre su comando de referencia: encendido, el
  comando se rechaza; apagado y con una sesión nueva, se permite.
- Evidencia que queda: el registro de línea base, la salida de la batería después del cambio,
  y una captura de la página de ajustes mostrando los cinco valores.

## Behaviour

- Main path: se abre la página del plugin y se ve una fila por ajuste con su valor actual;
  cambiar un booleano lo guarda; el valor sigue ahí tras reiniciar OMP. Al empezar una sesión
  con algún guard apagado, una sola línea nombra los apagados; con todos encendidos no aparece
  nada.
- Edge cases:
  - Repositorio con opt-out y ajuste global encendido → el guard no actúa: manda el
    repositorio.
  - Repositorio sin opt-out y ajuste global apagado → el guard no actúa.
  - `danger.mode = auto` sin perfil de usuario → deniega, como hoy.
  - `danger.mode = ask` con perfil no técnico → sigue denegando: el ajuste no afloja el perfil.
  - Ajuste cambiado a mitad de sesión → la sesión en curso no cambia; la siguiente sí.
- Error paths: si la configuración no se puede leer o trae un valor inválido, el guard aplica
  su valor por defecto y sigue funcionando. Un error interno del propio guard deja pasar el
  comando y lo registra; nunca bloquea la shell por su propia configuración.

## Acceptance criteria

- Given el plugin activo, When se abre su página de ajustes, Then aparecen exactamente
  cinco filas de ajuste — `guards.danger`, `guards.branch`, `guards.ship`,
  `guards.gitmoji`, `danger.mode` —, cada una con descripción no vacía y con el valor
  guardado como valor actual.
- Given los valores por defecto, When se ejecuta la batería de referencia, Then cada guard da
  el mismo veredicto y el mismo mensaje que en la línea base.
- Given `guards.danger` apagado y una sesión nueva, When se ejecuta su comando de referencia,
  Then se permite.
- Given `guards.branch` apagado, una sesión nueva y ningún opt-out en el repositorio, When se
  ejecuta su comando de referencia, Then se permite.
- Given `guards.ship` apagado y una sesión nueva, When se ejecuta su comando de referencia,
  Then se permite.
- Given `guards.gitmoji` apagado y una sesión nueva, When se intenta un commit sin gitmoji,
  Then se permite.
- Given cualquiera de los cuatro guards apagado, When se enciende y empieza una sesión nueva
  en un repositorio sin opt-out, Then su comando de referencia se vuelve a rechazar.
- Given un repositorio con el opt-out de un guard, When su ajuste global está encendido, Then
  el comando de referencia se permite igualmente.
- Given `danger.mode = auto`, When llega un comando destructivo, Then con perfil técnico pide
  confirmación y con perfil no técnico o ausente lo deniega.
- Given `danger.mode = deny` y perfil técnico, When llega un comando destructivo, Then lo
  deniega.
- Given `danger.mode = ask` y perfil no técnico, When llega un comando destructivo, Then lo
  deniega igualmente.
- Given algún guard apagado globalmente, When empieza una sesión, Then una sola línea nombra
  los guards apagados. Given todos encendidos, Then no aparece ninguna línea.
- Given un valor cambiado en la página, When se reinicia OMP y se vuelve a abrir la página,
  Then muestra el valor cambiado.
- Given un ajuste cambiado a mitad de sesión, When esa misma sesión sigue evaluando comandos,
  Then su comportamiento no cambia hasta la sesión siguiente.

## Points to clarify

Pasada de aclaración del 2026-11-06: ninguna pregunta abierta queda pendiente. Lo que sigue son
suposiciones validadas y lo que se dejó fuera a propósito.

- **suposición tomada** — `auto` es el valor por defecto y reproduce el comportamiento actual.
  *Base:* elección del usuario, validada contra el guard, que ya decide por `technical_level`.
  *Riesgo:* si el perfil cambia de semántica, el defecto se mueve con él sin que nadie lo note.
- **suposición tomada** — los ajustes son de la persona y la máquina, no del repositorio.
  *Base:* reparto por dominio acordado; el override por proyecto existe pero es manual, así que
  no compite. *Riesgo:* otra máquina arranca con todo encendido; es la dirección segura, pero no
  la preferencia del autor.
- **suposición tomada** — `guards.branch` cubre los dos interruptores del guard de rama (trunk y
  aislamiento de worktree). *Base:* ambos se leen en el mismo guard, y el usuario eligió un solo
  interruptor. *Riesgo:* quien quiera apagar solo uno no puede.
- **decisión diferida** — interruptores por proyecto en la UI; fuera de este ciclo.
- **área no formulable** — qué debería ver un colaborador no técnico cuando el guard peligroso
  está apagado en esa máquina; sé que importa y todavía no sé formularlo.

## Clarifications

- **2026-11-06 — ¿Aviso al arrancar?** → Sí: una sola línea, solo cuando algún guard está
  apagado. *Por qué:* apagar el guard peligroso desde la TUI no deja rastro en el repositorio, y el
  fichero del proyecto sí lo dejaba. Entra como criterio de aceptación.
- **2026-11-06 — `ask` contra perfil no técnico** → gana el perfil: `deny` deniega siempre, `ask`
  solo donde el perfil preguntaría o no hay perfil. *Por qué:* el perfil vive en el proyecto y el
  ajuste en la máquina; un ajuste global que aflojara la protección de un repo rompería el reparto
  por dominio. Endurecer sí, aflojar no.
- **2026-11-06 — ¿Constitución antes de planificar?** → No. La spec cita en línea los principios
  que honra (semántica upstream intacta, un solo origen por dominio, guardas que fallan abierto).
  La constitución se escribe cuando haya dos features que arbitrar.
- **2026-11-06 — Suposiciones validadas**: `auto` sobre el perfil, ajustes por máquina y un solo
  interruptor de rama. Ninguna cambió el contrato; se quedan como están.
- **2026-11-06 — Diferido**: interruptores por proyecto en la UI. Fuera, por decisión del usuario.
- **2026-11-06 — Sin graduar**: el caso del colaborador no técnico sigue sin enunciarse.
