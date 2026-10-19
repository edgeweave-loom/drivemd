import { act, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Navigator } from "./Navigator.tsx";
import { guardLeaving, hrefOf, navigate } from "./router.ts";
import { folderItem, metadata } from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { holdScreen } from "./test/screen.ts";

const JOURNAL = folderItem("Journal");

function open(path: string, drive = fakeDrive()) {
  history.replaceState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  const session = { drive, renew: vi.fn(), signOut: vi.fn() };
  render(<Navigator session={session} email="ada@example.com" signedIn />);
  return session;
}

afterEach(() => {
  guardLeaving(undefined);
  history.replaceState(null, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
});

describe("NavDrawer", () => {
  it("keeps the page as it is when the drawer comes or goes", () => {
    holdScreen("wide");
    open("/shortcuts");
    const page = screen.getByRole("main");
    act(() => {
      holdScreen("phone");
    });
    expect(screen.queryByRole("navigation", { name: "Drive" })).toBeNull();
    expect(screen.getByRole("main")).toBe(page);
  });

  it("marks one place only: the deepest the page sits in", async () => {
    holdScreen("wide");
    const drive = fakeDrive();
    drive.findVaults.mockResolvedValue([metadata(JOURNAL)]);
    open("/my-drive", drive);
    const drawer = screen.getByRole("navigation", { name: "Drive" });
    await within(drawer).findByRole("link", { name: "Journal" });
    const journal = hrefOf({ name: "folder", folder: { id: JOURNAL.id } });
    act(() => {
      navigate(journal, [
        {
          name: "My Drive",
          href: hrefOf({ name: "folder", folder: { id: "root" } }),
        },
        { name: "Journal", href: journal },
      ]);
    });
    const marked = within(drawer)
      .getAllByRole("link")
      .filter((link) => link.hasAttribute("aria-current"));
    expect(marked.map((link) => link.textContent)).toEqual(["Journal"]);
  });

  it("holds the vaults behind one item of a tablet's rail, marked when the page is in one", async () => {
    holdScreen("tablet");
    const drive = fakeDrive();
    drive.findVaults.mockResolvedValue([metadata(JOURNAL)]);
    open(hrefOf({ name: "folder", folder: { id: JOURNAL.id } }), drive);
    const rail = screen.getByRole("navigation", { name: "Drive" });
    const vaults = await within(rail).findByRole("button", { name: "Vaults" });
    expect(vaults).toHaveAttribute("aria-current", "true");
    expect(within(rail).queryByRole("heading", { name: "Vaults" })).toBeNull();
  });

  it("says when Drive did not list the vaults", async () => {
    holdScreen("wide");
    const drive = fakeDrive();
    drive.findVaults.mockRejectedValue(new Error("offline"));
    open("/my-drive", drive);
    const drawer = screen.getByRole("navigation", { name: "Drive" });
    expect(
      await within(drawer).findByText("Google Drive did not list the vaults."),
    ).toBeVisible();
  });
});
