/**
 * Rule B through OMP's native memory: which sessions count as "another session in this checkout".
 *
 * The provider is fed a fake `ExtensionAPI.pi` namespace, so these tests pin the filter (self,
 * subagent child, other checkout, unheld lease) without asking OMP for a second live process. The
 * real two-session check is recorded in the FTD's Evidence and in README.md.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSessionPeers, within } from "../targets/omp-session-peers.mjs";
import { evaluate } from "../targets/branch-guard.mjs";

function repo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "session-peers-")));
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=T", "commit", "-q", "--allow-empty", "-m", "init"]);
  return dir;
}

function fakePi({ sessions = [], held = [], recent = [] }) {
  return {
    FileSessionStorage: class {},
    SessionManager: { getDefaultSessionDir: () => "/bucket" },
    listSessions: async () => sessions,
    listRecentSessions: async () => recent,
    probeSessionLeases: (ids) => ({ held: ids.filter((id) => held.includes(id)), unknown: [] }),
  };
}

const at = (cwd, id, extra = {}) => ({ id, cwd, path: `/sessions/${id}.jsonl`, modified: new Date("2026-11-06T10:00:00Z"), ...extra });

test("another live session in the same checkout is reported", async () => {
  const root = repo();
  const peers = createSessionPeers({
    pi: fakePi({
      sessions: [
        at(root, "self"),
        at(root, "peer"),
        at(root, "finished"),
      ],
      held: ["self", "peer"],
    }),
    sessionDir: "/bucket",
    sessionId: "self",
    selfFile: "/sessions/self.jsonl",
  });

  const found = await peers({ worktreeCwd: root, sessionId: "self" });
  assert.equal(found.length, 1);
  assert.equal(found[0].target, "another OMP session");
  assert.equal(found[0].updatedAt, "2026-11-06T10:00:00.000Z");
});

test("a fork or continuation is another live session, whatever its parent field holds", async () => {
  const root = repo();
  const peers = createSessionPeers({
    pi: fakePi({
      sessions: [
        at(root, "fork-id", { parentSessionPath: "01a1af01-ade2-7062-b466-51767f966878" }),
        at(root, "fork-path", { parentSessionPath: "/sessions/self.jsonl" }),
        at(root, "continuation", { parentSessionPath: "01a1ae5e-a606-7069-b10e-ae7e42402636" }),
      ],
      held: ["fork-id", "fork-path", "continuation"],
    }),
    sessionDir: "/bucket",
    sessionId: "self",
  });

  const found = await peers({ worktreeCwd: root, sessionId: "self" });
  assert.equal(found.length, 3, "enumerated records are top-level sessions; a fork is not a subagent child");
});

test("one malformed record does not discard the valid peers", async () => {
  const root = repo();
  const peers = createSessionPeers({
    pi: fakePi({
      sessions: [at(root, "broken", { cwd: `${root}\u0000` }), at(root, "peer")],
      held: ["broken", "peer"],
    }),
    sessionDir: "/bucket",
    sessionId: "self",
  });

  const found = await peers({ worktreeCwd: root, sessionId: "self" });
  assert.equal(found.length, 1, "the live peer survives the malformed record");
  assert.equal(found[0].target, "another OMP session");
});

test("within accepts a filesystem root as the checkout", () => {
  assert.equal(within("/repo", "/"), true);
  assert.equal(within("/", "/"), true);
  assert.equal(within("/other", "/repo"), false);
});

test("a nested repository inside the checkout is a different checkout", async () => {
  const root = repo();
  const nested = join(root, "vendor", "nested");
  mkdirSync(nested, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", nested]);
  const peers = createSessionPeers({
    pi: fakePi({ sessions: [at(nested, "peer")], held: ["peer"] }),
    sessionDir: "/bucket",
    sessionId: "self",
  });

  assert.deepEqual(await peers({ worktreeCwd: root, sessionId: "self" }), []);
});

test("the recent-session fallback finds a peer outside this bucket", async () => {
  const root = repo();
  const peers = createSessionPeers({
    pi: fakePi({ sessions: [], recent: [at(root, "peer")], held: ["peer"] }),
    sessionDir: "/bucket",
    sessionId: "self",
  });

  assert.equal((await peers({ worktreeCwd: root, sessionId: "self" })).length, 1);
});

test("a session in a different checkout is ignored", async () => {
  const here = repo();
  const elsewhere = repo();
  const peers = createSessionPeers({
    pi: fakePi({ sessions: [at(elsewhere, "peer")], held: ["peer"] }),
    sessionDir: "/bucket",
    sessionId: "self",
  });

  assert.deepEqual(await peers({ worktreeCwd: here, sessionId: "self" }), []);
});

test("a session in a subdirectory of this checkout is reported", async () => {
  const here = repo();
  const sub = join(here, "targets");
  mkdirSync(sub);
  const peers = createSessionPeers({
    pi: fakePi({ sessions: [at(sub, "peer")], held: ["peer"] }),
    sessionDir: "/bucket",
    sessionId: "self",
  });

  assert.equal((await peers({ worktreeCwd: here, sessionId: "self" })).length, 1);
});

test("a command run from a subdirectory still sees peers elsewhere in the same checkout", async () => {
  const here = repo();
  const sub = join(here, "targets");
  mkdirSync(sub);
  const peers = createSessionPeers({
    pi: fakePi({ sessions: [at(here, "peer")], held: ["peer"] }),
    sessionDir: "/bucket",
    sessionId: "self",
  });

  assert.equal((await peers({ worktreeCwd: sub, sessionId: "self" })).length, 1);
});

test("a lease nobody holds is not a live session", async () => {
  const here = repo();
  const peers = createSessionPeers({
    pi: fakePi({ sessions: [at(here, "peer")], held: [] }),
    sessionDir: "/bucket",
    sessionId: "self",
  });

  assert.deepEqual(await peers({ worktreeCwd: here, sessionId: "self" }), []);
});

test("the current session's bucket is enumerated even when the checkout bucket differs", async () => {
  const root = repo();
  const seen = [];
  const peers = createSessionPeers({
    pi: {
      FileSessionStorage: class {},
      SessionManager: { getDefaultSessionDir: () => "/other-bucket" },
      listSessions: async (dir) => {
        seen.push(dir);
        return dir === "/bucket" ? [at(root, "peer")] : [];
      },
      listRecentSessions: async () => [],
      probeSessionLeases: (ids) => ({ held: ids, unknown: [] }),
    },
    sessionDir: "/bucket",
    sessionId: "self",
  });

  assert.equal((await peers({ worktreeCwd: root, sessionId: "self" })).length, 1);
  assert.ok(seen.includes("/bucket"), "the session directory handed by the adapter must be queried");
});

test("the session id alone excludes self when no file is supplied", async () => {
  const root = repo();
  const peers = createSessionPeers({
    pi: fakePi({ sessions: [at(root, "self")], held: ["self"] }),
    sessionDir: "/bucket",
    sessionId: "self",
  });

  assert.deepEqual(await peers({ worktreeCwd: root, sessionId: "self" }), []);
});

test("the session file alone excludes a same-path session with a different id", async () => {
  const root = repo();
  const peers = createSessionPeers({
    pi: fakePi({ sessions: [at(root, "fork", { path: "/sessions/self.jsonl" })], held: ["fork"] }),
    sessionDir: "/bucket",
    sessionId: "self",
    selfFile: "/sessions/self.jsonl",
  });

  assert.deepEqual(await peers({ worktreeCwd: root, sessionId: "self" }), []);
});

test("a failing provider fails open", async () => {
  const peers = createSessionPeers({ pi: null, sessionDir: "/bucket", sessionId: "self" });
  assert.deepEqual(await peers({ worktreeCwd: "/tmp", sessionId: "self" }), []);

  const broken = createSessionPeers({
    pi: {
      FileSessionStorage: class {},
      SessionManager: { getDefaultSessionDir: () => "/bucket" },
      listSessions: async () => {
        throw new Error("disk gone");
      },
      probeSessionLeases: () => ({ held: [], unknown: [] }),
    },
  });
  assert.deepEqual(await broken({ worktreeCwd: "/tmp", sessionId: "self" }), []);
});

test("branch-guard denies a branch switch when the injected provider reports a peer", async () => {
  const root = repo();
  const peers = async () => [{ target: "another OMP session", branch: null, updatedAt: new Date().toISOString() }];
  const reason = await evaluate({ root, command: "git switch -c feat/x", cwd: root, sessionId: "self", peers });

  assert.match(reason, /Another session is working in this same folder/);
  assert.match(reason, /\.worktrees\//);
  assert.match(reason, /another OMP session/);
});

test("branch-guard allows the same switch when no peer is reported", async () => {
  const root = repo();
  const peers = async () => [];
  assert.equal(await evaluate({ root, command: "git switch -c feat/x", cwd: root, sessionId: "self", peers }), null);
});
