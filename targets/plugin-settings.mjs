/**
 * Plugin settings: the four guard switches and the danger mode.
 *
 * OMP declares them in `package.json#omp.settings`, paints them in Settings → Plugins and persists
 * them in `<plugins>/omp-plugins.lock.json` under `settings["adaptive-engineering"]`; a project can
 * override key by key in `<root>/.omp/plugin-overrides.json`. OMP exposes no accessor to the
 * extension, so this module reads the same files OMP writes.
 *
 * Every failure is fail-open by contract: an unreadable or malformed file yields the defaults, and
 * the initialising call never throws.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const PLUGIN_NAME = "adaptive-engineering";
export const GUARD_NAMES = ["danger", "branch", "ship", "gitmoji"];
export const DANGER_MODES = ["auto", "ask", "deny"];

export const DEFAULTS = Object.freeze({
  guards: Object.freeze({ danger: true, branch: true, ship: true, gitmoji: true }),
  dangerMode: "auto",
});

const LOCK_NAME = "omp-plugins.lock.json";

function readJson(path) {
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * The lock file OMP writes. The plugins directory sits beside the agent directory, except under the
 * XDG layout where it lives inside it — probe both, first hit wins, `null` when there is none.
 */
export function resolveLockPath({ agentDir } = {}) {
  if (!agentDir || typeof agentDir !== "string") return null;
  for (const candidate of [
    join(agentDir, "plugins", LOCK_NAME),
    join(dirname(agentDir), "plugins", LOCK_NAME),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** This plugin's slice of a settings file, or `{}` when the file or the entry is absent. */
function pluginSlice(value) {
  const slice = value?.settings?.[PLUGIN_NAME];
  return slice && typeof slice === "object" && !Array.isArray(slice) ? slice : {};
}

/**
 * Merge global and project settings, validate each value and return the complete shape. The project
 * override wins key by key. Invalid values fall back to their default rather than rejecting the
 * whole file.
 */
export function readSettings({ lockPath, projectPaths = [] } = {}) {
  const global = pluginSlice(readJson(lockPath));
  const project = projectPaths.reduce((merged, path) => ({ ...merged, ...pluginSlice(readJson(path)) }), {});
  const merged = { ...global, ...project };

  const guards = {};
  for (const name of GUARD_NAMES) {
    const value = merged[`guards.${name}`];
    guards[name] = typeof value === "boolean" ? value : DEFAULTS.guards[name];
  }

  const mode = merged["danger.mode"];
  return {
    guards,
    dangerMode: DANGER_MODES.includes(mode) ? mode : DEFAULTS.dangerMode,
  };
}
