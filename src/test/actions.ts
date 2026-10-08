import { fireEvent, screen, within } from "@testing-library/react";

/** Opens the note's More actions menu, once the page offers it. */
export async function moreActions() {
  fireEvent.click(await screen.findByRole("button", { name: "More actions" }));
  return within(screen.getByRole("dialog", { name: "More actions" }));
}
