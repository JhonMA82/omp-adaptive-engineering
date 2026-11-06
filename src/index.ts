/**
 * Adaptive Engineering for OMP — a thin ExtensionAPI adapter over the reused RSC Harness
 * deterministic modules under `targets/` and `scripts/lib/`.
 *
 * RSC provides the guards, risk table, spec gate and review ledger. This file only translates
 * OMP's tool_call / tool_result / prompt lifecycle into those functions and back. It does not
 * reimplement any RSC rule.
 *
 * Upstream: https://github.com/ericrisco/rsc-harness @ 726aaf3 (v4.0.5), MIT.
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadRsc } from "./rsc-boundary.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(HERE, "..");
interface SuggestContext {
  sessionManager: { getEntries(): unknown[] };
  agent?: { kind?: string };
}

const result = (value: string, details: Record<string, unknown> = {}) => ({
  content: [{ type: "text" as const, text: value }],
  details,
});

/** Nearest ancestor that owns RSC state, a git checkout or the 02-DOCS workspace. */
function projectRoot(cwd: string): string {
  let dir = resolve(cwd);
  for (;;) {
    if (
      existsSync(join(dir, ".rsc")) ||
      existsSync(join(dir, ".rsc.json")) ||
      existsSync(join(dir, "02-DOCS")) ||
      existsSync(join(dir, ".git"))
    ) return dir;
    const up = dirname(dir);
    if (up === dir) return resolve(cwd);
    dir = up;
  }
}

function stripFrontmatter(markdown: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(markdown);
  return match ? markdown.slice(match[0].length) : markdown;
}

/**
 * RSC's messages name the upstream CLI. The OMP port exposes the same operations as native
 * tools/commands, so the refusal must name the way out that actually exists here.
 */
function translate(message: string): string {
  return String(message)
    .replace(/`?npx @ericrisco\/rsc sello ([^`\n]+)`?/g, (_m, rest) => `the \`rsc_sello\` tool (action: ${rest.trim().split(/\s+/)[0]})`)
    .replace(/`?npx @ericrisco\/rsc review consolidate`?/g, "the `rsc_review_consolidate` tool")
    .replace(/`?npx @ericrisco\/rsc review ledger panel ([^`\n]+)`?/g, (_m, rest) => `the \`rsc_review_ledger\` tool (action: panel, ${rest.trim()})`)
    .replace(/`?npx @ericrisco\/rsc review ledger`?/g, "the `rsc_review_ledger` tool")
    .replace(/`?npx @ericrisco\/rsc review escapes`?/g, "the `rsc_review_ledger` tool (action: escapes)")
    .replace(/`?npx @ericrisco\/rsc spec gate(?: <spec>)?`?/g, "the `rsc_spec_gate` tool")
    .replace(/`?npx @ericrisco\/rsc risk`?/g, "the `rsc_risk` tool")
    .replace(/`?npx @ericrisco\/rsc main unlock`?/g, "`/adaptive-main-unlock`")
    .replace(/`?npx @ericrisco\/rsc main lock`?/g, "`/adaptive-main-lock`")
    .replace(/`?npx @ericrisco\/rsc main status`?/g, "`/adaptive-status`")
    .replace(/`?npx @ericrisco\/rsc isolation off`?/g, "`/adaptive-isolation-off`")
    .replace(/`?npx @ericrisco\/rsc isolation on`?/g, "`/adaptive-isolation-on`");
}

function gitOut(root: string, args: string[], maxBuffer = 16 * 1024 * 1024): string | null {
  const run = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true, maxBuffer });
  return run.status === 0 ? (run.stdout || "") : null;
}

