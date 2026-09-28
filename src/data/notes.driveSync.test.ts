import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import * as vault from "./vault";
import * as notes from "./notes";
import { resetConnectionForTests } from "./db";

// A minimal in-memory stand-in for real Google Drive, shared across
// simulated "devices" within a test (the fake Drive itself is NOT reset
// when switching devices -- only each device's own local IndexedDB is --
// mirroring several real devices all talking to the same Drive account).
// modifiedTime is just a monotonically increasing opaque token; notes.ts
// never parses it as a real date, only compares it for equality.
interface FakeEntry {
  id: string;
  name: string;
  mimeType: string;
  parentId: string;
  content: Uint8Array;
  modifiedTime: string;
}
let fakeDrive: FakeEntry[] = [];
let clock = 0;
const nextToken = () => `t${++clock}`;

vi.mock("./driveClient", () => ({
  DOCX_MIME: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  async ensureFolder(_token: string, name: string, parentId?: string) {
    const pid = parentId ?? "drive-root";
    let f = fakeDrive.find((x) => x.mimeType === "application/vnd.google-apps.folder" && x.name === name && x.parentId === pid);
    if (!f) {
      f = { id: `folder-${++clock}`, name, mimeType: "application/vnd.google-apps.folder", parentId: pid, content: new Uint8Array(), modifiedTime: nextToken() };
      fakeDrive.push(f);
    }
    return f.id;
  },
  async uploadNewFile(_token: string, parentId: string, fileName: string, content: Uint8Array) {
    const id = `file-${++clock}`;
    const modifiedTime = nextToken();
    fakeDrive.push({ id, name: fileName, mimeType: "docx", parentId, content, modifiedTime });
    return { id, modifiedTime };
  },
  async updateFileContent(_token: string, fileId: string, content: Uint8Array) {
    const f = fakeDrive.find((x) => x.id === fileId);
    if (!f) return null;
    f.content = content;
    f.modifiedTime = nextToken();
    return f.modifiedTime;
  },
  async renameOrMoveFile(_token: string, fileId: string, opts: { newName?: string; newParentId?: string }) {
    const f = fakeDrive.find((x) => x.id === fileId);
    if (!f) return null;
    if (opts.newName) f.name = opts.newName;
    if (opts.newParentId) f.parentId = opts.newParentId;
    return f.modifiedTime; // rename/move alone doesn't bump content's modifiedTime here
  },
  async deleteFile(_token: string, fileId: string) {
    fakeDrive = fakeDrive.filter((x) => x.id !== fileId);
    return true;
  },
  async listFolderChildren(_token: string, folderId: string) {
    return fakeDrive.filter((x) => x.parentId === folderId).map(({ id, name, mimeType, modifiedTime }) => ({ id, name, mimeType, modifiedTime }));
  },
  async downloadFile(_token: string, fileId: string) {
    return fakeDrive.find((x) => x.id === fileId)?.content ?? null;
  },
}));

const PASSWORD = "hunter2"; // shared across simulated devices, same as in real life
const deviceIndexedDBs = new Map<string, IDBFactory>();

/** Swaps in `name`'s own persistent local IndexedDB (creating it the first time) and unlocks/sets up its vault, simulating switching to that physical device. */
async function enterDevice(name: string): Promise<void> {
  let idb = deviceIndexedDBs.get(name);
  if (!idb) {
    idb = new IDBFactory();
    deviceIndexedDBs.set(name, idb);
  }
  globalThis.indexedDB = idb;
  resetConnectionForTests();
  if (await vault.isSetUp()) {
    await vault.unlock(PASSWORD);
  } else {
    await vault.setUp(PASSWORD);
  }
}

beforeEach(() => {
  fakeDrive = [];
  clock = 0;
  deviceIndexedDBs.clear();
});

