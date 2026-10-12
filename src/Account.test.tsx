import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Account } from "./Account.tsx";
import { holdStandaloneApp } from "./test/screen.ts";

function aboutLink() {
  render(<Account email="ada@example.com" onSignOut={() => undefined} />);
  return screen.getByText("About DriveMD");
}

describe("the account's menu", () => {
  it("opens the about page in a tab of its own", () => {
    const link = aboutLink();
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");
  });

  it("opens it in the Home Screen app's own window, which has no Back button", () => {
    holdStandaloneApp(true);
    const link = aboutLink();
    expect(link).toHaveAttribute("href", "/about.html");
    expect(link).not.toHaveAttribute("target");
  });
});
