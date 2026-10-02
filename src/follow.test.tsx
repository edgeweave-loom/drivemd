import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DriveItem } from "./drive.ts";
import { useFollow } from "./follow.ts";
import { getPlace } from "./router.ts";
import { driveItem } from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { renderWithDrive, visit } from "./test/render.tsx";

const NOTES: DriveItem[] = [
  driveItem("plan.md", { id: "plan", parents: ["notes"] }),
  driveItem("data.csv", {
    id: "data",
    mimeType: "text/csv",
    parents: ["notes"],
  }),
];

function Follower({ href }: { href: string }) {
  const follow = useFollow({ id: "notes" });
  return (
    <>
      <h2 id="user-content-set-up">Set up</h2>
      <button
        type="button"
        onClick={() => {
          follow(href);
        }}
      >
        Follow
      </button>
    </>
  );
}

function follow(href: string) {
  const drive = fakeDrive();
  drive.listChildren.mockResolvedValue(NOTES);
  const rendered = renderWithDrive(<Follower href={href} />, drive);
  fireEvent.click(screen.getByRole("button", { name: "Follow" }));
  return rendered;
}

afterEach(() => {
  visit("/");
  vi.restoreAllMocks();
});

describe("useFollow", () => {
  it("opens a note a relative link leads to in the app, renewing first", async () => {
    const { renew } = follow("plan.md");

    expect(renew).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(getPlace().route).toEqual({ name: "file", file: { id: "plan" } });
    });
  });

  it.each([
    ["a web page", "https://example.com/docs", "https://example.com/docs"],
    [
      "an address to write to",
      "mailto:ada@example.com",
      "mailto:ada@example.com",
    ],
    [
      "another file in Drive",
      "data.csv",
      "https://drive.google.com/file/d/data/view",
    ],
  ])("opens %s in a new tab, telling it nothing", async (_, href, opened) => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    follow(href);

    await waitFor(() => {
      expect(open).toHaveBeenCalledExactlyOnceWith(
        opened,
        "_blank",
        "noopener,noreferrer",
      );
    });
  });

  it("follows a link it found already, within the click", () => {
    const drive = fakeDrive();
    const { client } = renderWithDrive(<Follower href="plan.md" />, drive);
    client.setQueryData(["resolve", "notes", undefined, "plan.md"], {
      ref: { id: "plan" },
      name: "plan.md",
      mimeType: "text/markdown",
    });

    fireEvent.click(screen.getByRole("button", { name: "Follow" }));

    expect(getPlace().route).toEqual({ name: "file", file: { id: "plan" } });
    expect(drive.listChildren).not.toHaveBeenCalled();
  });

  it.each([
    ["Drive answers a second after the click", "late"],
    ["the page is gone", "gone"],
  ])("follows nothing when %s", async (_, how) => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const drive = fakeDrive();
    let answer: (items: DriveItem[]) => void = () => undefined;
    drive.listChildren.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { unmount } = renderWithDrive(<Follower href="plan.md" />, drive);
    fireEvent.click(screen.getByRole("button", { name: "Follow" }));

    if (how === "late")
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1_100);
    else unmount();
    answer(NOTES);

    await waitFor(() => {
      expect(drive.listChildren).toHaveBeenCalledOnce();
    });
    await new Promise((settle) => setTimeout(settle, 20));
    expect(getPlace().route).toEqual({ name: "home" });
    expect(open).not.toHaveBeenCalled();
  });

  it("scrolls to a heading of the note", () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    follow("#set-up");

    expect(scrolled.mock.contexts).toEqual([
      screen.getByRole("heading", { name: "Set up" }),
    ]);
  });

  it.each([["gone.md"], ["javascript:alert(1)"]])(
    "does nothing for %s",
    async (href) => {
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      const { drive } = follow(href);

      await new Promise((settle) => setTimeout(settle, 20));
      expect(open).not.toHaveBeenCalled();
      expect(getPlace().route).toEqual({ name: "home" });
      expect(drive.getMetadata).not.toHaveBeenCalled();
    },
  );
});
