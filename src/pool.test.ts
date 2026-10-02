// @vitest-environment node
import { describe, expect, it } from "vitest";
import { pool } from "./pool.ts";

/** A task that runs until the test settles it. */
function task(log: string[], name: string) {
  let settle: (value: string) => void = () => undefined;
  const started = new Promise<string>((resolve) => {
    settle = resolve;
  });
  return {
    run: () => {
      log.push(`start ${name}`);
      return started;
    },
    settle: () => {
      settle(name);
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("pool", () => {
  it("runs at most so many tasks at a time, the others in turn", async () => {
    const run = pool(2);
    const log: string[] = [];
    const [a, b, c, d] = ["a", "b", "c", "d"].map((name) => task(log, name));
    if (!a || !b || !c || !d) throw new Error("Four tasks");

    const results = [a, b, c, d].map((one) => run(one.run));
    await tick();
    expect(log).toEqual(["start a", "start b"]);
    b.settle();
    await tick();
    expect(log).toEqual(["start a", "start b", "start c"]);
    // A task that comes now waits behind d, though a slot is free.
    a.settle();
    const e = task(log, "e");
    const late = run(e.run);
    await tick();
    expect(log).toEqual(["start a", "start b", "start c", "start d"]);
    c.settle();
    d.settle();
    e.settle();
    await expect(Promise.all([...results, late])).resolves.toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });

  it("frees the slot of a task that fails", async () => {
    const run = pool(1);

    await expect(run(() => Promise.reject(new Error("No")))).rejects.toThrow(
      "No",
    );
    await expect(run(() => Promise.resolve("next"))).resolves.toBe("next");
  });

  it("never runs a task whose signal aborts while it waits", async () => {
    const run = pool(1);
    const log: string[] = [];
    const first = task(log, "first");
    const second = task(log, "second");
    const leave = new AbortController();

    const running = run(first.run);
    const waiting = run(second.run, leave.signal);
    leave.abort(new Error("Left the note"));
    first.settle();

    await expect(waiting).rejects.toThrow("Left the note");
    await expect(running).resolves.toBe("first");
    expect(log).toEqual(["start first"]);
    await expect(run(() => Promise.resolve("after"))).resolves.toBe("after");
  });

  it("runs a task at once when a slot is free, whatever its signal", async () => {
    const run = pool(1);

    await expect(
      run(() => Promise.resolve("now"), new AbortController().signal),
    ).resolves.toBe("now");
  });
});
