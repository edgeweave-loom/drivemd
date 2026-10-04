import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DriveItem, FileMetadata } from "./drive.ts";
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

// Made-up vault: Vault/Daily/ holds the note shown, Vault/Notes/ the others.
const ROOT = folderItem("Vault", { id: "vault", parents: [] });
const DAILY = folderItem("Daily", { id: "daily", parents: ["vault"] });
const NOTES = folderItem("Notes", { id: "notes", parents: ["vault"] });
const TEXTS: Record<string, string> = {
  Guide:
    "# Guide\n\n## Water\n\nBoil it.\n\n## Tea\n\nSteep it. ^steep\n\n- [ ] Pour",
  Loop: "Loop text.\n\n![[Loop]]",
  A: "In A.\n\n![[B]]",
  B: "In B.\n\n![[C]]",
  C: "In C.\n\n![[D]]",
  D: "In D.\n\n![[E]]",
  E: "In E.",
  Big: "Too big.",
};
const NOTE_ITEMS = Object.keys(TEXTS).map((name) =>
  driveItem(`${name}.md`, { id: name.toLowerCase(), parents: ["notes"] }),
);
const ITEMS: DriveItem[] = [ROOT, DAILY, NOTES, ...NOTE_ITEMS];
const DETAILS: FileMetadata[] = NOTE_ITEMS.map((item) =>
  metadata(item, item.id === "big" ? { size: 2_000_000 } : {}),
);

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
  drive.getMetadata.mockImplementation(metadataOf(...DETAILS));
  drive.getContent.mockImplementation((file) => {
    const name = file.name.replace(/\.md$/, "");
    return Promise.resolve(new TextEncoder().encode(TEXTS[name] ?? ""));
  });
  return renderWithDrive(
    <Rendered
      text={text}
      folder={{ id: "daily" }}
      vault={VAULT}
      note="today"
      onEdit={() => undefined}
    />,
    drive,
  );
}

/** The embeds shown, outermost first. */
function embeds() {
  return [...document.querySelectorAll(".embed")];
}

describe("note embeds in a note of a vault", () => {
  it("show the note, with a link to it", async () => {
    open("![[Guide]]");

    expect(await screen.findByRole("heading", { name: "Water" })).toBeVisible();
    const [embed] = embeds();
    expect(
      within(embed as HTMLElement).getByRole("link", { name: "Guide" }),
    ).toHaveAttribute("href", "/edit?id=guide");
  });

  it("show the section a heading names", async () => {
    open("![[Guide#Water]]");

    expect(await screen.findByText("Boil it.")).toBeVisible();
    expect(screen.queryByText(/Steep it/)).toBeNull();
    expect(screen.getByRole("link", { name: "Guide > Water" })).toHaveAttribute(
      "href",
      "/edit?id=guide#water",
    );
  });

  it("show the block an ID names, without the ID", async () => {
    open("![[Guide#^steep]]");

    expect(await screen.findByText("Steep it.")).toBeVisible();
    expect(screen.queryByText(/Boil it/)).toBeNull();
  });

  it("say when the note has no such part", async () => {
    open("![[Guide#Coffee]]");

    expect(
      await screen.findByText("This part is not in the note."),
    ).toBeVisible();
  });

  it("leave the embedded note's tasks to its own page", async () => {
    open("![[Guide#Tea]]");

    expect(await screen.findByRole("checkbox")).toBeDisabled();
  });

  it("nest three deep at most", async () => {
    open("![[A]]");

    expect(await screen.findByText("In C.")).toBeVisible();
    // D shows as a plain link, neither loading nor shown.
    await waitFor(() => {
      const link = screen.getByRole("link", { name: "D" });
      expect(link.parentElement?.className).toBe("");
      expect(link).toHaveAttribute("href", "/edit?id=d");
    });
    expect(screen.queryByText("In D.")).toBeNull();
  });

  it("never show a note within itself", async () => {
    open("![[Loop]]");

    expect(await screen.findByText("Loop text.")).toBeVisible();
    await waitFor(() => {
      expect(screen.getAllByRole("link", { name: "Loop" })).toHaveLength(2);
    });
    expect(screen.getAllByText("Loop text.")).toHaveLength(1);
  });

  it.each([
    ["within text", "See ![[Guide]] here.", "Guide"],
    ["of a note too large to show", "![[Big]]", "Big"],
  ])("are links %s", async (_, text, name) => {
    open(text);

    expect(await screen.findByRole("link", { name })).toBeVisible();
    expect(embeds().some((embed) => embed.querySelector(".markdown"))).toBe(
      false,
    );
  });

  it("show faded when the note is not there", async () => {
    open("![[Gone]]");

    await waitFor(() => {
      expect(screen.getByText("Gone")).toHaveClass("unresolved");
    });
  });
});
