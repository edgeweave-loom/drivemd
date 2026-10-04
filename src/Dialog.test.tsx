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

  it("lets a dialog over one that stays close on Escape, and closes that one only", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <Dialog title="Welcome back">
        <Dialog title="Discard?" onClose={inner}>
          <p>Sure?</p>
        </Dialog>
        <Dialog title="Rename" onClose={outer}>
          <p>Name</p>
        </Dialog>
      </Dialog>,
    );

    const discard = screen.getByRole("dialog", { name: "Discard?" });
    expect(fireEvent(discard, new Event("cancel", { cancelable: true }))).toBe(
      true,
    );
    fireEvent(discard, new Event("close"));
    expect(inner).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
  });

  it("opens again when the browser closes it on Escape, if it cannot be closed", () => {
    render(
      <Dialog title="Welcome back">
        <p>Continue</p>
      </Dialog>,
    );

    const dialog = screen.getByRole<HTMLDialogElement>("dialog", {
      name: "Welcome back",
    });
    // Without a tap since the last refusal, browsers close it anyway.
    fireEvent(dialog, new Event("cancel", { cancelable: false }));
    dialog.close();
    expect(dialog.open).toBe(true);
  });

  it("opens again, the lowest first, the dialogs that cannot close that the browser closed together", () => {
    const onClose = vi.fn();
    render(
      <>
        <Dialog title="Saving">
          <p>Waiting for Drive</p>
        </Dialog>
        <Dialog title="Rename" onClose={onClose}>
          <p>Name</p>
        </Dialog>
        <Dialog title="Welcome back">
          <p>Continue</p>
        </Dialog>
      </>,
    );
    const dialog = (name: string) =>
      screen.getByRole<HTMLDialogElement>("dialog", { name });
    const saving = dialog("Saving");
    const rename = dialog("Rename");
    const welcome = dialog("Welcome back");
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");

    // As browsers do on Escape, once a page has refused it without a tap.
    for (const dialog of [saving, rename, welcome]) dialog.open = false;
    fireEvent(welcome, new Event("close"));
    expect(showModal.mock.contexts).toEqual([saving, welcome]);
    expect(rename.open).toBe(false);
    expect(welcome).toHaveAttribute("closedby", "none");
    expect(rename).not.toHaveAttribute("closedby");
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
