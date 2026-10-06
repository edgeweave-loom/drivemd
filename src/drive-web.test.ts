import { describe, expect, it } from "vitest";
import { linkedPage, sharedPage } from "./drive-web.ts";

const ID = "1AbC-d_9";
const KEY = "0-kEy_1";

describe("the page a pasted link leads to", () => {
  it.each([
    [
      `https://drive.google.com/file/d/${ID}/view?usp=sharing`,
      `/edit?id=${ID}`,
    ],
    [
      `https://drive.google.com/file/d/${ID}/view?usp=drive_link&resourcekey=${KEY}`,
      `/edit?id=${ID}&resourcekey=${KEY}`,
    ],
    [`https://drive.google.com/file/u/1/d/${ID}/edit`, `/edit?id=${ID}`],
    [`https://drive.google.com/file/d/${ID}`, `/edit?id=${ID}`],
    [
      `https://drive.google.com/open?id=${ID}&resourcekey=${KEY}`,
      `/edit?id=${ID}&resourcekey=${KEY}`,
    ],
    [`https://drive.google.com/uc?id=${ID}&export=download`, `/edit?id=${ID}`],
    [
      `https://drive.google.com/drive/folders/${ID}?usp=sharing`,
      `/folder/${ID}`,
    ],
    [
      `https://drive.google.com/drive/u/0/folders/${ID}?resourcekey=${KEY}`,
      `/folder/${ID}?resourcekey=${KEY}`,
    ],
    [`https://docs.google.com/document/d/${ID}/edit`, `/edit?id=${ID}`],
    [`https://docs.google.com/spreadsheets/u/0/d/${ID}/edit`, `/edit?id=${ID}`],
    [`  https://drive.google.com/file/d/${ID}/view\n`, `/edit?id=${ID}`],
    [
      `https://drive.google.com/u/0/uc?id=${ID}&export=download`,
      `/edit?id=${ID}`,
    ],
    [`https://drive.google.com/u/1/open?id=${ID}`, `/edit?id=${ID}`],
    [`https://docs.google.com/open?id=${ID}`, `/edit?id=${ID}`],
    [`https://docs.google.com/file/d/${ID}/edit`, `/edit?id=${ID}`],
    [
      `https://drive.google.com/a/example.com/file/d/${ID}/view`,
      `/edit?id=${ID}`,
    ],
    [
      `https://docs.google.com/a/example.com/document/d/${ID}/edit`,
      `/edit?id=${ID}`,
    ],
    [
      `https://drive.google.com/a/example.com/drive/folders/${ID}`,
      `/folder/${ID}`,
    ],
  ])("opens %s at %s", (link, page) => {
    expect(linkedPage(link)).toBe(page);
  });

  it("opens the app's own pages, at the part they name", () => {
    const { origin } = window.location;

    expect(linkedPage(`${origin}/edit?id=${ID}#next-steps`)).toBe(
      `/edit?id=${ID}#next-steps`,
    );
    expect(linkedPage(`${origin}/folder/${ID}/`)).toBe(`/folder/${ID}`);
  });

  it.each([
    "weekly plan",
    "plan.md",
    `drive.google.com/file/d/${ID}/view`,
    `http://drive.google.com/file/d/${ID}/view`,
    `https://drive.google.com.example/file/d/${ID}/view`,
    `https://example.com/edit?id=${ID}`,
    "https://drive.google.com/drive/my-drive",
    "https://drive.google.com/open?id=",
    "https://drive.google.com/file/d/a.b/view",
    `https://drive.google.com/file/d/${ID}/view?resourcekey=a,b`,
    `https://drive.google.com/drive/folders/${ID}/more`,
    "https://docs.google.com/document/d/e/2PACX-1vTmAdEuP/pub",
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTmAdEuP/pubhtml",
    `https://drive.google.com/a/file/d/${ID}/view`,
    `${window.location.origin}/nowhere`,
    // A share leads to the page its link does, if any, as it is opened.
    `${window.location.origin}/share?text=weekly+plan`,
  ])("leaves %s to search", (text) => {
    expect(linkedPage(text)).toBeUndefined();
  });
});

describe("the page a share leads to", () => {
  const LINK = `https://drive.google.com/file/d/${ID}/view?usp=sharing`;

  function shared(fields: Record<string, string>): string | undefined {
    const query = new URLSearchParams(fields).toString();
    return sharedPage(new URL(`/share?${query}`, window.location.origin));
  }

  it.each([
    [{ url: LINK }],
    // Android puts a shared link in the text, often with words around it.
    [{ text: LINK }],
    [{ title: "plan.md", text: `Have a look: ${LINK}` }],
    [{ text: `See\n<${LINK}>, before Monday.` }],
    [{ text: `(${LINK}).` }],
    [{ title: LINK }],
  ])("opens the Drive link in %j", (fields) => {
    expect(shared(fields)).toBe(`/edit?id=${ID}`);
  });

  it("opens the first link, from the address, the text, then the title", () => {
    const folder = `https://drive.google.com/drive/folders/${ID}`;
    const other = `https://drive.google.com/file/d/${KEY}/view`;
    expect(shared({ title: folder, text: `${other} ${LINK}`, url: LINK })).toBe(
      `/edit?id=${ID}`,
    );
    expect(shared({ title: LINK, text: `${other} ${folder}` })).toBe(
      `/edit?id=${KEY}`,
    );
  });

  it("looks past an address of the share page, to the next link", () => {
    const again = `${window.location.origin}/share?text=Tea`;
    expect(shared({ text: `${again} ${LINK}` })).toBe(`/edit?id=${ID}`);
  });

  it("opens a page of the app that was shared", () => {
    expect(
      shared({ text: `${window.location.origin}/folder/${ID}#notes` }),
    ).toBe(`/folder/${ID}#notes`);
  });

  it.each([
    [{}],
    [{ text: "weekly plan" }],
    [{ text: "https://example.com/file/d/plan/view" }],
    [{ url: "plan.md", title: "Plan" }],
  ])("opens nothing for %j", (fields) => {
    expect(shared(fields)).toBeUndefined();
  });
});
