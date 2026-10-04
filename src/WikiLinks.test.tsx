import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DriveItem } from "./drive.ts";
import { Rendered } from "./Markdown.tsx";
import { getPlace } from "./router.ts";
import {
  driveItem,
  folderItem,
  foldersAmong,
  metadata,
  metadataOf,
} from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { renderWithDrive, visit } from "./test/render.tsx";
import { VAULT } from "./test/vault.ts";

// Made-up vault: Vault/Daily/Today.md, Vault/Sub/Guide.md, Vault/image.png.
const ROOT = folderItem("Vault", { id: "vault", parents: [] });
const DAILY = folderItem("Daily", { id: "daily", parents: ["vault"] });
const SUB = folderItem("Sub", { id: "sub", parents: ["vault"] });
const GUIDE = driveItem("Guide.md", { id: "guide", parents: ["sub"] });
const IMAGE = driveItem("image.png", {
  id: "image",
  mimeType: "image/png",
  parents: ["vault"],
});
const ITEMS: DriveItem[] = [ROOT, DAILY, SUB, GUIDE, IMAGE];

/** Renders a note of the vault's Daily folder. */
function open(text: string, { incomplete = false } = {}) {
  const drive = fakeDrive();
  drive.listChildren.mockImplementation(({ id }) =>
    Promise.resolve(ITEMS.filter(({ parents }) => parents.includes(id))),
  );
  drive.listFolders.mockImplementation(foldersAmong(ITEMS));
  drive.findByName.mockImplementation((name) =>
    Promise.resolve({
      items: ITEMS.filter(
        (item) => item.name.toLowerCase() === name.toLowerCase(),
      ),
      incomplete,
    }),
  );
  drive.getMetadata.mockImplementation(
    metadataOf(...ITEMS.map((item) => metadata(item))),
  );
  return renderWithDrive(
    <Rendered text={text} folder={{ id: "daily" }} vault={VAULT} />,
    drive,
  );
}

afterEach(() => {
  visit("/");
  vi.restoreAllMocks();
});

describe("internal links in a note of a vault", () => {
  it("open the note of that name in the app", async () => {
    const { renew } = open("See [[guide]].");

    const link = await screen.findByRole("link", { name: "guide" });
    expect(link).toHaveAttribute("href", "/edit?id=guide");
    fireEvent.click(link);
    expect(renew).toHaveBeenCalledOnce();
    expect(getPlace().route).toEqual({ name: "file", file: { id: "guide" } });
  });

  it("show the text given after |", async () => {
    open("[[Guide|the guide]]");

    expect(
      await screen.findByRole("link", { name: "the guide" }),
    ).toHaveAttribute("href", "/edit?id=guide");
  });

  it.each([
    ["[[Guide#Set up]]", "Guide > Set up", "/edit?id=guide#set-up"],
    ["[[Guide#^step-1]]", "Guide > ^step-1", "/edit?id=guide#%5Estep-1"],
    ["[[Sub/Guide#Thé|tea]]", "tea", "/edit?id=guide#th%C3%A9"],
  ])("open %s at that heading or block", async (text, name, href) => {
    open(text);

    expect(await screen.findByRole("link", { name })).toHaveAttribute(
      "href",
      href,
    );
  });

  it("show a heading of the note itself, asking Drive nothing", () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    const { drive } = open("[[#Set up]]\n\n## Set up");

    fireEvent.click(screen.getByRole("link", { name: "Set up" }));
    expect(scrolled.mock.contexts).toEqual([
      screen.getByRole("heading", { name: "Set up" }),
    ]);
    expect(drive.findByName).not.toHaveBeenCalled();
  });

  it("open another file in Google Drive, in a new tab", async () => {
    open("[[image.png]]");

    const link = await screen.findByRole("link", { name: "image.png" });
    expect(link).toHaveAttribute(
      "href",
      "https://drive.google.com/file/d/image/view",
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("show faded when they lead to nothing", async () => {
    open("[[Gone]]");

    await waitFor(() => {
      expect(screen.getByText("Gone")).toHaveClass("unresolved");
    });
  });

  it("say when Drive left out drives where they might lead", async () => {
    open("[[Gone]]", { incomplete: true });

    await waitFor(() => {
      expect(screen.getByText("Gone")).toHaveAttribute(
        "title",
        "Google Drive did not search every drive, so this link may lead to a note it left out",
      );
    });
    expect(screen.getByText("Gone")).not.toHaveClass("unresolved");
  });

  it("take | as written in a table", async () => {
    open("| Link |\n| - |\n| [[Guide\\|G]] |");

    expect(await screen.findByRole("link", { name: "G" })).toHaveAttribute(
      "href",
      "/edit?id=guide",
    );
  });

  it.each([
    ["escaped", "\\[[Guide]]", "[[Guide]]"],
    ["in code", "`[[Guide]]`", "[[Guide]]"],
    ["in a link's text", "[a [[Guide]]](https://example.com)", "a [[Guide]]"],
    ["empty", "[[]]", "[[]]"],
  ])("are none when %s", (_, text, written) => {
    const { drive } = open(text);

    expect(screen.getByText(written)).toBeVisible();
    expect(drive.listChildren).not.toHaveBeenCalled();
    expect(drive.findByName).not.toHaveBeenCalled();
  });

  it("name subheadings with several #", async () => {
    open("[[Guide#Set up#Water]] [[Guide #Set up]]");

    expect(
      await screen.findByRole("link", { name: "Guide > Set up > Water" }),
    ).toHaveAttribute("href", "/edit?id=guide#water");
    expect(
      await screen.findByRole("link", { name: "Guide > Set up" }),
    ).toHaveAttribute("href", "/edit?id=guide#set-up");
  });

  it("may be written in HTML, but an empty one asks Drive nothing", async () => {
    const { drive } = open(
      '<a data-wikilink="Guide">the guide</a> <a data-wikilink="Gone"></a> <a data-wikilink="">x</a>',
    );

    expect(
      await screen.findByRole("link", { name: "the guide" }),
    ).toHaveAttribute("href", "/edit?id=guide");
    expect(drive.findByName).not.toHaveBeenCalledWith("Gone.md");
    expect(screen.getByText("x")).not.toHaveAttribute("href");
  });
});

describe("Markdown links in a note of a vault", () => {
  it("show a heading of the note itself written as its text", () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    open("[Go](#Set%20up)\n\n## Set up");

    fireEvent.click(screen.getByRole("link", { name: "Go" }));
    expect(scrolled.mock.contexts).toEqual([
      screen.getByRole("heading", { name: "Set up" }),
    ]);
  });

  it("find a note by name, as Obsidian does", async () => {
    open("[the guide](Guide.md) and [the other](Sub/Guide.md#set-up)");

    expect(
      await screen.findByRole("link", { name: "the guide" }),
    ).toHaveAttribute("href", "/edit?id=guide");
    expect(
      await screen.findByRole("link", { name: "the other" }),
    ).toHaveAttribute("href", "/edit?id=guide#set-up");
  });
});

describe("a note outside a vault", () => {
  it("shows an internal link as written", () => {
    const page = render(<Rendered text="[[Guide]]" />).container;

    expect(page.textContent).toBe("[[Guide]]");
  });

  it("drops an internal link's target written in HTML", () => {
    const page = render(
      <Rendered text={'<a data-wikilink="Guide" href="x.md">G</a>'} />,
    ).container;

    expect(page.querySelector("[data-wikilink]")).toBeNull();
  });
});
