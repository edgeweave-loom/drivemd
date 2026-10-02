import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  countDrafts,
  deleteDraft,
  deleteDrafts,
  readDraft,
  writeDraft,
  type Draft,
} from "./drafts.ts";

const ADA = "ada@example.com";
const GRACE = "grace@example.com";

function draft(fileId: string, text = "- [x] Boil\r\n"): Draft {
  return {
    fileId,
    headRevisionId: "revision-1",
    md5Checksum: "aaaa",
    text,
    keptAt: "2026-10-02T09:00:00.000Z",
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

  it("counts and forgets an account's texts, leaving others'", async () => {
    await writeDraft(ADA, draft("plan"));
    await writeDraft(ADA, draft("notes"));
    await writeDraft(GRACE, draft("plan"));

    await expect(countDrafts(ADA)).resolves.toBe(2);
    await deleteDrafts(ADA);

    await expect(countDrafts(ADA)).resolves.toBe(0);
    await expect(readDraft(GRACE, "plan")).resolves.toEqual(draft("plan"));
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
