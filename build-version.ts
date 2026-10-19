type Git = (...args: string[]) => string;

const release = /^v(\d+)\.(\d+)\.(\d+)$/;

/**
 * The version a build names itself (docs/SPEC.md, "Versions"): package.json's
 * alone for production, and for any other build a pre-release of it,
 * `<version>-beta.<n>+<short hash>`, where n counts the commits that the
 * latest release before it does not hold. Without git, or without that
 * release's tag and commits, the build still gets a name, only less exact.
 */
export function appVersion(
  version: string,
  production: boolean,
  git: Git,
): string {
  if (production) {
    return version;
  }
  let sha: string;
  try {
    sha = git("rev-parse", "--short", "HEAD");
  } catch {
    return `${version}-beta`;
  }
  const count = commitsSince(version, git);
  return `${version}-beta${count ? `.${count}` : ""}+${sha}`;
}

/**
 * The commits that the latest release before `version` does not hold. A tag
 * of `version` itself, or of a later release, is left out: right after a
 * release, dev still names it until its next version is set, and a beta of a
 * release already out would sort before it.
 */
function commitsSince(version: string, git: Git): string | undefined {
  try {
    const latest = git("tag", "--list", "v[0-9]*", "--sort=-v:refname")
      .split("\n")
      .find((tag) => precedes(tag, version));
    return latest && git("rev-list", "--count", `${latest}..HEAD`);
  } catch {
    return undefined;
  }
}

function precedes(tag: string, version: string): boolean {
  const ours = version.split(".").map(Number);
  const difference = release
    .exec(tag)
    ?.slice(1)
    .map((part, index) => Number(part) - (ours[index] ?? 0))
    .find((part) => part !== 0);
  return difference !== undefined && difference < 0;
}
