import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import * as vault from "./vault";
import * as notes from "./notes";
import { resetConnectionForTests } from "./db";
import { exportVaultZip, importVaultZip } from "./zipBackup";
import { ROOT_FOLDER_ID } from "./types";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetConnectionForTests();
});

describe("zip backup", () => {
  it(
    "exports and re-imports the whole vault, including nested folders",
    async () => {
      await vault.setUp("hunter2");
      const daily = await notes.dailyFolderId();
      const work = await notes.createFolder("Work", ROOT_FOLDER_ID);
      const projectX = await notes.createFolder("Project X", work.id);

      await notes.saveNote(notes.todayNoteId(), daily, "Today", "Diary content");
      await notes.saveNote(crypto.randomUUID(), projectX.id, "Kickoff notes", "Discuss scope");

      const zipBlob = await exportVaultZip();
      const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());

      // Fresh empty vault, same password, restoring from just the zip.
      globalThis.indexedDB = new IDBFactory();
      resetConnectionForTests();
      await vault.setUp("hunter2");

      const result = await importVaultZip(zipBytes, "hunter2");
      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(0);

      const restoredNotes = await notes.listNotes();
      expect(restoredNotes).toHaveLength(2);
      const restoredFolders = await notes.listFolders();
      expect(restoredFolders.map((f) => f.name).sort()).toEqual(["Daily", "Project X", "Work"]);

      const diaryNote = restoredNotes.find((n) => n.title === "Today");
      const loaded = await notes.findNote(diaryNote!.id);
      expect(loaded?.body).toBe("Diary content");
    },
    20000,
  );

  it(
    "skips files that don't decrypt with the given password",
    async () => {
      await vault.setUp("hunter2");
      await notes.saveNote(crypto.randomUUID(), ROOT_FOLDER_ID, "Note", "Body");
      const zipBlob = await exportVaultZip();
      const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());

      const result = await importVaultZip(zipBytes, "wrong-password");
      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
    },
    10000,
  );
});
