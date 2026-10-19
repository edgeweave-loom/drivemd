import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Navigator } from "./Navigator.tsx";
import { markTab, openedFromDrive } from "./drive-tab.ts";
import { getPlace, guardLeaving, navigate } from "./router.ts";
import {
  driveItem,
  folderItem,
  metadata,
  metadataOf,
} from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { holdScreen } from "./test/screen.ts";
import { visit } from "./test/render.tsx";

const EMAIL = "ada@example.com";

/** Opens plan.md, in Work, in a tab that Drive's Open with opened. */
function openFromDrive() {
  const drive = fakeDrive();
  drive.getMetadata.mockImplementation(
    metadataOf(
      metadata(folderItem("Work", { id: "work", parents: ["my-root"] })),
      metadata(driveItem("plan.md", { id: "plan", parents: ["work"] })),
    ),
  );
  drive.listChildren.mockResolvedValue([driveItem("notes.md")]);
  drive.markViewed.mockResolvedValue();
  drive.getContent.mockResolvedValue(new TextEncoder().encode("# The plan"));
  markTab(true);
  visit("/edit?id=plan");
  const session = { drive, renew: vi.fn(), signOut: vi.fn() };
  render(<Navigator session={session} email={EMAIL} signedIn />);
  return { drive, session, bar: within(screen.getByRole("banner")) };
}

/** What the open More actions menu offers, in order. */
function items() {
  return [
    ...screen
      .getByRole("dialog", { name: "More actions" })
      .querySelectorAll("a, button"),
  ].map((item) => item.textContent);
}

afterEach(() => {
  markTab(false);
  guardLeaving(undefined);
  visit("/");
});

describe("A tab opened from Drive", () => {
  it("shows DriveMD's mark, which leads nowhere, beside the account", async () => {
    holdScreen("wide");
    const { bar } = openFromDrive();

    await bar.findByText(/^Last modified/);
    expect(bar.getByRole("img", { name: "DriveMD" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "DriveMD" })).toBeNull();
    expect(
      bar.getByRole("button", { name: `Account, ${EMAIL}` }),
    ).toBeVisible();
  });

  it("shows no folder beside the note on a wide screen", async () => {
    holdScreen("wide");
    openFromDrive();

    await screen.findByRole("heading", { name: "The plan" });
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByRole("link", { name: "notes.md" })).toBeNull();
  });

  it("offers no folder drawer on a tablet", async () => {
    holdScreen("tablet");
    openFromDrive();

    await screen.findByRole("heading", { name: "The plan" });
    expect(screen.queryByRole("button", { name: "Folder" })).toBeNull();
  });

  it("shows a phone DriveMD's mark in place of Back, and Done while editing", async () => {
    const { bar } = openFromDrive();

    await bar.findByText(/^Last modified/);
    const mark = bar.getByRole("img", { name: "DriveMD" });
    expect(bar.queryByRole("link")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    // Done comes first, and the style sheet hides the mark after it.
    const done = await bar.findByRole("button", { name: "Done" });
    expect(done.parentElement?.nextElementSibling).toBe(mark.parentElement);
    expect(mark.parentElement).toHaveClass("mark");
  });

  it("stays on the note it moved to the trash, which offers nothing more", async () => {
    holdScreen("wide");
    const { drive, bar } = openFromDrive();
    drive.trashFile.mockImplementation(() => {
      // Drive's details, asked again, say so after a while.
      drive.getMetadata.mockReturnValue(new Promise(() => undefined));
      return Promise.resolve();
    });

    fireEvent.click(await bar.findByRole("button", { name: "More actions" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "More actions" })).getByRole(
        "button",
        { name: "Move to trash" },
      ),
    );
    const dialog = screen.getByRole("dialog", { name: "Move to trash?" });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Move to trash" }),
    );

    expect(
      await screen.findByText(
        "This file is in the trash. Restore it from Google Drive to open it.",
      ),
    ).toBeVisible();
    expect(getPlace().href).toBe("/edit?id=plan");
    expect(dialog).not.toBeInTheDocument();
    for (const name of ["More actions", "Move", "Viewing", "Saved"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByRole("heading", { name: "The plan" })).toBeNull();
  });

  it("ends the mode once the tab shows another page than a note", async () => {
    holdScreen("wide");
    const { bar } = openFromDrive();
    await bar.findByText(/^Last modified/);
    act(() => {
      navigate("/edit?id=notes");
    });
    expect(openedFromDrive()).toBe(true);

    act(() => {
      navigate("/folder/work");
    });
    expect(openedFromDrive()).toBe(false);
    act(() => {
      history.back();
    });
    await waitFor(() => {
      expect(getPlace().href).toBe("/edit?id=notes");
    });
    expect(
      await screen.findByRole("link", { name: "DriveMD" }),
    ).toHaveAttribute("href", "/");
  });

  it("keeps the account in a phone's More actions, after the note's actions", async () => {
    const { session, bar } = openFromDrive();
    await bar.findByText(/^Last modified/);

    fireEvent.click(await bar.findByRole("button", { name: "More actions" }));
    const menu = within(screen.getByRole("dialog", { name: "More actions" }));
    expect(items()).toEqual([
      "Move",
      "Move to trash",
      "About DriveMD",
      "Sign out",
    ]);
    expect(menu.getByText(EMAIL)).toBeVisible();
    // Apart from the note's actions.
    expect(
      menu
        .getByRole("separator")
        .compareDocumentPosition(menu.getByText(EMAIL)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(menu.getByRole("link", { name: "About DriveMD" })).toHaveAttribute(
      "href",
      "/about.html",
    );
    fireEvent.click(menu.getByRole("button", { name: "Sign out" }));
    await waitFor(() => {
      expect(session.signOut).toHaveBeenCalledOnce();
    });
  });

  it("leaves the account to its own button on a wider screen", async () => {
    holdScreen("tablet");
    const { bar } = openFromDrive();

    fireEvent.click(await bar.findByRole("button", { name: "More actions" }));
    const menu = within(screen.getByRole("dialog", { name: "More actions" }));
    expect(menu.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(menu.queryByRole("link", { name: "About DriveMD" })).toBeNull();
  });

  it("keeps a phone's account within reach once the note is in the trash", async () => {
    const { drive, bar } = openFromDrive();
    drive.trashFile.mockImplementation(() => {
      drive.getMetadata.mockReturnValue(new Promise(() => undefined));
      return Promise.resolve();
    });
    await bar.findByText(/^Last modified/);

    fireEvent.click(bar.getByRole("button", { name: "More actions" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "More actions" })).getByRole(
        "button",
        { name: "Move to trash" },
      ),
    );
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Move to trash?" })).getByRole(
        "button",
        { name: "Move to trash" },
      ),
    );
    await screen.findByText(/^This file is in the trash\./);

    fireEvent.click(bar.getByRole("button", { name: "More actions" }));
    expect(items()).toEqual(["About DriveMD", "Sign out"]);
  });
});
