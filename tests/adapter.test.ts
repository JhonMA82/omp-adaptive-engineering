/**
 * Adapter-boundary test: it does not mock RSC. It loads the real extension factory with a fake
 * ExtensionAPI, then drives its captured `tool_call` handler against the real guards. This is the
 * piece a Node-only guard test cannot cover: OMP's allow/ask/deny translation.
 *
 * Run with: bun tests/adapter.test.ts
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import adaptiveEngineering from "../src/index.ts";
import { loadRsc } from "../src/rsc-boundary.ts";

interface Chainable {
  (...args: unknown[]): Chainable;
  [key: string]: Chainable;
}

interface FakeContext {
  cwd: string;
  hasUI: boolean;
  agent: { kind: string; id: string; name: string; depth: number };
  sessionManager: { getSessionId(): string };
  ui: { confirm(): Promise<boolean>; notify(): void };
}

interface CapturedTool {
  name: string;
  execute(...args: unknown[]): Promise<unknown>;
}

interface CapturedCommand {
  handler(...args: unknown[]): unknown;
}

type Handler = (event: unknown, ctx: FakeContext) => Promise<unknown> | unknown;

const chain = new Proxy(function () {}, { get: () => chain, apply: () => chain }) as unknown as Chainable;
const z = new Proxy({}, { get: () => chain }) as unknown as Chainable;

const handlers = new Map<string, Handler>();
const tools = new Map<string, CapturedTool>();
const commands = new Map<string, CapturedCommand>();
const messages: unknown[] = [];

const pi = {
  zod: z,
  on: (event: string, handler: Handler) => handlers.set(event, handler),
  registerTool: (definition: CapturedTool) => tools.set(definition.name, definition),
  registerCommand: (name: string, definition: CapturedCommand) => commands.set(name, definition),
  sendMessage: (message: unknown) => messages.push(message),
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
};

await adaptiveEngineering(pi as unknown as Parameters<typeof adaptiveEngineering>[0]);

assert.ok(handlers.has("tool_call"), "the extension must subscribe to tool_call");
assert.ok(commands.has("adaptive-main-unlock"), "the native main switch must be registered");
assert.ok(tools.has("rsc_risk"), "the risk tool must be registered");

const rsc = await loadRsc();
for (const fn of ["resolveLockPath", "readSettings", "guardEnabled", "profileFrom", "applyDangerMode", "startupNotice"]) {
  assert.equal(typeof (rsc.settings as unknown as Record<string, unknown>)[fn], "function", `settings.${fn} must be loaded`);
}

function project(technical: "technical" | "non-technical"): string {
  const root = mkdtempSync(join(tmpdir(), "adaptive-adapter-"));
  mkdirSync(join(root, "02-DOCS", "wiki", "harness"), { recursive: true });
  writeFileSync(join(root, "02-DOCS", "wiki", "harness", "user-profile.md"), `technical_level: ${technical}\n`);
  return root;
}

function context(root: string, options: { hasUI: boolean; confirm?: boolean }): FakeContext {
  return {
    cwd: root,
    hasUI: options.hasUI,
    agent: { kind: "main", id: "main", name: "main", depth: 0 },
    sessionManager: { getSessionId: () => "adapter-test" },
    ui: {
      confirm: async () => options.confirm === true,
      notify: () => {},
    },
  };
}

const call = (root: string, command: string) =>
  handlers.get("tool_call")!(
    { type: "tool_call", toolCallId: "t1", toolName: "bash", input: { command } },
    context(root, { hasUI: false }),
  );

// A non-technical level: the guard returns a block, and the adapter must surface it as one.
const blockedRoot = project("non-technical");
const blocked = (await call(blockedRoot, "rm -rf /tmp/anything")) as { block?: boolean; reason?: string };
assert.equal(blocked?.block, true, "a danger deny must become an OMP block");
assert.match(String(blocked?.reason), /BLOCKED for a non-technical user/);

// A technical level: the same rule is an ask. No UI means no silent allow.
const technicalRoot = project("technical");
const headless = (await call(technicalRoot, "git reset --hard HEAD")) as { block?: boolean; reason?: string };
assert.equal(headless?.block, true, "an ask without UI must block, never silently allow");
assert.match(String(headless?.reason), /No interactive approval is available/);

// With UI, the native confirmation is the decision.
let asked = false;
const approvedCtx = context(technicalRoot, { hasUI: true, confirm: true });
approvedCtx.ui.confirm = async () => {
  asked = true;
  return true;
};
const approved = await handlers.get("tool_call")!(
  { type: "tool_call", toolCallId: "t2", toolName: "bash", input: { command: "git reset --hard HEAD" } },
  approvedCtx,
);
assert.equal(asked, true, "an ask must call OMP's confirmation UI");
assert.equal(approved, undefined, "an approved ask allows the call");

const declined = (await handlers.get("tool_call")!(
  { type: "tool_call", toolCallId: "t3", toolName: "bash", input: { command: "git reset --hard HEAD" } },
  context(technicalRoot, { hasUI: true, confirm: false }),
)) as { block?: boolean; reason?: string };
assert.equal(declined?.block, true, "a declined ask blocks the call");

// A harmless command still passes.
const harmless = await call(technicalRoot, "echo hello");
assert.equal(harmless, undefined, "a harmless command must not be blocked");

console.log("adapter: deny, ask-with-UI, ask-without-UI, decline and allow all pass");

// The project switches are user-invoked commands: they must write the same marker files the
// guards read, and nothing else.
const switchRoot = project("non-technical");
const unlock = commands.get("adaptive-main-unlock");
await unlock.handler("", context(switchRoot, { hasUI: false }));
assert.ok(existsSync(join(switchRoot, ".rsc", ".no-trunk-guard")), "unlock writes the project marker");
await commands.get("adaptive-main-lock").handler("", context(switchRoot, { hasUI: false }));
assert.ok(existsSync(join(switchRoot, ".rsc", ".no-trunk-open")), "lock writes its own marker");
assert.ok(!existsSync(join(switchRoot, ".rsc", ".no-trunk-guard")), "lock clears the unlock marker");

console.log("adapter: native project switches write the expected project-local state");

// Native tools are real registrations, not stubs: call two of them through the captured defs.
const toolRoot = project("technical");
mkdirSync(join(toolRoot, "src", "auth"), { recursive: true });
writeFileSync(join(toolRoot, "src", "auth", "login.js"), "export const login = true;\n");
const riskTool = tools.get("rsc_risk")!;
const riskResult = (await riskTool.execute(
  "risk",
  { paths: ["src/auth/login.js"], json: true },
  undefined,
  undefined,
  context(toolRoot, { hasUI: false }),
)) as { content: Array<{ text: string }> };
const riskJson = JSON.parse(riskResult.content[0].text);
assert.equal(riskJson.tier, 2, "the risk tool uses RSC's path table");
assert.equal(riskJson.classes.includes("auth"), true);

mkdirSync(join(toolRoot, "02-DOCS", "wiki", "sdd", "specs"), { recursive: true });
writeFileSync(
  join(toolRoot, "02-DOCS", "wiki", "sdd", "specs", "login.md"),
  `---
type: spec
timestamp: 2026-11-10
---
# Spec

## Problema & por qué
x
## Qué pasa si no lo construimos
x
## La alternativa más barata
x
## Objetivos
x
## Fuera de alcance
x
## Usuarios & contexto
x
## Comportamiento
x
## Criterios de aceptación
x
## Puntos a clarificar
- **suposición tomada** — x
## Qué podrá hacer el usuario
x
## Qué resultado obtiene
x
## Qué debe respetar
x
## Cómo lo demuestra
x
`,
);
const specTool = tools.get("rsc_spec_gate")!;
const specResult = (await specTool.execute(
  "spec",
  { paths: ["02-DOCS/wiki/sdd/specs/login.md"] },
  undefined,
  undefined,
  context(toolRoot, { hasUI: false }),
)) as { content: Array<{ text: string }> };
assert.match(specResult.content[0].text, /PASS  login\.md/);

console.log("adapter: rsc_risk and rsc_spec_gate registrations execute the upstream algorithms");

// The consolidation tool merges two lenses on the same place and keeps one unique finding.
const reportRoot = project("technical");
const finding = (lens: string) => `\`\`\`json findings
[{"lens":"${lens}","severity":"blocker","file":"src/a.js","line":10,"claim":"null user crashes the handler","failure_scenario":"request without session -> TypeError","evidence":"const id = user.id"}]
\`\`\``;
writeFileSync(join(reportRoot, "c.md"), finding("correctness"));
writeFileSync(join(reportRoot, "s.md"), finding("security"));
const consolidateTool = tools.get("rsc_review_consolidate")!;
const consolidateResult = (await consolidateTool.execute(
  "consolidate",
  { paths: ["c.md", "s.md"], json: true },
  undefined,
  undefined,
  context(reportRoot, { hasUI: false }),
)) as { content: Array<{ text: string }> };
const consolidated = JSON.parse(consolidateResult.content[0].text);
assert.equal(consolidated.reported, 2);
assert.equal(consolidated.unique, 1);
assert.equal(consolidated.findings[0].lenses.length, 2);

console.log("adapter: rsc_review_consolidate merges lens reports");
