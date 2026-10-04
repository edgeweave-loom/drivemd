import "fake-indexeddb/auto";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rememberAccount } from "./auth.ts";
import { countDrafts, deleteDrafts, readDraft, writeDraft } from "./drafts.ts";
import { keepPendingDrafts, useKeptDraft } from "./keep-draft.ts";
import { guardLeaving } from "./router.ts";
import { SignOut } from "./SignOut.tsx";

const ADA = "ada@example.com";
const GRACE = "grace@example.com";

function draft(fileId: string) {
  return writeDraft(ADA, {
    fileId,
    name: `${fileId}.md`,
    resourceKey: undefined,
    headRevisionId: "revision-1",
    md5Checksum: "aaaa",
    text: "Tea",
    keptAt: "2026-10-02T09:00:00.000Z",
  });
}

/** A note typed into a moment ago: its edits are not kept yet. */
function Typed() {
  useKeptDraft(
    ADA,
    "plan",
    {
      fileId: "plan",
      name: "plan.md",
      resourceKey: undefined,
      headRevisionId: "revision-1",
      md5Checksum: "aaaa",
      text: "Typed",
    },
    () => undefined,
  );
  return null;
}

function show() {
  const signOut = vi.fn();
  render(<SignOut account={ADA} onSignOut={signOut} />);
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  return signOut;
}

beforeEach(async () => {
  rememberAccount(ADA);
  await deleteDrafts(ADA);
  await deleteDrafts(GRACE);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SignOut", () => {
  it("signs out at once when nothing unsaved is on the device", async () => {
    const signOut = show();

    await waitFor(() => {
      expect(signOut).toHaveBeenCalledOnce();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says how many notes have unsaved changes, and keeps them on Cancel", async () => {
    await draft("plan");
    await draft("notes");
    const signOut = show();

    const dialog = await screen.findByRole("dialog", {
      name: "Discard unsaved changes?",
    });
    expect(dialog).toHaveTextContent(
      "2 notes have unsaved changes on this device. Signing out discards them.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(signOut).not.toHaveBeenCalled();
    await expect(countDrafts(ADA)).resolves.toBe(2);
  });

  it("discards them, then signs out, once the user confirms", async () => {
    await draft("plan");
    const signOut = show();

    // The dialog opens once it has rendered.
    await waitFor(() => {
      expect(
        screen.getByText(
          "1 note has unsaved changes on this device. Signing out discards them.",
        ),
      ).toBeVisible();
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Discard and sign out" }),
    );

    await waitFor(() => {
      expect(signOut).toHaveBeenCalledOnce();
    });
    await expect(countDrafts(ADA)).resolves.toBe(0);
  });

  it("counts the changes of the last half second too", async () => {
    const signOut = vi.fn();
    render(
      <>
        <Typed />
        <SignOut account={ADA} onSignOut={signOut} />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(
      await screen.findByRole("dialog", { name: "Discard unsaved changes?" }),
    ).toHaveTextContent("1 note has unsaved changes");
    expect(signOut).not.toHaveBeenCalled();
  });

  it("stays signed in, and says so, when the device would not discard them", async () => {
    await draft("plan");
    const signOut = show();
    await screen.findByRole("dialog", { name: "Discard unsaved changes?" });
    vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(() => {
      throw new DOMException("Quota", "QuotaExceededError");
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Discard and sign out" }),
    );

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(signOut).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Discard and sign out" }),
    ).toBeEnabled();
  });

  it("keeps nothing more while it asks, and keeps again on Cancel", async () => {
    await draft("plan");
    const signOut = vi.fn();
    const page = (typing: boolean) => (
      <>
        {typing && <Typed />}
        <SignOut account={ADA} onSignOut={signOut} />
      </>
    );
    const { rerender } = render(page(false));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("dialog", { name: "Discard unsaved changes?" });

    // A note typed into meanwhile keeps nothing until the user stays.
    rerender(page(true));
    await keepPendingDrafts();
    await expect(readDraft(ADA, "plan")).resolves.toMatchObject({
      text: "Tea",
    });
    await expect(countDrafts(ADA)).resolves.toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await keepPendingDrafts();
    await expect(readDraft(ADA, "plan")).resolves.toMatchObject({
      text: "Typed",
    });
  });

  it("discards the changes of the account another window switched to, as it signs that one out too", async () => {
    await draft("plan");
    await writeDraft(GRACE, {
      fileId: "notes",
      name: "notes.md",
      resourceKey: undefined,
      headRevisionId: "revision-1",
      md5Checksum: "aaaa",
      text: "Coffee",
      keptAt: "2026-10-02T09:00:00.000Z",
    });
    rememberAccount(GRACE);
    const signOut = show();

    // The dialog opens once it has rendered.
    await waitFor(() => {
      expect(
        screen.getByText(
          "2 notes have unsaved changes on this device. Signing out discards them.",
        ),
      ).toBeVisible();
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Discard and sign out" }),
    );

    await waitFor(() => {
      expect(signOut).toHaveBeenCalledOnce();
    });
    await expect(countDrafts(GRACE)).resolves.toBe(0);
  });

  it("tries to discard them even when it could not count them", async () => {
    await draft("plan");
    vi.spyOn(IDBObjectStore.prototype, "count").mockImplementation(() => {
      throw new DOMException("Lost", "UnknownError");
    });
    const signOut = show();

    await waitFor(() => {
      expect(signOut).toHaveBeenCalledOnce();
    });
    vi.restoreAllMocks();
    await expect(countDrafts(ADA)).resolves.toBe(0);
  });

  it("asks before leaving a note's unsaved changes that the device did not keep", async () => {
    guardLeaving(() => false);
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new DOMException("Blocked", "SecurityError");
      },
    });
    const signOut = show();

    await new Promise((settle) => setTimeout(settle, 20));
    expect(signOut).not.toHaveBeenCalled();
    guardLeaving(undefined);
  });

  it("signs out on a device that keeps nothing", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new DOMException("Blocked", "SecurityError");
      },
    });
    const signOut = show();

    await waitFor(() => {
      expect(signOut).toHaveBeenCalledOnce();
    });
  });
});
