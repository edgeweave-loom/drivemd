import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriveError } from "./drive.ts";
import { Navigator } from "./Navigator.tsx";
import { getPlace, guardLeaving, navigate } from "./router.ts";
import {
  driveItem,
  folderItem,
  metadata,
  metadataOf,
} from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { holdScreen } from "./test/screen.ts";

const EMAIL = "ada@example.com";

function open(path: string, drive = fakeDrive()) {
  history.replaceState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  const session = { drive, renew: vi.fn(), signOut: vi.fn() };
  render(<Navigator session={session} email={EMAIL} signedIn />);
  return session;
}

afterEach(() => {
  onlineManager.setOnline(true);
  guardLeaving(undefined);
  history.replaceState(null, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
});

describe("Navigator", () => {
  it("shows the account and signs out", async () => {
    const session = open("/");

    fireEvent.click(screen.getByRole("button", { name: `Account, ${EMAIL}` }));
    const menu = screen.getByRole("dialog", { name: "Account" });
    expect(menu).toHaveTextContent(EMAIL);
    fireEvent.click(within(menu).getByRole("button", { name: "Sign out" }));
    await waitFor(() => {
      expect(session.signOut).toHaveBeenCalledOnce();
    });
  });

  it("opens on Home, with a way into My Drive", async () => {
    const { drive } = open("/");
    drive.getMetadata.mockReturnValue(new Promise(() => undefined));
    drive.listChildren.mockResolvedValue([driveItem("notes.md")]);

    expect(screen.getByRole("heading", { name: "Home" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "My Drive" }));
    expect(
      await screen.findByRole("heading", { level: 2, name: "My Drive" }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "notes.md" })).toBeVisible();
    expect(drive.listChildren).toHaveBeenCalledWith({ id: "root" });
  });

  it.each([
    ["/shortcuts", "Shortcuts"],
    ["/shared-drives", "Shared drives"],
    ["/shared-with-me", "Shared with me"],
  ])("opens %s", (path, heading) => {
    open(path);

    // The page's own heading, which a phone's bar names too.
    expect(
      screen.getByRole("heading", { level: 2, name: heading }),
    ).toBeVisible();
  });

  it("searches from any page, renewing the token within the tap", () => {
    const session = open("/shortcuts");
    session.drive.search.mockReturnValue(new Promise(() => undefined));

    const search = screen.getByRole("searchbox", {
      name: "Search Markdown files by name",
    });
    fireEvent.change(search, { target: { value: " weekly plan " } });
    fireEvent.submit(search);
    expect(session.renew).toHaveBeenCalledOnce();
    expect(getPlace().href).toBe("/search?q=weekly+plan");
    expect(
      screen.getByRole("heading", { name: "Search: weekly plan" }),
    ).toBeVisible();
  });

  it("keeps the words searched in the search box, and its focus", () => {
    const session = open("/search?q=plan");
    session.drive.search.mockReturnValue(new Promise(() => undefined));
    const search = screen.getByRole("searchbox");
    expect(search).toHaveValue("plan");

    search.focus();
    fireEvent.change(search, { target: { value: "notes" } });
    fireEvent.submit(search);
    expect(screen.getByRole("searchbox")).toBe(search);
    expect(search).toHaveFocus();
    expect(search).toHaveValue("notes");
    act(() => {
      history.back();
    });
  });

  it("follows Back to another search on a wide screen", async () => {
    holdScreen("wide");
    const session = open("/search?q=plan");
    session.drive.search.mockReturnValue(new Promise(() => undefined));
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "notes" },
    });
    fireEvent.submit(screen.getByRole("searchbox"));

    act(() => {
      history.back();
    });
    await waitFor(() => {
      expect(screen.getByRole("searchbox")).toHaveValue("plan");
    });
  });

  it("opens the search from its button, the field taking the focus within the tap", () => {
    open("/my-drive");
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(getPlace().href).toBe("/search?q=");
    expect(screen.getByRole("searchbox")).toHaveFocus();
  });

  it("clears the words typed, keeping the search shown and the focus", () => {
    const session = open("/search?q=plan");
    session.drive.search.mockReturnValue(new Promise(() => undefined));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("searchbox")).toHaveFocus();
    expect(getPlace().href).toBe("/search?q=plan");
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("goes back, on a phone, to the page that opened the search, past the searches made there", async () => {
    const session = open("/my-drive");
    session.drive.search.mockReturnValue(new Promise(() => undefined));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    for (const words of ["plan", "plans"]) {
      fireEvent.change(screen.getByRole("searchbox"), {
        target: { value: words },
      });
      fireEvent.submit(screen.getByRole("searchbox"));
    }
    expect(getPlace().href).toBe("/search?q=plans");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => {
      expect(getPlace().href).toBe("/my-drive");
    });
    // Words typed there go with the search.
    expect(screen.getByRole("searchbox", { hidden: true })).toHaveValue("");
  });

  it("forgets the words typed but not searched once the search is left", async () => {
    open("/my-drive");
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "half typed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => {
      expect(getPlace().href).toBe("/my-drive");
    });
    expect(screen.getByRole("searchbox", { hidden: true })).toHaveValue("");
  });

  it("goes Home from a search that the app did not open", () => {
    const session = open("/search?q=plan");
    session.drive.search.mockReturnValue(new Promise(() => undefined));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(getPlace().href).toBe("/");
  });

  it("asks Drive again when the same search is submitted", async () => {
    const session = open("/search?q=plan");
    session.drive.search.mockResolvedValue({ items: [], incomplete: false });
    await waitFor(() => {
      expect(session.drive.search).toHaveBeenCalledOnce();
    });

    fireEvent.submit(screen.getByRole("searchbox"));
    await waitFor(() => {
      expect(session.drive.search).toHaveBeenCalledTimes(2);
    });
  });

  it("searches for nothing when no word is typed", () => {
    const session = open("/shortcuts");

    fireEvent.submit(screen.getByRole("searchbox"));
    expect(session.renew).not.toHaveBeenCalled();
    expect(getPlace().href).toBe("/shortcuts");
  });

  it("opens a pasted Drive link, renewing the token within the tap", () => {
    const session = open("/shortcuts");

    const search = screen.getByRole("searchbox");
    fireEvent.change(search, {
      target: {
        value: "https://drive.google.com/drive/folders/work?resourcekey=k",
      },
    });
    fireEvent.submit(search);
    expect(session.renew).toHaveBeenCalledOnce();
    expect(getPlace().href).toBe("/folder/work?resourcekey=k");
    expect(session.drive.search).not.toHaveBeenCalled();
    expect(search).toHaveValue("");

    fireEvent.change(search, {
      target: {
        value: "https://drive.google.com/file/d/plan/view?resourcekey=k",
      },
    });
    fireEvent.submit(search);
    expect(session.renew).toHaveBeenCalledTimes(2);
    expect(getPlace().href).toBe("/edit?id=plan&resourcekey=k");
  });

  it("searches again when the address of the search shown is pasted", async () => {
    const session = open("/search?q=plan");
    session.drive.search.mockResolvedValue({ items: [], incomplete: false });
    await waitFor(() => {
      expect(session.drive.search).toHaveBeenCalledOnce();
    });

    const search = screen.getByRole("searchbox");
    fireEvent.change(search, {
      target: { value: `${window.location.origin}/search?q=plan` },
    });
    fireEvent.submit(search);
    expect(search).toHaveValue("plan");
    await waitFor(() => {
      expect(session.drive.search).toHaveBeenCalledTimes(2);
    });
  });

  it("opens a pasted link only once the page with unsaved changes lets it", () => {
    const session = open("/shortcuts");
    guardLeaving(() => false);

    const search = screen.getByRole("searchbox");
    const link = "https://drive.google.com/drive/folders/work";
    fireEvent.change(search, { target: { value: link } });
    fireEvent.submit(search);
    expect(session.renew).not.toHaveBeenCalled();
    expect(getPlace().href).toBe("/shortcuts");
    expect(search).toHaveValue(link);
  });

  it("leaves a folder's dialogs behind when another folder opens", async () => {
    const drive = fakeDrive();
    const work = folderItem("Work", { id: "work", parents: ["my-root"] });
    work.capabilities.canAddChildren = true;
    drive.getMetadata.mockImplementation(metadataOf(metadata(work)));
    drive.listChildren.mockResolvedValue([]);
    open("/folder/work", drive);
    fireEvent.click(await screen.findByRole("button", { name: "New note" }));
    expect(screen.getByRole("dialog")).toBeVisible();

    act(() => {
      navigate("/folder/other");
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("searches what was typed, without the phone's capitals or corrections", () => {
    open("/");

    const search = screen.getByRole("searchbox", {
      name: "Search Markdown files by name",
    });
    expect(search).toHaveAttribute("autocapitalize", "none");
    expect(search).toHaveAttribute("autocorrect", "off");
    expect(search).toHaveAttribute("spellcheck", "false");
  });

  it("says when a URL opens nothing, and leads back Home", () => {
    open("/nowhere");

    expect(
      screen.getByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Go to Home" }));
    expect(getPlace().href).toBe("/");
  });

  it("says when what was shared with the app leads nowhere, and leads back Home", () => {
    open("/share");

    expect(
      screen.getByRole("heading", { name: "Nothing to open" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "DriveMD opens links to Google Drive files and folders, and to its own pages.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Go to Home" }));
    expect(getPlace().href).toBe("/");
  });

  it("goes Home from the app's name", () => {
    open("/nowhere");

    fireEvent.click(screen.getByRole("link", { name: "DriveMD" }));
    expect(getPlace().href).toBe("/");
  });
});

describe("Navigator's note bar", () => {
  function openPlan() {
    const drive = fakeDrive();
    drive.getMetadata.mockImplementation(
      metadataOf(
        metadata(folderItem("Work", { id: "work", parents: ["my-root"] })),
        metadata(driveItem("plan.md", { id: "plan", parents: ["work"] })),
      ),
    );
    drive.listChildren.mockResolvedValue([]);
    drive.markViewed.mockResolvedValue();
    drive.getContent.mockResolvedValue(new TextEncoder().encode("# The plan"));
    open("/edit?id=plan", drive);
    return within(screen.getByRole("banner"));
  }

  it("names the note and who changed it last, with its tools and no search", async () => {
    const bar = openPlan();

    expect(
      await bar.findByRole("heading", { level: 1, name: "plan.md" }),
    ).toBeVisible();
    expect(
      await bar.findByText(/^Last modified by Ada Lovelace on /),
    ).toBeVisible();
    expect(await bar.findByRole("button", { name: "Edit" })).toBeVisible();
    expect(bar.queryByRole("searchbox")).toBeNull();
    expect(bar.queryByRole("button", { name: "Search" })).toBeNull();
    expect(
      screen.queryByRole("navigation", { name: "Breadcrumbs" }),
    ).toBeNull();
  });

  it("leads a phone up to the note's folder, rebuilt from Drive", async () => {
    const bar = openPlan();

    expect(
      await bar.findByRole("link", { name: "Back to Work" }),
    ).toHaveAttribute("href", "/folder/work");
    expect(bar.queryByRole("link", { name: "DriveMD" })).toBeNull();
    expect(bar.queryByRole("button", { name: /^Account, / })).toBeNull();
  });

  it("leads a phone Home from a note Drive cannot place", async () => {
    const drive = fakeDrive();
    drive.getMetadata.mockRejectedValue(new DriveError(404, "Not found"));
    open("/edit?id=plan", drive);

    expect(
      await within(screen.getByRole("banner")).findByRole("link", {
        name: "Back to Home",
      }),
    ).toHaveAttribute("href", "/");
  });

  it("leads a phone Home from a note opened offline", () => {
    onlineManager.setOnline(false);
    open("/edit?id=plan");

    expect(
      within(screen.getByRole("banner")).getByRole("link", {
        name: "Back to Home",
      }),
    ).toHaveAttribute("href", "/");
  });

  it("leads a wider screen Home by DriveMD's mark, beside the account", async () => {
    holdScreen("tablet");
    const bar = openPlan();

    await bar.findByRole("heading", { level: 1, name: "plan.md" });
    expect(bar.getByRole("link", { name: "DriveMD" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(bar.queryByRole("link", { name: /^Back to/ })).toBeNull();
    expect(
      bar.getByRole("button", { name: `Account, ${EMAIL}` }),
    ).toBeVisible();
  });
});

describe("Navigator's app bar on a phone", () => {
  const myDrive = { name: "My Drive", href: "/my-drive" };
  const work = { name: "Work", href: "/folder/work" };

  it("names a folder and leads up to the one above, along the path taken", () => {
    const { drive } = open("/");
    drive.getMetadata.mockReturnValue(new Promise(() => undefined));
    drive.listChildren.mockReturnValue(new Promise(() => undefined));
    act(() => {
      navigate(work.href, [myDrive, work]);
    });
    const bar = screen.getByRole("banner");
    expect(within(bar).getByRole("heading", { level: 1 })).toHaveTextContent(
      "Work",
    );
    const up = within(bar).getByRole("link", { name: "Back to My Drive" });
    expect(up).toHaveAttribute("href", "/my-drive");
    fireEvent.click(up);
    expect(getPlace()).toMatchObject({ href: "/my-drive", trail: [myDrive] });
  });

  it("names a root, and leads up to Home", () => {
    open("/shortcuts");
    const bar = screen.getByRole("banner");
    expect(within(bar).getByRole("heading", { level: 1 })).toHaveTextContent(
      "Shortcuts",
    );
    expect(
      within(bar).getByRole("link", { name: "Back to Home" }),
    ).toHaveAttribute("href", "/");
  });

  it("says the folder is on its way, and offers no way up until Drive gives its path", () => {
    const { drive } = open("/folder/work");
    drive.getMetadata.mockReturnValue(new Promise(() => undefined));
    const bar = screen.getByRole("banner");
    expect(within(bar).getByRole("heading", { level: 1 })).toHaveTextContent(
      "…",
    );
    expect(within(bar).queryByRole("link", { name: /^Back to/ })).toBeNull();
  });

  it("leads Home from a folder Drive cannot place", async () => {
    const drive = fakeDrive();
    drive.getMetadata.mockRejectedValue(new DriveError(404, "Not found"));
    open("/folder/work", drive);

    expect(
      await within(screen.getByRole("banner")).findByRole("link", {
        name: "Back to Home",
      }),
    ).toHaveAttribute("href", "/");
  });

  it("calls a folder Drive does not describe Folder, as its page does", async () => {
    const drive = fakeDrive();
    drive.getMetadata.mockRejectedValue(new Error("offline"));
    open("/folder/work", drive);
    const bar = screen.getByRole("banner");
    await waitFor(() => {
      expect(within(bar).getByRole("heading", { level: 1 })).toHaveTextContent(
        "Folder",
      );
    });
  });
});
