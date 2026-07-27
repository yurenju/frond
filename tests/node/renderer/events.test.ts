import { describe, expect, test } from "vitest";
import { Emitter } from "../../../src/renderer/events.ts";

interface TestEvents {
  ping: { readonly value: number };
  pong: { readonly text: string };
}

describe("typed emitter", () => {
  test("送出去的事件只到對應的 listener", () => {
    const emitter = new Emitter<TestEvents>();
    const pings: number[] = [];
    const pongs: string[] = [];

    emitter.on("ping", (event) => pings.push(event.value));
    emitter.on("pong", (event) => pongs.push(event.text));

    emitter.emit("ping", { value: 1 });

    expect(pings).toEqual([1]);
    expect(pongs).toEqual([]);
  });

  test("同一個事件可以有很多 listener，依掛上去的順序", () => {
    const emitter = new Emitter<TestEvents>();
    const order: string[] = [];

    emitter.on("ping", () => order.push("first"));
    emitter.on("ping", () => order.push("second"));
    emitter.emit("ping", { value: 0 });

    expect(order).toEqual(["first", "second"]);
  });

  test("on() 回傳的函式解得掉訂閱", () => {
    const emitter = new Emitter<TestEvents>();
    const seen: number[] = [];

    const unsubscribe = emitter.on("ping", (event) => seen.push(event.value));
    emitter.emit("ping", { value: 1 });
    unsubscribe();
    emitter.emit("ping", { value: 2 });

    expect(seen).toEqual([1]);
  });

  test("解除兩次是安全的", () => {
    const emitter = new Emitter<TestEvents>();
    const unsubscribe = emitter.on("ping", () => {});

    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
  });

  test("listener 在自己的回呼裡解除訂閱，不會漏掉排在後面的", () => {
    // 一次性的監聽（「下一次 relocate 時做一件事」）就是這個形狀。邊走訪邊改動
    // 同一個集合的實作會靜默地跳過第二個 listener。
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

  test("沒有 listener 的事件送出去不丟錯", () => {
    const emitter = new Emitter<TestEvents>();
    expect(() => emitter.emit("pong", { text: "x" })).not.toThrow();
  });

  test("clear() 之後一個都不送", () => {
    const emitter = new Emitter<TestEvents>();
    const seen: number[] = [];

    emitter.on("ping", (event) => seen.push(event.value));
    emitter.clear();
    emitter.emit("ping", { value: 1 });

    expect(seen).toEqual([]);
  });
});
