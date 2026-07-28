import { describe, expect, test } from "vitest";
import { Emitter } from "../../../packages/frond/src/renderer/events.ts";

interface TestEvents {
  ping: { readonly value: number };
  pong: { readonly text: string };
}

describe("typed emitter", () => {
  test("an emitted event reaches only the matching listener", () => {
    const emitter = new Emitter<TestEvents>();
    const pings: number[] = [];
    const pongs: string[] = [];

    emitter.on("ping", (event) => pings.push(event.value));
    emitter.on("pong", (event) => pongs.push(event.text));

    emitter.emit("ping", { value: 1 });

    expect(pings).toEqual([1]);
    expect(pongs).toEqual([]);
  });

  test("one event can have many listeners, in the order they were attached", () => {
    const emitter = new Emitter<TestEvents>();
    const order: string[] = [];

    emitter.on("ping", () => order.push("first"));
    emitter.on("ping", () => order.push("second"));
    emitter.emit("ping", { value: 0 });

    expect(order).toEqual(["first", "second"]);
  });

  test("the function on() returns undoes the subscription", () => {
    const emitter = new Emitter<TestEvents>();
    const seen: number[] = [];

    const unsubscribe = emitter.on("ping", (event) => seen.push(event.value));
    emitter.emit("ping", { value: 1 });
    unsubscribe();
    emitter.emit("ping", { value: 2 });

    expect(seen).toEqual([1]);
  });

  test("unsubscribing twice is safe", () => {
    const emitter = new Emitter<TestEvents>();
    const unsubscribe = emitter.on("ping", () => {});

    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
  });

  test("a listener unsubscribing inside its own callback does not skip the ones after it", () => {
    // A one-shot listener ("do something on the next relocate") has exactly this shape. An
    // implementation mutating the same set while iterating it would silently skip the second
    // listener.
    const emitter = new Emitter<TestEvents>();
    const seen: string[] = [];

    const unsubscribe = emitter.on("ping", () => {
      seen.push("first");
      unsubscribe();
    });
    emitter.on("ping", () => seen.push("second"));

    emitter.emit("ping", { value: 0 });

    expect(seen).toEqual(["first", "second"]);
  });

  test("emitting an event with no listeners does not throw", () => {
    const emitter = new Emitter<TestEvents>();
    expect(() => emitter.emit("pong", { text: "x" })).not.toThrow();
  });

  test("after clear() nothing is delivered", () => {
    const emitter = new Emitter<TestEvents>();
    const seen: number[] = [];

    emitter.on("ping", (event) => seen.push(event.value));
    emitter.clear();
    emitter.emit("ping", { value: 1 });

    expect(seen).toEqual([]);
  });
});
