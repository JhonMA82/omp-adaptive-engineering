/**
 * Adapter-boundary test: it does not mock RSC. It loads the real extension factory with a fake
 * ExtensionAPI, then drives its captured `tool_call` handler against the real guards. This is the
 * piece a Node-only guard test cannot cover: OMP's allow/ask/deny translation.
 *
 * Run with: bun tests/adapter.test.ts
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
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
  ui: { confirm(title: string, message: string): Promise<boolean>; notify(): void };
}

interface CapturedTool {
  name: string;
  execute(...args: unknown[]): Promise<unknown>;
}

interface CapturedCommand {
  handler(...args: unknown[]): unknown;
}

type Handler = (event: unknown, ctx: FakeContext) => Promise<unknown> | unknown;

const settingsRoot = mkdtempSync(join(tmpdir(), "rsc-adapter-settings-"));
mkdirSync(join(settingsRoot, ".git"), { recursive: true });
mkdirSync(join(settingsRoot, "plugins"), { recursive: true });
const settingsLock = join(settingsRoot, "plugins", "omp-plugins.lock.json");

const chain = new Proxy(function () {}, { get: () => chain, apply: () => chain }) as unknown as Chainable;
const z = new Proxy({}, { get: () => chain }) as unknown as Chainable;

const handlers = new Map<string, Handler>();
const tools = new Map<string, CapturedTool>();
const commands = new Map<string, CapturedCommand>();
const messages: unknown[] = [];

const pi = {
  zod: z,
  pi: { getAgentDir: () => settingsRoot },
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
const unlock = commands.get("adaptive-main-unlock")!;
await unlock.handler("", context(switchRoot, { hasUI: false }));
assert.ok(existsSync(join(switchRoot, ".rsc", ".no-trunk-guard")), "unlock writes the project marker");
await commands.get("adaptive-main-lock")!.handler("", context(switchRoot, { hasUI: false }));
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

// ---- plugin settings: snapshot at session start, gating, mode, notice --------
const settingsContext = (overrides: Partial<FakeContext> = {}): FakeContext => ({
  cwd: settingsRoot,
  hasUI: false,
  agent: { kind: "main", id: "s1", name: "s1", depth: 0 },
  sessionManager: { getSessionId: () => "settings-session" },
  ui: { confirm: async () => true, notify: () => {} },
  ...overrides,
});

const writeSettings = (values: Record<string, unknown>) =>
  writeFileSync(
    settingsLock,
    JSON.stringify({ plugins: {}, settings: { "omp-rsc-harness": values } }),
  );

const startSession = async () => {
  await handlers.get("session_start")!({ type: "session_start" }, settingsContext());
};

const runBash = (command: string, ctx: FakeContext = settingsContext()) =>
  handlers.get("tool_call")!(
    { type: "tool_call", toolCallId: "settings", toolName: "bash", input: { command } },
    ctx,
  ) as Promise<{ block?: boolean; reason?: string } | undefined>;

// An interactive session that approves: distinguishes "asked and allowed" from "denied outright".
const approving = settingsContext({ hasUI: true, ui: { confirm: async () => true, notify: () => {} } });

const notices = () =>
  messages.filter((message) => (message as { customType?: string })?.customType === "rsc-guards-off");

const noticesBefore = notices().length;
writeSettings({});
await startSession();
assert.equal(notices().length, noticesBefore, "no notice when every guard is on");

writeSettings({ "guards.gitmoji": false });
await startSession();
const notice = notices().at(-1) as { content?: string } | undefined;
assert.ok(notice && String(notice.content).includes("gitmoji"), "the notice names the disabled guard");

const commit = 'git commit -m "fix: no emoji"';
assert.equal(await runBash(commit), undefined, "gitmoji guard off lets the commit through");

writeSettings({});
await startSession();
const backOn = await runBash(commit);
assert.ok(backOn?.block === true, "turning the guard back on rejects it in the next session");

writeSettings({ "guards.gitmoji": false });
const frozen = await runBash(commit);
assert.ok(frozen?.block === true, "a change mid-session does not apply until the next session");

const profile = join(settingsRoot, "02-DOCS", "wiki", "harness", "user-profile.md");
mkdirSync(join(settingsRoot, "02-DOCS", "wiki", "harness"), { recursive: true });
const destructive = "git reset --hard HEAD";

writeFileSync(profile, "technical_level: non-technical\n");
writeSettings({ "danger.mode": "ask" });
await startSession();
const loosened = await runBash(destructive, approving);
assert.ok(loosened?.block === true, "ask mode never loosens a non-technical profile");

writeFileSync(profile, "technical_level: technical\n");
writeSettings({ "danger.mode": "auto" });
await startSession();
assert.equal(await runBash(destructive, approving), undefined, "auto asks a technical profile, and the approval allows it");

writeSettings({ "danger.mode": "deny" });
await startSession();
const denied = await runBash(destructive, approving);
assert.ok(denied?.block === true, "deny mode blocks what the profile would only ask about");

console.log("adapter: settings snapshot, guard switches, danger mode and notice");

// ---- reference battery: branch and ship switches on real repositories --------
const git = (cwd: string, ...args: string[]) =>
  spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });

const makeRepo = (name: string): string => {
  const created = join(settingsRoot, "repos", name);
  mkdirSync(created, { recursive: true });
  const dir = realpathSync(created);
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  writeFileSync(join(dir, ".gitignore"), ".rsc/\n.worktrees/\n");
  writeFileSync(join(dir, "a.txt"), "a");
  git(dir, "add", ".");
  git(dir, "commit", "-m", "📝 init");
  return dir;
};

const makeWorktree = (main: string, name: string, branch: string): string => {
  const path = join(main, ".worktrees", name);
  mkdirSync(join(main, ".worktrees"), { recursive: true });
  const added = git(main, "worktree", "add", "-q", "-b", branch, path);
  assert.equal(added.status, 0, `git worktree add failed: ${added.stderr}`);
  return realpathSync(path);
};

const branchRepo = makeRepo("branch");
mkdirSync(join(branchRepo, ".rsc"), { recursive: true });
writeFileSync(join(branchRepo, ".rsc", ".no-trunk-open"), "");
const branchCtx = settingsContext({ cwd: branchRepo });
const commitOnTrunk = 'git commit -m "📝 prueba"';

writeSettings({});
await startSession();
assert.ok((await runBash(commitOnTrunk, branchCtx))?.block === true, "branch guard blocks a commit on the closed trunk");

writeSettings({ "guards.branch": false });
await startSession();
assert.equal(await runBash(commitOnTrunk, branchCtx), undefined, "guards.branch off lets the same commit through");

const shipRepo = makeRepo("ship");
git(shipRepo, "switch", "-c", "feat/x");
writeFileSync(join(shipRepo, "b.txt"), "b");
const shipCtx = settingsContext({ cwd: shipRepo });
const leaveBranch = "git switch main";

writeSettings({});
await startSession();
assert.ok((await runBash(leaveBranch, shipCtx))?.block === true, "ship guard blocks leaving a dirty feature branch");

writeSettings({ "guards.ship": false });
await startSession();
assert.equal(await runBash(leaveBranch, shipCtx), undefined, "guards.ship off lets the branch be left");

// session_switch opens a new session too: the snapshot refreshes and the notice must follow it.
writeSettings({ "guards.ship": false });
const beforeSwitch = notices().length;
await handlers.get("session_switch")!({ type: "session_switch", reason: "new" }, settingsContext());
assert.equal(notices().length, beforeSwitch + 1, "session_switch announces the disabled guards");

// A verdict rewritten by danger.mode must not show the reason written for the opposite decision.
writeFileSync(profile, "technical_level: technical\n");
writeSettings({ "danger.mode": "deny" });
await startSession();
const denyReason = (await runBash(destructive, approving))?.reason ?? "";
assert.match(denyReason, /danger\.mode = deny/);
assert.doesNotMatch(denyReason, /confirms it/);

const noProfileRepo = makeRepo("noprofile");
let confirmReason = "";
const capturing = settingsContext({
  cwd: noProfileRepo,
  hasUI: true,
  ui: {
    confirm: async (_title: string, reason: string) => {
      confirmReason = reason;
      return true;
    },
    notify: () => {},
  },
});
writeSettings({ "danger.mode": "ask" });
await startSession();
assert.equal(await runBash(destructive, capturing), undefined, "ask mode lets an approved command run when there is no profile");
assert.match(confirmReason, /danger\.mode = ask/);
assert.doesNotMatch(confirmReason, /BLOCKED/, "the confirmation must not carry the denial text");

// Remaining acceptance paths: the danger switch, a project opt-out with the guard on, and auto
// following a non-technical profile.
writeSettings({ "guards.danger": false });
await startSession();
assert.equal(await runBash(destructive, approving), undefined, "guards.danger off lets the destructive command through");

const optoutRepo = makeRepo("optout");
mkdirSync(join(optoutRepo, ".rsc"), { recursive: true });
writeFileSync(join(optoutRepo, ".rsc", ".no-gitmoji"), "");
writeSettings({});
await startSession();
assert.equal(
  await runBash('git commit -m "no emoji"', settingsContext({ cwd: optoutRepo })),
  undefined,
  "a project opt-out wins over the global switch being on",
);

writeFileSync(profile, "technical_level: non-technical\n");
writeSettings({ "danger.mode": "auto" });
await startSession();
assert.ok((await runBash(destructive, approving))?.block === true, "auto denies for a non-technical profile");

console.log("adapter: reference battery — branch and ship switches");

// ---- closing pass: status, switch injection, error paths --------------------
// F-01: the handler used to shadow the imported `trunk` with itself (`const trunk = trunk`).
await commands.get("adaptive-status")!.handler("", settingsContext({ cwd: branchRepo }));
const statusMessage = messages.at(-1) as { content?: string } | undefined;
const status = JSON.parse(String(statusMessage?.content));
assert.equal(status.trunkPolicy.closed, true, "adaptive-status reports the closed trunk from the repo");
assert.equal(status.worktreeIsolation, "on");
assert.equal(typeof status.defaultBranch, "string");

// F-02: /new, resume and fork arrive as session_switch; the always-on body must be re-injected.
const suggestCount = () => messages.filter((message) => (message as { customType?: string })?.customType === "rsc-suggest").length;
const suggestsBefore = suggestCount();
await handlers.get("session_switch")!({ type: "session_switch", reason: "new" }, settingsContext());
assert.equal(suggestCount(), suggestsBefore + 1, "session_switch injects the suggest body");

// F-08: a failed write is not a code change, so it must not nudge.
const nudgeRoot = project("technical");
const failedWrite = await handlers.get("tool_result")!(
  { type: "tool_result", toolName: "write", isError: true, input: { path: "src/a.ts" } },
  settingsContext({ cwd: nudgeRoot }),
);
assert.equal(failedWrite, undefined, "a failed write must not trigger the FTD nudge");

// F-09: the upstream CLI rejected a non-integer window; the tool must reject it too.
await assert.rejects(
  consolidateTool.execute("w1", { paths: ["c.md", "s.md"], window: -1 }, undefined, undefined, context(reportRoot, { hasUI: false })),
  /non-negative integer/,
);
await assert.rejects(
  consolidateTool.execute("w2", { paths: ["c.md", "s.md"], window: 1.5 }, undefined, undefined, context(reportRoot, { hasUI: false })),
  /non-negative integer/,
);

// F-10: a risk error names a tool that exists here, never the upstream CLI.
const bareRoot = mkdtempSync(join(tmpdir(), "rsc-no-repo-"));
await assert.rejects(
  riskTool.execute("r2", {}, undefined, undefined, context(bareRoot, { hasUI: false })),
  /the `rsc_risk` tool/,
);
await assert.rejects(
  riskTool.execute("r3", {}, undefined, undefined, context(bareRoot, { hasUI: false })),
  /Pass the `base` parameter or the paths themselves/,
);

console.log("adapter: status, session_switch injection and error paths pass");

// The rule-B seam itself: a live peer means the branch switch is blocked through the real adapter.
const peersRepo = makeRepo("peers");
// The fake SDK namespace gains the session APIs the peers provider calls.
const sdkFake = pi.pi as unknown as Record<string, unknown>;
Object.assign(sdkFake, {
  FileSessionStorage: class {},
  SessionManager: { getDefaultSessionDir: () => "/fake-sessions" },
  listSessions: async () => [
    { id: "peer", cwd: peersRepo, path: "/fake-sessions/peer.jsonl", modified: new Date() },
  ],
  listRecentSessions: async () => [],
  probeSessionLeases: () => ({ held: ["peer"], unknown: [] }),
});
const peerBlocked = (await runBash("git switch -c feat/peer", settingsContext({ cwd: peersRepo }))) as
  | { block?: boolean; reason?: string }
  | undefined;
assert.equal(peerBlocked?.block, true, "the adapter must pass its peers provider to the branch guard");
assert.match(String(peerBlocked?.reason), /Another session is working in this same folder/);

// F-02 second half: resume/fork already carry the entry, so the switch must not duplicate it.
const resumed = settingsContext();
(resumed.sessionManager as unknown as { getEntries: () => unknown[] }).getEntries = () => [
  { type: "custom", customType: "rsc-suggest" },
];
const beforeResume = suggestCount();
await handlers.get("session_switch")!({ type: "session_switch", reason: "resume" }, resumed);
assert.equal(suggestCount(), beforeResume, "a resumed session that already holds the body gets no duplicate");

// `fork` is the third switch reason: an empty fork gets the body, a fork carrying it does not.
const forkedEmpty = settingsContext();
(forkedEmpty.sessionManager as unknown as { getEntries: () => unknown[] }).getEntries = () => [];
const beforeFork = suggestCount();
await handlers.get("session_switch")!({ type: "session_switch", reason: "fork" }, forkedEmpty);
assert.equal(suggestCount(), beforeFork + 1, "a fork without the body gets it once");

const forkedWithBody = settingsContext();
(forkedWithBody.sessionManager as unknown as { getEntries: () => unknown[] }).getEntries = () => [
  { type: "custom_message", customType: "rsc-suggest" },
];
const beforeForkDuplicate = suggestCount();
await handlers.get("session_switch")!({ type: "session_switch", reason: "fork" }, forkedWithBody);
assert.equal(suggestCount(), beforeForkDuplicate, "a fork that already carries the body gets no duplicate");

// A successful write in a project with no feature document does nudge; the failed one above did not.
const nudgeProject = project("technical");
const nudged = (await handlers.get("tool_result")!(
  { type: "tool_result", toolName: "write", isError: false, input: { path: "src/a.ts" } },
  settingsContext({ cwd: nudgeProject }),
)) as { additionalContext?: string } | undefined;
assert.ok(nudged?.additionalContext, "a successful first code write must nudge when no feature document exists");

// `window: 0` is legal: it must consolidate, not be rejected as if it were negative.
const zeroWindow = (await consolidateTool.execute(
  "w3",
  { paths: ["c.md", "s.md"], window: 0, json: true },
  undefined,
  undefined,
  context(reportRoot, { hasUI: false }),
)) as { content: Array<{ text: string }> };
assert.equal(JSON.parse(zeroWindow.content[0].text).unique, 1, "window 0 is a valid grouping window");

console.log("adapter: rule-B peers wiring and suggest dedupe pass");

// ---- F-03: the `.rsc` contract across a real linked worktree ----------------
// A worktree starts without `.rsc/` because it is ignored. The session boundary hydrates the main
// checkout's project decisions once; ledger, sello and the rest stay with the checkout that wrote
// them, and every git judgement keeps using the worktree's own branch.
const stateRepo = makeRepo("state");
mkdirSync(join(stateRepo, ".rsc"), { recursive: true });
writeFileSync(join(stateRepo, ".rsc", ".no-danger-guard"), "");
writeFileSync(join(stateRepo, ".rsc", ".no-trunk-open"), "");
const stateWt = makeWorktree(stateRepo, "wt", "feat/wt");

writeSettings({});
await handlers.get("session_start")!({ type: "session_start" }, settingsContext({ cwd: stateWt }));
assert.ok(existsSync(join(stateWt, ".rsc", ".no-danger-guard")), "a fresh worktree inherits the danger opt-out");
assert.ok(existsSync(join(stateWt, ".rsc", ".no-trunk-open")), "a fresh worktree inherits the trunk switch");
assert.equal(existsSync(join(stateWt, ".rsc", "review-ledger.jsonl")), false, "the ledger is not copied");
assert.equal(
  await runBash("git reset --hard HEAD", settingsContext({ cwd: stateWt })),
  undefined,
  "the main checkout's danger opt-out applies in the worktree",
);

// The review ledger is per checkout: a round in the worktree must not append to main's file.
const ledgerTool = tools.get("rsc_review_ledger")!;
const ledgerRound = (root: string) =>
  ledgerTool.execute("round", { action: "round", task: "spec/t1" }, undefined, undefined, context(root, { hasUI: false }));
const ledgerLines = (root: string) =>
  readFileSync(join(root, ".rsc", "review-ledger.jsonl"), "utf8").split("\n").filter(Boolean).length;
await ledgerRound(stateRepo);
await ledgerRound(stateWt);
const mainLedgerBefore = ledgerLines(stateRepo);
await ledgerRound(stateWt);
assert.equal(ledgerLines(stateRepo), mainLedgerBefore, "a worktree round does not write the main ledger");
assert.equal(ledgerLines(stateWt), 2, "the worktree keeps its own ledger");

// The sello's project switch is read from the checkout that asks, never from the main one.
const selloTool = tools.get("rsc_sello")!;
const selloStatus = async (root: string) => {
  const out = (await selloTool.execute(
    "sello",
    { action: "status" },
    undefined,
    undefined,
    context(root, { hasUI: false }),
  )) as { content: Array<{ text: string }> };
  return JSON.parse(out.content[0].text);
};
const previousSelloHome = process.env.RSC_SELLO_HOME;
process.env.RSC_SELLO_HOME = mkdtempSync(join(tmpdir(), "rsc-sello-home-"));
try {
  assert.equal((await selloStatus(stateRepo)).enabled, false);
  writeFileSync(join(stateWt, ".rsc", "sello-config.json"), JSON.stringify({ enabled: true }));
  assert.equal((await selloStatus(stateWt)).enabled, true, "the worktree sees its own sello switch");
  assert.equal((await selloStatus(stateRepo)).enabled, false, "the worktree sello does not affect main");
} finally {
  if (previousSelloHome === undefined) delete process.env.RSC_SELLO_HOME;
  else process.env.RSC_SELLO_HOME = previousSelloHome;
}

// A worktree's own opt-out is local, and a git command is judged on the worktree's branch.
writeFileSync(join(stateWt, ".rsc", ".no-gitmoji"), "");
assert.ok(!existsSync(join(stateRepo, ".rsc", ".no-gitmoji")), "a worktree marker never writes back to main");
assert.ok(
  (await runBash('git commit -m "no emoji"', settingsContext({ cwd: stateRepo })))?.block === true,
  "the main checkout still enforces gitmoji",
);
assert.equal(
  await runBash('git commit -m "no emoji"', settingsContext({ cwd: stateWt })),
  undefined,
  "the worktree can opt out without changing main",
);

const trunkRepo = makeRepo("trunk-wt");
mkdirSync(join(trunkRepo, ".rsc"), { recursive: true });
writeFileSync(join(trunkRepo, ".rsc", ".no-trunk-open"), "");
const trunkWt = makeWorktree(trunkRepo, "wt", "feat/wt");
await handlers.get("session_start")!({ type: "session_start" }, settingsContext({ cwd: trunkWt }));
assert.ok(existsSync(join(trunkWt, ".rsc", ".no-trunk-open")), "the closed trunk travels to the worktree");
assert.equal(
  await runBash('git commit -m "📝 prueba"', settingsContext({ cwd: trunkWt })),
  undefined,
  "a commit is judged on the worktree's branch, not the main checkout's",
);
assert.ok(
  (await runBash('git commit -m "📝 prueba"', settingsContext({ cwd: trunkRepo })))?.block === true,
  "the main checkout is still on the closed trunk",
);

// /adaptive-status names both roots so the contract is inspectable from the session.
await commands.get("adaptive-status")!.handler("", settingsContext({ cwd: stateWt }));
const stateStatus = JSON.parse(String((messages.at(-1) as { content?: string })?.content));
assert.equal(stateStatus.project, stateWt);
assert.equal(stateStatus.state.mainCheckout, stateRepo);
assert.equal(stateStatus.state.linkedWorktree, true);
assert.deepEqual(stateStatus.state.projectOptOuts, ["danger-guard", "gitmoji", "trunk-open"]);

// R-01: a project nested inside the checkout keeps its own marker instead of being flattened to
// the git toplevel. The nested opt-out is the only reason the technical command is allowed.
const nestedRepo = makeRepo("nested-project");
const nestedProject = join(nestedRepo, "03-PROJECTS", "a");
mkdirSync(join(nestedProject, ".rsc"), { recursive: true });
writeFileSync(join(nestedProject, ".rsc", ".no-danger-guard"), "");
mkdirSync(join(nestedProject, "02-DOCS", "wiki", "harness"), { recursive: true });
writeFileSync(join(nestedProject, "02-DOCS", "wiki", "harness", "user-profile.md"), "technical_level: technical\n");
assert.equal(
  await runBash("git reset --hard HEAD", settingsContext({ cwd: nestedProject })),
  undefined,
  "a nested project's opt-out is read instead of the git toplevel's absent state",
);

console.log("adapter: worktree state contract, per-checkout ledger/sello and git context pass");
