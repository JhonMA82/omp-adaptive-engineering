/**
 * OMP boundary for RSC's two state scopes.
 *
 * Upstream RSC keeps two different things in two different places:
 *
 *   - `.rsc.json`  the team's decision, committed, so every clone and every linked worktree that
 *                  checks out that branch sees it;
 *   - `.rsc/`      machine-local state: opt-out markers, the sello, the review ledger, the nudge
 *                  journal and the session memory. It is ignored, so a linked worktree starts
 *                  without it and uses its own copy.
 *
 * Upstream rebuilds the local markers from `.rsc.json` at install/sync time ("hydrateLocalDecisions"
 * in `scripts/install-apply.js`). This port has no installer, so the equivalent boundary is the
 * first session in a checkout: when a linked worktree has no `.rsc/` yet, inherit the project
 * decisions one time. It never writes back to the main checkout, and it never copies the sello,
 * the ledger, the nudge journal or the memory — those belong to the checkout that produced them.
 *
 * This module only resolves roots and materializes the opt-out files the shipped guards read. It
 * does not add a registry, a lock, a daemon or a second state store.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

/** The project decisions this port's modules actually consult. Machine-local switches stay out. */
export const PROJECT_OPT_OUTS = [
  "asdd-gate",
  "danger-guard",
  "feature-gate",
  "ftd-nudge",
  "gitmoji",
  "ship-guard",
  "trunk-guard",
  "trunk-open",
  "worktree-isolation",
];

const SUPPORTED = new Set(PROJECT_OPT_OUTS);

const git = (cwd, args) => {
  const run = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true });
  return run.status === 0 ? (run.stdout || "").trim() : null;
};

const real = (path) => {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
};

/** A directory that declares itself a project to RSC. */
const hasProjectMarker = (dir) =>
  existsSync(join(dir, ".rsc")) ||
  existsSync(join(dir, ".rsc.json")) ||
  existsSync(join(dir, "02-DOCS"));

/** Nearest project root at or below the checkout ceiling; the ceiling itself when there is none. */
export function projectRootWithin(start, ceiling) {
  let dir = start;
  for (;;) {
    if (hasProjectMarker(dir)) return dir;
    if (dir === ceiling) return ceiling;
    const up = dirname(dir);
    if (up === dir) return ceiling;
    // Never walk past the checkout: in a linked worktree this is the worktree, not the main tree.
    if (up !== ceiling && !up.startsWith(`${ceiling}${sep}`)) return ceiling;
    dir = up;
  }
}

function nearestHarnessRoot(start) {
  let dir = start;
  for (;;) {
    if (hasProjectMarker(dir) || existsSync(join(dir, ".git"))) {
      return dir;
    }
    const up = dirname(dir);
    if (up === dir) return start;
    dir = up;
  }
}

/**
 * The project the session works in, and the main checkout of the same repository.
 *
 * `workRoot` is the nearest project root inside the checkout (`.rsc`/`.rsc.json`/`02-DOCS`), or the
 * checkout toplevel when the tree has no marker. In a linked worktree it is always below the
 * worktree boundary, never the main checkout, so every guard and `.rsc/` write stays on the branch
 * being worked. `mainRoot` is only used to read the shared project decision and to hydrate a fresh
 * worktree; it is never passed to a guard as the working root.
 */
