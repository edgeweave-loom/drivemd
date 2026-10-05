// @vitest-environment node
import { describe, expect, it } from "vitest";
import { toggleTask } from "./tasks.ts";

describe("toggleTask", () => {
  it.each([
    ["- [ ] tea", 0, "- [x] tea"],
    ["- [x] tea", 0, "- [ ] tea"],
    ["- [X] tea", 0, "- [ ] tea"],
    ["* [ ] tea", 0, "* [x] tea"],
    ["+   [ ] tea", 0, "+   [x] tea"],
    ["12. [ ] tea", 0, "12. [x] tea"],
    ["3) [x] tea", 0, "3) [ ] tea"],
    ["-\t[ ] tea", 0, "-\t[x] tea"],
  ])("checks or unchecks the task in %j", (text, offset, toggled) => {
    expect(toggleTask(text, offset)).toBe(toggled);
  });

  it("changes only the mark of the task that starts at the offset", () => {
    const text = "# Plan\r\n\r\n> - [ ] boil\r\n> - [x] pour\r\n";
    const offset = text.indexOf("- [x]");

    expect(toggleTask(text, offset)).toBe(
      "# Plan\r\n\r\n> - [ ] boil\r\n> - [ ] pour\r\n",
    );
  });

  it.each([
    ["no list marker", "[ ] tea", 0],
    ["no task", "- tea", 0],
    ["raw HTML", '<li class="task-list-item"><input type="checkbox"> tea', 0],
    ["an offset elsewhere", "- [ ] tea", 2],
    ["an offset past the end", "- [ ] tea", 40],
  ])("leaves the text alone at %s", (_, text, offset) => {
    expect(toggleTask(text, offset)).toBeUndefined();
  });
});
