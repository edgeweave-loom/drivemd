import { vi, type Mock } from "vitest";
import type { Drive } from "../drive.ts";

export type FakeDrive = { [Call in keyof Drive]: Mock<Drive[Call]> };

/** A Drive whose calls fail until a test says what they answer. */
export function fakeDrive(): FakeDrive {
  const unanswered = () =>
    Promise.reject(new Error("The test set no answer for this Drive call"));
  return {
    getMetadata: vi.fn<Drive["getMetadata"]>(unanswered),
    getContent: vi.fn<Drive["getContent"]>(unanswered),
    listChildren: vi.fn<Drive["listChildren"]>(unanswered),
    listFolders: vi.fn<Drive["listFolders"]>(unanswered),
    listSharedDrives: vi.fn<Drive["listSharedDrives"]>(unanswered),
    listSharedWithMe: vi.fn<Drive["listSharedWithMe"]>(unanswered),
    listRecent: vi.fn<Drive["listRecent"]>(unanswered),
    search: vi.fn<Drive["search"]>(unanswered),
    findByName: vi.fn<Drive["findByName"]>(unanswered),
    findVaults: vi.fn<Drive["findVaults"]>(unanswered),
    findVaultConfigs: vi.fn<Drive["findVaultConfigs"]>(unanswered),
    listShortcuts: vi.fn<Drive["listShortcuts"]>(unanswered),
    checkShortcut: vi.fn<Drive["checkShortcut"]>(unanswered),
    saveContent: vi.fn<Drive["saveContent"]>(unanswered),
    keepRevision: vi.fn<Drive["keepRevision"]>(unanswered),
    markViewed: vi.fn<Drive["markViewed"]>(unanswered),
    createFile: vi.fn<Drive["createFile"]>(unanswered),
    renameFile: vi.fn<Drive["renameFile"]>(unanswered),
    moveFile: vi.fn<Drive["moveFile"]>(unanswered),
    trashFile: vi.fn<Drive["trashFile"]>(unanswered),
  };
}