/** The repository probe `spec gate` uses for status claims; the split-repo subject resolution stays in the RSC CLI. */
function gitProbe(root: string) {
  const top = (gitOut(root, ["rev-parse", "--show-toplevel"]) || "").trim();
  if (!top) return null;
  const main = ["origin/main", "main", "HEAD"].find((ref) => gitOut(top, ["rev-parse", "--verify", ref]) !== null);
  if (!main) return null;
  return {
    root: top,
    hasCommit: (sha: string) => gitOut(top, ["cat-file", "-e", `${sha}^{commit}`]) !== null,
    isAncestor: (sha: string) => gitOut(top, ["merge-base", "--is-ancestor", sha, main]) !== null,
    hasPr: (n: string) => {
      for (const needle of [`(#${n})`, `Merge pull request #${n} `]) {
        const out = gitOut(top, ["log", main, "--grep", needle, "--fixed-strings", "-1", "--format=%H"]);
        if (out !== null && out.trim() !== "") return true;
      }
      return false;
    },
    hasTag: (version: string) => {
      const out = gitOut(top, ["tag", "-l", `v${version}`]);
      return out !== null && out.trim() !== "";
    },
  };
}

export default async function adaptiveEngineering(pi: ExtensionAPI) {
  const z = pi.zod;
  const {
    danger,
    branch,
    ship,
    gitmoji,
    nudge,
    promptGate,
    sello,
    risk: riskLib,
    spec: specLib,
    ledger,
    findings: findingsLib,
    selloTool,
    trunk,
    settings,
  } = await loadRsc();

  // ---- plugin settings: one snapshot per session --------------------------------
  // Read once at session start and frozen for the session's lifetime: a change made in Settings →
  // Plugins applies to the next session, never to the one in flight. No disk I/O on tool_call.
  const agentDir = (() => {
    try {
      const fn = (pi as unknown as { pi?: { getAgentDir?: () => string } })?.pi?.getAgentDir;
      return typeof fn === "function" ? fn() : null;
    } catch {
      return null;
    }
  })();

  let settingsSnapshot = settings.DEFAULTS;

  const refreshSettings = (cwd: string): void => {
    try {
      const root = projectRoot(cwd);
      settingsSnapshot = settings.readSettings({
        lockPath: settings.resolveLockPath({ agentDir }),
        projectPaths: [join(root, ".omp", "plugin-overrides.json"), join(root, ".pi", "plugin-overrides.json")],
      });
    } catch {
      settingsSnapshot = settings.DEFAULTS;
    }
  };

  const suggestBody = stripFrontmatter(readFileSync(join(PLUGIN_ROOT, "skills", "suggest", "SKILL.md"), "utf8"));

  const alreadyHasSuggest = (ctx: SuggestContext): boolean => {
    try {
      return ctx.sessionManager.getEntries().some((entry) => {
        if (!entry || typeof entry !== "object") return false;
        if (!("type" in entry) || (entry.type !== "custom" && entry.type !== "custom_message")) return false;
        return "customType" in entry && entry.customType === "rsc-suggest";
      });
    } catch {
      return false;
    }
  };

  const injectSuggest = (ctx: SuggestContext, force = false) => {
    if (ctx.agent?.kind !== "main") return;
    if (!force && alreadyHasSuggest(ctx)) return;
    pi.sendMessage(
      { customType: "rsc-suggest", content: suggestBody, display: false, attribution: "agent" },
      { deliverAs: "nextTurn", triggerTurn: false },
    );
  };

  // ---- lifecycle: the always-on body and the per-turn lane gate -----------------
  pi.on("session_start", async (_event, ctx) => {
    refreshSettings(ctx.cwd);
    injectSuggest(ctx);
    const notice = settings.startupNotice(settingsSnapshot);
    if (notice) {
      pi.sendMessage(
        { customType: "rsc-guards-off", content: notice, display: true, attribution: "agent" },
        { deliverAs: "nextTurn", triggerTurn: false },
      );
    }
  });
  pi.on("session_switch", async (_event, ctx) => refreshSettings(ctx.cwd));
  pi.on("session_compact", async (_event, ctx) => injectSuggest(ctx, true));

  pi.on("before_agent_start", async (event, ctx) => {
    if (ctx.agent?.kind !== "main" || event.reason !== "prompt") return;
    const gate = await promptGate.gateText(projectRoot(ctx.cwd));
    if (!gate) return;
    return { systemPrompt: [...event.systemPrompt, gate] };
  });

  // ---- guards: RSC's PreToolUse(Bash) hooks, in their original order ------------
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return;
    const command = event.input.command;
    if (!command) return;
    const root = projectRoot(ctx.cwd);
    const cwd = typeof event.input.cwd === "string" ? resolve(ctx.cwd, event.input.cwd) : ctx.cwd;

    // 1. ship-guard: sello gate, ASDD escalation gate, then leaving a feature branch behind.
    if (settings.guardEnabled(settingsSnapshot, "ship")) {
      const shipped = await ship.shipGuardDecision(root, command);
      if (shipped.decision === "deny") return { block: true, reason: translate(shipped.reason) };
    }

    // 2. branch-guard: closed trunk, shared checkout, worktree placement.
    const branchReason = !settings.guardEnabled(settingsSnapshot, "branch") ? null : await branch.evaluate({
      root,
      command,
      cwd,
      sessionId: ctx.sessionManager.getSessionId(),
    });
    if (branchReason) return { block: true, reason: translate(branchReason) };

    // 3. gitmoji guard: an inline commit message without a gitmoji.
    const gitmojiVerdict = settings.guardEnabled(settingsSnapshot, "gitmoji")
      ? gitmoji.evaluateGitmoji(root, command)
      : null;
    if (gitmojiVerdict) return { block: true, reason: translate(gitmojiVerdict.reason) };

    // 4. danger guard: deny for a non-technical level, ask for a technical one.
    if (settings.guardEnabled(settingsSnapshot, "danger")) {
      const dangerVerdict = settings.applyDangerMode(
        settingsSnapshot.dangerMode,
        danger.evaluateDanger(root, command),
        settings.profileFrom(danger.technicalLevel(root)),
      );
      if (dangerVerdict.decision === "deny") return { block: true, reason: translate(dangerVerdict.reason) };
      if (dangerVerdict.decision === "ask") {
        const reason = translate(dangerVerdict.reason);
        if (!ctx.hasUI) {
          return {
            block: true,
            reason: `${reason}\n\nNo interactive approval is available in this session, so the command was blocked instead of silently allowed.`,
          };
        }
        const approved = await ctx.ui.confirm("rsc danger guard", reason);
        if (!approved) return { block: true, reason: "The person declined this command at the rsc danger guard prompt." };
      }
    }
  });

  // ---- FTD nudge: once per session after the first code edit with no feature doc ----
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "write" && event.toolName !== "edit") return;
    // Both edit/write inputs carry one of these optional path fields; the event union has no single view.
    const input = event.input as Record<string, unknown>;
    const raw = String(input?.path ?? input?.file_path ?? input?.notebook_path ?? "");
    if (!raw) return;
    const file = raw.includes("://") ? raw : resolve(ctx.cwd, raw);
    const text = nudge.decide(projectRoot(ctx.cwd), {
      session_id: ctx.sessionManager.getSessionId(),
      tool_input: { file_path: file },
    });
    if (text) return { additionalContext: translate(text) };
  });

  // ---- native tools: the RSC CLI operations that skills still call ---------------
  pi.registerTool({
    name: "rsc_risk",
    label: "RSC Risk",
    description:
      "Classify a change with RSC's deterministic risk table: tier 0 docs/copy, tier 1 ordinary code, tier 2 auth/billing/CI/migrations/secrets/harness. Pass paths to classify a forecast, or omit them to classify the diff against the trunk.",
    parameters: z.object({
      base: z.string().optional().describe("Git ref to diff against; defaults to the trunk (origin/main, main, master)."),
      paths: z.array(z.string()).optional().describe("Paths to classify directly. Omit to classify the working-tree diff."),
      json: z.boolean().optional().describe("Return the structured assessment as JSON."),
    }),
    approval: "read",
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const root = sello.resolveRoot(projectRoot(ctx.cwd));
      const given = (params.paths ?? []).map((p: string) => relative(root, resolve(ctx.cwd, p)).split("\\").join("/"));
      let paths = given;
      let against: string | null = null;
      let from: string | null = null;
      if (!given.length) {
        const changed = riskLib.changedPaths(root, params.base ?? null);
        if (!changed.ok) throw new Error(changed.message);
        paths = changed.paths;
        against = changed.base;
        from = changed.from;
      }
      const texts = sello.changeText(root, from, paths);
      const assessment = {
        ...riskLib.assess(paths, sello.readEffectiveConfig(root), texts),
        ...(against ? { base: against } : {}),
      };
      return result(params.json ? JSON.stringify(assessment, null, 2) : translate(riskLib.render(assessment)), assessment);
    },
  });

  pi.registerTool({
    name: "rsc_spec_gate",
    label: "RSC Spec Gate",
    description:
      "Run RSC's spec exit gate over written specs: required sections, explicit open points, and status claims checked against the repository. No path checks every spec in 02-DOCS/wiki/sdd/specs.",
    parameters: z.object({
      paths: z.array(z.string()).optional().describe("Spec files to check. Omit to check the whole specs directory."),
    }),
    approval: "read",
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const root = projectRoot(ctx.cwd);
      const dir = join(root, "02-DOCS", "wiki", "sdd", "specs");
      const targets: string[] = params.paths?.length
        ? params.paths.map((p: string) => resolve(ctx.cwd, p))
        : (() => {
            try {
              return readdirSync(dir)
                .filter((f) => f.endsWith(".md") && !f.endsWith(".plan.md"))
                .map((f) => join(dir, f));
            } catch {
              return [];
            }
          })();
      if (!targets.length) {
        return result("no specs found — pass a path, or write one to 02-DOCS/wiki/sdd/specs/");
      }
      const probe = gitProbe(root);
      const lines: string[] = [];
      let failed = 0;
      let drifted = 0;
      for (const path of targets) {
        const markdown = readFileSync(path, "utf8");
        const checked = specLib.specCompleteness(markdown);
        const name = path.split(/[\\/]/).pop();
        if (checked.ok) {
          const typed = checked.openPoints.length - checked.untyped.length;
          lines.push(`PASS  ${name} — ${checked.openPoints.length} open point(s), ${typed} typed`);
        } else {
          failed += 1;
          lines.push(`FAIL  ${name}`);
          if (checked.missing.length) lines.push(`      missing section(s): ${checked.missing.join(", ")}`);
          if (checked.empty.length) lines.push(`      section(s) with no content: ${checked.empty.join(", ")}`);
        }
        const status = (/^status:[ \t]*(.*)$/m.exec(markdown) || [, ""])[1];
        const claims = specLib.statusClaims(status);
        for (const verdict of specLib.checkClaims(claims, probe)) {
          if (verdict.verdict === "holds") continue;
          if (verdict.verdict === "stale") drifted += 1;
          lines.push(`      status ${verdict.verdict.toUpperCase()}: ${verdict.raw} — ${verdict.reason}`);
        }
      }
      lines.push(
        "",
        `${targets.length - failed}/${targets.length} pass, ${drifted} status claim(s) contradicted by the repo${probe ? "" : " (no repository to ask)"}. Not checked by this gate:`,
        ...specLib.specCompleteness("").unchecked.map((u: string) => `  - ${u}`),
      );
      return result(lines.join("\n"), { failed, drifted, specs: targets.length });
    },
  });

  pi.registerTool({
    name: "rsc_review_ledger",
    label: "RSC Review Ledger",
    description:
      "RSC's append-only review ledger: cap rounds at 3, record unique findings and outcomes, record a tier-2 review panel, measure noise, list escapes. Writes .rsc/review-ledger.jsonl.",
    parameters: z.object({
      action: z.enum(["round", "panel", "record", "outcome", "stats", "escapes"]).describe("Ledger operation."),
      task: z.string().optional().describe("Qualified task id <spec-slug>/<task> for round and panel."),
      lenses: z.string().optional().describe("Comma-separated lenses for panel, e.g. correctness,security,tests."),
      findingsJson: z.string().optional().describe("JSON array of findings, or an object with a findings array, for record."),
      id: z.string().optional().describe("Finding id for outcome, e.g. L1."),
      outcome: z.enum(["fixed", "false", "intentional", "irrelevant", "parked"]).optional().describe("Outcome value."),
      since: z.string().optional().describe("Git ref for escapes."),
      json: z.boolean().optional().describe("Return JSON where the original CLI offers it."),
    }),
    approval: "write",
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const root = sello.resolveRoot(projectRoot(ctx.cwd));
      switch (params.action) {
        case "round": {
          if (!params.task) throw new Error("rsc_review_ledger round needs task=<spec-slug>/<task>");
          const r = ledger.round(root, params.task);
          if (!r.ok) throw new Error(translate(r.message));
          return result(translate(r.message));
        }
        case "panel": {
          if (!params.task) throw new Error("rsc_review_ledger panel needs task=<spec-slug>/<task>");
          const r = ledger.panel(root, params.task, params.lenses);
          if (!r.ok) throw new Error(translate(r.message));
          return result(translate(r.message));
        }
        case "record": {
          if (!params.findingsJson) throw new Error("rsc_review_ledger record needs findingsJson");
          let parsed: unknown;
          try {
            parsed = JSON.parse(params.findingsJson);
          } catch (error) {
            throw new Error(`rsc: findingsJson is not valid JSON (${(error as Error).message})`);
          }
          const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.findings) ? parsed.findings : [parsed];
          const out = ledger.record(root, list, { task: params.task || "" });
          if (params.json) return result(JSON.stringify(out, null, 2), { findings: out });
          return result(
            out
              .map((f) =>
                `${f.id}  ${f.status === "repeat" ? `repeat of ${f.repeatOf} — do not raise it again` : "new"}  ${f.file || "(no file)"}  ${f.claim}`,
              )
              .join("\n") || "nothing to record",
          );
        }
        case "outcome": {
          if (!params.id || !params.outcome) throw new Error("rsc_review_ledger outcome needs id and outcome");
          const r = ledger.outcome(root, params.id, params.outcome);
          if (!r.ok) throw new Error(translate(r.message));
          return result(translate(r.message));
        }
        case "stats": {
          const stats = ledger.stats(root);
          return result(params.json ? JSON.stringify(stats, null, 2) : ledger.renderStats(stats), stats);
        }
        case "escapes": {
          const found = ledger.escapes(root, { since: params.since || "" });
          if (!found.ok) throw new Error(found.message);
          return result(params.json ? JSON.stringify(found, null, 2) : ledger.renderEscapes(found), found);
        }
      }
    },
  });

  pi.registerTool({
    name: "rsc_review_consolidate",
    label: "RSC Review Consolidate",
    description:
      "Merge the refuter panel's findings from report files: same place and claim collapse, the highest severity survives, and a blocker/should-fix without file:line or a failure scenario is downgraded to a question.",
    parameters: z.object({
      paths: z.array(z.string()).describe("Lens report files (markdown with ```json findings blocks) or plain JSON."),
      window: z.number().optional().describe("Line window for same-place grouping (default 3)."),
      json: z.boolean().optional().describe("Return structured output."),
    }),
    approval: "read",
    async execute(_id, params, _signal, _onUpdate, ctx) {
      if (!params.paths?.length) throw new Error("rsc_review_consolidate needs at least one report path");
      const sources: Array<[string, string]> = [];
      for (const file of params.paths) {
        sources.push([readFileSync(resolve(ctx.cwd, file), "utf8"), file]);
      }
      const all: Array<Record<string, unknown>> = [];
      const errors: string[] = [];
      for (const [raw, source] of sources) {
        const parsed = findingsLib.parseFindings(raw, source);
        all.push(...parsed.findings);
        errors.push(...parsed.errors);
      }
      const consolidated = findingsLib.consolidate(all, { window: params.window ?? findingsLib.DEFAULT_WINDOW });
      const output = { ...consolidated, errors };
      return result(params.json ? JSON.stringify(output, null, 2) : findingsLib.renderConsolidation(consolidated, errors), output);
    },
  });

  pi.registerTool({
      name: "rsc_sello",
      label: "RSC Sello",
      description:
        "RSC's sello (review receipt): turn the byte-binding gate on/off, freeze the candidate, approve/block with lenses, declare and check a fix budget, and inspect status. State lives in .rsc/.",
      parameters: z.object({
        action: z.enum(["on", "off", "freeze", "approve", "block", "budget", "budget-check", "check", "report", "status"]),
        global: z.boolean().optional().describe("on/off: write the user-scope switch instead of the project switch."),
        lenses: z.string().optional().describe("Comma-separated lenses for approve."),
        acceptPartialLenses: z.boolean().optional().describe("approve: seal even with fewer lenses than the tier requires."),
        note: z.string().optional().describe("approve/block: non-blocking finding to append."),
        reason: z.string().optional().describe("block: why the change is blocked."),
        lines: z.number().optional().describe("budget: declared line budget."),
        justify: z.string().optional().describe("budget-check: justification for an overrun."),
      }),
      approval: "write",
      async execute(_id, params, _signal, _onUpdate, ctx) {
        const outcome = selloTool.runSello(projectRoot(ctx.cwd), params.action, params);
        if (!outcome.ok) throw new Error(translate(outcome.message));
        return result(translate(outcome.message), outcome.data ?? {});
      },
    });

  // ---- native commands for the project-level switches ---------------------------
  const switchResult = (message: string) => {
    pi.sendMessage(
      { customType: "rsc-switch", content: message, display: true, attribution: "agent" },
      { deliverAs: "nextTurn", triggerTurn: false },
    );
  };

  const setMarker = (root: string, name: string, on: boolean) => {
    const dir = join(root, ".rsc");
    mkdirSync(dir, { recursive: true });
    if (on) writeFileSync(join(dir, name), "");
    else rmSync(join(dir, name), { force: true });
  };

  pi.registerCommand("adaptive-main-unlock", {
    description: "Allow the agent to work on the default branch in this project (writes .rsc/.no-trunk-guard).",
    handler: async (_args, ctx) => {
      const root = projectRoot(ctx.cwd);
      setMarker(root, ".no-trunk-guard", true);
      setMarker(root, ".no-trunk-open", false);
      switchResult(
        "rsc main unlock: the agent may now work on the default branch in this project. Commit .rsc/ if the team should inherit the decision.",
      );
    },
  });

  pi.registerCommand("adaptive-main-lock", {
    description: "Close the default branch for the agent and require branches/PRs (writes .rsc/.no-trunk-open).",
    handler: async (_args, ctx) => {
      const root = projectRoot(ctx.cwd);
      setMarker(root, ".no-trunk-open", true);
      setMarker(root, ".no-trunk-guard", false);
      switchResult(
        "rsc main lock: branches and pull requests for this project — the default branch is closed for the agent, and it asks before each code change where it goes.",
      );
    },
  });

  pi.registerCommand("adaptive-isolation-off", {
    description: "Let sessions share this checkout without a worktree (writes .rsc/.no-worktree-isolation).",
    handler: async (_args, ctx) => {
      const root = projectRoot(ctx.cwd);
      setMarker(root, ".no-worktree-isolation", true);
      switchResult(
        "rsc isolation off: sessions may share this folder without a worktree. Commit .rsc/ if the team should inherit the decision.",
      );
    },
  });

  pi.registerCommand("adaptive-isolation-on", {
    description: "Require a .worktrees/<branch> worktree when another session works in this checkout.",
    handler: async (_args, ctx) => {
      const root = projectRoot(ctx.cwd);
      setMarker(root, ".no-worktree-isolation", false);
      switchResult(
        "rsc isolation on: with another session active in this folder, new work goes to .worktrees/<branch>/ at the root, never inside a project folder.",
      );
    },
  });

  pi.registerCommand("adaptive-status", {
    description: "Report this project's trunk policy, worktree isolation switches and sello state.",
    handler: async (_args, ctx) => {
      const root = projectRoot(ctx.cwd);
      const trunk = trunk;
      const policy = trunk.trunkPolicy(root);
      const isolation = existsSync(join(root, ".rsc", ".no-worktree-isolation")) ? "off" : "on";
      switchResult(
        JSON.stringify(
          {
            project: root,
            defaultBranch: trunk.defaultBranchName(root),
            trunkPolicy: policy,
            worktreeIsolation: isolation,
            sello: sello.checkSello(root),
          },
          null,
          2,
        ),
      );
    },
  });
}
