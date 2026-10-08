import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { markTab } from "./drive-tab.ts";
import { FileContent } from "./FileContent.tsx";
import { driveItem, metadata } from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { renderWithDrive } from "./test/render.tsx";
import { holdScreen } from "./test/screen.ts";

const PLAN = metadata(driveItem("plan.md", { id: "plan" }), {
  md5Checksum: "aaaa",
  headRevisionId: "revision-1",
});

const utf8 = (text: string) => new TextEncoder().encode(text);

/** Opens plan.md in a tab that Drive's Open with opened. */
function openFromDrive() {
  const drive = fakeDrive();
  drive.getContent.mockResolvedValue(utf8("# The plan\n"));
  drive.getMetadata.mockResolvedValue(PLAN);
  markTab(true);
  return renderWithDrive(<FileContent file={PLAN} />, drive);
}

afterEach(() => {
  markTab(false);
});

describe("A note opened from Drive", () => {
  it.each(["wide", "tablet"] as const)(
    "opens in Editing on a %s screen, the source beside the preview",
    async (layout) => {
      holdScreen(layout);
      openFromDrive();

      expect(
        await screen.findByRole("region", { name: "Markdown" }),
      ).toBeVisible();
      expect(screen.getByRole("heading", { name: "The plan" })).toBeVisible();
      expect(screen.getByRole("button", { name: "Editing" })).toBeVisible();
    },
  );

  it("opens in reading on a phone", async () => {
    openFromDrive();

    expect(await screen.findByRole("button", { name: "Edit" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Markdown" })).toBeNull();
  });

  it("holds to the revision it opened with, as Editing does", async () => {
    holdScreen("wide");
    const { drive, rerender } = openFromDrive();
    await screen.findByRole("region", { name: "Markdown" });
    drive.getContent.mockResolvedValue(utf8("# Their plan\n"));

    rerender(
      <FileContent file={metadata(PLAN, { headRevisionId: "revision-2" })} />,
    );
    expect(
      await screen.findByRole("heading", { name: "The plan" }),
    ).toBeVisible();
    expect(drive.getContent).toHaveBeenCalledOnce();
  });

  it("opens in Viewing in a tab of the app's own", async () => {
    holdScreen("wide");
    markTab(false);
    const drive = fakeDrive();
    drive.getContent.mockResolvedValue(utf8("# The plan\n"));
    renderWithDrive(<FileContent file={PLAN} />, drive);

    expect(
      await screen.findByRole("button", { name: "Viewing" }),
    ).toBeVisible();
  });
});
