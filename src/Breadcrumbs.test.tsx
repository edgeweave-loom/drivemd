import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Breadcrumbs } from "./Breadcrumbs.tsx";
import { getPlace } from "./router.ts";
import { renderWithDrive, visit } from "./test/render.tsx";
import { holdScreen } from "./test/screen.ts";

const PATH = [
  { name: "My Drive", href: "/my-drive" },
  { name: "Work", href: "/folder/work" },
  { name: "Notes", href: "/folder/notes" },
];

function crumbs() {
  return within(screen.getByRole("navigation", { name: "Breadcrumbs" }));
}

afterEach(() => {
  visit("/");
});

describe("Breadcrumbs", () => {
  it("leads Home, then back along the path, and ends at the page", () => {
    renderWithDrive(<Breadcrumbs path={PATH} />);

    expect(
      crumbs()
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Home", "My Drive", "Work"]);
    const here = crumbs().getByText("Notes");
    expect(here).toHaveAttribute("aria-current", "page");
    expect(here.closest("a")).toBeNull();
  });

  it("leaves Home to the drawer and the rail on a wider screen", () => {
    holdScreen("tablet");
    renderWithDrive(<Breadcrumbs path={PATH} />);

    expect(
      crumbs()
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["My Drive", "Work", "Notes"]);
    expect(crumbs().getAllByRole("link")).toHaveLength(2);
  });

  it("keeps the path up to the crumb followed", () => {
    renderWithDrive(<Breadcrumbs path={PATH} />);

    fireEvent.click(crumbs().getByRole("link", { name: "Work" }));
    expect(getPlace()).toMatchObject({
      href: "/folder/work",
      trail: PATH.slice(0, 2),
    });
  });

  it("leads Home while the path is still unknown", () => {
    renderWithDrive(<Breadcrumbs path={undefined} />);

    expect(
      crumbs()
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Home"]);
  });

  it("shows nothing while the path is unknown on a wider screen", () => {
    holdScreen("wide");
    renderWithDrive(<Breadcrumbs path={undefined} />);

    expect(crumbs().queryAllByRole("listitem")).toEqual([]);
  });
});
