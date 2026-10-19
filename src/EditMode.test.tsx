import { EditorView } from "@codemirror/view";
import { onlineManager } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DriveError, type FileMetadata } from "./drive.ts";
import { FileContent } from "./FileContent.tsx";
import { driveItem, metadata } from "./test/drive-items.ts";
import { pickMode } from "./test/actions.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { renderWithDrive } from "./test/render.tsx";
import { holdScreen } from "./test/screen.ts";

const PLAN = metadata(driveItem("plan.md", { id: "plan" }));
const utf8 = (text: string) => new TextEncoder().encode(text);

function open(file: FileMetadata = PLAN, text = "# Tea\r\n\r\n- [ ] Boil\r\n") {
  const drive = fakeDrive();
  drive.getContent.mockResolvedValue(utf8(text));
  drive.getMetadata.mockResolvedValue(file);
  drive.keepRevision.mockResolvedValue();
  drive.saveContent.mockResolvedValue(
    metadata(file, { headRevisionId: "revision-2" }),
  );
  return renderWithDrive(<FileContent file={file} />, drive);
}

/** The editor, once it has loaded, in its shadow root. */
async function editor() {
  return waitFor(() => {
    const source = document
      .querySelector(".editor")
      ?.shadowRoot?.querySelector<HTMLElement>(
        '[aria-label="Markdown source"]',
      );
    const view = source && EditorView.findFromDOM(source);
    if (!view) throw new Error("No editor yet");
    return view;
  });
}

function editorShown() {
  return document.querySelector(".editor") !== null;
}

function type(view: EditorView, text: string) {
  act(() => {
    view.dispatch({ changes: { from: view.state.doc.length, insert: text } });
  });
}

