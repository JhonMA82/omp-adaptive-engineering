---
type: ftd
title: FTD — Renombrar el repositorio a omp-rsc-harness
description: La identidad del proyecto pasa de omp-adaptive-engineering / adaptive-engineering a omp-rsc-harness en GitHub, en el manifiesto del plugin, en el lockfile y en los documentos vivos.
author: Juan
branch: main
status: done
created: 2026-11-06
slug: repo-rename
---

# FTD — Renombrar el repositorio a omp-rsc-harness

## Intent

El mismo artefacto aparece con dos nombres: la carpeta y el remoto dicen
`omp-adaptive-engineering`, y el plugin se registra como `adaptive-engineering`. El nombre decidido
es **`omp-rsc-harness`**, que describe lo que el repo es (el RSC Harness portado a OMP) y coincide
con la identidad pública. Se renombra en todos los sitios donde el nombre es identidad, no historia.

## Scope

Dentro:

- GitHub: `JhonMA82/omp-adaptive-engineering` → `JhonMA82/omp-rsc-harness` (GitHub redirige la URL
  vieja).
- `package.json#name`, que es la identidad del plugin para OMP.
- `targets/plugin-settings.mjs` (`PLUGIN_NAME`) y las fixtures de `tests/plugin-settings.test.js` y
  `tests/adapter.test.ts`, que leen la rebanada `settings["<plugin>"]` del lock.
- `bun.lock` (`workspaces[""].name`).
- `README.md`: ruta de instalación, symlink, comandos de ciclo de vida y ajustes.
- `02-DOCS/wiki/harness/user-profile.md` y `02-DOCS/wiki/sdd/decisions.md`: afirmaciones sobre el
  estado actual.
- Carpeta local `~/Dev/omp-adaptive-engineering` → `~/Dev/omp-rsc-harness` y re-link del plugin.

Fuera:

- Comandos `/adaptive-*` y nombres de skills/agentes: son nombres del método, no del repo.
- Documentos fechados de evidencia (`AUDITORIA_PORT_RSC_OMP.md`, `sdd/plans/`, `sdd/progress/`,
  `sdd/verifications/`) y los diffs congelados de `.rsc/review/`: registran lo observado en su fecha;
  reescribirlos falsificaría la evidencia.
- El prefijo `adaptive` del namespace de comandos y del estado `.rsc`/`.omp`: compatible y sin
  relación con la URL.

## Checklist

- [x] **Desbloquear main** — `trunkPolicy` devuelve `{"closed":false,"reason":"unlocked","signals":[]}`.
- [x] **Renombrar la identidad del plugin** — `package.json:2`, `PLUGIN_NAME` en
      `targets/plugin-settings.mjs:15`, fixtures de ambos tests y `bun.lock:6`.
- [x] **Actualizar los documentos vivos** — README, perfil y decisiones; las ocurrencias restantes
      son documentos fechados de evidencia (ver Scope).
- [x] **Verificar** — suite completa verde y el plugin listado con la identidad nueva.
- [x] **Renombrar GitHub y la carpeta local** — remoto, `gh repo view` y symlink del plugin en la
      ruta nueva; entrada vieja del lock retirada.
- [x] **Evidencia en este FTD** — la sección Evidence cita fichero/línea y resultados.

## Evidence

- `targets/trunk-policy.mjs` vía `node -e`: `{"closed":false,"reason":"unlocked","signals":[]}` con
  `.rsc/.no-trunk-guard` presente y `.rsc/.no-trunk-open` eliminado (estado local, `.rsc/` ignorado).
- `package.json:2` `"name": "omp-rsc-harness"`; `targets/plugin-settings.mjs:15`
  `PLUGIN_NAME = "omp-rsc-harness"`; `tests/plugin-settings.test.js:26,95` y
  `tests/adapter.test.ts:250` usan la rebanada nueva; `bun.lock:6` idem.
- `README.md:28-41,95-96` con ruta, symlink, ciclo de vida y clave de ajustes nuevas.
- `grep -rIn 'adaptive-engineering\|omp-adaptive'` sin resultados en código, manifiesto, lockfile ni
  README; solo quedan en `AUDITORIA_PORT_RSC_OMP.md`, `sdd/plans/`, `sdd/progress/`,
  `sdd/verifications/` y `.rsc/review/*.diff` (historia congelada) y en este FTD.
- `node --test tests/*.test.js`: 234 pass, 1 skipped, 0 fail. `bun tests/adapter.test.ts`: todas las
  baterías pasan. `bun run typecheck`: sin errores. Repetido desde la carpeta nueva.
- `omp plugin list`: `● omp-rsc-harness@0.2.0`. `omp plugin config list omp-rsc-harness --json`
  devuelve `{"settings":{},"schema":…}`.
- `git remote -v` y `gh repo view --json name,url`: `JhonMA82/omp-rsc-harness`,
  `https://github.com/JhonMA82/omp-rsc-harness`.
- `~/.omp/plugins/node_modules/omp-rsc-harness -> /home/juan/Dev/omp-rsc-harness`; el lock de OMP
  conserva una sola entrada.
- Nota: `omp plugin uninstall adaptive-engineering` respondió «not installed» porque el enlace viejo
  no estaba en el registro de instalación; el symlink colgante y su entrada del lock se retiraron
  directamente. `settings` estaba vacío, así que no hubo ajustes que migrar.

## Next

Reabrir la sesión en `~/Dev/omp-rsc-harness` para que OMP cargue el plugin con la identidad nueva;
el plugin enlazado solo cambia en sesiones nuevas.
