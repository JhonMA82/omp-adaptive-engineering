/**
 * The `.rsc` state contract across a main checkout and a linked worktree.
 *
 * Upstream RSC keeps committed decisions in `.rsc.json` and machine-local state in `.rsc/`.
 * A linked worktree starts without `.rsc/` (it is ignored), so the OMP boundary hydrates the
 * project opt-outs once and leaves the ledger, sello, nudge and memory to the checkout that
 * produced them. These tests use real `git worktree` checkouts, not mock paths.
 */
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  declaredOptOuts,
  hydrateProjectDecisions,
  inheritedOptOuts,
  localOptOuts,
  projectOptOuts,
  resolveRoots,
  stateSummary,
} from "../targets/omp-state-roots.mjs";

const git = (cwd, ...args) => {
  const run = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr}`);
  return run.stdout.trim();
};

/** A disposable repository with the two ignore rules a real RSC project has. */
function repo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rsc-state-")));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "state@example.com");
  git(dir, "config", "user.name", "State Test");
  writeFileSync(join(dir, ".gitignore"), ".rsc/\n.worktrees/\n");
  writeFileSync(join(dir, "a.txt"), "a\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "📝 init");
  return dir;
}

function worktree(main, name, branch) {
  const path = join(main, ".worktrees", name);
  git(main, "worktree", "add", "-q", "-b", branch, path);
  return realpathSync(path);
}

function marker(root, name) {
  mkdirSync(join(root, ".rsc"), { recursive: true });
  writeFileSync(join(root, ".rsc", `.no-${name}`), "");
}

function setOptOuts(root, names) {
  writeFileSync(join(root, ".rsc.json"), JSON.stringify({ version: 1, optOuts: names }));
}

test("the work root is the checkout, the main root is the checkout it was linked from", () => {
  const main = repo();
  const wt = worktree(main, "wt", "feat/wt");
  mkdirSync(join(wt, "src"), { recursive: true });

  assert.deepEqual(resolveRoots(main), { workRoot: main, mainRoot: main, linkedWorktree: false });
  assert.deepEqual(resolveRoots(wt), { workRoot: wt, mainRoot: main, linkedWorktree: true });
  // A subdirectory still resolves to its checkout; no session moves to the main checkout.
  assert.deepEqual(resolveRoots(join(wt, "src")), { workRoot: wt, mainRoot: main, linkedWorktree: true });

  const plain = realpathSync(mkdtempSync(join(tmpdir(), "rsc-no-git-")));
  assert.deepEqual(resolveRoots(plain), { workRoot: plain, mainRoot: plain, linkedWorktree: false });
});

test("a fresh worktree inherits committed decisions and the main checkout's markers once", () => {
  const main = repo();
  marker(main, "danger-guard");
  marker(main, "trunk-open");
  setOptOuts(main, ["gitmoji"]);
  git(main, "add", ".rsc.json");
  git(main, "commit", "-q", "-m", "📝 decision");
  // Local-only state that must never follow the opt-outs.
  writeFileSync(join(main, ".rsc", "sello.json"), "{}");
  writeFileSync(join(main, ".rsc", "review-ledger.jsonl"), "");
  mkdirSync(join(main, ".rsc", "memory"), { recursive: true });
  writeFileSync(join(main, ".rsc", "memory", "ftd-nudge.json"), "{}");

  const wt = worktree(main, "wt", "feat/wt");
  assert.deepEqual(projectOptOuts(main), ["danger-guard", "gitmoji", "trunk-open"]);
  assert.deepEqual(inheritedOptOuts(resolveRoots(wt)), ["danger-guard", "gitmoji", "trunk-open"]);

  assert.deepEqual(hydrateProjectDecisions(resolveRoots(wt)), ["danger-guard", "gitmoji", "trunk-open"]);
  assert.deepEqual(localOptOuts(wt), ["danger-guard", "gitmoji", "trunk-open"]);
  assert.deepEqual(
    readdirSync(join(wt, ".rsc")).sort(),
    [".no-danger-guard", ".no-gitmoji", ".no-trunk-open"],
    "only the project opt-out markers travel",
  );
  assert.equal(existsSync(join(wt, ".rsc", "sello.json")), false);
  assert.equal(existsSync(join(wt, ".rsc", "review-ledger.jsonl")), false);
  assert.equal(existsSync(join(wt, ".rsc", "memory", "ftd-nudge.json")), false);

  // The worktree is now authoritative: deleting a marker re-arms the guard, and a later session
  // must not put it back.
  rmSync(join(wt, ".rsc", ".no-danger-guard"));
  assert.deepEqual(hydrateProjectDecisions(resolveRoots(wt)), []);
  assert.deepEqual(localOptOuts(wt), ["gitmoji", "trunk-open"]);
});

test("a worktree's own opt-out never writes back to the main checkout", () => {
  const main = repo();
  const wt = worktree(main, "wt", "feat/wt");
  marker(wt, "ship-guard");

  assert.deepEqual(localOptOuts(main), []);
  assert.deepEqual(localOptOuts(wt), ["ship-guard"]);
  assert.deepEqual(hydrateProjectDecisions(resolveRoots(main)), []);
  assert.deepEqual(localOptOuts(main), [], "hydrating or using the worktree cannot change main");
});

test("one worktree never inherits another worktree's local opt-out", () => {
  const main = repo();
  const first = worktree(main, "first", "feat/first");
  const second = worktree(main, "second", "feat/second");
  marker(first, "danger-guard");

  assert.deepEqual(hydrateProjectDecisions(resolveRoots(second)), []);
  assert.deepEqual(localOptOuts(second), []);
});

test("inheritance happens once: a later main decision does not rewrite an existing worktree", () => {
  const main = repo();
  const wt = worktree(main, "wt", "feat/wt");
  // A session already ran here (it may have written only local state), so `.rsc/` exists.
  mkdirSync(join(wt, ".rsc"), { recursive: true });

  marker(main, "danger-guard");
  assert.deepEqual(hydrateProjectDecisions(resolveRoots(wt)), []);
  assert.deepEqual(localOptOuts(wt), [], "the worktree's own .rsc/ is authoritative after the first session");
});

test("a declaration on the worktree's branch wins over the main declaration", () => {
  const main = repo();
  setOptOuts(main, ["danger-guard", "trunk-guard"]);
  git(main, "add", ".rsc.json");
  git(main, "commit", "-q", "-m", "📝 decision");

  const wt = worktree(main, "wt", "feat/wt");
  setOptOuts(wt, ["gitmoji"]);
  git(wt, "add", ".rsc.json");
  git(wt, "commit", "-q", "-m", "📝 branch decision");
  // A marker that exists only in the main checkout is still the only record of that decision.
  marker(main, "ship-guard");

  assert.deepEqual(declaredOptOuts(wt), ["gitmoji"]);
  assert.deepEqual(inheritedOptOuts(resolveRoots(wt)), ["gitmoji", "ship-guard"]);
  assert.deepEqual(hydrateProjectDecisions(resolveRoots(wt)), ["gitmoji", "ship-guard"]);
  assert.deepEqual(localOptOuts(wt), ["gitmoji", "ship-guard"]);
  assert.equal(existsSync(join(wt, ".rsc", ".no-danger-guard")), false, "the branch re-armed it");
  assert.equal(existsSync(join(wt, ".rsc", ".no-trunk-guard")), false);
});

test("committed declarations alone are enough; no local marker is required", () => {
  const main = repo();
  setOptOuts(main, ["asdd-gate", "danger-guard"]);
  git(main, "add", ".rsc.json");
  git(main, "commit", "-q", "-m", "📝 decision");
  const wt = worktree(main, "wt", "feat/wt");

  assert.deepEqual(hydrateProjectDecisions(resolveRoots(wt)), ["asdd-gate", "danger-guard"]);
  assert.ok(existsSync(join(wt, ".rsc", ".no-asdd-gate")));
  assert.ok(existsSync(join(wt, ".rsc", ".no-danger-guard")));
});

test("a fresh clone materializes its own committed opt-outs once", () => {
  const clone = repo();
  setOptOuts(clone, ["danger-guard", "trunk-guard"]);
  git(clone, "add", ".rsc.json");
  git(clone, "commit", "-q", "-m", "📝 decision");

  assert.deepEqual(hydrateProjectDecisions(resolveRoots(clone)), ["danger-guard", "trunk-guard"]);
  assert.ok(existsSync(join(clone, ".rsc", ".no-danger-guard")));
  assert.ok(existsSync(join(clone, ".rsc", ".no-trunk-guard")));
  assert.deepEqual(hydrateProjectDecisions(resolveRoots(clone)), [], "local state is authority after that");
});

test("a checkout without git has one root and writes nothing", () => {
  const plain = realpathSync(mkdtempSync(join(tmpdir(), "rsc-no-git-")));
  const roots = resolveRoots(plain);
  assert.deepEqual(hydrateProjectDecisions(roots), []);
  assert.equal(existsSync(join(plain, ".rsc")), false);
});

test("stateSummary reports both roots and the project decisions", () => {
  const main = repo();
  marker(main, "danger-guard");
  const wt = worktree(main, "wt", "feat/wt");
  hydrateProjectDecisions(resolveRoots(wt));

  assert.deepEqual(stateSummary(wt), {
    worktree: wt,
    mainCheckout: main,
    linkedWorktree: true,
    projectOptOuts: ["danger-guard"],
  });
});

test("a committed .rsc/ in the worktree is local authority, not a template to hydrate", () => {
  const main = repo();
  marker(main, "danger-guard");
  const wt = worktree(main, "wt", "feat/wt");
  // Simulate a project that (unusually) tracks its local state: the directory already exists.
  mkdirSync(join(wt, ".rsc"), { recursive: true });
  writeFileSync(join(wt, ".rsc", ".no-gitmoji"), "");

  assert.deepEqual(hydrateProjectDecisions(resolveRoots(wt)), []);
  assert.deepEqual(localOptOuts(wt), ["gitmoji"]);
  assert.equal(existsSync(join(wt, ".rsc", ".no-danger-guard")), false);
});

test("a nested project inside a checkout is the work root, not the git toplevel", () => {
  const main = repo();
  const nested = join(main, "03-PROJECTS", "a");
  mkdirSync(join(nested, ".rsc"), { recursive: true });
  mkdirSync(join(nested, "src"), { recursive: true });

  assert.deepEqual(resolveRoots(nested), {
    workRoot: realpathSync(nested),
    mainRoot: realpathSync(nested),
    linkedWorktree: false,
  });
  assert.deepEqual(resolveRoots(join(nested, "src")).workRoot, realpathSync(nested));
});

test("a nested project in a worktree maps to its counterpart in the main checkout", () => {
  const main = repo();
  const nested = join(main, "03-PROJECTS", "a");
  mkdirSync(nested, { recursive: true });
  setOptOuts(nested, ["danger-guard"]);
  git(main, "add", "03-PROJECTS/a/.rsc.json");
  git(main, "commit", "-q", "-m", "📝 nested decision");

  const wt = worktree(main, "wt", "feat/wt");
  const wtNested = join(wt, "03-PROJECTS", "a");
  assert.ok(existsSync(wtNested), "the worktree checks out the nested project");

  assert.deepEqual(resolveRoots(wtNested), {
    workRoot: realpathSync(wtNested),
    mainRoot: realpathSync(nested),
    linkedWorktree: true,
  });
  assert.deepEqual(hydrateProjectDecisions(resolveRoots(wtNested)), ["danger-guard"]);
  assert.ok(existsSync(join(wtNested, ".rsc", ".no-danger-guard")));
  assert.equal(existsSync(join(main, ".rsc", ".no-danger-guard")), false, "main is untouched");
});
