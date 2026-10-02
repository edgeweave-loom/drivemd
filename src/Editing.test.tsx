import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DriveError, type FileMetadata } from "./drive.ts";
import { FileContent } from "./FileContent.tsx";
import { driveItem, metadata } from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { renderWithDrive } from "./test/render.tsx";

const PLAN = metadata(driveItem("plan.md", { id: "plan" }), {
  md5Checksum: "aaaa",
  headRevisionId: "revision-1",
});
const SAVED = metadata(PLAN, {
  md5Checksum: "bbbb",
  headRevisionId: "revision-2",
});
const TASKS = "- [ ] Boil\n- [x] Pour\n";

const utf8 = (text: string) => new TextEncoder().encode(text);

function open(text = TASKS, file: FileMetadata = PLAN) {
  const drive = fakeDrive();
  drive.getContent.mockResolvedValue(utf8(text));
  drive.getMetadata.mockResolvedValue(file);
  drive.keepRevision.mockResolvedValue();
  drive.saveContent.mockResolvedValue(SAVED);
  return renderWithDrive(<FileContent file={file} />, drive);
}

async function boxes() {
  return screen.findAllByRole<HTMLInputElement>("checkbox");
}

async function box(index: number) {
  const found = (await boxes())[index];
  if (!found) throw new Error(`No checkbox ${String(index)}`);
  return found;
}

