import "fake-indexeddb/auto";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countDrafts, deleteDrafts, writeDraft } from "./drafts.ts";
import { SignOut } from "./SignOut.tsx";

const ADA = "ada@example.com";

function draft(fileId: string) {
  return writeDraft(ADA, {
    fileId,
    headRevisionId: "revision-1",
    md5Checksum: "aaaa",
    text: "Tea",
    keptAt: "2026-10-02T09:00:00.000Z",
  });
}

function show() {
  const signOut = vi.fn();
  render(<SignOut account={ADA} onSignOut={signOut} />);
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  return signOut;
}

beforeEach(async () => {
  await deleteDrafts(ADA);
});

afterEach(() => {
  vi.unstubAllGlobals();
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

    expect(
      await screen.findByText(
        "1 note has unsaved changes on this device. Signing out discards them.",
      ),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Discard and sign out" }),
    );

    await waitFor(() => {
      expect(signOut).toHaveBeenCalledOnce();
    });
    await expect(countDrafts(ADA)).resolves.toBe(0);
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
