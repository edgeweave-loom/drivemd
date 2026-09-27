import { afterEach, describe, expect, it, vi } from "vitest";
import { DriveError, getAccountEmail } from "./drive.ts";

const TOKEN = "example-access-token";
const ABOUT_URL =
  "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)";

function answer(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json(body, { status }))),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getAccountEmail", () => {
  it("asks Drive for the signed-in user's email with the token as a bearer", async () => {
    answer(200, { user: { emailAddress: "ada@example.com" } });

    await expect(getAccountEmail(TOKEN)).resolves.toBe("ada@example.com");
    expect(fetch).toHaveBeenCalledWith(ABOUT_URL, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
  });

  it("reports Drive's status and message when it refuses", async () => {
    answer(403, { error: { message: "Drive API is disabled" } });

    const error: unknown = await getAccountEmail(TOKEN).catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(DriveError);
    expect(error).toMatchObject({
      status: 403,
      message: "Drive API is disabled",
    });
  });

  it("tells an expired or revoked token apart", async () => {
    answer(401, { error: { message: "Invalid Credentials" } });

    await expect(getAccountEmail(TOKEN)).rejects.toMatchObject({ status: 401 });
  });

  it("reports the status of an answer that is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response("Bad Gateway", { status: 502 })),
      ),
    );

    await expect(getAccountEmail(TOKEN)).rejects.toMatchObject({
      status: 502,
      message: "Google Drive answered 502",
    });
  });

  it.each([{}, { user: { emailAddress: "" } }, null])(
    "rejects an answer without an email: %j",
    async (body) => {
      answer(200, body);

      await expect(getAccountEmail(TOKEN)).rejects.toBeInstanceOf(DriveError);
    },
  );

  it("reports a network failure without the token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError(`Failed: Bearer ${TOKEN}`))),
    );

    const error: unknown = await getAccountEmail(TOKEN).catch(
      (cause: unknown) => cause,
    );
    expect(error).toMatchObject({ status: 0 });
    expect((error as Error).message).not.toContain(TOKEN);
  });
});
