/**
 * Gate and mode tests: what the four switches gate, how `danger.mode` rewrites a verdict, the
 * profile mapping and the one-line startup notice. The profile mapping is the contract that keeps a
 * global setting from loosening a non-technical project.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULTS,
  applyDangerMode,
  guardEnabled,
  profileFrom,
  startupNotice,
} from "../targets/plugin-settings.mjs";

const settings = (overrides = {}) => ({
  guards: { ...DEFAULTS.guards, ...(overrides.guards ?? {}) },
  dangerMode: overrides.dangerMode ?? DEFAULTS.dangerMode,
});

test("guardEnabled follows the stored boolean", () => {
  assert.equal(guardEnabled(DEFAULTS, "gitmoji"), true);
  assert.equal(guardEnabled(settings({ guards: { gitmoji: false } }), "gitmoji"), false);
  assert.equal(guardEnabled(settings({ guards: { danger: false } }), "danger"), false);
});

test("auto leaves the verdict untouched", () => {
  const ask = { decision: "ask", reason: "r" };
  assert.equal(applyDangerMode("auto", ask, "technical"), ask);
  assert.equal(applyDangerMode("auto", ask, "non-technical"), ask);
});

test("deny turns an ask into a deny and leaves allow alone", () => {
  assert.equal(applyDangerMode("deny", { decision: "ask", reason: "r" }, "technical").decision, "deny");
  assert.equal(applyDangerMode("deny", { decision: "deny", reason: "r" }, null).decision, "deny");
  assert.equal(applyDangerMode("deny", { decision: "allow" }, "technical").decision, "allow");
});

test("ask never loosens a non-technical profile", () => {
  assert.equal(applyDangerMode("ask", { decision: "deny", reason: "r" }, "non-technical").decision, "deny");
});

test("ask applies where the profile would ask or where there is none", () => {
  assert.equal(applyDangerMode("ask", { decision: "deny", reason: "r" }, null).decision, "ask");
  assert.equal(applyDangerMode("ask", { decision: "deny", reason: "r" }, "technical").decision, "ask");
  assert.equal(applyDangerMode("ask", { decision: "allow" }, null).decision, "allow");
});

test("profileFrom maps the raw level to the three cases the mode understands", () => {
  assert.equal(profileFrom("technical"), "technical");
  assert.equal(profileFrom("non-technical"), "non-technical");
  assert.equal(profileFrom("mixed"), "non-technical");
  assert.equal(profileFrom(""), null);
  assert.equal(profileFrom(undefined), null);
});

test("startupNotice is absent when every guard is on", () => {
  assert.equal(startupNotice(DEFAULTS), null);
});

test("startupNotice names every guard that is off, in one line", () => {
  const notice = startupNotice(settings({ guards: { gitmoji: false, danger: false } }));
  assert.equal(typeof notice, "string");
  assert.equal(notice.includes("\n"), false);
  assert.match(notice, /gitmoji/);
  assert.match(notice, /danger/);
  assert.doesNotMatch(notice, /ship/);
});