describe("editing a note in the viewer", () => {
  it("checks a task with a tap, changing only its mark, and offers to save", async () => {
    open();
    fireEvent.click(await box(0));

    expect((await boxes()).map((box) => box.checked)).toEqual([true, true]);
    expect(screen.getByText("Unsaved changes")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeVisible();
  });

  it("has nothing to save once the task is back as it was", async () => {
    open();

    fireEvent.click(await box(1));
    fireEvent.click(await box(1));

    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("saves the bytes after checking for others' changes, keeping the first revision", async () => {
    const { drive, renew } = open();

    fireEvent.click(await box(0));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.queryByText("Unsaved changes")).toBeNull();
    });
    expect(renew).toHaveBeenCalledOnce();
    expect(drive.keepRevision).toHaveBeenCalledExactlyOnceWith(
      PLAN,
      "revision-1",
    );
    expect(drive.saveContent).toHaveBeenCalledExactlyOnceWith(
      PLAN,
      utf8("- [x] Boil\n- [x] Pour\n"),
    );
    expect((await boxes()).map((box) => box.checked)).toEqual([true, true]);
    expect(drive.getContent).toHaveBeenCalledOnce();

    // The next save writes over the revision just saved, and keeps none.
    drive.getMetadata.mockResolvedValue(SAVED);
    fireEvent.click(await box(1));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(drive.saveContent).toHaveBeenCalledTimes(2);
    });
    expect(drive.saveContent).toHaveBeenLastCalledWith(
      SAVED,
      utf8("- [x] Boil\n- [ ] Pour\n"),
    );
    expect(drive.keepRevision).toHaveBeenCalledOnce();
  });

  it("follows Drive's revisions again once the page hears of the one saved", async () => {
    const { drive, rerender } = open();
    fireEvent.click(await box(0));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.queryByText("Unsaved changes")).toBeNull();
    });

    rerender(<FileContent file={SAVED} />);
    drive.getContent.mockResolvedValue(utf8("- [ ] Serve\n"));
    rerender(
      <FileContent file={metadata(SAVED, { headRevisionId: "revision-3" })} />,
    );

    expect(await screen.findByText("Serve")).toBeVisible();
  });

  it("saves with Cmd or Ctrl+S, and never lets the browser save the page", async () => {
    const { drive, renew } = open();
    fireEvent.click(await box(0));

    const ctrl = fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => {
      expect(drive.saveContent).toHaveBeenCalledOnce();
    });
    expect(ctrl).toBe(false);
    expect(renew).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.queryByText("Unsaved changes")).toBeNull();
    });

    // Nothing left to save: the shortcut does nothing, but the browser's.
    expect(fireEvent.keyDown(window, { key: "S", ctrlKey: true })).toBe(false);
    expect(fireEvent.keyDown(window, { key: "s" })).toBe(true);
    // A layout that is not Latin: the key is the one where S is.
    expect(
      fireEvent.keyDown(window, { key: "ы", code: "KeyS", ctrlKey: true }),
    ).toBe(false);
    // Autofill sends keydown events without a key.
    expect(fireEvent.keyDown(window, { ctrlKey: true })).toBe(true);
    expect(
      fireEvent.keyDown(window, { key: "s", ctrlKey: true, altKey: true }),
    ).toBe(true);
    expect(drive.saveContent).toHaveBeenCalledOnce();
  });

  it("writes back a byte order mark and CRLF line breaks as they were", async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const drive = fakeDrive();
    drive.getContent.mockResolvedValue(
      new Uint8Array([...bom, ...utf8("# Tea\r\n\r\n- [ ] Boil\r\n")]),
    );
    drive.getMetadata.mockResolvedValue(PLAN);
    drive.keepRevision.mockResolvedValue();
    drive.saveContent.mockResolvedValue(SAVED);
    renderWithDrive(<FileContent file={PLAN} />, drive);

    fireEvent.click(await box(0));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(drive.saveContent).toHaveBeenCalledExactlyOnceWith(
        PLAN,
        new Uint8Array([...bom, ...utf8("# Tea\r\n\r\n- [x] Boil\r\n")]),
      );
    });
  });

  it("writes nothing when someone else changed the file, keeping the edits", async () => {
    const { drive } = open();
    drive.getMetadata.mockResolvedValue(
      metadata(PLAN, { md5Checksum: "cccc" }),
    );

    fireEvent.click(await box(0));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByRole("heading", {
        name: "Someone changed this file in Google Drive",
      }),
    ).toBeVisible();
    expect(drive.saveContent).not.toHaveBeenCalled();
    expect(await box(0)).toBeChecked();
  });

  it("says why Drive refused, keeping the edits", async () => {
    const { drive } = open();
    drive.saveContent.mockRejectedValue(
      new DriveError(403, "Rate limit exceeded"),
    );

    fireEvent.click(await box(0));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Google Drive refused the request: Rate limit exceeded",
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(await box(0)).toBeChecked();
  });

  it.each([
    [
      "the user cannot edit",
      TASKS,
      metadata(PLAN, {
        capabilities: { ...PLAN.capabilities, canModifyContent: false },
      }),
    ],
    ["it is locked", TASKS, metadata(PLAN, { locked: true })],
    ["its line breaks mix", "- [ ] Boil\r\n- [x] Pour\n", PLAN],
  ])("leaves the tasks alone in a file %s", async (_, text, file) => {
    open(text, file);

    for (const box of await boxes()) expect(box).toBeDisabled();
  });

  it.each([
    ["not UTF-8", new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x0a])],
    ["UTF-16 without its mark", new Uint8Array([0x61, 0x00, 0x0a, 0x00])],
  ])("never offers to save a file it only shows, %s", async (_, bytes) => {
    const drive = fakeDrive();
    drive.getContent.mockResolvedValue(bytes);
    renderWithDrive(<FileContent file={PLAN} />, drive);

    expect(await screen.findByText(/DriveMD only shows it/)).toBeVisible();
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("offers no Save once the user may no longer edit the file", async () => {
    const { rerender } = open();
    fireEvent.click(await box(0));

    rerender(<FileContent file={metadata(PLAN, { locked: true })} />);

    expect(await screen.findByText("Locked")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("leaves alone a checkbox written in HTML within a task", async () => {
    open('- [ ] Buy <input type="checkbox"> milk\n');

    expect(await box(0)).toBeEnabled();
    expect(await box(1)).toBeDisabled();
  });

  it("keeps a task ticked while a save runs", async () => {
    const { drive } = open();
    let answer: (saved: typeof SAVED) => void = () => undefined;
    drive.saveContent.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    fireEvent.click(await box(0));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: "Saving…" });

    fireEvent.click(await box(1));
    answer(SAVED);

    await screen.findByRole("button", { name: "Save" });
    expect((await boxes()).map((one) => one.checked)).toEqual([true, false]);
    expect(screen.getByText("Unsaved changes")).toBeVisible();
    expect(drive.saveContent).toHaveBeenCalledExactlyOnceWith(
      PLAN,
      utf8("- [x] Boil\n- [x] Pour\n"),
    );
  });

  it("follows Drive again once the edits are undone by hand", async () => {
    const { drive, rerender } = open();
    fireEvent.click(await box(0));
    fireEvent.click(await box(0));

    drive.getContent.mockResolvedValue(utf8("- [ ] Serve\n"));
    rerender(<FileContent file={SAVED} />);

    expect(await screen.findByText("Serve")).toBeVisible();
  });

  it("keeps the revision someone else made since the last save, before writing over it", async () => {
    const { drive, rerender } = open();
    fireEvent.click(await box(0));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.queryByText("Unsaved changes")).toBeNull();
    });
    rerender(<FileContent file={SAVED} />);

    const theirs = metadata(SAVED, {
      md5Checksum: "cccc",
      headRevisionId: "revision-3",
    });
    drive.getContent.mockResolvedValue(utf8("- [ ] Serve\n"));
    drive.getMetadata.mockResolvedValue(theirs);
    rerender(<FileContent file={theirs} />);
    await screen.findByText("Serve");
    fireEvent.click(await box(0));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(drive.saveContent).toHaveBeenCalledTimes(2);
    });
    expect(drive.keepRevision).toHaveBeenLastCalledWith(theirs, "revision-3");
    expect(drive.keepRevision).toHaveBeenCalledTimes(2);
  });

  it("leaves alone a task list written in HTML", async () => {
    open(
      '<ul><li class="task-list-item"><input type="checkbox"> Boil</li></ul>',
    );

    expect(await box(0)).toBeDisabled();
  });

  it("shows Drive's newer revision while nothing is edited, and keeps the edits otherwise", async () => {
    const { drive, rerender } = open();
    drive.getContent.mockResolvedValue(
      utf8("- [ ] Boil\n- [ ] Pour\n- [ ] Serve\n"),
    );

    rerender(<FileContent file={SAVED} />);
    expect(await screen.findByText("Serve")).toBeVisible();

    fireEvent.click(await box(0));
    rerender(
      <FileContent file={metadata(PLAN, { headRevisionId: "revision-3" })} />,
    );
    expect(screen.getByText("Serve")).toBeVisible();
    expect(await box(0)).toBeChecked();
    expect(drive.getContent).toHaveBeenCalledTimes(2);
  });
});
