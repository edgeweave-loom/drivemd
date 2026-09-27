import { describe, expect, it } from "vitest";
import firebase from "../firebase.json";

const { hosting } = firebase;
// Firebase applies every matching rule in order, so a later rule wins.
const [firstRule, ...laterRules] = hosting.headers;
const everyPath = new Map(
  firstRule?.headers.map(({ key, value }) => [key, value]),
);

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
  it("sets the security headers for every path in the first rule", () => {
    expect(firstRule?.source).toBe("**");
  });

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

    it("sets exactly the reviewed directives", () => {
      // A new directive, such as script-src-elem, could reopen what the
      // others close: adding one must be a deliberate change to this list.
      expect([...csp.keys()]).toEqual([
        "default-src",
        "script-src",
        "connect-src",
        "frame-src",
        "object-src",
        "base-uri",
        "form-action",
        "frame-ancestors",
        "require-trusted-types-for",
        "trusted-types",
      ]);
    });

    it("runs only the app's scripts and Google's sign-in script", () => {
      // The exact file, never the host: Google's hosts serve JSONP endpoints
      // that would let an injected script tag bypass the policy.
      expect(csp.get("script-src")).toEqual([
        "'self'",
        "https://accounts.google.com/gsi/client",
      ]);
    });

    it("talks only to Google sign-in and the Drive API", () => {
      expect(csp.get("connect-src")).toEqual([
        "'self'",
        "https://accounts.google.com/gsi/",
        "https://www.googleapis.com",
      ]);
      expect(csp.get("frame-src")).toEqual([
        "https://accounts.google.com/gsi/",
      ]);
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

    it("allows no Trusted Types policy but the app's and Google's", () => {
      // A lenient "default" policy would silently undo the requirement.
      // goog#html is the policy Google's Closure-built scripts create: GIS
      // does not create it today, but it loads unpinned from Google.
      expect(csp.get("trusted-types")).toEqual(["drivemd-gis", "goog#html"]);
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

  it("revalidates pages on every load", () => {
    expect(everyPath.get("Cache-Control")).toBe("no-cache");
  });

  it("overrides nothing after the first rule but the cache of hashed assets", () => {
    expect(laterRules).toEqual([
      {
        source: "/assets/**",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ]);
  });
});
