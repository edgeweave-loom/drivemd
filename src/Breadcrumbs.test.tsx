import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Breadcrumbs } from "./Breadcrumbs.tsx";
import { getPlace } from "./router.ts";
import { renderWithDrive, visit } from "./test/render.tsx";

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
  it("leads Home, then back along the path to the page", () => {
    renderWithDrive(<Breadcrumbs path={PATH} />);

    expect(
      crumbs()
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Home", "My Drive", "Work"]);
    expect(crumbs().queryByText("Notes")).toBeNull();
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
});
