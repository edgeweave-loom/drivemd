import { describe, expect, it } from "vitest";
import { appVersion } from "./build-version.ts";

const SHA = "rev-parse --short HEAD";
const TAGS = "tag --list v[0-9]* --sort=-v:refname";

/** Git answering the commands given, joined by spaces, and failing others. */
function fakeGit(answers: Record<string, string>) {
  return (...args: string[]) => {
    const answer = answers[args.join(" ")];
    if (answer === undefined) {
      throw new Error("fatal: bad revision");
    }
    return answer;
  };
}

describe("appVersion", () => {
  it("is package.json's version alone in production", () => {
    expect(appVersion("0.8.0", true, fakeGit({}))).toBe("0.8.0");
  });

  it("counts the commits that the latest release's tag does not hold", () => {
    const git = fakeGit({
      [SHA]: "abc1234",
      [TAGS]: "v0.10.0\nv0.9.1\nv0.2.0\n",
      "rev-list --count v0.10.0..HEAD": "12",
    });
    expect(appVersion("0.11.0", false, git)).toBe("0.11.0-beta.12+abc1234");
  });

  it("counts from the latest release before its version, not from its own or a later one", () => {
    const git = fakeGit({
      [SHA]: "abc1234",
      [TAGS]: "v1.0.0\nv0.8.0\nv0.8.0-rc.1\nv0.7.10\nv0.7.2\n",
      "rev-list --count v0.7.10..HEAD": "66",
    });
    expect(appVersion("0.8.0", false, git)).toBe("0.8.0-beta.66+abc1234");
  });

  it("names the commit when no tag is there to count from", () => {
    const git = fakeGit({ [SHA]: "abc1234", [TAGS]: "v0.8.0\n" });
    expect(appVersion("0.8.0", false, git)).toBe("0.8.0-beta+abc1234");
  });

  it("names the commit when the tag's commit is missing, as in a shallow clone", () => {
    const git = fakeGit({ [SHA]: "abc1234", [TAGS]: "v0.7.0\n" });
    expect(appVersion("0.8.0", false, git)).toBe("0.8.0-beta+abc1234");
  });

  it("is a bare pre-release without git", () => {
    expect(appVersion("0.8.0", false, fakeGit({}))).toBe("0.8.0-beta");
  });
});
