import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DriveError } from "./drive.ts";
import { SearchPage } from "./SearchPage.tsx";
import { driveItem } from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { renderWithDrive } from "./test/render.tsx";

function results() {
  const [list] = screen
    .getAllByRole("list")
    .filter((found) => !found.closest("nav"));
  if (!list) throw new Error("No results");
  return within(list)
    .getAllByRole("link")
    .map((link) => link.textContent);
}

describe("SearchPage", () => {
  it("lists the matching files as Drive orders them, newest change first", async () => {
    const drive = fakeDrive();
    drive.search.mockResolvedValue({
      items: [
        driveItem("weekly plan.md"),
        driveItem("Plan B.md"),
        driveItem(".plan.md"),
      ],
      incomplete: false,
    });
    renderWithDrive(<SearchPage text="plan" />, drive);

    expect(screen.getByRole("heading", { name: "Search: plan" })).toBeVisible();
    await screen.findByRole("link", { name: "weekly plan.md" });
    expect(results()).toEqual(["weekly plan.md", "Plan B.md"]);
    expect(drive.search).toHaveBeenCalledWith("plan");
  });

  it.each([
    ["myplan", "a word starting with “myplan”"],
    ["weekly plan", "words starting with “weekly” and “plan”"],
  ])("explains how names match when nothing does: %s", async (text, words) => {
    const drive = fakeDrive();
    drive.search.mockResolvedValue({
      items: [driveItem(".hidden plan.md")],
      incomplete: false,
    });
    renderWithDrive(<SearchPage text={text} />, drive);

    expect(
      await screen.findByText(
        `Among Drive's first 100 matches, no Markdown file has a name with ${words}. Drive matches the start of words: “plan” finds planning.md, not myplan.md.`,
      ),
    ).toBeVisible();
  });

  it("says when Drive left some drives out of the search", async () => {
    const drive = fakeDrive();
    drive.search.mockResolvedValue({
      items: [driveItem("plan.md")],
      incomplete: true,
    });
    renderWithDrive(<SearchPage text="plan" />, drive);

    expect(
      await screen.findByText(
        "Google Drive did not search every drive, so some matches may be missing.",
      ),
    ).toBeVisible();
    expect(results()).toEqual(["plan.md"]);
  });

  it("asks for words when there are none", () => {
    const drive = fakeDrive();
    renderWithDrive(<SearchPage text="" />, drive);

    expect(
      screen.getByText("Type words from a file's name to find it."),
    ).toBeVisible();
    expect(drive.search).not.toHaveBeenCalled();
  });

  it("says why Drive could not search", async () => {
    const drive = fakeDrive();
    drive.search.mockRejectedValue(
      new DriveError(0, "Google Drive could not be reached"),
    );
    renderWithDrive(<SearchPage text="plan" />, drive);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Google Drive could not be reached. Check your connection.",
    );
  });
});
