import { EditorView } from "@codemirror/view";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FileMetadata } from "./drive.ts";
import { FileContent } from "./FileContent.tsx";
import { driveItem, metadata } from "./test/drive-items.ts";
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
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    const view = await editor();
    expect(view.state.sliceDoc()).toBe("# Tea\r\n\r\n- [ ] Boil\r\n");
    type(view, "\r\nGreen.");
    expect(
      screen.getByText("Green.", { selector: ".markdown p" }),
    ).toBeVisible();
    expect(screen.getByText("Unsaved changes")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(drive.saveContent).toHaveBeenCalledExactlyOnceWith(
        PLAN,
        utf8("# Tea\r\n\r\n- [ ] Boil\r\n\r\nGreen."),
      );
    });
  });

  it("brings a task tapped in the preview into the source", async () => {
    holdScreen("wide");
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const view = await editor();

    fireEvent.click(screen.getByRole("checkbox"));

    expect(view.state.sliceDoc()).toBe("# Tea\r\n\r\n- [x] Boil\r\n");
  });

  it("switches between the source and the preview on a phone", async () => {
    holdScreen("phone");
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    type(await editor(), "\r\nGreen.");

    expect(screen.queryByRole("heading", { name: "Tea" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByText("Green.")).toBeVisible();
    expect(editorShown()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Source" }));
    expect((await editor()).state.sliceDoc()).toContain("Green.");
  });

  it("starts the editor again from a revision someone else made, while nothing is edited", async () => {
    holdScreen("wide");
    const { drive, rerender } = open();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const before = await editor();

    drive.getContent.mockResolvedValue(utf8("# Coffee\n"));
    rerender(
      <FileContent file={metadata(PLAN, { headRevisionId: "revision-3" })} />,
    );

    await waitFor(async () => {
      expect((await editor()).state.sliceDoc()).toBe("# Coffee\n");
    });
    expect(await editor()).not.toBe(before);
  });

  it("keeps the same editor, its cursor and history, after a save", async () => {
    holdScreen("wide");
    const { drive, rerender } = open();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const view = await editor();
    type(view, "\r\nGreen.");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(drive.saveContent).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(screen.queryByText("Unsaved changes")).toBeNull();
    });

    rerender(
      <FileContent file={metadata(PLAN, { headRevisionId: "revision-2" })} />,
    );

    expect(await editor()).toBe(view);
  });

  it("leaves the editor with Done, keeping the edits to save", async () => {
    holdScreen("wide");
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    type(await editor(), "\r\nGreen.");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(editorShown()).toBe(false);
    expect(screen.getByText("Green.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit" })).toBeVisible();
  });
});
