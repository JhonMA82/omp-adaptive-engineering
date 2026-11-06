/**
 * Reader tests for the plugin settings: lock resolution, defaults, project override precedence,
 * malformed input. Written before `targets/plugin-settings.mjs` exists — the red is the task's
 * done-check, and the module is stubbed before the real implementation so the reds land on
 * assertions instead of an import error.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DEFAULTS, readSettings, resolveLockPath } from "../targets/plugin-settings.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "plugin-settings-"));

function lockAt(dir, value) {
  const plugins = join(dir, "plugins");
  mkdirSync(plugins, { recursive: true });
  const file = join(plugins, "omp-plugins.lock.json");
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  return file;
}

function pluginLock(settings) {
  return { plugins: {}, settings: { "adaptive-engineering": settings } };
}

test("resolveLockPath finds the lock under <agentDir>/plugins", () => {
  const agentDir = tmp();
  const expected = lockAt(agentDir, pluginLock({}));
  assert.equal(resolveLockPath({ agentDir }), expected);
});

test("resolveLockPath falls back to <parent>/plugins when the agent dir is XDG-flattened", () => {
  const root = tmp();
  const agentDir = join(root, "omp");
  mkdirSync(agentDir, { recursive: true });
  const expected = lockAt(root, pluginLock({}));
  assert.equal(resolveLockPath({ agentDir }), expected);
});

test("resolveLockPath returns null when neither candidate exists", () => {
  assert.equal(resolveLockPath({ agentDir: join(tmp(), "missing") }), null);
  assert.equal(resolveLockPath({ agentDir: null }), null);
});

test("readSettings returns the defaults with no lock and no overrides", () => {
  const settings = readSettings({ lockPath: null, projectPaths: [] });
  assert.deepEqual(settings, DEFAULTS);
  assert.equal(settings.dangerMode, "auto");
  assert.equal(settings.guards.danger, true);
  assert.equal(settings.guards.branch, true);
  assert.equal(settings.guards.ship, true);
  assert.equal(settings.guards.gitmoji, true);
});

test("readSettings reads a stored boolean", () => {
  const lockPath = lockAt(tmp(), pluginLock({ "guards.gitmoji": false }));
  const settings = readSettings({ lockPath, projectPaths: [] });
  assert.equal(settings.guards.gitmoji, false);
  assert.equal(settings.guards.danger, true);
});

test("readSettings reads the danger mode", () => {
  const lockPath = lockAt(tmp(), pluginLock({ "danger.mode": "deny" }));
  assert.equal(readSettings({ lockPath, projectPaths: [] }).dangerMode, "deny");
});

test("a project override wins over the global lock", () => {
  const lockPath = lockAt(tmp(), pluginLock({ "guards.danger": true }));
  const project = join(tmp(), "plugin-overrides.json");
  writeFileSync(project, JSON.stringify({ settings: { "adaptive-engineering": { "guards.danger": false } } }));

  const settings = readSettings({ lockPath, projectPaths: [project] });
  assert.equal(settings.guards.danger, false);
});

test("a malformed lock falls back to the defaults instead of throwing", () => {
  const lockPath = lockAt(tmp(), "{ not json");
  assert.deepEqual(readSettings({ lockPath, projectPaths: [] }), DEFAULTS);
});

test("values of the wrong type fall back to their default", () => {
  const lockPath = lockAt(
    tmp(),
    pluginLock({ "guards.danger": "no", "guards.ship": 1, "danger.mode": "sometimes" }),
  );
  const settings = readSettings({ lockPath, projectPaths: [] });
  assert.equal(settings.guards.danger, true);
  assert.equal(settings.guards.ship, true);
  assert.equal(settings.dangerMode, "auto");
});

test("unknown keys are ignored", () => {
  const lockPath = lockAt(tmp(), pluginLock({ "guards.nope": false, other: "x" }));
  assert.deepEqual(readSettings({ lockPath, projectPaths: [] }), DEFAULTS);
});
