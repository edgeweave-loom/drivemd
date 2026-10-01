import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DriveError,
  TooLargeError,
  type DriveItem,
  type FileMetadata,
} from "./drive.ts";
import { Rendered } from "./Markdown.tsx";
import {
  driveItem,
  folderItem,
  metadata,
  metadataOf,
} from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { renderWithDrive } from "./test/render.tsx";

const PHOTO = metadata(
  driveItem("photo.png", {
    id: "photo",
    mimeType: "image/png",
    parents: ["img"],
  }),
  { size: 2_000 },
);
const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function open(text: string, ...files: FileMetadata[]) {
  const folders: Record<string, DriveItem[]> = {
    notes: [folderItem("img", { id: "img", parents: ["notes"] })],
    img: files,
  };
  const drive = fakeDrive();
  drive.listChildren.mockImplementation((ref) =>
    Promise.resolve(folders[ref.id] ?? []),
  );
  drive.getMetadata.mockImplementation(metadataOf(...files));
  drive.getContent.mockResolvedValue(BYTES);
  const rendered = renderWithDrive(
    <Rendered text={text} folder={{ id: "notes" }} />,
    drive,
  );
  return { ...rendered, drive };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("relative images in a note", () => {
  it("show an image from Drive, read with the user's token", async () => {
    const made = vi.spyOn(URL, "createObjectURL");
    const revoked = vi.spyOn(URL, "revokeObjectURL");
    const { drive, unmount } = open("![A photo](img/photo.png)", PHOTO);

    const image = await screen.findByRole("img", { name: "A photo" });
    await waitFor(() => {
      expect(image.getAttribute("src")).toMatch(/^blob:/);
    });
    expect(drive.getContent).toHaveBeenCalledExactlyOnceWith(PHOTO, 10_000_000);
    const [blob] = made.mock.calls[0] ?? [];
    expect(blob).toBeInstanceOf(Blob);
    expect((blob as Blob).type).toBe("image/png");
    unmount();
    expect(revoked).toHaveBeenCalledWith(image.getAttribute("src"));
  });

  it.each([
    ["an image over 10 MB", metadata(PHOTO, { size: 10_000_001 })],
    [
      "an image the user may not download",
      metadata(PHOTO, {
        capabilities: { ...PHOTO.capabilities, canDownload: false },
      }),
    ],
    [
      "a file that is not an image",
      metadata(PHOTO, { mimeType: "application/pdf" }),
    ],
  ])("link to Google Drive for %s", async (_, file) => {
    const { drive } = open("![A photo](img/photo.png)", file);

    const link = await screen.findByRole("link", { name: "Image: A photo" });
    expect(link).toHaveAttribute(
      "href",
      "https://drive.google.com/file/d/photo/view",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.queryByRole("img")).toBeNull();
    expect(drive.getContent).not.toHaveBeenCalled();
  });

  it("link to Google Drive for an image that grew past 10 MB", async () => {
    const { drive } = open("![A photo](img/photo.png)", PHOTO);
    drive.getContent.mockRejectedValue(new TooLargeError("Too large"));

    expect(
      await screen.findByRole("link", { name: "Image: A photo" }),
    ).toBeVisible();
  });

  it("show the description, faded, for an image that is not there", async () => {
    open("![A photo](img/gone.png) ![](img/none.png)");

    await waitFor(() => {
      expect(screen.getByText("A photo")).toHaveClass("unresolved");
    });
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("show the description when Drive fails to send the image", async () => {
    const { drive } = open("![A photo](img/photo.png)", PHOTO);
    drive.getContent.mockRejectedValue(new DriveError(500, "Backend error"));

    await waitFor(() => {
      expect(screen.getByText("A photo")).toHaveAttribute(
        "title",
        "Google Drive could not send this image",
      );
    });
  });
});
