import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DriveError } from "./drive.ts";
import { EntryList } from "./EntryList.tsx";
import { entriesOf } from "./listing.ts";
import { metadataQuery } from "./queries.ts";
import {
  driveItem,
  FOLDER,
  folderItem,
  metadata,
  shortcutItem,
} from "./test/drive-items.ts";
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

describe("EntryList, where it gives each note's folder", () => {
  it("names the folder a note sits in, once Drive answers", async () => {
    const drive = fakeDrive();
    drive.getMetadata.mockResolvedValue(
      metadata(folderItem("Work", { id: "work" })),
    );
    renderWithDrive(
      <EntryList
        entries={entriesOf([driveItem("plan.md", { parents: ["work"] })])}
        trail={undefined}
        empty="Nothing"
        located
      />,
      drive,
    );
    const plan = screen.getByRole("link", { name: "plan.md" });
    await waitFor(() => {
      expect(plan).toHaveAccessibleDescription("Work");
    });
    expect(drive.getMetadata).toHaveBeenCalledWith({ id: "work" });
  });

  it("says Shared with me for a note whose folder Drive does not name", () => {
    const drive = fakeDrive();
    renderWithDrive(
      <EntryList
        entries={entriesOf([driveItem("shared.md", { parents: [] })])}
        trail={undefined}
        empty="Nothing"
        located
      />,
      drive,
    );
    expect(
      screen.getByRole("link", { name: "shared.md" }),
    ).toHaveAccessibleDescription("Shared with me");
    expect(drive.getMetadata).not.toHaveBeenCalled();
  });

  it("names a shortcut's folder too", async () => {
    const drive = fakeDrive();
    drive.checkShortcut.mockResolvedValue(undefined);
    drive.getMetadata.mockResolvedValue(
      metadata(folderItem("Work", { id: "parent" })),
    );
    renderWithDrive(
      <EntryList
        entries={entriesOf([shortcutItem("plan.md", "text/markdown")])}
        trail={undefined}
        empty="Nothing"
        located
      />,
      drive,
    );
    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: /plan\.md/ }),
      ).toHaveAccessibleDescription("Work");
    });
  });

  it("joins the folder to the time only once Drive names it", async () => {
    const drive = fakeDrive();
    let answer: (folder: ReturnType<typeof metadata>) => void = () => undefined;
    drive.getMetadata.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    renderWithDrive(
      <EntryList
        entries={entriesOf([
          driveItem("plan.md", {
            parents: ["work"],
            modifiedTime: "2026-09-01T10:00:00.000Z",
          }),
        ])}
        trail={undefined}
        empty="Nothing"
        located
      />,
      drive,
    );
    const details = screen
      .getByRole("link", { name: "plan.md" })
      .querySelector(".details");
    expect(details).toHaveTextContent(/^Sep 1, 2026$/);
    act(() => {
      answer(metadata(folderItem("Work", { id: "work" })));
    });
    await waitFor(() => {
      expect(details).toHaveTextContent(/^Work · Sep 1, 2026$/);
    });
  });

  it("shares the folder's details with the rest of the app", async () => {
    const drive = fakeDrive();
    const { client } = renderWithDrive(
      <EntryList
        entries={entriesOf([driveItem("plan.md", { parents: ["work"] })])}
        trail={undefined}
        empty="Nothing"
        located
      />,
      drive,
    );
    // As a folder page or the breadcrumbs would read them.
    act(() => {
      client.setQueryData(
        metadataQuery(drive, { id: "work" }).queryKey,
        metadata(folderItem("Work", { id: "work" })),
      );
    });
    expect(
      await screen.findByText("Work", { selector: ".location" }),
    ).toBeVisible();
  });

  it("gives no folder where the list does not ask for it", () => {
    const drive = fakeDrive();
    renderWithDrive(
      <EntryList
        entries={entriesOf([driveItem("plan.md", { parents: ["work"] })])}
        trail={undefined}
        empty="Nothing"
      />,
      drive,
    );
    expect(drive.getMetadata).not.toHaveBeenCalled();
  });
});
