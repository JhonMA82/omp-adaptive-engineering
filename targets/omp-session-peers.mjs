/**
 * OMP boundary for RSC's Branch-guard rule B: "another session is working in this same checkout".
 *
 * Upstream reads a session journal (`session-memory-core.mjs`) that this port does not ship. OMP
 * already knows the answer, so this module asks it instead of inventing a registry:
 *
 *   - `listSessions`/`listRecentSessions` enumerate session records OMP itself wrote, each with the
 *     working directory it was started in and a `parentSessionPath` for a subagent's child session.
 *   - `probeSessionLeases` reports which of those session ids a live process currently owns. The
 *     lease is a file lock (an abstract socket on Linux) held until the process exits, so an idle
 *     session that is still open counts — switching branches would still change its files.
 *
 * The candidate set is bounded on purpose: the current session's bucket, the git checkout's bucket
 * and the newest sessions across every project. OMP exposes no "list every live session" call, so a
 * session started in a different subdirectory and untouched for a long time may not be listed; the
 * rule then fails open exactly as upstream does without its journal module.
 *
 * Everything is fail-open: any error, missing API or unreadable record yields no peers.
 */
import { realpathSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const RECENT_LIMIT = 60;

const realish = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

export const within = (path, dir) => {
  if (path === dir) return true;
  return path.startsWith(dir.endsWith(sep) ? dir : dir + sep);
};

/** The checkout a directory belongs to, or null when git cannot answer. */
function checkoutOf(dir) {
  const run = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (run.status !== 0) return null;
  const top = (run.stdout || "").trim();
  return top ? realish(top) : null;
}

const iso = (value) => (value instanceof Date ? value.toISOString() : String(value));

/**
 * Build the `peers` provider `branch-guard.evaluate` expects.
 *
 * @param {object} options
 * @param {object} options.pi        OMP's injected SDK namespace (`ExtensionAPI.pi`).
 * @param {string} [options.sessionDir] Current session's directory (`ctx.sessionManager.getSessionDir()`).
 * @param {string} [options.sessionId]  Current session id, excluded from the result.
 * @param {string} [options.selfFile]   Current session file, excluded as a second identity check.
 * @param {number} [options.recentLimit]
 * @returns {(input: { root?: string, worktreeCwd: string, sessionId?: string }) => Promise<Array<{ target: string, branch: null, updatedAt: string }>>}
 */
export function createSessionPeers({ pi, sessionDir, sessionId, selfFile, recentLimit = RECENT_LIMIT } = {}) {
  return async function peers({ worktreeCwd }) {
    try {
      if (!pi || typeof pi.listSessions !== "function" || typeof pi.probeSessionLeases !== "function") return [];
      const self = sessionId;
      // Rule B is about a whole checkout: `git -C <subdir> switch` changes files elsewhere in the
      // same checkout too. Normalise the command's effective directory to its git toplevel; using
      // the subdirectory itself would reject every peer (including peers in that subdirectory).
      const here = checkoutOf(worktreeCwd) ?? realish(worktreeCwd);
      const storage = new pi.FileSessionStorage();
      const buckets = new Set();
      if (sessionDir) buckets.add(sessionDir);
      const checkoutBucket = pi.SessionManager.getDefaultSessionDir(here, undefined, storage);
      if (checkoutBucket) buckets.add(checkoutBucket);

      const candidates = new Map();
      for (const bucket of buckets) {
        for (const session of await pi.listSessions(bucket, storage)) {
          if (session?.id) candidates.set(session.id, session);
        }
      }
      if (typeof pi.listRecentSessions === "function") {
        const recent = await pi.listRecentSessions({ limit: recentLimit });
        for (const session of recent) if (session?.id) candidates.set(session.id, session);
      }

      // Subagent child journals live under `<parent-session>/<id>.jsonl`, one level below the bucket;
      // neither listing scans that depth, so an enumerated record is a top-level session — including
      // a fork or continuation of ours, which is a second live session and must count. No parent
      // filter: it would drop live forks whose header records their source.
      const near = [];
      for (const session of candidates.values()) {
        try {
          if (session.id === self) continue;
          if (selfFile && session.path === selfFile) continue;
          if (typeof session.cwd !== "string" || !isAbsolute(session.cwd)) continue;
          const cwd = realish(session.cwd);
          if (!within(cwd, here)) continue;
          // Reject a nested repository one level down: it is a different checkout even if the path is inside.
          const top = checkoutOf(cwd);
          if (top !== here) continue;
          near.push(session);
        } catch {
          // One malformed record must not discard every other candidate.
          continue;
        }
      }
      if (near.length === 0) return [];

      const leases = pi.probeSessionLeases(near.map((session) => session.id));
      const held = new Set(leases?.held ?? []);
      return near
        .filter((session) => held.has(session.id))
        .map((session) => ({
          target: "another OMP session",
          branch: null,
          updatedAt: iso(session.modified),
        }));
    } catch {
      return [];
    }
  };
}
