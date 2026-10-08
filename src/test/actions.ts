import { fireEvent, screen, within } from "@testing-library/react";

/** Opens the note's More actions menu, once the page offers it. */
export async function moreActions() {
  fireEvent.click(await screen.findByRole("button", { name: "More actions" }));
  return within(screen.getByRole("dialog", { name: "More actions" }));
}

/** Picks a mode from the note's mode menu, as a wider screen than a phone's has. */
export async function pickMode(name: "Editing" | "Viewing") {
  fireEvent.click(
    await screen.findByRole("button", { name: /^(Editing|Viewing)$/ }),
  );
  fireEvent.click(
    within(screen.getByRole("menu", { name: "Mode" })).getByRole(
      "menuitemradio",
      { name },
    ),
  );
}
