#!/usr/bin/env node
// rsc Ship guard (claude). Wired by targets/claude.js onto PreToolUse (matcher Bash)
// as `node ...` so it runs on every platform including Windows.
//   argv[2] = absolute project root   stdin = PreToolUse hook JSON
//
// Enforces the "close the feature before you leave it" rule at the one deterministic
// moment it matters: when a Bash command tries to switch to the trunk (main/master)
// or merge into it. A merge run ON the feature branch (`git merge origin/main`) brings
// the trunk in — it leaves nothing behind, so it is not judged (team simulation D10);
// a merge counts only where it lands on a trunk checkout (`git -C ../main merge feat`).
// rsc's own knowledge commits (📥/📝 docs(auto)) are not the person's unpushed work. If the current feature branch has uncommitted changes or commits
// that were never pushed, the guard DENIES the command and tells the agent to run
// `ship` (commit → push → PR). Opening the PR itself is `ship`'s job and the skill's
// hard rule; this hook guarantees you cannot quietly abandon unsaved/unpushed work.
//
// Design: precise (only fires on a trunk switch/merge), local-only (no network, no gh),
// and FAIL-OPEN — any ambiguity (detached HEAD, no repo, git error) allows the command.
// Opt out per project with .rsc/.no-ship-guard.
//
// OMP port: the decision is also exported as shipGuardDecision(root, command) so the
// ExtensionAPI adapter runs this exact algorithm in-process. The CLI entrypoint below
// is unchanged in behavior for the original tests.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function allow() { process.exit(0); }
function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

/**
 * null-ish allow, or `{ decision: 'deny', reason }`. Async because the sello, ASDD gate
 * and shell-unwrap siblings are loaded lazily; every failure is fail-open.
 */
