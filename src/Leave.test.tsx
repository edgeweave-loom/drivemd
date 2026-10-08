import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileContent } from "./FileContent.tsx";
import { Link } from "./Link.tsx";
import { getPlace, navigate } from "./router.ts";
import { driveItem, metadata } from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { renderWithDrive, visit } from "./test/render.tsx";

const PLAN = metadata(driveItem("plan.md", { id: "plan" }));

async function edited() {
  visit("/edit?id=plan");
  const drive = fakeDrive();
  drive.getContent.mockResolvedValue(new TextEncoder().encode("- [ ] Boil\n"));
  drive.getMetadata.mockResolvedValue(PLAN);
  drive.keepRevision.mockResolvedValue();
  drive.saveContent.mockResolvedValue(
    metadata(PLAN, { md5Checksum: "bbbb", headRevisionId: "revision-2" }),
  );
  const rendered = renderWithDrive(<FileContent file={PLAN} />, drive);
  fireEvent.click(await screen.findByRole("checkbox"));
  return rendered;
}

function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

afterEach(() => {
  vi.restoreAllMocks();
  visit("/");
});

describe("leaving a note with unsaved changes", () => {
  it("has the browser warn before the page goes", async () => {
    await edited();

    expect(unload()).toBe(true);
  });

  it("asks before the app opens another page, and stays when the user says no", async () => {
    const asked = vi.spyOn(window, "confirm").mockReturnValue(false);
    await edited();

    navigate("/shortcuts");

    expect(asked).toHaveBeenCalledExactlyOnceWith(
      "This note has unsaved changes. Leave it anyway?",
    );
    expect(getPlace().route).toEqual({ name: "file", file: { id: "plan" } });
    asked.mockReturnValue(true);
    navigate("/shortcuts");
    expect(getPlace().route).toEqual({ name: "shortcuts" });
  });

  it("asks before a link renews the token, so that a refusal opens no Google window", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { renew, rerender } = await edited();
    rerender(
      <>
        <FileContent file={PLAN} />
        <Link to="/shortcuts">Shortcuts</Link>
      </>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Shortcuts" }));

    expect(renew).not.toHaveBeenCalled();
    expect(getPlace().route).toEqual({ name: "file", file: { id: "plan" } });
  });

  it("does not ask when the note's own address changes, as on a rename", async () => {
    const asked = vi.spyOn(window, "confirm");
    await edited();

    navigate("/edit?id=plan");

    expect(asked).not.toHaveBeenCalled();
  });

  it("warns and asks no more once saved", async () => {
    const asked = vi.spyOn(window, "confirm");
    await edited();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    });

    expect(unload()).toBe(false);
    navigate("/shortcuts");
    expect(asked).not.toHaveBeenCalled();
  });

  it("does not warn for a note without edits", async () => {
    visit("/edit?id=plan");
    const drive = fakeDrive();
    drive.getContent.mockResolvedValue(new TextEncoder().encode("Tea\n"));
    renderWithDrive(<FileContent file={PLAN} />, drive);
    await screen.findByText("Tea");

    expect(unload()).toBe(false);
  });
});
