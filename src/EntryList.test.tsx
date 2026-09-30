import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DriveError } from "./drive.ts";
import { EntryList } from "./EntryList.tsx";
import { entriesOf } from "./listing.ts";
import { FOLDER, shortcutItem } from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { renderWithDrive } from "./test/render.tsx";

function renderShortcut(check: Promise<"missing" | "trashed" | undefined>) {
  const drive = fakeDrive();
  drive.checkShortcut.mockReturnValue(check);
  const { client } = renderWithDrive(
    <EntryList
      entries={entriesOf([shortcutItem("Notes", FOLDER)])}
      trail={undefined}
      empty="Nothing"
    />,
    drive,
  );
  return { drive, client };
}

describe("EntryList", () => {
  it("shows a shortcut at once, and keeps it once its target checks out", async () => {
    const { drive } = renderShortcut(Promise.resolve(undefined));

    expect(screen.getByRole("link", { name: /Notes/ })).toBeVisible();
    await expect
      .poll(() => drive.checkShortcut.mock.calls)
      .toEqual([
        [{ id: "target-Notes", mimeType: FOLDER, resourceKey: "key" }],
      ]);
    expect(screen.getByRole("link", { name: /Notes/ })).toBeVisible();
  });

  it.each([
    ["missing", "Deleted, or not shared with you"],
    ["trashed", "In the trash"],
  ] as const)(
    "greys out a shortcut whose target is %s, saying why",
    async (broken, reason) => {
      renderShortcut(Promise.resolve(broken));

      expect(await screen.findByText(reason)).toBeVisible();
      const link = screen.getByRole("link", { name: /Notes/ });
      expect(link).toHaveAttribute("aria-disabled", "true");
      expect(link).not.toHaveAttribute("href");
    },
  );

  it("opens a shortcut again once its target is back", async () => {
    const { drive, client } = renderShortcut(Promise.resolve("trashed"));
    await screen.findByText("In the trash");

    drive.checkShortcut.mockResolvedValue(undefined);
    await act(() => client.invalidateQueries());
    await waitFor(() => {
      expect(screen.queryByText("In the trash")).toBeNull();
    });
    expect(screen.getByRole("link", { name: /Notes/ })).toHaveAttribute(
      "href",
      "/folder/target-Notes?resourcekey=key",
    );
  });

  it("keeps a shortcut whose check failed", async () => {
    const { drive } = renderShortcut(
      Promise.reject(new DriveError(403, "Rate Limit Exceeded")),
    );

    await expect
      .poll(() => drive.checkShortcut.mock.results[0]?.type)
      .toBe("return");
    await new Promise((resolve) => setTimeout(resolve));
    expect(screen.getByRole("link", { name: /Notes/ })).toHaveAttribute("href");
  });
});
