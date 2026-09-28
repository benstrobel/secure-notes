import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import * as vault from "./vault";
import * as notes from "./notes";
import { resetConnectionForTests } from "./db";
import { ROOT_FOLDER_ID } from "./types";

// Fresh in-memory IndexedDB per test so vault setup state doesn't leak across tests.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetConnectionForTests();
});

describe("vault + notes", () => {
  it("sets up, unlocks, and rejects the wrong password", async () => {
    await vault.setUp("hunter2");
    vault.lock();

    expect(await vault.unlock("wrong")).toBe(false);
    expect(await vault.unlock("hunter2")).toBe(true);
  });

  it("creates the default Daily folder at setup", async () => {
    await vault.setUp("hunter2");
    const folders = await notes.listFolders();
    expect(folders).toHaveLength(1);
    expect(folders[0].name).toBe("Daily");
    expect(await notes.dailyFolderId()).toBe(folders[0].id);
  });

  it("today's entry is not created just by looking at it", async () => {
    await vault.setUp("hunter2");
    const id = notes.todayNoteId();
    expect(await notes.findNote(id)).toBeNull();
    expect(await notes.listNotes()).toHaveLength(0);
  });

  it("saving today's entry creates it; re-saving updates the same note", async () => {
    await vault.setUp("hunter2");
    const daily = await notes.dailyFolderId();
    const id = notes.todayNoteId();

    const created = await notes.saveNote(id, daily, "28 September 2026", "First thought.");
    expect(created.id).toBe(id);

    const list1 = await notes.listNotes();
    expect(list1).toHaveLength(1);

    const updated = await notes.saveNote(id, daily, "28 September 2026", "First thought.\nSecond thought.");
    expect(updated.createdAt).toBe(created.createdAt);
    expect((await notes.listNotes())).toHaveLength(1);

    const loaded = await notes.findNote(id);
    expect(loaded?.body).toBe("First thought.\nSecond thought.");
  });

  it("creates a regular note in a user-chosen folder", async () => {
    await vault.setUp("hunter2");
    const work = await notes.createFolder("Work", ROOT_FOLDER_ID);
    const note = await notes.saveNote(crypto.randomUUID(), work.id, "Meeting notes", "Discuss roadmap");

    const loaded = await notes.findNote(note.id);
    expect(loaded?.folderId).toBe(work.id);
    expect(loaded?.title).toBe("Meeting notes");
  });

  it("supports nested folders", async () => {
    await vault.setUp("hunter2");
    const work = await notes.createFolder("Work", ROOT_FOLDER_ID);
    const projectX = await notes.createFolder("Project X", work.id);
    expect(projectX.parentId).toBe(work.id);

    const folders = await notes.listFolders();
    expect(folders.map((f) => f.name).sort()).toEqual(["Daily", "Project X", "Work"]);
  });

  it("deletes a note", async () => {
    await vault.setUp("hunter2");
    const id = crypto.randomUUID();
    await notes.saveNote(id, ROOT_FOLDER_ID, "Temp", "Body");
    expect(await notes.listNotes()).toHaveLength(1);

    await notes.deleteNote(id);
    expect(await notes.listNotes()).toHaveLength(0);
    expect(await notes.findNote(id)).toBeNull();
  });

  it("refuses to delete a non-empty folder", async () => {
    await vault.setUp("hunter2");
    const folder = await notes.createFolder("Has notes", ROOT_FOLDER_ID);
    await notes.saveNote(crypto.randomUUID(), folder.id, "Note", "Body");

    expect(await notes.deleteFolder(folder.id)).toBe(false);
    expect(await notes.listFolders()).toContainEqual(expect.objectContaining({ id: folder.id }));
  });

  it("deletes an empty folder", async () => {
    await vault.setUp("hunter2");
    const folder = await notes.createFolder("Empty", ROOT_FOLDER_ID);
    expect(await notes.deleteFolder(folder.id)).toBe(true);
    expect(await notes.listFolders()).not.toContainEqual(expect.objectContaining({ id: folder.id }));
  });

  it("changes the password and re-encrypts existing notes", async () => {
    // Several docx encrypt/decrypt passes in one test, each with a real
    // ~1s spin-count KDF -- default 5s timeout is too tight here.
    await vault.setUp("old-password");
    const id = crypto.randomUUID();
    await notes.saveNote(id, ROOT_FOLDER_ID, "Secret", "Sensitive content");

    const ok = await notes.changePassword("old-password", "new-password");
    expect(ok).toBe(true);

    // Old password no longer works; the vault must be unlocked with the new one to read notes.
    vault.lock();
    expect(await vault.unlock("old-password")).toBe(false);
    expect(await vault.unlock("new-password")).toBe(true);

    const loaded = await notes.findNote(id);
    expect(loaded?.body).toBe("Sensitive content");
  }, 15000);

  it("rejects a password change started with the wrong current password", async () => {
    await vault.setUp("hunter2");
    await notes.saveNote(crypto.randomUUID(), ROOT_FOLDER_ID, "Note", "Body");
    expect(await notes.changePassword("wrong-current", "new-password")).toBe(false);
    expect(await vault.unlock("hunter2")).toBe(true);
  });
});