describe("editing a note's source", () => {
  it("is offered for a file the user may edit only", async () => {
    open();
    expect(await screen.findByRole("button", { name: "Edit" })).toBeVisible();
  });

  it.each([
    [
      "view only",
      metadata(PLAN, {
        capabilities: { ...PLAN.capabilities, canModifyContent: false },
      }),
    ],
    ["locked", metadata(PLAN, { locked: true })],
  ])("is not offered for a file that is %s", async (_, file) => {
    open(file);

    expect(await screen.findByRole("heading", { name: "Tea" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("shows the source beside the preview on a wide screen, and saves it", async () => {
    holdScreen("wide");
    const { drive } = open();
    await pickMode("Source");

    const view = await editor();
    expect(view.state.sliceDoc()).toBe("# Tea\r\n\r\n- [ ] Boil\r\n");
    type(view, "\r\nGreen.");
    expect(
      screen.getByText("Green.", { selector: ".markdown p" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(drive.saveContent).toHaveBeenCalledExactlyOnceWith(
        PLAN,
        utf8("# Tea\r\n\r\n- [ ] Boil\r\n\r\nGreen."),
      );
    });
  });

  it("names the source and the preview on a wide screen, keeping the note shown", async () => {
    holdScreen("wide");
    open();
    await screen.findByRole("heading", { name: "Tea" });
    const shown = document.querySelector(".markdown");
    await pickMode("Source");
    await editor();

    // As regions, which leave the note's own headings as they are.
    const [source, preview] = screen.getAllByRole("region");
    expect(source).toHaveAccessibleName("Markdown");
    expect(preview).toHaveAccessibleName("Preview");
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    // As it was, its folded parts too, rather than drawn anew.
    expect(document.querySelector(".markdown")).toBe(shown);
  });

  it("brings a task tapped in the preview into the source", async () => {
    holdScreen("wide");
    open();
    await pickMode("Source");
    const view = await editor();

    fireEvent.click(screen.getByRole("checkbox"));

    expect(view.state.sliceDoc()).toBe("# Tea\r\n\r\n- [x] Boil\r\n");
  });

  it("switches between Visual, Source and the preview on a phone", async () => {
    holdScreen("phone");
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const view = await editor();
    type(view, "\r\nGreen.");

    expect(screen.queryByRole("heading", { name: "Tea" })).toBeNull();
    // The switch names what shows, which needs no label of its own.
    expect(screen.queryByRole("region", { name: "Markdown" })).toBeNull();
    const show = screen.getByRole("group", { name: "Show" });
    const visual = within(show).getByRole("button", { name: "Visual" });
    const source = within(show).getByRole("button", { name: "Source" });
    const preview = within(show).getByRole("button", { name: "Preview" });
    expect(visual).toHaveAttribute("aria-pressed", "true");
    expect(source).toHaveAttribute("aria-pressed", "false");
    expect(preview).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(source);
    expect(await editor()).toBe(view);
    expect(source).toHaveAttribute("aria-pressed", "true");
    expect(visual).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(preview);
    expect(screen.getByText("Green.")).toBeVisible();
    expect(editorShown()).toBe(false);
    expect(preview).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(preview);
    expect(editorShown()).toBe(false);
    fireEvent.click(source);
    expect((await editor()).state.sliceDoc()).toContain("Green.");
    expect(source).toHaveAttribute("aria-pressed", "true");
  });

  it("starts editing in the mode chosen last on the device, never in the preview", async () => {
    holdScreen("phone");
    const { unmount } = open();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(await screen.findByRole("button", { name: "Source" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(
      await screen.findByRole("button", { name: "Source" }),
    ).toHaveAttribute("aria-pressed", "true");
    unmount();

    open();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(
      await screen.findByRole("button", { name: "Source" }),
    ).toHaveAttribute("aria-pressed", "true");
    await editor();
  });

  it("keeps the revision opened while editing, and shows Drive's newer one once viewing", async () => {
    holdScreen("wide");
    const { drive, rerender } = open();
    await pickMode("Source");
    const view = await editor();
    type(view, "x");

    drive.getContent.mockResolvedValue(utf8("# Coffee\n"));
    rerender(
      <FileContent file={metadata(PLAN, { headRevisionId: "revision-3" })} />,
    );
    // Typing passes back through the text opened: still the same editor.
    act(() => {
      view.dispatch({
        changes: { from: view.state.doc.length - 1, to: view.state.doc.length },
      });
    });
    expect(await editor()).toBe(view);
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(drive.getContent).toHaveBeenCalledOnce();

    await pickMode("Viewing");
    expect(
      await screen.findByRole("heading", { name: "Coffee" }),
    ).toBeVisible();
    // The edit was undone: nothing was written.
    expect(drive.saveContent).not.toHaveBeenCalled();
  });

  it("keeps as unsaved an undo made while a save runs", async () => {
    holdScreen("wide");
    const { drive } = open();
    let answer: (saved: FileMetadata) => void = () => undefined;
    drive.saveContent.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    await pickMode("Source");
    const view = await editor();
    type(view, "x");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: "Saving…" });

    act(() => {
      view.dispatch({
        changes: { from: view.state.doc.length - 1, to: view.state.doc.length },
      });
    });
    answer(metadata(PLAN, { headRevisionId: "revision-2" }));

    expect(await screen.findByRole("button", { name: "Save" })).toBeVisible();
    expect(view.state.sliceDoc()).toBe("# Tea\r\n\r\n- [ ] Boil\r\n");
  });

  it("keeps the same editor, its cursor and history, after a save", async () => {
    holdScreen("wide");
    const { drive, rerender } = open();
    await pickMode("Source");
    const view = await editor();
    type(view, "\r\nGreen.");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(drive.saveContent).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    });

    rerender(
      <FileContent file={metadata(PLAN, { headRevisionId: "revision-2" })} />,
    );

    expect(await editor()).toBe(view);
  });

  it("saves before leaving a phone's editor with Done", async () => {
    const { drive } = open();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    type(await editor(), "\r\nGreen.");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(await screen.findByRole("button", { name: "Edit" })).toBeVisible();
    expect(drive.saveContent).toHaveBeenCalledExactlyOnceWith(
      PLAN,
      utf8("# Tea\r\n\r\n- [ ] Boil\r\n\r\nGreen."),
    );
    expect(editorShown()).toBe(false);
    expect(screen.getByText("Green.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Saved" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Saved to Google Drive",
    );
  });

  it("stays in a phone's editor when Done cannot save, saying why", async () => {
    const { drive } = open();
    drive.saveContent.mockRejectedValue(
      new DriveError(403, "The user does not have sufficient permissions."),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    type(await editor(), "\r\nGreen.");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The user does not have sufficient permissions.",
    );
    expect(editorShown()).toBe(true);
    // Done gives way to Back meanwhile, which leaves the note.
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeVisible();
  });

  it("says at once that Done cannot save while the device is offline", async () => {
    const { drive } = open();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    type(await editor(), "\r\nGreen.");
    onlineManager.setOnline(false);
    drive.getMetadata.mockRejectedValue(
      new DriveError(0, "Google Drive could not be reached"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Google Drive could not be reached. Check your connection.",
    );
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeVisible();
    expect(drive.keepRevision).not.toHaveBeenCalled();
    expect(drive.saveContent).not.toHaveBeenCalled();
  });
});
