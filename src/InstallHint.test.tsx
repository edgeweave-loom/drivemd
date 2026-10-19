import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holdStandalone, holdTouch } from "./test/screen.ts";

// Got it holds for the page: each test loads the module afresh.
let InstallHint: typeof import("./InstallHint.tsx").InstallHint;

function hint() {
  return screen.queryByRole("region", {
    name: "Add DriveMD to your Home Screen",
  });
}

describe("InstallHint", () => {
  beforeEach(async () => {
    vi.resetModules();
    ({ InstallHint } = await import("./InstallHint.tsx"));
    holdTouch(true);
    holdStandalone(false);
  });

  afterEach(() => {
    holdTouch(false);
    holdStandalone(undefined);
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("tells the user on a touch screen how to add DriveMD to the Home Screen from Safari", () => {
    render(<InstallHint />);
    expect(hint()).toHaveTextContent(
      "In Safari, tap Share, then Add to Home Screen, to open DriveMD in a window of its own.",
    );
  });

  it("says nothing once DriveMD runs from the Home Screen", () => {
    holdStandalone(true);
    render(<InstallHint />);
    expect(hint()).toBeNull();
  });

  it("says nothing in browsers that offer to install apps themselves", () => {
    holdStandalone(undefined);
    render(<InstallHint />);
    expect(hint()).toBeNull();
  });

  it("says nothing with a mouse, as on a Mac, which has no Home Screen", () => {
    holdTouch(false);
    render(<InstallHint />);
    expect(hint()).toBeNull();
  });

  it("goes for good once the user taps Got it", async () => {
    const { unmount } = render(<InstallHint />);
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(hint()).toBeNull();
    expect(localStorage.length).toBe(1);
    unmount();
    // As a new page would.
    vi.resetModules();
    ({ InstallHint } = await import("./InstallHint.tsx"));

    render(<InstallHint />);
    expect(hint()).toBeNull();
  });

  it("goes for the page when the device keeps nothing", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    const { unmount } = render(<InstallHint />);
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(hint()).toBeNull();
    unmount();

    render(<InstallHint />);
    expect(hint()).toBeNull();
  });

  it("goes once the user taps Got it in another tab", () => {
    render(<InstallHint />);
    localStorage.setItem("drivemd.installHint", "dismissed");
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: "drivemd.installHint" }),
      );
    });
    expect(hint()).toBeNull();
  });
});
