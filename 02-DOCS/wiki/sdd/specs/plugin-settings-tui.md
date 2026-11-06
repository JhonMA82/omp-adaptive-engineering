---
type: spec
title: Spec — Ajustes del plugin en la TUI de OMP
description: Exponer los cuatro interruptores de guard y el modo del guard peligroso en la página de ajustes de plugins de OMP.
tags: [sdd, spec]
timestamp: 2026-11-06T01:27:53Z
topic: sdd
slug: plugin-settings-tui
status: draft
---

# Spec — Ajustes del plugin en la TUI de OMP

> Slug: `plugin-settings-tui` · Status: draft · Created: 2026-11-06
> Inherits: no constitution exists in this repo yet (see Points to clarify).

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
  cambiar un booleano lo guarda; el valor sigue ahí tras reiniciar OMP.
- Edge cases:
  - Repositorio con opt-out y ajuste global encendido → el guard no actúa: manda el
    repositorio.
  - Repositorio sin opt-out y ajuste global apagado → el guard no actúa.
  - `danger.mode = auto` sin perfil de usuario → deniega, como hoy.
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
- Given un valor cambiado en la página, When se reinicia OMP y se vuelve a abrir la página,
  Then muestra el valor cambiado.
- Given un ajuste cambiado a mitad de sesión, When esa misma sesión sigue evaluando comandos,
  Then su comportamiento no cambia hasta la sesión siguiente.

## Points to clarify

Ninguno de estos puntos bloquea planificar: el mínimo de la spec se sostiene sin ellos. Son el
contrato de entrada a la fase de aclaración.

- **pregunta abierta** — ¿el arranque de sesión debe anunciar en una línea qué guards están
  apagados globalmente? Apagar el guard peligroso desde la TUI no deja rastro en el repo, y hoy
  apagarlo sí lo dejaba. No forma parte del mínimo: si la respuesta es sí, entra un criterio de
  aceptación nuevo; si es no, se cierra aquí.
- **suposición tomada** — `auto` es el valor por defecto y reproduce el comportamiento
  actual. *Base:* elección del usuario en esta sesión. *Riesgo:* si el perfil cambia de
  semántica, el defecto se mueve con él sin que nadie lo note.
- **suposición tomada** — los ajustes son de la persona y la máquina, no del repositorio.
  *Base:* reparto por dominio acordado. *Riesgo:* otra máquina arranca con todo encendido;
  es la dirección segura, pero no la preferencia del autor.
- **suposición tomada** — `guards.branch` cubre los dos interruptores del guard de rama
  (trunk y aislamiento de worktree). *Base:* elección del usuario. *Riesgo:* quien quiera
  apagar solo uno no puede.
- **decisión diferida** — interruptores por proyecto en la UI; fuera de este ciclo.
- **área no formulable** — qué debería ver un colaborador no técnico cuando el guard
  peligroso está apagado en esa máquina; sé que importa y todavía no sé formularlo.
- **pregunta abierta** — el repositorio no tiene constitución. ¿Se escribe una antes de
  planificar, o esta spec avanza sin principios heredados y los declara aquí?
