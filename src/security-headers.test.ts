import { describe, expect, it } from "vitest";
import firebase from "../firebase.json";

const { hosting } = firebase;

function headersOf(source: string): Map<string, string> {
  const rule = hosting.headers.find((candidate) => candidate.source === source);
  return new Map(rule?.headers.map(({ key, value }) => [key, value]));
}

const everyPath = headersOf("**");

function contentSecurityPolicy(): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const directive of (
    everyPath.get("Content-Security-Policy") ?? ""
  ).split(";")) {
    const [name, ...sources] = directive.trim().split(/\s+/);
    if (name) directives.set(name, sources);
  }
  return directives;
}

describe("Firebase Hosting", () => {
  it("serves the Vite build as a single-page app, except for assets", () => {
    expect(hosting.public).toBe("dist");
    // A missing asset gets a 404, not the app's HTML with a 200 that the
    // browser would try to run as a module.
    expect(hosting.rewrites).toEqual([
      { source: "!/assets/**", destination: "/index.html" },
    ]);
  });

  describe("Content-Security-Policy", () => {
    const csp = contentSecurityPolicy();

    it("loads everything from the app's own origin by default", () => {
      expect(csp.get("default-src")).toEqual(["'self'"]);
    });

    it("never allows inline code, eval, wildcards or whole schemes", () => {
      const unsafe = [...csp.values()]
        .flat()
        .filter((source) => /unsafe|^\*$|^[a-z-]+:$/.test(source));
      expect(unsafe).toEqual([]);
    });

    it("blocks plugins, base URL hijacking, form posts and framing", () => {
      expect(csp.get("object-src")).toEqual(["'none'"]);
      expect(csp.get("base-uri")).toEqual(["'none'"]);
      expect(csp.get("form-action")).toEqual(["'none'"]);
      expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    });

    it("requires Trusted Types for the DOM sinks that run scripts", () => {
      expect(csp.get("require-trusted-types-for")).toEqual(["'script'"]);
    });
  });

  it("isolates the app from other origins' windows and requests", () => {
    expect(everyPath.get("Cross-Origin-Opener-Policy")).toBe(
      "same-origin-allow-popups",
    );
    expect(everyPath.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
  });

  it("keeps browsers on HTTPS for a year", () => {
    expect(everyPath.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
  });

  it("stops MIME sniffing, full-URL referrers and unused device features", () => {
    expect(everyPath.get("X-Content-Type-Options")).toBe("nosniff");
    expect(everyPath.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(everyPath.get("Permissions-Policy")).toBe(
      "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    );
  });

  it("revalidates pages on every load and caches hashed assets for good", () => {
    expect(everyPath.get("Cache-Control")).toBe("no-cache");
    expect(headersOf("/assets/**").get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    // Firebase applies matching rules in order: the later rule wins.
    const sources = hosting.headers.map(({ source }) => source);
    expect(sources.indexOf("/assets/**")).toBeGreaterThan(
      sources.indexOf("**"),
    );
  });

  it("lets no narrower rule override a security header", () => {
    const overridden = hosting.headers
      .filter(({ source }) => source !== "**")
      .flatMap(({ headers }) => headers.map(({ key }) => key))
      .filter((key) => key !== "Cache-Control");
    expect(overridden).toEqual([]);
  });
});
