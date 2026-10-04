import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DriveItem } from "./drive.ts";
import { Rendered } from "./Markdown.tsx";
import {
  driveItem,
  folderItem,
  foldersAmong,
  metadata,
  metadataOf,
} from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { renderWithDrive } from "./test/render.tsx";
import { VAULT } from "./test/vault.ts";

// Made-up vault: Vault/Daily/Today.md, Vault/Files/cat.png, Vault/Files/doc.pdf,
// Vault/Guide.md.
const ROOT = folderItem("Vault", { id: "vault", parents: [] });
const DAILY = folderItem("Daily", { id: "daily", parents: ["vault"] });
const FILES = folderItem("Files", { id: "files", parents: ["vault"] });
const CAT = driveItem("cat.png", {
  id: "cat",
  mimeType: "image/png",
  parents: ["files"],
});
const PDF = driveItem("doc.pdf", {
  id: "doc",
  mimeType: "application/pdf",
  parents: ["files"],
});
const GUIDE = driveItem("Guide.md", { id: "guide", parents: ["vault"] });
const ITEMS: DriveItem[] = [ROOT, DAILY, FILES, CAT, PDF, GUIDE];

/** Renders a note of the vault's Daily folder. */
function open(text: string) {
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
      incomplete: false,
    }),
  );
  drive.getMetadata.mockImplementation(
    metadataOf(...ITEMS.map((item) => metadata(item))),
  );
  drive.getContent.mockResolvedValue(new Uint8Array([1, 2, 3]));
  return renderWithDrive(
    <Rendered text={text} folder={{ id: "daily" }} vault={VAULT} />,
    drive,
  );
}

describe("image embeds in a note of a vault", () => {
  it("show the image of that name, read from Drive", async () => {
    const { drive } = open("![[cat.png]]");

    const image = await screen.findByRole("img", { name: "cat.png" });
    await waitFor(() => {
      expect(image).toHaveAttribute("src", expect.stringMatching(/^blob:/));
    });
    expect(drive.getContent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cat" }),
      10_000_000,
    );
  });

  it.each([
    ["![[cat.png|300]]", "cat.png", "300", null],
    ["![[cat.png|300x200]]", "cat.png", "300", "200"],
    ["![[Files/cat.png|A cat|120]]", "A cat", "120", null],
  ])("take a size: %s", async (text, name, width, height) => {
    open(text);

    const image = await screen.findByRole("img", { name });
    expect(image).toHaveAttribute("width", width);
    expect(image.getAttribute("height")).toBe(height);
  });

  it.each([
    [
      "a PDF",
      "![[doc.pdf]]",
      "doc.pdf",
      "https://drive.google.com/file/d/doc/view",
    ],
    ["a note", "![[Guide]]", "Guide", "/edit?id=guide"],
  ])("show %s as a link", async (_, text, name, href) => {
    open(text);

    expect(await screen.findByRole("link", { name })).toHaveAttribute(
      "href",
      href,
    );
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("show faded when they lead to nothing", async () => {
    open("![[gone.png]]");

    await waitFor(() => {
      expect(screen.getByText("gone.png")).toHaveClass("unresolved");
    });
  });

  it("are a link when the ! is escaped", async () => {
    open("\\![[cat.png]]");

    expect(await screen.findByRole("link", { name: "cat.png" })).toBeVisible();
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("embeds in a note of a vault", () => {
  it("lead to the last heading they name, whatever the spaces around #", async () => {
    open("See ![[Guide # Water # Cups]].");

    expect(await screen.findByRole("link", { name: "Guide" })).toHaveAttribute(
      "href",
      "/edit?id=guide#cups",
    );
  });

  it("take a size in pixels only, even written in HTML", async () => {
    open('<img data-embed="cat.png" width="100%" height="99999" alt="cat">');

    const image = await screen.findByRole("img", { name: "cat" });
    expect(image).not.toHaveAttribute("width");
    expect(image).toHaveAttribute("height", "99999");
  });
});

describe("Markdown images in a note of a vault", () => {
  it("find the image as Obsidian does", async () => {
    open("![a cat](cat.png)");

    expect(await screen.findByRole("img", { name: "a cat" })).toBeVisible();
  });
});

describe("a note outside a vault", () => {
  it("shows an embed as written", () => {
    const page = render(<Rendered text="![[cat.png]]" />).container;

    expect(page.textContent).toBe("![[cat.png]]");
  });
});
