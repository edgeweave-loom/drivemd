import "fake-indexeddb/auto";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteDrafts, readDraft, writeDraft } from "./drafts.ts";
import type { FileMetadata } from "./drive.ts";
import { FileContent } from "./FileContent.tsx";
import { driveItem, metadata } from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { ACCOUNT, renderWithDrive } from "./test/render.tsx";

const PLAN = metadata(driveItem("plan.md", { id: "plan", parents: ["work"] }), {
  md5Checksum: "aaaa",
  headRevisionId: "revision-1",
});
const utf8 = (text: string) => new TextEncoder().encode(text);

function open(file: FileMetadata = PLAN) {
  const drive = fakeDrive();
  drive.getContent.mockResolvedValue(utf8("- [ ] Boil\n"));
  drive.getMetadata.mockResolvedValue(file);
  drive.keepRevision.mockResolvedValue();
  drive.saveContent.mockResolvedValue(
    metadata(file, { md5Checksum: "bbbb", headRevisionId: "revision-2" }),
  );
  return renderWithDrive(<FileContent file={file} />, drive);
}

function kept(text: string, revision = "revision-1", md5 = "aaaa") {
  return writeDraft(ACCOUNT, {
    fileId: "plan",
    headRevisionId: revision,
    md5Checksum: md5,
    text,
    keptAt: "2026-10-02T09:00:00.000Z",
  });
}

beforeEach(async () => {
  await deleteDrafts(ACCOUNT);
});

describe("unsaved text kept on the device", () => {
  it("is kept as the user edits, with the revision edited", async () => {
    open();
    fireEvent.click(await screen.findByRole("checkbox"));

    await waitFor(async () => {
      expect(await readDraft(ACCOUNT, "plan")).toMatchObject({
        text: "- [x] Boil\n",
        headRevisionId: "revision-1",
        md5Checksum: "aaaa",
      });
    });
  });

  it("is kept at once when the page goes, before the half second is out", async () => {
    const { unmount } = open();
    fireEvent.click(await screen.findByRole("checkbox"));

    unmount();

    await waitFor(async () => {
      expect(await readDraft(ACCOUNT, "plan")).toMatchObject({
        text: "- [x] Boil\n",
      });
    });
  });

  it("is offered back when the note opens again, and restored on a tap", async () => {
    await kept("- [x] Boil\n");
    open();

    expect(
      await screen.findByText(/^You have unsaved changes to this note from /),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    expect(await screen.findByRole("checkbox")).toBeChecked();
    expect(screen.getByText("Unsaved changes")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  });

  it("is forgotten when the user discards it", async () => {
    await kept("- [x] Boil\n");
    open();

    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
    });
    expect(await screen.findByRole("checkbox")).not.toBeChecked();
    await waitFor(async () => {
      expect(await readDraft(ACCOUNT, "plan")).toBeUndefined();
    });
  });

  it("leads to the choice of a conflict when Drive changed the note since", async () => {
    await kept("- [x] Boil\n", "revision-0", "0000");
    const { renew } = open();

    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));

    expect(
      await screen.findByRole("heading", {
        name: "Someone changed this file in Google Drive",
      }),
    ).toBeVisible();
    expect(renew).toHaveBeenCalledOnce();
  });

  it("is forgotten once the note is saved", async () => {
    await kept("- [x] Boil\n");
    const { drive } = open();
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));

    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(drive.saveContent).toHaveBeenCalledOnce();
    });
    await waitFor(async () => {
      expect(await readDraft(ACCOUNT, "plan")).toBeUndefined();
    });
  });

  it("is not offered when it holds the note's own text", async () => {
    await kept("- [ ] Boil\n");
    open();

    expect(await screen.findByRole("checkbox")).toBeVisible();
    await new Promise((settle) => setTimeout(settle, 50));
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  });

  it("is not needed to edit, on a device that keeps nothing", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new DOMException("Blocked", "SecurityError");
      },
    });
    open();

    fireEvent.click(await screen.findByRole("checkbox"));

    expect(screen.getByText("Unsaved changes")).toBeVisible();
    await new Promise((settle) => setTimeout(settle, 700));
    vi.unstubAllGlobals();
  });
});
