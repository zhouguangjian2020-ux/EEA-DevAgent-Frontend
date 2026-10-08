import assert from "node:assert/strict";
import test from "node:test";
import { loadTypescript } from "./load-typescript.mjs";

const { createUuid } = await loadTypescript("../src/lib/uuid.ts");

test("uses native randomUUID when the browser provides it", () => {
  let fallbackCalled = false;
  const value = createUuid({
    randomUUID: () => "native-uuid",
    getRandomValues: () => {
      fallbackCalled = true;
      throw new Error("fallback should not be called");
    },
  });
  assert.equal(value, "native-uuid");
  assert.equal(fallbackCalled, false);
});

test("falls back to secure random bytes and produces UUID v4", () => {
  let received;
  const value = createUuid({
    getRandomValues: (bytes) => {
      received = bytes;
      bytes.fill(0);
      return bytes;
    },
  });

  assert.equal(received?.length, 16);
  assert.equal(value, "00000000-0000-4000-8000-000000000000");
  assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("fails closed when no secure random API is available", () => {
  assert.throws(() => createUuid({}), /\u4e0d\u652f\u6301\u5b89\u5168\u968f\u673a\u6570/);
});

