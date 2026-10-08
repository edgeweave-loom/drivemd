import { EditorView } from "@codemirror/view";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DriveError } from "./drive.ts";
import { FileContent } from "./FileContent.tsx";
import { getPlace } from "./router.ts";
import { driveItem, metadata } from "./test/drive-items.ts";
import { pickMode } from "./test/actions.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { renderWithDrive, visit } from "./test/render.tsx";
import { holdScreen } from "./test/screen.ts";

const PLAN = metadata(driveItem("plan.md", { id: "plan", parents: ["work"] }), {
  md5Checksum: "aaaa",
  headRevisionId: "revision-1",
});
const THEIRS = metadata(PLAN, {
  md5Checksum: "cccc",
  headRevisionId: "revision-3",
});
const utf8 = (text: string) => new TextEncoder().encode(text);

/** A note whose save finds that someone else changed it in Drive. */
async function conflict() {
  const drive = fakeDrive();
  drive.getContent.mockImplementation((file) =>
    Promise.resolve(
      utf8(
        file.headRevisionId === "revision-3"
          ? "- [ ] Boil\n- [ ] Serve\n"
          : "- [ ] Boil\n",
      ),
    ),
  );
  drive.getMetadata.mockResolvedValue(THEIRS);
  drive.keepRevision.mockResolvedValue();
  drive.saveContent.mockImplementation((file) =>
    Promise.resolve(metadata(file, { headRevisionId: "revision-4" })),
  );
  const rendered = renderWithDrive(<FileContent file={PLAN} />, drive);
  fireEvent.click(await screen.findByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("heading", {
    name: "Someone changed this file in Google Drive",
  });
  return { ...rendered, drive };
}

/** Keeps Drive's version, confirming that the user's changes go. */
function keepTheirs() {
  fireEvent.click(
    screen.getByRole("button", { name: "Keep the Drive version" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Drop my changes" }));
}

/** The text the view of the differences shows. */
async function differences() {
  return waitFor(() => {
    const content = document
      .querySelector(".differences")
      ?.shadowRoot?.querySelector<HTMLElement>(".cm-content");
    const view = content && EditorView.findFromDOM(content);
    if (!view) throw new Error("No differences yet");
    return view;
  });
}

afterEach(() => {
  visit("/");
});

describe("a save that finds someone else's change", () => {
  // The editor and the view of the differences both load and draw in jsdom.
  it(
    "updates the differences as the user types, keeping the same view",
    { timeout: 15_000 },
    async () => {
      holdScreen("wide");
      await conflict();
      await pickMode("Editing");
      const view = await differences();
      const source = await waitFor(() => {
        const content = document
          .querySelector(".editor")
          ?.shadowRoot?.querySelector<HTMLElement>(".cm-content");
        const found = content && EditorView.findFromDOM(content);
        if (!found) throw new Error("No editor yet");
        return found;
      });

      act(() => {
        source.dispatch({
          changes: { from: source.state.doc.length, insert: "Tea\n" },
        });
      });

      await waitFor(() => {
        expect(view.state.sliceDoc()).toBe("- [x] Boil\nTea\n");
      });
      expect(await differences()).toBe(view);
    },
  );

  it("shows Drive's version against the user's, with nothing written", async () => {
    const { drive } = await conflict();

    const view = await differences();
    expect(view.state.sliceDoc()).toBe("- [x] Boil\n");
    expect(view.dom.textContent).toContain("Serve");
    expect(view.state.readOnly).toBe(true);
    expect(drive.saveContent).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("keeps Drive's version, dropping the user's", async () => {
    await conflict();

    keepTheirs();

    expect(await screen.findByText("Serve")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(await screen.findByRole("button", { name: "Saved" })).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: /Someone changed/ }),
    ).toBeNull();
  });

  it("keeps Drive's version after the editor closes, and tells the page of it", async () => {
    holdScreen("wide");
    await conflict();
    await pickMode("Editing");

    keepTheirs();
    await pickMode("Viewing");

    await new Promise((settle) => setTimeout(settle, 50));
    expect(screen.getByText("Serve")).toBeVisible();
  });

  it("asks before dropping the user's changes, and keeps them on Cancel", async () => {
    await conflict();

    fireEvent.click(
      screen.getByRole("button", { name: "Keep the Drive version" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Drop your changes?" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("heading", { name: /Someone changed/ }),
    ).toBeVisible();
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("keeps the edits when someone wrote to the copy before it was filled", async () => {
    const { drive } = await conflict();
    const copy = driveItem("plan (conflict).md", {
      id: "copy",
      parents: ["work"],
    });
    drive.createFile.mockResolvedValue(copy);
    const empty = metadata(copy, { md5Checksum: "d41d", headRevisionId: "r1" });
    const theirs = metadata(copy, {
      md5Checksum: "ffff",
      headRevisionId: "r2",
    });
    drive.getMetadata.mockImplementation((file) =>
      Promise.resolve(file.id === "copy" ? empty : THEIRS),
    );
    drive.getMetadata.mockImplementationOnce(() => Promise.resolve(empty));
    drive.getMetadata.mockImplementationOnce(() => Promise.resolve(theirs));

    fireEvent.click(
      screen.getByRole("button", { name: "Save mine as a copy" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Someone wrote to the copy before DriveMD could. Your changes are still here: try again for a new copy.",
    );
    expect(getPlace().route).toEqual({ name: "home" });
    expect(drive.saveContent).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Save mine as a copy" }),
    );
    await waitFor(() => {
      expect(drive.createFile).toHaveBeenCalledTimes(2);
    });
  });

  it("overwrites Drive's version with the user's, keeping Drive's in the history", async () => {
    const { drive } = await conflict();

    fireEvent.click(
      screen.getByRole("button", { name: "Overwrite with mine" }),
    );

    await waitFor(() => {
      expect(drive.saveContent).toHaveBeenCalledExactlyOnceWith(
        THEIRS,
        utf8("- [x] Boil\n"),
      );
    });
    expect(drive.keepRevision).toHaveBeenCalledExactlyOnceWith(
      THEIRS,
      "revision-3",
    );
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    });
    expect(
      screen.queryByRole("heading", { name: /Someone changed/ }),
    ).toBeNull();
  });

  it("saves the user's version as a copy beside the file, then opens it", async () => {
    const { drive } = await conflict();
    const copy = driveItem("plan (conflict).md", {
      id: "copy",
      parents: ["work"],
    });
    drive.createFile.mockResolvedValue(copy);
    drive.getMetadata.mockImplementation((file) =>
      Promise.resolve(file.id === "copy" ? metadata(copy) : THEIRS),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Save mine as a copy" }),
    );

    await waitFor(() => {
      expect(getPlace().route).toEqual({ name: "file", file: { id: "copy" } });
    });
    expect(drive.createFile).toHaveBeenCalledExactlyOnceWith(
      { id: "work" },
      "plan (conflict).md",
    );
    expect(drive.saveContent).toHaveBeenCalledExactlyOnceWith(
      metadata(copy),
      utf8("- [x] Boil\n"),
    );
  });

  it("writes into the copy it made already when the user tries again", async () => {
    const { drive } = await conflict();
    const copy = driveItem("plan (conflict).md", {
      id: "copy",
      parents: ["work"],
    });
    drive.createFile.mockResolvedValue(copy);
    drive.getMetadata.mockImplementation((file) =>
      Promise.resolve(file.id === "copy" ? metadata(copy) : THEIRS),
    );
    drive.saveContent.mockRejectedValueOnce(
      new DriveError(503, "Backend error"),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Save mine as a copy" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Backend error");
    fireEvent.click(
      screen.getByRole("button", { name: "Save mine as a copy" }),
    );

    await waitFor(() => {
      expect(getPlace().route).toEqual({ name: "file", file: { id: "copy" } });
    });
    expect(drive.createFile).toHaveBeenCalledOnce();
  });

  it("says why Drive refused a choice, and leaves the choice open", async () => {
    const { drive } = await conflict();
    drive.createFile.mockRejectedValue(
      new DriveError(403, "The user does not have permission"),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Save mine as a copy" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Google Drive refused the request: The user does not have permission",
    );
    expect(
      screen.getByRole("button", { name: "Overwrite with mine" }),
    ).toBeEnabled();

    // The next conflict starts afresh.
    keepTheirs();
    drive.getMetadata.mockResolvedValue(
      metadata(PLAN, { md5Checksum: "eeee", headRevisionId: "revision-5" }),
    );
    fireEvent.click(
      (await screen.findAllByRole("checkbox"))[1] ?? document.body,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { name: /Someone changed/ });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers no copy for a file whose folder is out of reach", async () => {
    holdScreen("phone");
    const drive = fakeDrive();
    const alone = { ...PLAN, parents: [] };
    drive.getContent.mockResolvedValue(utf8("- [ ] Boil\n"));
    drive.getMetadata.mockResolvedValue({ ...THEIRS, parents: [] });
    renderWithDrive(<FileContent file={alone} />, drive);
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByRole("heading", { name: /Someone changed/ });
    expect(
      screen.queryByRole("button", { name: "Save mine as a copy" }),
    ).toBeNull();
  });
});
