/**
 * Plugin settings: the four guard switches and the danger mode.
 *
 * OMP declares them in `package.json#omp.settings`, paints them in Settings → Plugins and persists
 * them in `<plugins>/omp-plugins.lock.json` under `settings["omp-rsc-harness"]`; a project can
 * override key by key in `<root>/.omp/plugin-overrides.json`. OMP exposes no accessor to the
 * extension, so this module reads the same files OMP writes.
 *
 * Every failure is fail-open by contract: an unreadable or malformed file yields the defaults, and
 * the initialising call never throws.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const PLUGIN_NAME = "omp-rsc-harness";
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
 * The lock file OMP writes. OMP resolves the plugins directory through its own dirs resolver, which
 * on Linux redirects to `$XDG_DATA_HOME/omp/plugins` once that root exists, and otherwise keeps it
 * beside the agent directory. Probe in OMP's own precedence — XDG first, then beside the agent dir,
 * then its parent — and return `null` when none exists.
 */
export function resolveLockPath({ agentDir, env = process.env } = {}) {
  const candidates = [];

  const xdgRoot = env?.XDG_DATA_HOME ? join(env.XDG_DATA_HOME, "omp") : null;
  if (xdgRoot && process.platform === "linux" && existsSync(xdgRoot)) {
    candidates.push(join(xdgRoot, "plugins", LOCK_NAME));
  }

  if (agentDir && typeof agentDir === "string") {
    candidates.push(
      join(agentDir, "plugins", LOCK_NAME),
      join(dirname(agentDir), "plugins", LOCK_NAME),
    );
  }

  for (const candidate of candidates) {
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

/** The profile as the three cases the mode distinguishes. Anything that is not exactly `technical`
 * is treated as non-technical: the safe side, because it is the one that never loosens a guard. */
export function profileFrom(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  return raw.trim().toLowerCase() === "technical" ? "technical" : "non-technical";
}

/** Whether a guard runs. A missing or malformed value reads as on. */
export function guardEnabled(settings, name) {
  return settings?.guards?.[name] !== false;
}

/**
 * `danger.mode` applied to the guard's verdict. `auto` changes nothing; `deny` hardens any verdict;
 * `ask` only relaxes a denial where the project has no non-technical profile to protect.
 */
export function applyDangerMode(mode, verdict, profile) {
  if (!verdict || verdict.decision === "allow") return verdict;
  // `rewritten` tells the adapter the reason was written for the opposite decision and must not be
  // shown verbatim: an "ask" reason under a deny, or a "BLOCKED" reason in a confirmation dialog,
  // is a lie about what is happening.
  if (mode === "deny" && verdict.decision === "ask") {
    return { ...verdict, decision: "deny", rewritten: true };
  }
  if (mode === "ask" && verdict.decision === "deny" && profile !== "non-technical") {
    return { ...verdict, decision: "ask", rewritten: true };
  }
  return verdict;
}

/** One line naming the guards that are off, or `null` when every guard is on. */
export function startupNotice(settings) {
  const off = GUARD_NAMES.filter((name) => settings?.guards?.[name] === false);
  if (off.length === 0) return null;
  return `rsc: guards apagados — ${off.join(", ")}. Se cambian en Settings → Plugins.`;
}
