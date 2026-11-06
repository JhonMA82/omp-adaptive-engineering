// The RSC sello CLI transitions, extracted as a JS function so both the OMP tool and its tests
// use the same code. The algorithm is upstream `targets/sello.mjs`; this file only exposes the
// state transitions the original `scripts/rsc.js` performed.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  MESSAGES,
  appendFindings,
  appendLog,
  budgetSpent,
  candidateDigest,
  checkSello,
  classifyCandidate,
  computeCandidate,
  countFindings,
  globalConfigPath,
  isEnabled,
  lensesRequired,
  readConfig,
  readEffectiveConfig,
  readGlobalConfig,
  readSello,
  resolveRoot,
  selloPaths,
  validateRiskConfig,
  writeSello,
} from '../targets/sello.mjs';

const fail = (message) => ({ ok: false, message });

/**
 * @param {string} rawRoot project directory (resolved to the git toplevel)
 * @param {string} action on|off|freeze|approve|block|budget|budget-check|check|report|status
 * @param {object} options
 * @returns {{ok: boolean, message: string, data?: unknown}}
 */
export function runSello(rawRoot, action, options = {}) {
  const root = resolveRoot(rawRoot);
  const paths = selloPaths(root);
  const lenses = String(options.lenses || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  switch (action) {
    case 'on':
    case 'off': {
      const isGlobal = options.global === true;
      const target = isGlobal ? globalConfigPath() : paths.config;
      const cfg = (isGlobal ? readGlobalConfig() : readConfig(root)) || {};
      delete cfg.scope;
      if (action === 'on') {
        try {
          validateRiskConfig(cfg);
        } catch (error) {
          return fail(error.message);
        }
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify({ ...cfg, enabled: action === 'on' }, null, 2)}\n`);
      const where = isGlobal ? 'for every project (global)' : 'for this project';
      let message =
        action === 'on'
          ? `✅ sello ON ${where}. Risk-0 changes (docs/copy) still pass silently; everything else needs a review before commit/push/PR.`
          : `✅ sello OFF ${where}. Delivery behaves exactly as before.`;
      if (isGlobal) {
        const project = readConfig(root);
        if (project && project.enabled !== undefined && project.enabled !== (action === 'on')) {
          message += `\n   ⚠️  this project overrides it (project = ${project.enabled ? 'on' : 'off'}); the project switch always wins. Change it with \`rsc_sello ${project.enabled ? 'off' : 'on'}\` here.`;
        }
      }
      return { ok: true, message };
    }

    case 'freeze': {
      const cfg = readEffectiveConfig(root);
      const candidate = computeCandidate(root, cfg);
      if (!candidate) return fail(MESSAGES.noTrunk());
      const candidates = Object.keys(candidate.files);
      if (!candidates.length) return { ok: true, message: 'sello: nothing to freeze — the working tree matches the trunk base.' };
      const risk = classifyCandidate(root, candidate, cfg);
      const required = lensesRequired(risk.tier, cfg);
      writeSello(root, { status: 'frozen', ...candidate, risk, required, lenses: [], createdAt: new Date().toISOString() });
      const lines = [];
      if (risk.configError) lines.push(`⚠️  ${risk.configError}`, '   (using the default risk table until it is fixed)');
      lines.push(`🧊 frozen: ${candidates.length} file(s), risk tier ${risk.tier} → ${required} lens(es) required.`);
      for (const [p, c] of Object.entries(risk.classes)) if (c !== 'default' && c !== 'docs') lines.push(`   ${p} → ${c}`);
      if (risk.lowered?.length) lines.push(`   (lowered by config: ${risk.lowered.join(', ')})`);
      return { ok: true, message: lines.join('\n') };
    }

    case 'approve':
    case 'block': {
      const current = readSello(root);
      if (current.missing || current.corrupt || !current.status) return fail(MESSAGES.notFrozen());
      const cfg = readEffectiveConfig(root);
      const candidate = computeCandidate(root, cfg);
      const changed =
        candidate &&
        Object.keys({ ...current.files, ...candidate.files }).some((p) => current.files[p] !== candidate.files[p]);
      if (action === 'approve' && (changed || current.base !== candidate?.base)) return fail(MESSAGES.staleFreeze());
      const required = current.required ?? lensesRequired(current.risk?.tier ?? 1, cfg);
      if (action === 'approve' && lenses.length < required && !options.acceptPartialLenses) {
        return fail(MESSAGES.partialLenses(lenses.length, required));
      }
      if (options.note) appendFindings(root, [`${new Date().toISOString().slice(0, 10)} ${options.note}`]);
      const status = action === 'approve' ? 'approved' : 'blocked';
      writeSello(root, { ...current, status, lenses, reason: options.reason });
      appendLog(root, {
        at: new Date().toISOString(),
        status,
        base: current.base,
        risk: current.risk?.tier,
        files: Object.keys(current.files).length,
        lenses,
        digest: candidateDigest(current),
        partialLenses: lenses.length < required || undefined,
        reason: options.reason,
      });
      return {
        ok: true,
        message:
          action === 'approve'
            ? `✅ sealed with ${lenses.length}/${required} lens(es)${lenses.length ? `: ${lenses.join(', ')}` : ''}.`
            : '⛔ blocked — fix and re-review.',
      };
    }

    case 'budget': {
      const current = readSello(root);
      if (current.missing || current.corrupt) return fail(MESSAGES.notFrozen());
      const lines = Number(options.lines);
      if (!Number.isFinite(lines) || lines <= 0) return fail('Use: rsc_sello budget with lines=<N>');
      writeSello(root, { ...current, budget: { lines, declaredAt: new Date().toISOString() } });
      return { ok: true, message: `📏 fix budget declared: ${lines} line(s). budget-check will hold the fix to it.` };
    }

    case 'budget-check': {
      const current = readSello(root);
      if (current.missing || current.corrupt || !current.budget) {
        return fail('sello: no declared budget. Recover: run rsc_sello budget with lines=<N> BEFORE fixing.');
      }
      const candidate = computeCandidate(root, readEffectiveConfig(root));
      const spent = budgetSpent(current, candidate || { numstat: {} });
      if (spent <= current.budget.lines) return { ok: true, message: `✅ within budget: ~${spent}/${current.budget.lines} line(s).` };
      if (typeof options.justify === 'string' && options.justify.trim()) {
        writeSello(root, { ...current, budget: { ...current.budget, exceeded: spent, justification: options.justify } });
        appendFindings(root, [`budget exceeded (~${spent}/${current.budget.lines}): ${options.justify}`]);
        return { ok: true, message: `⚠️ over budget (~${spent}/${current.budget.lines}) — justification recorded.` };
      }
      return fail(MESSAGES.overBudget(spent, current.budget.lines));
    }

    case 'check': {
      const verdict = checkSello(root);
      if (verdict.warning) {
        return {
          ok: verdict.ok,
          message: `⚠️  ${verdict.warning}\n${verdict.ok ? `✅ sello check: ${verdict.code}` : verdict.message}`,
        };
      }
      return { ok: verdict.ok, message: verdict.ok ? `✅ sello check: ${verdict.code}` : verdict.message };
    }

    case 'report':
      return {
        ok: true,
        message: existsSync(paths.findings) ? readFileSync(paths.findings, 'utf8') : '(no non-blocking findings recorded)',
      };

    case 'status': {
      const enabled = isEnabled(root);
      const verdict = checkSello(root);
      const current = readSello(root);
      const cfg = readEffectiveConfig(root);
      let lowered = [];
      let configError;
      try {
        ({ lowered } = validateRiskConfig(cfg || {}));
      } catch (error) {
        configError = error.message;
      }
      const globalCfg = readGlobalConfig();
      const projectCfg = readConfig(root);
      const status = {
        enabled,
        decidedBy: cfg?.scope,
        scopes: {
          global: globalCfg?.enabled === undefined ? 'unset' : globalCfg.enabled ? 'on' : 'off',
          project: projectCfg?.enabled === undefined ? 'unset' : projectCfg.enabled ? 'on' : 'off',
        },
        check: verdict.code,
        inert: enabled && ['no-trunk', 'disabled'].includes(verdict.code) ? verdict.code : undefined,
        shipGuardOptOut: existsSync(join(root, '.rsc', '.no-ship-guard')) || undefined,
        warning: verdict.warning,
        configError,
        loweredClasses: lowered.length ? lowered : undefined,
        status: current.missing ? 'none' : current.corrupt ? 'corrupt' : current.status,
        risk: current.risk?.tier,
        lenses: current.lenses,
        lensesRequired: current.required,
        budget: current.budget,
        nonBlockingFindings: countFindings(root),
      };
      return { ok: true, message: JSON.stringify(status, null, 2), data: status };
    }

    default:
      return fail(
        'Use: rsc_sello on|off [global]|status|freeze|approve lenses=a,b [acceptPartialLenses]|block reason="…"|budget lines=N|budget-check [justify="…"]|check|report',
      );
  }
}
