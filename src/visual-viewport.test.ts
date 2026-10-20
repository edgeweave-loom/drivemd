import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keepVisible } from "./visual-viewport.ts";

/** A visual viewport of `height`, `pageTop` down a page scrolled to 0. */
class Viewport extends EventTarget {
  height = 800;
  pageTop = 0;
  show(height: number, pageTop = 0) {
    this.height = height;
    this.pageTop = pageTop;
    this.dispatchEvent(new Event("resize"));
  }
}

/**
 * An element that the browser lays out from `top()`, `height` tall,
 * before its own transform.
 */
function element(top: () => number, height: number) {
  const box = document.createElement("div");
  vi.spyOn(box, "getBoundingClientRect").mockImplementation(() => {
    const shift = Number(/-?\d+/.exec(box.style.transform)?.[0] ?? 0);
    return new DOMRect(0, top() + shift, 0, height);
  });
  return box;
}

describe("keepVisible", () => {
  let viewport: Viewport;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame"] });
    viewport = new Viewport();
    Object.defineProperty(window, "visualViewport", {
      value: viewport,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(window, "visualViewport");
  });

  it("brings an app bar back down as iOS pans the page away from it", () => {
    let top = 0;
    const bar = element(() => top, 56);
    keepVisible(bar);

    // Measured in the iOS simulator: Safari with the keyboard up, on a
    // short note.
    top = -40;
    viewport.show(411);
    expect(bar.style.transform).toBe("translateY(40px)");

    top = 0;
    viewport.show(800);
    expect(bar.style.transform).toBe("translateY(0px)");
  });

  it("never takes the visual viewport for above the page's top", () => {
    const bar = element(() => 0, 56);
    keepVisible(bar);

    // As the Home Screen app reports it once the page scrolls to the cursor.
    viewport.show(452, -5);

    expect(bar.style.transform).toBe("translateY(0px)");
  });

  it("keeps Find in note's panel under the app bar as iOS pans the page", () => {
    let top = 0;
    const bar = element(() => top, 56);
    const panel = element(() => top + 56, 82);
    keepVisible(bar);
    keepVisible(panel, { below: bar });

    // Its field focused, the page panned 120 px away from the bar.
    top = -120;
    viewport.show(400);

    expect(bar.style.transform).toBe("translateY(120px)");
    expect(panel.style.transform).toBe("translateY(120px)");
  });

  it("keeps a dialog's top in view when it cannot fit above the keyboard", () => {
    const dialog = element(() => 100, 600);
    keepVisible(dialog);

    viewport.show(500);
    expect(dialog.style.transform).toBe("translateY(-100px)");
    viewport.show(300);
    expect(dialog.style.transform).toBe("translateY(-100px)");
  });

  it("measures again over the next frames, until iOS settles", () => {
    let bottom = 800;
    const bar = element(() => bottom - 48, 48);
    const settled = vi.fn();
    keepVisible(bar, { onSettle: settled });

    // A passing place, then the right one, without an event between.
    bottom = 1206;
    viewport.show(411);
    expect(bar.style.transform).toBe("translateY(-795px)");
    bottom = 800;
    vi.advanceTimersToNextFrame();
    expect(bar.style.transform).toBe("translateY(-389px)");

    expect(settled).not.toHaveBeenCalled();
    for (let frame = 0; frame < 30; frame += 1) vi.advanceTimersToNextFrame();
    expect(settled).toHaveBeenCalledExactlyOnceWith(800);
  });

  it("tells once it has settled as it shows, then as the height changes", () => {
    const bar = element(() => 752, 48);
    const settled = vi.fn();
    // The keyboard already up, as iOS may bring it before the toolbar shows.
    viewport.height = 411;
    keepVisible(bar, { onSettle: settled });

    for (let frame = 0; frame < 30; frame += 1) vi.advanceTimersToNextFrame();
    expect(settled).toHaveBeenCalledExactlyOnceWith(411);

    // A scroll alone, as Safari's bars stay.
    viewport.dispatchEvent(new Event("scroll"));
    for (let frame = 0; frame < 30; frame += 1) vi.advanceTimersToNextFrame();
    expect(settled).toHaveBeenCalledOnce();

    viewport.show(800);
    for (let frame = 0; frame < 30; frame += 1) vi.advanceTimersToNextFrame();
    expect(settled).toHaveBeenLastCalledWith(411);
    expect(settled).toHaveBeenCalledTimes(2);
  });

  it("puts the element back once it stops", () => {
    const bar = element(() => 752, 48);
    const stop = keepVisible(bar);
    viewport.show(411);

    stop();

    expect(bar.style.transform).toBe("");
    viewport.show(300);
    expect(bar.style.transform).toBe("");
  });
});
