/**
 * The full `danger.mode` matrix: three profiles × three modes, judged by the real guard.
 *
 * `auto` mirrors upstream RSC: a technical project is asked, anyone else (including no profile) is
 * denied. `ask` is the port's explicit override: it turns a denial into a native confirmation only
 * where the project is not explicitly non-technical. `deny` hardens whatever the guard would ask.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { evaluateDanger } from "../targets/danger-guard.mjs";
import { applyDangerMode, profileFrom } from "../targets/plugin-settings.mjs";

const PROFILE = join("02-DOCS", "wiki", "harness", "user-profile.md");

const root = (level) => {
  const dir = mkdtempSync(join(tmpdir(), "danger-matrix-"));
  if (level !== null) {
    mkdirSync(join(dir, "02-DOCS", "wiki", "harness"), { recursive: true });
    writeFileSync(join(dir, PROFILE), `technical_level: ${level}\n`);
  }
  return dir;
};

const levelOf = (dir) => {
  try {
    return profileFrom(/technical_level:\s*([a-z-]+)/i.exec(readFileSync(join(dir, PROFILE), "utf8"))?.[1]);
  } catch {
    return null;
  }
};

const DESTRUCTIVE = "git reset --hard HEAD";
const HARMLESS = "ls -la";

const decide = (dir, mode, command = DESTRUCTIVE) =>
  applyDangerMode(mode, evaluateDanger(dir, command), levelOf(dir));

test("auto preserves the guard's own verdict for every profile", () => {
  assert.equal(decide(root("technical"), "auto").decision, "ask");
  assert.equal(decide(root("non-technical"), "auto").decision, "deny");
  assert.equal(decide(root(null), "auto").decision, "deny");
});

test("ask confirms for a technical profile and for no profile, never for a non-technical one", () => {
  assert.equal(decide(root("technical"), "ask").decision, "ask");
  assert.equal(decide(root("non-technical"), "ask").decision, "deny");
  assert.equal(decide(root(null), "ask").decision, "ask");
});

test("deny hardens every profile the guard would ask about", () => {
  for (const level of ["technical", "non-technical", null]) {
    assert.equal(decide(root(level), "deny").decision, "deny", `profile ${level}`);
  }
});

test("no mode turns a harmless command into a decision", () => {
  for (const level of ["technical", "non-technical", null]) {
    for (const mode of ["auto", "ask", "deny"]) {
      assert.equal(decide(root(level), mode, HARMLESS).decision, "allow", `profile ${level}, mode ${mode}`);
    }
  }
});

test("a relaxed verdict is marked for rewriting", () => {
  const relaxed = decide(root(null), "ask");
  assert.equal(relaxed.decision, "ask");
  // The guard's own reason still says BLOCKED; `rewritten` is what tells the adapter not to show it
  // verbatim. tests/adapter.test.ts asserts the confirmation carries the mode's text instead.
  assert.equal(relaxed.rewritten, true);
});
