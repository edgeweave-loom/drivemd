import { describe, expect, it } from "vitest";
import { requestFromDrive } from "./drive-ui.ts";

const ID = "1AbC-d_9";
const KEY = "0-kEy_1";
const USER = "104857600000000000001";

/** The address Drive opens with this state, as JSON. */
function address(path: string, state: unknown): URL {
  const url = new URL(path, "https://md.example");
  url.searchParams.set("state", JSON.stringify(state));
  return url;
}

describe("Drive's Open with", () => {
  it("opens the file Drive names, as the account it names", () => {
    const url = address("/open", {
      ids: [ID],
      resourceKeys: {},
      action: "open",
      userId: USER,
    });

    expect(requestFromDrive(url)).toEqual({
      action: "open",
      file: { id: ID },
      account: USER,
    });
  });

  it("opens the first file, with its resource key", () => {
    const url = address("/open", {
      ids: [ID, "other"],
      resourceKeys: { [ID]: KEY, other: "k" },
      action: "open",
      userId: USER,
    });

    expect(requestFromDrive(url)).toMatchObject({
      file: { id: ID, resourceKey: KEY },
    });
  });

  it("takes an empty resource key for none", () => {
    const url = address("/open", {
      ids: [ID],
      resourceKeys: { [ID]: "" },
      action: "open",
    });

    expect(requestFromDrive(url)).toMatchObject({ file: { id: ID } });
  });

  it("opens without an account or resource keys", () => {
    const url = address("/open", { ids: [ID], action: "open" });

    expect(requestFromDrive(url)).toEqual({
      action: "open",
      file: { id: ID },
    });
  });

  it.each([
    ["no state", new URL("/open", "https://md.example")],
    [
      "a state that is not JSON",
      new URL("/open?state={", "https://md.example"),
    ],
    ["a state that is a list", address("/open", [ID])],
    ["another action", address("/open", { ids: [ID], action: "create" })],
    ["no file", address("/open", { ids: [], action: "open" })],
    [
      "a Google document",
      address("/open", { exportIds: [ID], action: "open" }),
    ],
    [
      "a file ID not shaped like Drive's",
      address("/open", { ids: ["a/b"], action: "open" }),
    ],
    [
      "a file ID that is not text",
      address("/open", { ids: [1], action: "open" }),
    ],
    [
      "a resource key not shaped like Drive's",
      address("/open", {
        ids: [ID],
        resourceKeys: { [ID]: "a,b" },
        action: "open",
      }),
    ],
    [
      "resource keys in a list",
      address("/open", { ids: [ID], resourceKeys: [KEY], action: "open" }),
    ],
    [
      "an account not shaped like Google's",
      address("/open", { ids: [ID], action: "open", userId: "a b" }),
    ],
    ["another page", address("/edit", { ids: [ID], action: "open" })],
  ])("opens nothing with %s", (_, url) => {
    expect(requestFromDrive(url)).toBeUndefined();
  });
});

describe("Drive's New", () => {
  it("creates a file in the folder Drive names, as the account it names", () => {
    const url = address("/new", {
      action: "create",
      folderId: ID,
      folderResourceKey: KEY,
      userId: USER,
    });

    expect(requestFromDrive(url)).toEqual({
      action: "create",
      folder: { id: ID, resourceKey: KEY },
      account: USER,
    });
  });

  it("takes an empty resource key for none", () => {
    const url = address("/new", {
      action: "create",
      folderId: ID,
      folderResourceKey: "",
    });

    expect(requestFromDrive(url)).toEqual({
      action: "create",
      folder: { id: ID },
    });
  });

  it("creates a file in My Drive when Drive names no folder", () => {
    const url = address("/new", { action: "create" });

    expect(requestFromDrive(url)).toEqual({
      action: "create",
      folder: { id: "root" },
    });
  });

  it.each([
    ["another action", address("/new", { action: "open", folderId: ID })],
    [
      "a folder ID not shaped like Drive's",
      address("/new", { action: "create", folderId: "a/b" }),
    ],
    [
      "a resource key not shaped like Drive's",
      address("/new", {
        action: "create",
        folderId: ID,
        folderResourceKey: "a,b",
      }),
    ],
    [
      "a resource key without a folder",
      address("/new", { action: "create", folderResourceKey: KEY }),
    ],
    [
      "an account not shaped like Google's",
      address("/new", { action: "create", folderId: ID, userId: 1 }),
    ],
  ])("creates nothing with %s", (_, url) => {
    expect(requestFromDrive(url)).toBeUndefined();
  });
});
