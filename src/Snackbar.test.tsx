import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SHOWN_FOR, Snackbar } from "./Snackbar.tsx";

afterEach(() => {
  vi.useRealTimers();
});

describe("Snackbar", () => {
  it("says nothing until it has something to say", () => {
    render(<Snackbar times={0} message="Saved to Google Drive" />);

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("goes after a few seconds, and shows again for the next time", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <Snackbar times={1} message="Saved to Google Drive" />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Saved to Google Drive");

    act(() => {
      vi.advanceTimersByTime(SHOWN_FOR - 1);
    });
    expect(status).toHaveTextContent("Saved to Google Drive");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(status).toBeEmptyDOMElement();

    rerender(<Snackbar times={2} message="Saved to Google Drive" />);
    expect(status).toHaveTextContent("Saved to Google Drive");
    // Each time, for as long again.
    act(() => {
      vi.advanceTimersByTime(SHOWN_FOR - 1);
    });
    rerender(<Snackbar times={3} message="Saved to Google Drive" />);
    act(() => {
      vi.advanceTimersByTime(SHOWN_FOR - 1);
    });
    expect(status).toHaveTextContent("Saved to Google Drive");
  });
});
