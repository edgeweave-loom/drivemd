import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileContent } from "./FileContent.tsx";
import { Rendered } from "./Markdown.tsx";
import { DEFAULT_SETTINGS } from "./vault-settings.ts";
import { driveItem, metadata } from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";
import { renderWithDrive, visit } from "./test/render.tsx";

const PLAN = metadata(driveItem("plan.md", { id: "plan" }));

/** Opens the note with the text given, at the address given. */
function open(address: string, text: string) {
  visit(address);
  const drive = fakeDrive();
  drive.findVaultConfigs.mockResolvedValue([]);
  drive.getContent.mockResolvedValue(new TextEncoder().encode(text));
  return renderWithDrive(<FileContent file={PLAN} />, drive);
}

afterEach(() => {
  visit("/");
  vi.restoreAllMocks();
});

describe("a note opened at a heading", () => {
  it("shows that heading", async () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    open("/edit?id=plan#th%C3%A9", "# Plan\n\nIntro.\n\n## Thé\n\nGreen.");

    const heading = await screen.findByRole("heading", { name: "Thé" });
    expect(scrolled).toHaveBeenCalledOnce();
    expect(scrolled.mock.contexts).toEqual([heading]);
  });

  it("shows it once, not again when another revision of the note comes", async () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    const { rerender } = open("/edit?id=plan#tea", "# Plan\n\n## Tea");
    await screen.findByRole("heading", { name: "Tea" });

    rerender(<FileContent file={{ ...PLAN, headRevisionId: "revision-2" }} />);
    await screen.findByRole("heading", { name: "Tea" });
    expect(scrolled).toHaveBeenCalledOnce();
  });

  it("stays put when no part of the note has that name", async () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    open("/edit?id=plan#nowhere", "# Plan");

    await screen.findByRole("heading", { name: "Plan" });
    expect(scrolled).not.toHaveBeenCalled();
  });
});

describe("a link to a part of the note", () => {
  it("shows the heading it names, written with its encoding", () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    render(<Rendered text={"[Go](#th%C3%A9)\n\n## Thé"} />);

    fireEvent.click(screen.getByRole("link", { name: "Go" }));
    expect(scrolled.mock.contexts).toEqual([
      screen.getByRole("heading", { name: "Thé" }),
    ]);
  });

  it("opens the folded callouts around the block it names", () => {
    const page = render(
      <Rendered
        text={
          "[Go](#^answer)\n\n> [!faq]- Q\n> > [!note]- Inner\n> > Yes. ^answer"
        }
        vault={DEFAULT_SETTINGS}
      />,
    ).container;

    fireEvent.click(screen.getByRole("link", { name: "Go" }));
    expect(
      [...page.querySelectorAll("details")].map(({ open }) => open),
    ).toEqual([true, true]);
  });
});
