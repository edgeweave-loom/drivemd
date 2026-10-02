import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FileContent } from "./FileContent.tsx";
import { driveItem, metadata } from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { renderWithDrive } from "./test/render.tsx";

// The editor's code could not be fetched: the connection dropped, or a new
// release replaced it.
vi.mock("./Editor.tsx", () => {
  throw new TypeError("Failed to fetch dynamically imported module");
});

describe("editing without the editor's code", () => {
  it("says the editor could not load, leaving the note in view", async () => {
    const drive = fakeDrive();
    drive.getContent.mockResolvedValue(new TextEncoder().encode("# Tea"));
    renderWithDrive(
      <FileContent file={metadata(driveItem("plan.md", { id: "plan" }))} />,
      drive,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "DriveMD could not load its editor. Check your connection, then reload it.",
    );
    expect(screen.getByRole("button", { name: "Reload" })).toBeVisible();
  });
});
