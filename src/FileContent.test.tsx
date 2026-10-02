import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DriveError, TooLargeError, type FileMetadata } from "./drive.ts";
import { FileContent } from "./FileContent.tsx";
import { driveItem, metadata } from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { renderWithDrive } from "./test/render.tsx";

const PLAN = metadata(driveItem("plan.md", { id: "plan" }));
const MB = 1_000_000;

function utf8(text: string) {
  return new TextEncoder().encode(text);
}

function open(file: FileMetadata, content = utf8("# Plan\n\nTea.\n")) {
  const drive = fakeDrive();
  drive.getContent.mockResolvedValue(content);
  return renderWithDrive(<FileContent file={file} />, drive);
}

describe("FileContent", () => {
  it("reads the content of the file Drive described, and shows it", async () => {
    const { drive } = open(PLAN);

    expect(await screen.findByText(/^# Plan/)).toBeVisible();
    expect(drive.getContent).toHaveBeenCalledExactlyOnceWith(PLAN, MB);
    expect(screen.queryByText(/only|Locked/)).toBeNull();
  });

  it.each([
    [{ canModifyContent: false, canComment: false }, {}, "View only"],
    [{ canModifyContent: false, canComment: true }, {}, "Comment only"],
    [{}, { locked: true, lockReason: "Approved" }, "Locked: Approved"],
    [{}, { locked: true }, "Locked"],
  ])(
    "says why the user cannot edit it: %j %j",
    async (granted, changes, reason) => {
      open(
        metadata(PLAN, {
          ...changes,
          capabilities: { ...PLAN.capabilities, ...granted },
        }),
      );

      expect(
        await screen.findByText(reason, { selector: ".read-only" }),
      ).toBeVisible();
      expect(screen.getByText(/^# Plan/)).toBeVisible();
    },
  );

  it.each([
    [
      new Uint8Array([0x63, 0x61, 0x66, 0xe9]),
      "Not UTF-8 text: DriveMD only shows it",
    ],
    [utf8("a\r\nb\nc"), "Mixed line breaks: DriveMD only shows it"],
  ])(
    "shows, read-only, a file it could not write back unchanged",
    async (content, reason) => {
      open(PLAN, content);

      expect(await screen.findByText(reason)).toBeVisible();
    },
  );

  it("does not read a file over 1 MB, and leads to Google Drive", async () => {
    const { drive } = open(
      metadata(PLAN, { size: 2_400_000, resourceKey: "key-1" }),
    );

    expect(
      await screen.findByText(
        "This file holds 2.4 MB, and DriveMD opens files up to 1 MB.",
      ),
    ).toBeVisible();
    const link = screen.getByRole("link", { name: "Open it in Google Drive" });
    expect(link).toHaveAttribute(
      "href",
      "https://drive.google.com/file/d/plan/view?resourcekey=key-1",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(drive.getContent).not.toHaveBeenCalled();
  });

  it("says so when the file grew past 1 MB since Drive described it", async () => {
    const drive = fakeDrive();
    drive.getContent.mockRejectedValue(new TooLargeError("Too large"));
    renderWithDrive(<FileContent file={PLAN} />, drive);

    expect(
      await screen.findByText(
        "This file holds over 1 MB, and DriveMD opens files up to 1 MB.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open it in Google Drive" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(drive.getContent).toHaveBeenCalledOnce();
  });

  it("reads a file of 1 MB exactly", async () => {
    const { drive } = open(metadata(PLAN, { size: MB }));

    expect(await screen.findByText(/Tea\./)).toBeVisible();
    expect(drive.getContent).toHaveBeenCalledOnce();
  });

  it("says why it cannot show a file the user may not download", async () => {
    const { drive } = open(
      metadata(PLAN, {
        capabilities: { ...PLAN.capabilities, canDownload: false },
      }),
    );

    expect(
      await screen.findByText(
        "The file's owner does not let you download it, so DriveMD cannot show it.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open it in Google Drive" }),
    ).toHaveAttribute("href", "https://drive.google.com/file/d/plan/view");
    expect(drive.getContent).not.toHaveBeenCalled();
  });

  it("says when the content could not be read, and tries again on a tap", async () => {
    const drive = fakeDrive();
    drive.getContent.mockRejectedValueOnce(
      new DriveError(0, "Google Drive could not be reached"),
    );
    drive.getContent.mockResolvedValueOnce(utf8("Tea."));
    renderWithDrive(<FileContent file={PLAN} />, drive);

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Tea.")).toBeVisible();
  });
});
