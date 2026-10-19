import "@testing-library/jest-dom/vitest";
import { onlineManager } from "@tanstack/react-query";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";
import { holdScreen, holdTouch, installScreen } from "./screen.ts";

// The viewer and the editor load as chunks of their own, which a busy
// machine may take more than the default second to render.
configure({ asyncUtilTimeout: 3_000 });

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
  // Nor does it open popovers, which it hides: the button that names one
  // shows it, or hides it again.
  HTMLElement.prototype.showPopover = function (this: HTMLElement) {
    this.style.display = "block";
    this.dispatchEvent(
      Object.assign(new Event("toggle"), { newState: "open" }),
    );
  };
  HTMLElement.prototype.hidePopover = function (this: HTMLElement) {
    this.style.removeProperty("display");
  };
  document.addEventListener("click", (event) => {
    const invoker =
      event.target instanceof Element
        ? event.target.closest("[popovertarget]")
        : null;
    const popover = document.getElementById(
      invoker?.getAttribute("popovertarget") ?? "",
    );
    if (!popover) return;
    if (popover.style.display === "block") popover.hidePopover();
    else popover.showPopover();
  });
  // Nor does its window ever have the focus, which a page in use has.
  document.hasFocus = () => true;
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
  // Nor does it make object URLs.
  let objects = 0;
  URL.createObjectURL = () => {
    objects += 1;
    return `blob:http://localhost:3000/object-${String(objects)}`;
  };
  URL.revokeObjectURL = () => undefined;
  // Nor does it load fonts: an event target stands for the page's.
  Object.defineProperty(document, "fonts", { value: new EventTarget() });
  // Nor does it time the page's load, which then counts as a new address.
  performance.getEntriesByType = () => [];
  installScreen();
}

afterEach(() => {
  cleanup();
  holdScreen("phone");
  holdTouch(false);
  onlineManager.setOnline(true);
});
