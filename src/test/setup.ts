import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { holdScreen, installScreen } from "./screen.ts";

// Tests that run in Node have no page at all.
if ("window" in globalThis) {
  // jsdom has no modal dialogs: an open one is enough for the tests.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
  // jsdom does not lay pages out, so it cannot scroll them.
  window.scrollTo = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
  installScreen();
}

afterEach(() => {
  cleanup();
  holdScreen("phone");
});
