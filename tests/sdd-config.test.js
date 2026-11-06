/**
 * The SDD autopilot switch has one name: `sdd.execution_mode: automatic`.
 *
 * This guard exists because `specify` used to tell the model to read `sdd.autopilot: true`,
 * while `asdd`, `ship`, `constitution` and `sdd-init` all read `execution_mode`. A project that
 * configured one key could therefore still be asked to choose manual/autopilot, defeating the
 * autonomous flow. The test pins the single-key contract in the skills that consume it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const CONSUMERS = [
  "skills/asdd/SKILL.md",
  "skills/specify/SKILL.md",
  "skills/sdd-init/SKILL.md",
  "skills/ship/SKILL.md",
  "skills/constitution/SKILL.md",
];

test("autopilot has one config key: sdd.execution_mode", () => {
  for (const file of CONSUMERS) {
    assert.doesNotMatch(read(file), /sdd\.autopilot/, `${file} must not document a second autopilot key`);
    assert.match(read(file), /execution_mode/, `${file} must name the execution_mode key`);
  }
  assert.match(
    read("skills/specify/SKILL.md"),
    /sdd\.execution_mode: automatic/,
    "specify must treat the configured automatic mode as the autopilot default",
  );
  assert.match(
    read("skills/sdd-init/SKILL.md"),
    /only autopilot switch/,
    "sdd-init must state that execution_mode is the only autopilot key",
  );
});
