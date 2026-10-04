import { describe, expect, it } from "vitest";
import { linkedPage } from "./drive-web.ts";

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
  ])("leaves %s to search", (text) => {
    expect(linkedPage(text)).toBeUndefined();
  });
});
