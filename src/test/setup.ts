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
  // Nor does it know what is on screen: everything is.
  window.IntersectionObserver = class {
    readonly report: IntersectionObserverCallback;
    constructor(report: IntersectionObserverCallback) {
      this.report = report;
    }
    observe(target: Element) {
      this.report(
        [{ target, isIntersecting: true } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }
    disconnect() {
      return undefined;
    }
  } as unknown as typeof IntersectionObserver;
  installScreen();
}

afterEach(() => {
  cleanup();
  holdScreen("phone");
});