export async function shipGuardDecision(root, command) {
  // "Not a git repo" means: nothing to enforce. (The .no-ship-guard opt-out is checked
  // AFTER the sello below — it opts out of THIS guard's branch-hygiene rules, not of a
  // different feature that happens to share the hook. The sello has its own switch.)
  if (!existsSync(join(root, '.git'))) return { decision: 'allow' };

  // Read the tool call. Only Bash commands can move branches.
  if (typeof command !== 'string' || !command) return { decision: 'allow' };

  // ---- sello gate (opt-in) ----------------------------------------------------
  // When the sello is ON for this project, delivery commands (commit, push, PR)
  // must match the sealed bytes. OFF (the default) → this block is a no-op and the
  // guard behaves exactly as before. checkSello itself fails open on environment
  // problems and denies only on real divergence/no-review/corruption (spec).
  // Deliberately BEFORE the .no-ship-guard opt-out: that file disables this guard's
  // branch-hygiene rules; the sello is a separate opt-in with its own `sello off`.
  try {
    const { checkSello, isEnabled, isDeliveryCommand } = await import(new URL('./sello.mjs', import.meta.url));
    if (isDeliveryCommand(command) && isEnabled(root)) {
      const verdict = checkSello(root);
      if (!verdict.ok) return { decision: 'deny', reason: verdict.message };
    }
  } catch { /* sello lib missing/unloadable → nothing to enforce, fail open */ }

  // ---- ASDD escalation gate ---------------------------------------------------
  // A tier-2 branch does not leave the machine (push, PR) without a spec linked to it that passes the
  // spec gate. Its own opt-out (.rsc/.no-asdd-gate); fail-open if a sibling is missing.
  try {
    const sello = await import(new URL('./sello.mjs', import.meta.url));
    const { specCompleteness } = await import(new URL('./spec-completeness.mjs', import.meta.url));
    const { asddGate } = await import(new URL('./asdd-gate.mjs', import.meta.url));
    const verdict = asddGate(root, command, { sello, specCompleteness });
    if (verdict) return { decision: 'deny', reason: verdict };
  } catch { /* sibling missing/unloadable → nothing to enforce, fail open */ }

  // Ship-guard's own opt-out (branch hygiene only — the sello above already ran).
  if (existsSync(join(root, '.rsc', '.no-ship-guard'))) return { decision: 'allow' };

  // Does this command try to land on / move to the trunk?
  // Global options may sit before the subcommand (`git -C . switch main`, `git -c k=v merge`), and the
  // command may be handed to a shell (`bash -c "git switch main"`): the segments judged are the ones the
  // shell really runs, quoted text blanked (shell-unwrap.mjs, shared with the other guards — E2E defect
  // 15). Without that sibling, the raw command as before.
  const GOPTS = String.raw`(?:(?:-[Cc]\s+\S+|--\S+)\s+)*`;
  const TRUNK = new RegExp(String.raw`\bgit\s+${GOPTS}(?:checkout|switch)\s+(?:-{1,2}\S+\s+)*(?:main|master)\b`);
  const MERGE = new RegExp(String.raw`\bgit\s+${GOPTS}merge\b`);
  const SH = await import(new URL('./shell-unwrap.mjs', import.meta.url)).catch(() => null);
  const judged = SH ? SH.expand(command).map((s) => s.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""')) : [command];

  const gitIn = (dir, ...args) => {
    const r = spawnSync('git', ['-C', dir, ...args], { windowsHide: true, encoding: 'utf8' });
    return r.status === 0 ? (r.stdout || '').trim() : null;
  };
  const git = (...args) => gitIn(root, ...args);

  // A merge lands on the trunk only where the checkout it runs in IS on the trunk. Here that means a
  // `git -C <dir> merge` aimed at another checkout; a merge in this one runs on the feature branch
  // (checked below), and `git switch main && git merge x` is already caught by its switch.
  function mergesIntoTrunk(segment) {
    if (!MERGE.test(segment)) return false;
    const m = segment.match(/\bgit\s+(?:-c\s+\S+\s+)*-C\s+(\S+)/);
    if (!m) return false;
    const dir = isAbsolute(m[1]) ? m[1] : resolve(root, m[1]);
    const b = gitIn(dir, 'rev-parse', '--abbrev-ref', 'HEAD');
    return b === 'main' || b === 'master';
  }
  if (!judged.some((s) => TRUNK.test(s) || mergesIntoTrunk(s))) return { decision: 'allow' };

  // Commits in a range that are the person's: rsc's own knowledge commits are left out.
  const RSC_OWN = /^(?:📥|📝) docs\(auto\)/u;
  function ownCommits(range) {
    const log = git('log', '--format=%s', range);
    if (log === null) return null;
    return log.split('\n').filter((s) => s && !RSC_OWN.test(s)).length;
  }

  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  // Not on a feature branch (already trunk, detached, or git failed) → nothing to guard.
  if (!branch || branch === 'HEAD' || branch === 'main' || branch === 'master') return { decision: 'allow' };

  const tail = '\n(If this is intentional and you accept the risk, create .rsc/.no-ship-guard to disable this guard.)';

  // 1) Uncommitted work would be carried off the feature branch.
  const dirty = git('status', '--porcelain');
  if (dirty && dirty.length > 0) {
    return {
      decision: 'deny',
      reason: `You're leaving feature branch "${branch}" with uncommitted changes. Commit them first — run the \`ship\` skill (commit → push → PR), don't abandon the diff.${tail}`,
    };
  }

  // 2) Commits exist but were never pushed.
  const upstream = git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}');
  if (upstream) {
    const ahead = ownCommits(`${upstream}..HEAD`);
    if (ahead && Number(ahead) > 0) {
      return {
        decision: 'deny',
        reason: `Feature branch "${branch}" has ${ahead} commit(s) not pushed to ${upstream}. Push them and open the PR — run the \`ship\` skill — before switching to the trunk.${tail}`,
      };
    }
  } else {
    // No upstream at all: if the branch carries commits beyond the trunk, it was never pushed.
    const aheadOfTrunk = ownCommits('main..HEAD') ?? ownCommits('master..HEAD');
    if (aheadOfTrunk && Number(aheadOfTrunk) > 0) {
      return {
        decision: 'deny',
        reason: `Feature branch "${branch}" was never pushed (no upstream, ${aheadOfTrunk} commit(s) ahead of the trunk). Push it and open a PR — run the \`ship\` skill — before leaving it.${tail}`,
      };
    }
  }

  return { decision: 'allow' };
}

/** "Was this file run directly?" — symlink-aware, and safe when argv[1] is absent. */
function isMain(metaUrl) {
  const invoked = process.argv[1];
  if (!invoked) return false;
  const self = fileURLToPath(metaUrl);
  try { return realpathSync(self) === realpathSync(invoked); } catch { return self === invoked; }
}

if (isMain(import.meta.url)) {
  const root = process.argv[2] || process.cwd();
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { allow(); }
  if ((input.tool_name || input.toolName) !== 'Bash') allow();
  const command = input.tool_input?.command || input.toolInput?.command || '';
  const verdict = await shipGuardDecision(root, command);
  if (verdict.decision === 'deny') deny(verdict.reason);
  allow();
}