describe("Drive sync across devices", () => {
  it("uses the same id/filename for a daily note pulled onto a second device", async () => {
    await enterDevice("A");
    const daily = await notes.dailyFolderId();
    const id = notes.todayNoteId();
    await notes.saveNote(id, daily, "28 September 2026", "Written on device A.");
    await notes.connectDrive("token-a");
    expect(fakeDrive.find((f) => f.mimeType === "docx")?.name).toBe(`${id}.docx`);

    await enterDevice("B");
    const connected = await notes.connectDrive("token-b");
    expect(connected).toBe(true);

    // The critical assertion: pulled under the SAME id device A used, not a random uuid.
    const pulled = await notes.findNote(id);
    expect(pulled?.body).toBe("Written on device A.");
    expect(await notes.listNotes()).toHaveLength(1);
  });

  it("pulls an update to a note already known locally, not just brand-new files", async () => {
    await enterDevice("A");
    const daily = await notes.dailyFolderId();
    const id = notes.todayNoteId();
    await notes.saveNote(id, daily, "28 September 2026", "v1 from device A.");
    await notes.connectDrive("token-a");

    await enterDevice("B");
    await notes.connectDrive("token-b"); // pulls v1, now "knows" this note via driveFileId

    await enterDevice("A"); // back to the SAME device A local state (not a fresh vault)
    await notes.saveNote(id, await notes.dailyFolderId(), "28 September 2026", "v2 from device A.");
    await notes.syncPending("token-a-2");

    await enterDevice("B");
    const restored = await notes.restoreFromDrive("token-b-2");
    expect(restored).toBe(0); // an update to an already-known note, not counted as a new import
    const loaded = await notes.findNote(id);
    expect(loaded?.body).toBe("v2 from device A.");
    expect(await notes.listNotes()).toHaveLength(1); // no duplicate created for a clean pull
  });

  it("keeps both versions instead of silently overwriting when both devices edit the same day's entry before syncing", async () => {
    await enterDevice("A");
    const dailyA = await notes.dailyFolderId();
    const id = notes.todayNoteId();
    await notes.saveNote(id, dailyA, "28 September 2026", "A's morning entry.");
    await notes.connectDrive("token-a");

    // Device B, independently, writes its own version of today BEFORE ever syncing.
    await enterDevice("B");
    const dailyB = await notes.dailyFolderId();
    await notes.saveNote(id, dailyB, "28 September 2026", "B's morning entry.");

    // Now device B connects to the same Drive account for the first time.
    await notes.connectDrive("token-b");

    const list = await notes.listNotes();
    expect(list).toHaveLength(2); // both entries survived -- neither was silently dropped

    const bodies = await Promise.all(list.map((m) => notes.findNote(m.id).then((n) => n?.body)));
    expect(bodies).toContain("B's morning entry."); // device B's own local edit, untouched
    expect(bodies).toContain("A's morning entry."); // device A's version, landed as a separate note

    const conflictCopy = list.find((m) => m.id !== id);
    expect(conflictCopy?.title).toContain("from other device");

    // Drive itself ends up with two files -- nothing was deleted on either side.
    expect(fakeDrive.filter((f) => f.mimeType === "docx")).toHaveLength(2);

    // Resolving the conflict discards the chosen loser and its Drive file, keeping only the winner.
    expect(conflictCopy?.conflictOf).toBe(id); // links back to the note it diverged from
    const driveFileIdToDelete = await notes.resolveConflict(id, conflictCopy!.id);
    expect(driveFileIdToDelete).toBe(conflictCopy!.driveFileId); // caller is told to clean up the LOSER's own Drive file

    const remaining = await notes.listNotes();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(id);
    expect((await notes.findNote(id))?.body).toBe("B's morning entry."); // the kept note, untouched
  });

  it("detects a conflict on a later re-sync when both sides changed a known note since they last agreed", async () => {
    await enterDevice("A");
    const dailyA = await notes.dailyFolderId();
    const id = notes.todayNoteId();
    await notes.saveNote(id, dailyA, "28 September 2026", "v1, seen by both.");
    await notes.connectDrive("token-a");

    await enterDevice("B");
    await notes.connectDrive("token-b"); // B pulls v1, now in sync with A

    // Device A edits and pushes v2.
    await enterDevice("A");
    await notes.saveNote(id, await notes.dailyFolderId(), "28 September 2026", "v2 from device A.");
    await notes.syncPending("token-a-2");

    // Device B, unaware of v2, makes its own local edit (still unsynced).
    await enterDevice("B");
    await notes.saveNote(id, await notes.dailyFolderId(), "28 September 2026", "v2 from device B.");

    // Device B now syncs: pull-before-push should surface the conflict rather than clobbering either side.
    const restored = await notes.restoreFromDrive("token-b-2");
    expect(restored).toBe(1); // A's diverging version landed as a conflict copy

    const list = await notes.listNotes();
    expect(list).toHaveLength(2);
    const bodies = await Promise.all(list.map((m) => notes.findNote(m.id).then((n) => n?.body)));
    expect(bodies).toContain("v2 from device B."); // B's own edit, untouched
    expect(bodies).toContain("v2 from device A."); // A's edit, preserved as a separate note

    // B's own edit is still queued to push -- completing the sync pushes it as normal.
    await notes.syncPending("token-b-3");
    expect((await notes.findNote(id))?.body).toBe("v2 from device B.");
  });

  it("gives every conflict copy a distinct, still date-based name even when several duplicates exist for the same day", async () => {
    // Simulates leftover duplicate "<date>.docx" files as could exist from
    // before restoreFromDrive pulled updates at all (each device pushing
    // its own version without ever seeing the others' -- see the bug this
    // whole file/date-id-matching fix addressed).
    const id = notes.todayNoteId();
    let driveRootId: string | undefined;
    for (const [name, body] of [["A", "from A"], ["B", "from B"], ["C", "from C"]] as const) {
      await enterDevice(name);
      const daily = await notes.dailyFolderId();
      await notes.saveNote(id, daily, "28 September 2026", body);
      if (!driveRootId) {
        await notes.connectDrive(`token-${name}`); // first device: establish the "Secure Notes" root and push
        driveRootId = (await vault.loadConfig()).driveFolderId;
      } else {
        // Later devices: link straight to the already-known root and push WITHOUT ever pulling first --
        // reproducing the old duplicate-name bug's Drive state (each device pushing its own version blind).
        await vault.setDriveFolderId(driveRootId);
        await notes.syncPending(`token-${name}`);
      }
    }
    expect(fakeDrive.filter((f) => f.mimeType === "docx")).toHaveLength(3);

    await enterDevice("D");
    await notes.connectDrive("token-d");

    const list = await notes.listNotes();
    expect(list).toHaveLength(3); // nothing dropped

    const titles = list.map((n) => n.title);
    expect(new Set(titles).size).toBe(3); // no two titles collide -- neither locally nor, since Drive filenames come from these, in Drive

    const conflictCopies = list.filter((n) => n.conflictOf);
    expect(conflictCopies).toHaveLength(2);
    for (const copy of conflictCopies) expect(copy.title.startsWith(id)).toBe(true); // still reads as this date, not a locale-formatted title
  });
});
