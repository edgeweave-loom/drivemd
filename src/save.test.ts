// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DriveError } from "./drive.ts";
import { saveText } from "./save.ts";
import { driveItem, metadata } from "./test/drive-items.ts";
import { fakeDrive } from "./test/fake-drive.ts";

const OPENED = metadata(driveItem("plan.md", { id: "plan" }), {
  md5Checksum: "aaaa",
  headRevisionId: "revision-1",
});
const SAVED = metadata(OPENED, {
  md5Checksum: "bbbb",
  headRevisionId: "revision-2",
});
const BYTES = new TextEncoder().encode("- [x] tea\n");

function drive() {
  const fake = fakeDrive();
  fake.getMetadata.mockResolvedValue(OPENED);
  fake.keepRevision.mockResolvedValue();
  fake.saveContent.mockResolvedValue(SAVED);
  return fake;
}

describe("saveText", () => {
  it("checks that nobody changed the file, keeps the revision from before the edits, then writes", async () => {
    const fake = drive();

    await expect(
      saveText(fake, OPENED, BYTES, { keep: true }),
    ).resolves.toEqual({
      saved: SAVED,
    });
    expect(fake.getMetadata).toHaveBeenCalledExactlyOnceWith(OPENED);
    expect(fake.keepRevision).toHaveBeenCalledExactlyOnceWith(
      OPENED,
      "revision-1",
    );
    expect(fake.saveContent).toHaveBeenCalledExactlyOnceWith(OPENED, BYTES);
    const [checked] = fake.getMetadata.mock.invocationCallOrder;
    const [kept] = fake.keepRevision.mock.invocationCallOrder;
    const [written] = fake.saveContent.mock.invocationCallOrder;
    expect(checked).toBeLessThan(kept ?? 0);
    expect(kept).toBeLessThan(written ?? 0);
  });

  it("keeps no revision but the first", async () => {
    const fake = drive();

    await saveText(fake, OPENED, BYTES, { keep: false });

    expect(fake.keepRevision).not.toHaveBeenCalled();
    expect(fake.saveContent).toHaveBeenCalledOnce();
  });

  it("keeps no revision of a new empty file, which has none yet", async () => {
    const fake = drive();
    const empty = metadata(OPENED, { headRevisionId: undefined });
    fake.getMetadata.mockResolvedValue(empty);

    await saveText(fake, empty, BYTES, { keep: true });

    expect(fake.keepRevision).not.toHaveBeenCalled();
    expect(fake.saveContent).toHaveBeenCalledExactlyOnceWith(empty, BYTES);
  });

  it.each([
    ["content", { md5Checksum: "cccc", headRevisionId: "revision-2" }],
    ["revision", { headRevisionId: "revision-2" }],
  ])("writes nothing when someone changed the file's %s", async (_, change) => {
    const fake = drive();
    const changed = metadata(OPENED, change);
    fake.getMetadata.mockResolvedValue(changed);

    await expect(
      saveText(fake, OPENED, BYTES, { keep: true }),
    ).resolves.toEqual({
      conflict: changed,
    });
    expect(fake.keepRevision).not.toHaveBeenCalled();
    expect(fake.saveContent).not.toHaveBeenCalled();
  });

  it("writes once a new token has come after a 401, if nobody changed the file meanwhile", async () => {
    const fake = drive();
    fake.saveContent.mockRejectedValueOnce(
      new DriveError(401, "Invalid Credentials"),
    );

    await expect(
      saveText(fake, OPENED, BYTES, { keep: true }),
    ).resolves.toEqual({
      saved: SAVED,
    });
    expect(fake.getMetadata).toHaveBeenCalledTimes(2);
    expect(fake.saveContent).toHaveBeenCalledTimes(2);
  });

  it("checks again for someone else's change after a 401, as the new token took a while", async () => {
    const fake = drive();
    const changed = metadata(OPENED, { md5Checksum: "cccc" });
    fake.saveContent.mockRejectedValueOnce(
      new DriveError(401, "Invalid Credentials"),
    );
    fake.getMetadata
      .mockResolvedValueOnce(OPENED)
      .mockResolvedValueOnce(changed);

    await expect(
      saveText(fake, OPENED, BYTES, { keep: true }),
    ).resolves.toEqual({
      conflict: changed,
    });
    expect(fake.saveContent).toHaveBeenCalledOnce();
  });

  it.each([
    [new DriveError(403, "The user does not have permission")],
    [new DriveError(401, "Invalid Credentials")],
  ])(
    "fails as Drive does otherwise, or after a second 401: %s",
    async (error) => {
      const fake = drive();
      fake.saveContent.mockRejectedValue(error);

      await expect(saveText(fake, OPENED, BYTES, { keep: true })).rejects.toBe(
        error,
      );
    },
  );
});
