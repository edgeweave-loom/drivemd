import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forgetCreated, openCreated } from "./created.ts";
import { rememberEditMode } from "./edit-mode.ts";
import { FileContent } from "./FileContent.tsx";
import { driveItem, metadata } from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { renderWithDrive } from "./test/render.tsx";
import { holdScreen, holdTouch } from "./test/screen.ts";

const IDEAS = metadata(driveItem("Ideas.md", { id: "ideas" }), {
  md5Checksum: "d41d8cd98f00b204e9800998ecf8427e",
  headRevisionId: "revision-1",
});

/** Shows Ideas.md, empty, which New note may just have created. */
function show() {
  const drive = fakeDrive();
  drive.getContent.mockResolvedValue(new Uint8Array());
  drive.getMetadata.mockResolvedValue(IDEAS);
  return renderWithDrive(<FileContent file={IDEAS} />, drive);
}

async function editorShows() {
  await waitFor(() => {
    expect(document.querySelector(".editor")).not.toBeNull();
  });
}

/** Whether the note's text, in the editor's shadow root, has the focus. */
function typing() {
  const root = document.querySelector(".editor")?.shadowRoot;
  return root?.activeElement?.classList.contains("cm-content") === true;
}

beforeEach(() => {
  // jsdom names Apple as its vendor, so CodeMirror reads the selection in
  // a shadow root as Safari needs, through a command jsdom lacks.
  Object.defineProperty(document, "execCommand", {
    value: () => false,
    configurable: true,
  });
});

afterEach(() => {
  forgetCreated();
});

describe("A note just created", () => {
  it("opens in Visual on a computer, the cursor in it", async () => {
    holdScreen("wide");
    openCreated(IDEAS);
    show();

    expect(await screen.findByRole("button", { name: "Visual" })).toBeVisible();
    await editorShows();
    expect(typing()).toBe(true);
  });

  it("opens in Source when the device chose it last", async () => {
    holdScreen("wide");
    rememberEditMode("source");
    openCreated(IDEAS);
    show();

    expect(
      await screen.findByRole("region", { name: "Markdown" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Source" })).toBeVisible();
  });

  it("opens in the editor on a phone, leaving the keyboard to a tap", async () => {
    holdTouch(true);
    openCreated(IDEAS);
    show();

    expect(await screen.findByRole("button", { name: "Done" })).toBeVisible();
    await editorShows();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(typing()).toBe(false);
  });

  it("opens in reading once it showed, as any note", async () => {
    openCreated(IDEAS);
    const first = show();
    await screen.findByRole("button", { name: "Done" });
    first.unmount();

    show();
    expect(await screen.findByRole("button", { name: "Edit" })).toBeVisible();
    expect(document.querySelector(".editor")).toBeNull();
  });

  it("leaves another note in reading", async () => {
    openCreated({ id: "other" });
    show();

    expect(await screen.findByRole("button", { name: "Edit" })).toBeVisible();
  });
});
