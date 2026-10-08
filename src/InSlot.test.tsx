import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InSlot } from "./InSlot.tsx";
import { SlotsContext } from "./slots.ts";

describe("InSlot", () => {
  it("shows its children in the app bar's place", () => {
    const place = document.createElement("div");
    document.body.append(place);
    render(
      <SlotsContext value={{ title: place }}>
        <InSlot name="title">
          <h1>plan.md</h1>
        </InSlot>
      </SlotsContext>,
    );

    expect(place).toContainElement(screen.getByRole("heading"));
    place.remove();
  });

  it("waits for a bar's place rather than showing them where the page is", () => {
    const { container } = render(
      <SlotsContext value={{}}>
        <InSlot name="title">
          <h1>plan.md</h1>
        </InSlot>
      </SlotsContext>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows them where the page is without a bar", () => {
    render(
      <InSlot name="title">
        <h1>plan.md</h1>
      </InSlot>,
    );

    expect(screen.getByRole("heading")).toBeVisible();
  });
});
