import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { DriveContext } from "../drive-context.ts";
import { createQueryClient } from "../queries.ts";
import { fakeDrive } from "./fake-drive.ts";

/**
 * Renders a page with a made-up Drive. Failed calls are not tried again, so
 * that tests need not wait; queries.test.ts covers when the app does.
 */
export function renderWithDrive(ui: ReactNode, drive = fakeDrive()) {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  const renew = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <DriveContext value={{ drive, renew }}>{ui}</DriveContext>
    </QueryClientProvider>,
  );
  return { drive, renew, client };
}

/** Opens a URL of the app as a fresh page load would. */
export function visit(path: string, state: unknown = null) {
  history.replaceState(state, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
