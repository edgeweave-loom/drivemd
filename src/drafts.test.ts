import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  countDrafts,
  deleteDraft,
  deleteDraftHolding,
  deleteDrafts,
  listDrafts,
  readDraft,
  writeDraft,
  type Draft,
} from "./drafts.ts";

const ADA = "ada@example.com";
const GRACE = "grace@example.com";

function draft(
  fileId: string,
  text = "- [x] Boil\r\n",
  keptAt = "2026-10-02T09:00:00.000Z",
): Draft {
  return {
    fileId,
    name: `${fileId}.md`,
    resourceKey: undefined,
    headRevisionId: "revision-1",
    md5Checksum: "aaaa",
    text,
    keptAt,
  };
}

beforeEach(async () => {
  await deleteDrafts(ADA);
  await deleteDrafts(GRACE);
});

describe("drafts", () => {
  it("keeps a note's unsaved text on the device, for its account only", async () => {
    await writeDraft(ADA, draft("plan"));

    await expect(readDraft(ADA, "plan")).resolves.toEqual(draft("plan"));
    await expect(readDraft(GRACE, "plan")).resolves.toBeUndefined();
    await expect(readDraft(ADA, "other")).resolves.toBeUndefined();
  });

  it("keeps the latest text of a note", async () => {
    await writeDraft(ADA, draft("plan", "one"));
    await writeDraft(ADA, draft("plan", "two"));

    await expect(readDraft(ADA, "plan")).resolves.toMatchObject({
      text: "two",
    });
    await expect(countDrafts(ADA)).resolves.toBe(1);
  });

  it("forgets one note's text once it is saved or dropped", async () => {
    await writeDraft(ADA, draft("plan"));
    await writeDraft(ADA, draft("notes"));

    await deleteDraft(ADA, "plan");

    await expect(readDraft(ADA, "plan")).resolves.toBeUndefined();
    await expect(countDrafts(ADA)).resolves.toBe(1);
  });

  it("forgets a note's text only while the device still holds that text", async () => {
    await writeDraft(ADA, draft("plan", "newer"));

    await deleteDraftHolding(ADA, "plan", "older");
    await expect(readDraft(ADA, "plan")).resolves.toMatchObject({
      text: "newer",
    });
    await deleteDraftHolding(ADA, "plan", "newer");
    await expect(readDraft(ADA, "plan")).resolves.toBeUndefined();
  });

  it("counts and forgets an account's texts, leaving others'", async () => {
    await writeDraft(ADA, draft("plan"));
    await writeDraft(ADA, draft("notes"));
    await writeDraft(GRACE, draft("plan"));

    await expect(countDrafts(ADA)).resolves.toBe(2);
    await deleteDrafts(ADA);

    await expect(countDrafts(ADA)).resolves.toBe(0);
    await expect(readDraft(GRACE, "plan")).resolves.toEqual(draft("plan"));
  });

  it("lists an account's notes with unsaved text, the one kept last first, without their text", async () => {
    await writeDraft(ADA, draft("plan", "one", "2026-10-02T09:00:00.000Z"));
    await writeDraft(ADA, {
      ...draft("shared", "two", "2026-10-03T09:00:00.000Z"),
      resourceKey: "key-1",
    });
    await writeDraft(ADA, draft("notes", "three", "2026-10-01T09:00:00.000Z"));
    await writeDraft(GRACE, draft("other"));

    await expect(listDrafts(ADA)).resolves.toStrictEqual([
      {
        fileId: "shared",
        name: "shared.md",
        resourceKey: "key-1",
        keptAt: "2026-10-03T09:00:00.000Z",
      },
      {
        fileId: "plan",
        name: "plan.md",
        resourceKey: undefined,
        keptAt: "2026-10-02T09:00:00.000Z",
      },
      {
        fileId: "notes",
        name: "notes.md",
        resourceKey: undefined,
        keptAt: "2026-10-01T09:00:00.000Z",
      },
    ]);
    await expect(listDrafts(GRACE)).resolves.toMatchObject([
      { fileId: "other" },
    ]);
  });

  it("fails when the device keeps nothing, as in some private windows", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        const request = { error: null } as unknown as IDBOpenDBRequest;
        queueMicrotask(() => {
          request.onerror?.call(request, new Event("error"));
        });
        return request;
      },
    });

    await expect(writeDraft(ADA, draft("plan"))).rejects.toThrow(
      "IndexedDB did not open",
    );
    vi.unstubAllGlobals();
  });
});
