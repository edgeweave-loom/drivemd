import { fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog.tsx";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Dialog", () => {
  it("lets Escape close it when it can be closed", () => {
    render(
      <Dialog title="Rename" onClose={vi.fn()}>
        <p>Name</p>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog", { name: "Rename" });
    expect(fireEvent(dialog, new Event("cancel", { cancelable: true }))).toBe(
      true,
    );
  });

  it("opens once, however often React sets it up", () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    render(
      <StrictMode>
        <Dialog title="Rename">
          <p>Name</p>
        </Dialog>
      </StrictMode>,
    );

    expect(showModal).toHaveBeenCalledOnce();
  });
});
