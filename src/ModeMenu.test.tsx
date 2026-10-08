import { EditorView } from "@codemirror/view";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { DriveError, type FileMetadata } from "./drive.ts";
import { FileContent } from "./FileContent.tsx";
import { pickMode } from "./test/actions.ts";
import { driveItem, metadata } from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { renderWithDrive } from "./test/render.tsx";
import { holdScreen } from "./test/screen.ts";

const PLAN = metadata(driveItem("plan.md", { id: "plan" }), {
  md5Checksum: "aaaa",
  headRevisionId: "revision-1",
});
const utf8 = (text: string) => new TextEncoder().encode(text);

function open() {
  const drive = fakeDrive();
  drive.getContent.mockResolvedValue(utf8("# Tea\n"));
  drive.getMetadata.mockResolvedValue(PLAN);
  drive.keepRevision.mockResolvedValue();
  drive.saveContent.mockResolvedValue(
    metadata(PLAN, { md5Checksum: "bbbb", headRevisionId: "revision-2" }),
  );
  return renderWithDrive(<FileContent file={PLAN} />, drive);
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

beforeEach(() => {
  holdScreen("wide");
});

describe("the mode menu", () => {
  it("names the mode and offers both, saying what each does", async () => {
    open();

    const mode = await screen.findByRole("button", { name: "Viewing" });
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    fireEvent.click(mode);
    const menu = within(screen.getByRole("menu", { name: "Mode" }));
    const editing = menu.getByRole("menuitemradio", { name: "Editing" });
    const viewing = menu.getByRole("menuitemradio", { name: "Viewing" });
    expect(editing).toHaveAttribute("aria-checked", "false");
    expect(editing).toHaveAccessibleDescription(
      "Edit the Markdown beside its preview",
    );
    expect(viewing).toHaveAttribute("aria-checked", "true");
    expect(viewing).toHaveAccessibleDescription("Save, then read the note");
    // The focus starts at the mode chosen, and the arrows move it.
    expect(viewing).toHaveFocus();
    fireEvent.keyDown(viewing, { key: "ArrowUp" });
    expect(editing).toHaveFocus();
    fireEvent.keyDown(editing, { key: "ArrowDown" });
    expect(viewing).toHaveFocus();
    fireEvent.keyDown(viewing, { key: "Home" });
    expect(editing).toHaveFocus();
    fireEvent.keyDown(editing, { key: "End" });
    expect(viewing).toHaveFocus();

    fireEvent.click(editing);
    expect(screen.queryByRole("menu", { name: "Mode" })).toBeNull();
    expect(
      await screen.findByRole("button", { name: "Editing" }),
    ).toBeVisible();
    await editor();
  });

  it("closes as the focus leaves it by Tab", async () => {
    open();

    fireEvent.click(await screen.findByRole("button", { name: "Viewing" }));
    const menu = screen.getByRole("menu", { name: "Mode" });
    fireEvent.keyDown(
      within(menu).getByRole("menuitemradio", { name: "Viewing" }),
      {
        key: "Tab",
      },
    );
    expect(menu).not.toBeVisible();
  });

  it("saves before viewing, then shows the note alone", async () => {
    const { drive } = open();
    await pickMode("Editing");
    type(await editor(), "Green.\n");

    await pickMode("Viewing");
    await waitFor(() => {
      expect(drive.saveContent).toHaveBeenCalledExactlyOnceWith(
        PLAN,
        utf8("# Tea\nGreen.\n"),
      );
    });
    expect(
      await screen.findByRole("button", { name: "Viewing" }),
    ).toBeVisible();
    expect(editorShown()).toBe(false);
    expect(screen.getByRole("button", { name: "Saved" })).toBeVisible();
  });

  it("stays in Editing when more was typed while it saved", async () => {
    const { drive } = open();
    let written: (file: FileMetadata) => void = () => undefined;
    drive.saveContent.mockReturnValue(
      new Promise((resolve) => {
        written = resolve;
      }),
    );
    await pickMode("Editing");
    const view = await editor();
    type(view, "Green.\n");

    await pickMode("Viewing");
    await waitFor(() => {
      expect(drive.saveContent).toHaveBeenCalledOnce();
    });
    type(view, "Black.\n");
    written(
      metadata(PLAN, { md5Checksum: "bbbb", headRevisionId: "revision-2" }),
    );
    expect(await screen.findByRole("button", { name: "Save" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Editing" })).toBeVisible();
    expect(editorShown()).toBe(true);
  });

  it("writes nothing when viewing a note left as it was", async () => {
    const { drive } = open();
    await pickMode("Editing");
    await editor();

    await pickMode("Viewing");
    expect(
      await screen.findByRole("button", { name: "Viewing" }),
    ).toBeVisible();
    expect(editorShown()).toBe(false);
    expect(drive.saveContent).not.toHaveBeenCalled();
  });

  it("stays in Editing when someone else changed the note, saying so", async () => {
    const { drive } = open();
    await pickMode("Editing");
    type(await editor(), "Green.\n");
    drive.getMetadata.mockResolvedValue(
      metadata(PLAN, { md5Checksum: "cccc", headRevisionId: "revision-9" }),
    );
    drive.getContent.mockResolvedValue(utf8("# Coffee\n"));

    await pickMode("Viewing");
    expect(
      await screen.findByRole("heading", { name: /Someone changed/ }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Editing" })).toBeVisible();
    expect(editorShown()).toBe(true);
    expect(drive.saveContent).not.toHaveBeenCalled();
  });

  it("stays in Editing when the save fails, saying why", async () => {
    const { drive } = open();
    drive.saveContent.mockRejectedValue(
      new DriveError(403, "The user does not have sufficient permissions."),
    );
    await pickMode("Editing");
    type(await editor(), "Green.\n");

    await pickMode("Viewing");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The user does not have sufficient permissions.",
    );
    expect(screen.getByRole("button", { name: "Editing" })).toBeVisible();
    expect(editorShown()).toBe(true);
  });

  it("is not on a phone, which floats Edit and keeps Done", async () => {
    holdScreen("phone");
    open();

    expect(await screen.findByRole("button", { name: "Edit" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Viewing" })).toBeNull();
  });
});