export function resolveRoots(cwd) {
  const start = real(resolve(cwd));
  const top = git(start, ["rev-parse", "--show-toplevel"]);
  if (!top) {
    const root = nearestHarnessRoot(start);
    return { workRoot: root, mainRoot: root, linkedWorktree: false };
  }

  const worktreeTop = real(top);
  const workRoot = projectRootWithin(start, worktreeTop);
  const common = git(start, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common) return { workRoot, mainRoot: workRoot, linkedWorktree: false };

  const candidate = real(dirname(common));
  // The common dir of a submodule or a bare repository does not sit inside a working tree; do not
  // treat its parent as a main checkout. Only a real toplevel of the same repository qualifies.
  const candidateTop = git(candidate, ["rev-parse", "--show-toplevel"]);
  const candidateCommon = git(candidate, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const sameRepository = candidateCommon !== null && real(candidateCommon) === real(common);
  if (candidateTop && real(candidateTop) === candidate && sameRepository && candidate !== worktreeTop) {
    // A nested project in the worktree has a counterpart at the same relative path in the main
    // checkout; use it for project decisions. A missing counterpart falls back to the main toplevel.
    const rel = relative(worktreeTop, workRoot).split(sep).join("/");
    const counterpart = rel && !rel.startsWith("..") ? join(candidate, rel) : candidate;
    const mainRoot = existsSync(counterpart) ? real(counterpart) : candidate;
    return { workRoot, mainRoot, linkedWorktree: true };
  }
  return { workRoot, mainRoot: workRoot, linkedWorktree: false };
}

function readJson(path) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

/** Opt-outs declared by `.rsc.json` in one checkout. */
export function declaredOptOuts(root) {
  const declaration = readJson(join(root, ".rsc.json"));
  const list = Array.isArray(declaration?.optOuts) ? declaration.optOuts : [];
  return [...new Set(list.filter((name) => SUPPORTED.has(name)))].sort();
}

/** Opt-outs present as local markers in one checkout. */
export function localOptOuts(root) {
  let files = [];
  try {
    files = readdirSync(join(root, ".rsc"));
  } catch {
    return [];
  }
  return [...new Set(
    files
      .filter((file) => file.startsWith(".no-"))
      .map((file) => file.slice(".no-".length))
      .filter((name) => SUPPORTED.has(name)),
  )].sort();
}

/** Project decisions one checkout already holds, declaration first, markers second. */
export function projectOptOuts(root) {
  return [...new Set([...declaredOptOuts(root), ...localOptOuts(root)])].sort();
}

/**
 * What a linked worktree should inherit.
 *
 * A declaration committed on the worktree's branch is the branch's own project decision and wins
 * over the main checkout's declaration. The main checkout's local markers are still a fallback:
 * this port records decisions as markers (it has no manifest writer), so a marker that exists only
 * there is the only record of the decision. A worktree that already has `.rsc/` is authoritative
 * and is not hydrated at all (see below).
 */
export function inheritedOptOuts({ workRoot, mainRoot }) {
  if (workRoot === mainRoot) return [];
  const declarationRoot = existsSync(join(workRoot, ".rsc.json")) ? workRoot : mainRoot;
  return [...new Set([...declaredOptOuts(declarationRoot), ...localOptOuts(mainRoot)])].sort();
}

/**
 * Give a fresh checkout the project opt-outs once. A checkout that already has `.rsc/` is
 * authoritative for itself: deleting a marker there re-arms the guard, and a later session must not
 * undo that choice. A main checkout materializes only its own committed `.rsc.json` (the clone
 * case); a linked worktree also inherits the main checkout's local markers. Returns the marker names
 * it created.
 */
export function hydrateProjectDecisions(roots) {
  const { workRoot, mainRoot } = roots;
  if (existsSync(join(workRoot, ".rsc"))) return [];

  const names = workRoot === mainRoot ? declaredOptOuts(workRoot) : inheritedOptOuts(roots);
  if (names.length === 0) return [];

  const dir = join(workRoot, ".rsc");
  mkdirSync(dir, { recursive: true });
  const note =
    workRoot === mainRoot
      ? "Declared in .rsc.json by this project; materialized here by the OMP adapter.\n"
      : "Inherited from the main checkout's project decisions by the OMP adapter.\n";
  for (const name of names) writeFileSync(join(dir, `.no-${name}`), note);
  return names;
}

/** One object for `/adaptive-status`; the roots, not a second registry. */
export function stateSummary(cwd) {
  const roots = resolveRoots(cwd);
  return {
    worktree: roots.workRoot,
    mainCheckout: roots.mainRoot,
    linkedWorktree: roots.linkedWorktree,
    projectOptOuts: projectOptOuts(roots.workRoot),
  };
}
