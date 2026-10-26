import { vi } from "vitest";

/**
 * Opens new tabs as the browser would, and records the address that each
 * form sent to one loads, as a GET form builds it: the action's query
 * replaced with the form's fields.
 */
export function openNoteTabs() {
  const open = vi.spyOn(window, "open").mockReturnValue(window);
  const loaded: { target: string; url: URL }[] = [];
  vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(function (
    this: HTMLFormElement,
  ) {
    const url = new URL(this.action);
    url.search = "";
    for (const field of this.querySelectorAll("input")) {
      url.searchParams.append(field.name, field.value);
    }
    loaded.push({ target: this.target, url });
  });
  return { open, loaded };
}
