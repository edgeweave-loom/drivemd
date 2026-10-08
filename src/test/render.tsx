import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { DriveContext } from "../drive-context.ts";
import { createQueryClient } from "../queries.ts";
import { fakeDrive } from "./fake-drive.ts";

/** The made-up account the tests sign in as. */
export const ACCOUNT = "ada@example.com";

/**
 * Renders a page with a made-up Drive, signed in unless the tab waits for
 * Continue. Failed reads are not tried again, so that tests need not wait;
 * queries.test.ts covers when the app does. Writes run as in the app.
 */
export function renderWithDrive(
  ui: ReactNode,
  drive = fakeDrive(),
  { signedIn = true } = {},
) {
  const client = createQueryClient();
  client.setDefaultOptions({
    ...client.getDefaultOptions(),
    queries: { retry: false },
  });
  const renew = vi.fn();
  const within = (page: ReactNode) => (
    <QueryClientProvider client={client}>
      <DriveContext value={{ drive, renew, account: ACCOUNT, signedIn }}>
        {page}
      </DriveContext>
    </QueryClientProvider>
  );
  const { rerender, unmount } = render(within(ui));
  return {
    drive,
    renew,
    client,
    unmount,
    rerender: (page: ReactNode) => {
      rerender(within(page));
    },
  };
}

/** Opens a URL of the app as a fresh page load would. */
export function visit(path: string, state: unknown = null) {
  history.replaceState(state, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
