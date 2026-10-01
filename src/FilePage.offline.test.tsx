import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilePage } from "./FilePage.tsx";
import { driveItem, metadata, metadataOf } from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { renderWithDrive } from "./test/render.tsx";

// The viewer's code could not be fetched: the connection dropped, or a new
// release replaced it.
vi.mock("./FileContent.tsx", () => {
  throw new TypeError("Failed to fetch dynamically imported module");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FilePage without its viewer", () => {
  it("says the viewer could not load, and reloads the app on a tap", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    const drive = fakeDrive();
    drive.getMetadata.mockImplementation(
      metadataOf(metadata(driveItem("plan.md", { id: "plan" }))),
    );
    drive.markViewed.mockResolvedValue();
    renderWithDrive(
      <FilePage
        file={{ id: "plan" }}
        trail={[{ name: "plan.md", href: "/edit?id=plan" }]}
      />,
      drive,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "DriveMD could not load its viewer. Check your connection, then reload it.",
    );
    expect(screen.getByRole("heading", { name: "plan.md" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledOnce();
  });
});
