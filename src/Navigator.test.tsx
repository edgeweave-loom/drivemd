import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Navigator } from "./Navigator.tsx";
import { getPlace, guardLeaving, navigate } from "./router.ts";
import {
  driveItem,
  folderItem,
  metadata,
  metadataOf,
} from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";

const EMAIL = "ada@example.com";

function open(path: string, drive = fakeDrive()) {
  history.replaceState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  const session = { drive, renew: vi.fn(), signOut: vi.fn() };
  render(<Navigator session={session} email={EMAIL} signedIn />);
  return session;
}

afterEach(() => {
  guardLeaving(undefined);
  history.replaceState(null, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
});

describe("Navigator", () => {
  it("shows the account and signs out", async () => {
    const session = open("/");

    expect(screen.getByText(EMAIL)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
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
      await screen.findByRole("heading", { name: "My Drive" }),
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

    expect(screen.getByRole("heading", { name: heading })).toBeVisible();
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

  it("follows Back to another search", async () => {
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
        value: "https://drive.google.com/file/d/plan/view?resourcekey=k",
      },
    });
    fireEvent.submit(search);
    expect(session.renew).toHaveBeenCalledOnce();
    expect(getPlace().href).toBe("/edit?id=plan&resourcekey=k");
    expect(session.drive.search).not.toHaveBeenCalled();
    expect(search).toHaveValue("");
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

  it("opens a file's page", () => {
    open("/edit?id=plan");

    expect(
      screen.getByRole("navigation", { name: "Breadcrumbs" }),
    ).toBeVisible();
  });

  it("leaves a folder's dialogs behind when another folder opens", async () => {
    const drive = fakeDrive();
    const work = folderItem("Work", { id: "work", parents: ["my-root"] });
    work.capabilities.canAddChildren = true;
    drive.getMetadata.mockImplementation(metadataOf(metadata(work)));
    drive.listChildren.mockResolvedValue([]);
    open("/folder/work", drive);
    fireEvent.click(await screen.findByRole("button", { name: "New" }));
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
