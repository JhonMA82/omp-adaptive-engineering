/**
 * The one place where the untyped `.mjs` boundaries are turned into typed handles. Every cast here
 * is a named module contract with the exports this adapter calls; the algorithms stay upstream.
 */
export interface DangerVerdict {
  decision: "allow" | "deny" | "ask";
  why?: string;
  reason?: string;
  /** Set when `danger.mode` changed the decision and the original reason no longer describes it. */
  rewritten?: boolean;
}

export interface DangerModule {
  evaluateDanger(root: string, command: string): DangerVerdict;
  technicalLevel(root: string): string | null;
}

export interface BranchModule {
  evaluate(options: { root: string; command: string; cwd: string; sessionId: string }): Promise<string | null>;
}

export interface ShipModule {
  shipGuardDecision(root: string, command: string): Promise<{ decision: "allow" | "deny"; reason?: string }>;
}

export interface GitmojiModule {
  evaluateGitmoji(root: string, command: string): { reason: string } | null;
}

export interface NudgeModule {
  decide(root: string, input: { session_id: string; tool_input: { file_path: string } }): string;
}

export interface PromptGateModule {
  gateText(root: string): Promise<string>;
}

export interface SelloModule {
  resolveRoot(root: string): string;
  changeText(root: string, base: string | null, paths: string[]): Record<string, string>;
  readEffectiveConfig(root: string): Record<string, unknown> | null;
  checkSello(root: string): { ok: boolean; code: string; warning?: string; message?: string };
}

export interface RiskAssessment {
  tier: number;
  classes: string[];
  reviewers: number;
  humanApproval: boolean;
  escalate: string | null;
  paths: Record<string, string>;
  content?: Array<{ path: string; class: string; match: string }>;
  base?: string;
  configError?: string;
}

export interface RiskModule {
  changedPaths(root: string, base?: string | null): {
    ok: boolean;
    paths?: string[];
    base?: string;
    from?: string;
    message?: string;
  };
  assess(paths: string[], cfg: Record<string, unknown> | null, texts: Record<string, string>): RiskAssessment;
  render(assessment: RiskAssessment): string;
}

export interface SpecCompleteness {
  ok: boolean;
  missing: string[];
  empty: string[];
  openPoints: Array<{ type: string; typed: boolean; text: string }>;
  untyped: string[];
  unchecked: string[];
}

export interface SpecGateModule {
  specCompleteness(markdown: string): SpecCompleteness;
  statusClaims(status: string): Array<{ kind: string; value: string; raw: string }>;
  checkClaims(
    claims: Array<{ kind: string; value: string; raw: string }>,
    probe: {
      hasCommit(sha: string): boolean;
      isAncestor(sha: string): boolean;
      hasPr(pr: string): boolean;
      hasTag(version: string): boolean;
    } | null,
  ): Array<{ kind: string; value: string; verdict: string; raw: string; reason: string }>;
}

export interface LedgerFinding {
  id: string;
  status?: "new" | "repeat";
  repeatOf?: string;
  file?: string;
  claim?: string;
}

export interface ReviewLedgerModule {
  round(root: string, task: string): { ok: boolean; round: number; message: string };
  panel(root: string, task: string, lenses: string | undefined): { ok: boolean; message: string };
  record(root: string, findings: unknown[], options: { task: string }): LedgerFinding[];
  outcome(root: string, id: string, value: string): { ok: boolean; message: string };
  stats(root: string): unknown;
  renderStats(stats: unknown): string;
  escapes(root: string, options: { since: string }): { ok: boolean; message?: string };
  renderEscapes(result: unknown): string;
}

export interface ReviewFindingsModule {
  parseFindings(raw: string, source: string): { findings: Array<Record<string, unknown>>; errors: string[] };
  consolidate(findings: Array<Record<string, unknown>>, options: { window: number }): Record<string, unknown>;
  renderConsolidation(result: Record<string, unknown>, errors: string[]): string;
  DEFAULT_WINDOW: number;
}

export interface SelloToolModule {
  runSello(
    root: string,
    action: string,
    options: Record<string, unknown>,
  ): { ok: boolean; message: string; data?: unknown };
}

export interface TrunkModule {
  trunkPolicy(root: string): { closed: boolean; reason: string; signals: string[] };
  defaultBranchName(root: string): string | null;
}

export type GuardName = "danger" | "branch" | "ship" | "gitmoji";
export type DangerMode = "auto" | "ask" | "deny";
export type DangerProfile = "technical" | "non-technical" | null;

export interface PluginSettings {
  guards: Record<GuardName, boolean>;
  dangerMode: DangerMode;
}

export interface SettingsModule {
  DEFAULTS: PluginSettings;
  GUARD_NAMES: GuardName[];
  DANGER_MODES: DangerMode[];
  resolveLockPath(input: { agentDir?: string | null }): string | null;
  readSettings(input: { lockPath?: string | null; projectPaths?: string[] }): PluginSettings;
  guardEnabled(settings: PluginSettings, name: GuardName): boolean;
  profileFrom(raw: unknown): DangerProfile;
  applyDangerMode(mode: DangerMode, verdict: DangerVerdict, profile: DangerProfile): DangerVerdict;
  startupNotice(settings: PluginSettings): string | null;
}

export interface RscModules {
  danger: DangerModule;
  branch: BranchModule;
  ship: ShipModule;
  gitmoji: GitmojiModule;
  nudge: NudgeModule;
  promptGate: PromptGateModule;
  sello: SelloModule;
  risk: RiskModule;
  spec: SpecGateModule;
  ledger: ReviewLedgerModule;
  findings: ReviewFindingsModule;
  selloTool: SelloToolModule;
  trunk: TrunkModule;
  settings: SettingsModule;
}

const load = (rel: string) => import(new URL(rel, import.meta.url).href) as Promise<unknown>;

// The dynamic imports are the untyped boundary; each cast names the contract above and is checked
// by the ported upstream tests plus tests/adapter.test.ts.
export async function loadRsc(): Promise<RscModules> {
  const [danger, branch, ship, gitmoji, nudge, promptGate, sello, risk, spec, ledger, findings, selloTool, trunk, settings] =
    await Promise.all([
      load("../targets/danger-guard.mjs"),
      load("../targets/branch-guard.mjs"),
      load("../targets/ship-guard.mjs"),
      load("../targets/gitmoji-guard.mjs"),
      load("../targets/ftd-nudge.mjs"),
      load("../targets/userprompt-gate.mjs"),
      load("../targets/sello.mjs"),
      load("../scripts/lib/risk.js"),
      load("../scripts/lib/spec-gate.js"),
      load("../scripts/lib/review-ledger.js"),
      load("../scripts/lib/review-findings.js"),
      load("./sello-tool.mjs"),
      load("../targets/trunk-policy.mjs"),
      load("../targets/plugin-settings.mjs"),
    ]);
  return {
    danger: danger as DangerModule,
    branch: branch as BranchModule,
    ship: ship as ShipModule,
    gitmoji: gitmoji as GitmojiModule,
    nudge: nudge as NudgeModule,
    promptGate: promptGate as PromptGateModule,
    sello: sello as SelloModule,
    risk: risk as RiskModule,
    spec: spec as SpecGateModule,
    ledger: ledger as ReviewLedgerModule,
    findings: findings as ReviewFindingsModule,
    selloTool: selloTool as SelloToolModule,
    trunk: trunk as TrunkModule,
    settings: settings as SettingsModule,
  };
}
