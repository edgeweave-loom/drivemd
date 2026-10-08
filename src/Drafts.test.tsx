import "fake-indexeddb/auto";
import { EditorView } from "@codemirror/view";
import { onlineManager } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rememberAccount, signOut } from "./auth.ts";
import { deleteDrafts, readDraft, writeDraft } from "./drafts.ts";
import { resumeKeeping } from "./keep-draft.ts";
import type { FileMetadata } from "./drive.ts";
import { FileContent } from "./FileContent.tsx";
import { metadataQuery } from "./queries.ts";
import { driveItem, metadata } from "./test/drive-items.ts";
import { editInPreview, pickMode } from "./test/actions.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { ACCOUNT, renderWithDrive } from "./test/render.tsx";
import { holdScreen } from "./test/screen.ts";

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
    name: "plan.md",
    resourceKey: undefined,
    headRevisionId: revision,
    md5Checksum: md5,
    text,
    keptAt: "2026-10-02T09:00:00.000Z",
  });
}

beforeEach(async () => {
  // Signed in, as the navigator's Sign out button has it.
  resumeKeeping();
  rememberAccount(ACCOUNT);
  await deleteDrafts(ACCOUNT);
});

afterEach(() => {
  onlineManager.setOnline(true);
});

describe("unsaved text kept on the device", () => {
  it("is kept as the user edits, with the revision edited and the note's name", async () => {
    open({ ...PLAN, resourceKey: "key-1" });
    await editInPreview();
    fireEvent.click(await screen.findByRole("checkbox"));

    await waitFor(async () => {
      expect(await readDraft(ACCOUNT, "plan")).toMatchObject({
        name: "plan.md",
        resourceKey: "key-1",
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

  it.each([
    ["once kept", 700],
    ["while waiting to be kept", 50],
  ])("is forgotten when the edits are undone by hand, %s", async (_, wait) => {
    const { unmount } = open();
    await editInPreview();
    fireEvent.click(await screen.findByRole("checkbox"));
    await new Promise((settle) => setTimeout(settle, wait));
    fireEvent.click(screen.getByRole("checkbox"));

    unmount();

    await new Promise((settle) => setTimeout(settle, 700));
    await expect(readDraft(ACCOUNT, "plan")).resolves.toBeUndefined();
  });

  it("keeps edits made during a save that ends once the page has gone", async () => {
    const drive = fakeDrive();
    drive.getContent.mockResolvedValue(utf8("- [ ] Boil\n- [ ] Pour\n"));
    drive.getMetadata.mockResolvedValue(PLAN);
    drive.keepRevision.mockResolvedValue();
    let answer: (saved: FileMetadata) => void = () => undefined;
    drive.saveContent.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { unmount } = renderWithDrive(<FileContent file={PLAN} />, drive);
    await editInPreview();
    const [boil] = await screen.findAllByRole("checkbox");
    if (boil) fireEvent.click(boil);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: "Saving…" });
    const [, pour] = screen.getAllByRole("checkbox");
    if (pour) fireEvent.click(pour);

    unmount();
    answer(
      metadata(PLAN, { md5Checksum: "bbbb", headRevisionId: "revision-2" }),
    );

    await new Promise((settle) => setTimeout(settle, 700));
    await expect(readDraft(ACCOUNT, "plan")).resolves.toMatchObject({
      text: "- [x] Boil\n- [x] Pour\n",
    });
  });

  it("is not kept once the account signed out in another tab", async () => {
    const { unmount } = open();
    fireEvent.click(await screen.findByRole("checkbox"));

    signOut();
    window.dispatchEvent(
      new StorageEvent("storage", { key: "drivemd.account", newValue: null }),
    );
    unmount();

    await new Promise((settle) => setTimeout(settle, 700));
    await expect(readDraft(ACCOUNT, "plan")).resolves.toBeUndefined();
  });

  it("is kept when the browser refuses its local storage", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Refused", "SecurityError");
    });
    const { unmount } = open();
    fireEvent.click(await screen.findByRole("checkbox"));

    unmount();

    vi.restoreAllMocks();
    await waitFor(async () => {
      expect(await readDraft(ACCOUNT, "plan")).toBeDefined();
    });
  });

  it("is offered back when the note opens again, and restored on a tap", async () => {
    await kept("- [x] Boil\n");
    open();

    expect(
      await screen.findByText(/^You have unsaved changes to this note from /),
    ).toBeVisible();
    // Save keeps its place meanwhile, with nothing to save yet.
    expect(screen.getByRole("button", { name: "Saved" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    expect(await screen.findByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("button", { name: "Save" })).toBeVisible();
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
    const { drive } = open();

    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
    // Restoring writes nothing: the user saves, and sees what Drive holds.
    await new Promise((settle) => setTimeout(settle, 50));
    expect(drive.getMetadata).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    expect(
      await screen.findByRole("heading", {
        name: "Someone changed this file in Google Drive",
      }),
    ).toBeVisible();
    expect(drive.saveContent).not.toHaveBeenCalled();
  });

  it("waits for the user's answer before any edit, and restores into the editor", async () => {
    holdScreen("wide");
    await kept("- [x] Boil\n");
    open();

    await screen.findByRole("button", { name: "Restore" });
    expect(
      screen.queryByRole("button", { name: /^(Edit|Editing|Viewing)$/ }),
    ).toBeNull();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await pickMode("Editing");

    await waitFor(() => {
      const content = document
        .querySelector(".editor")
        ?.shadowRoot?.querySelector<HTMLElement>(".cm-content");
      const view = content && EditorView.findFromDOM(content);
      expect(view?.state.sliceDoc()).toBe("- [x] Boil\n");
    });
  });

  it("is offered again on coming back to the note soon after", async () => {
    const { rerender } = open();
    fireEvent.click(await screen.findByRole("checkbox"));
    // Elsewhere in the app, with the same cache.
    rerender(<p>Elsewhere</p>);
    await waitFor(async () => {
      expect(await readDraft(ACCOUNT, "plan")).toBeDefined();
    });

    rerender(<FileContent file={PLAN} />);

    expect(
      await screen.findByRole("button", { name: "Restore" }),
    ).toBeVisible();
  });

  it("is offered again while the device is offline, before an edit replaces it", async () => {
    const { rerender } = open();
    await screen.findByRole("checkbox");
    rerender(<p>Elsewhere</p>);
    await kept("- [x] Boil\n");
    onlineManager.setOnline(false);

    // The note shows from the cache.
    rerender(<FileContent file={PLAN} />);

    expect(
      await screen.findByRole("button", { name: "Restore" }),
    ).toBeVisible();
  });

  it("is not forgotten for Drive's text when another tab kept newer text since", async () => {
    const saved = metadata(PLAN, {
      md5Checksum: "bbbb",
      headRevisionId: "revision-2",
    });
    const drive = fakeDrive();
    drive.getMetadata.mockResolvedValue(saved);
    drive.getContent.mockImplementation((file) =>
      Promise.resolve(
        utf8(
          file.headRevisionId === "revision-2"
            ? "- [x] Boil\n"
            : "- [ ] Boil\n",
        ),
      ),
    );
    await kept("- [x] Boil\n");
    const { rerender } = renderWithDrive(<FileContent file={PLAN} />, drive);
    await screen.findByRole("button", { name: "Restore" });
    // Another tab saved that text, then typed on.
    await kept("- [x] Boil\n- [ ] Pour\n");

    rerender(<FileContent file={saved} />);

    expect(
      await screen.findByRole("button", { name: "Restore" }),
    ).toBeVisible();
    await expect(readDraft(ACCOUNT, "plan")).resolves.toMatchObject({
      text: "- [x] Boil\n- [ ] Pour\n",
    });
  });

  it("is not forgotten for a revision the page shows from its cache, older than Drive's", async () => {
    // Saved as revision 2 elsewhere, then edited back to revision 1's text.
    await kept("- [ ] Boil\n", "revision-2", "bbbb");
    const { drive, client } = open();
    // As the file's page left it, fresh for half a minute as in the app.
    client.setDefaultOptions({ queries: { retry: false, staleTime: 30_000 } });
    client.setQueryData(metadataQuery(drive, PLAN).queryKey, PLAN);
    drive.getMetadata.mockResolvedValue(
      metadata(PLAN, { md5Checksum: "bbbb", headRevisionId: "revision-2" }),
    );

    await screen.findByRole("checkbox");
    await new Promise((settle) => setTimeout(settle, 100));
    await expect(readDraft(ACCOUNT, "plan")).resolves.toMatchObject({
      text: "- [ ] Boil\n",
    });
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

  it("is forgotten, not offered, when it holds the note's own text", async () => {
    await kept("- [ ] Boil\n");
    open();

    expect(await screen.findByRole("checkbox")).toBeVisible();
    await waitFor(async () => {
      expect(await readDraft(ACCOUNT, "plan")).toBeUndefined();
    });
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  });

  it("is not needed to edit, on a device that keeps nothing", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new DOMException("Blocked", "SecurityError");
      },
    });
    open();

    await editInPreview();
    fireEvent.click(await screen.findByRole("checkbox"));

    expect(screen.getByRole("button", { name: "Save" })).toBeVisible();
    await new Promise((settle) => setTimeout(settle, 700));
    vi.unstubAllGlobals();
  });
});
