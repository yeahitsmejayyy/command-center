import { describe, expect, test } from "bun:test";
import { dragOffset, shouldDismiss } from "./sheetGesture.ts";

/**
 * When a swipe dismisses the sheet.
 *
 * Getting this wrong is felt rather than seen: too eager and the sheet closes
 * while you are reaching for a field, too reluctant and a flick leaves it
 * hanging halfway.
 */

const HEIGHT = 800;

describe("shouldDismiss", () => {
  test("a small, slow drag springs back", () => {
    expect(shouldDismiss(40, 600, HEIGHT)).toBe(false);
  });

  test("dragging most of the way down dismisses", () => {
    expect(shouldDismiss(500, 900, HEIGHT)).toBe(true);
  });

  test("just past a quarter of the sheet is enough", () => {
    expect(shouldDismiss(HEIGHT * 0.3, 1200, HEIGHT)).toBe(true);
  });

  test("just short of it is not", () => {
    expect(shouldDismiss(HEIGHT * 0.2, 1200, HEIGHT)).toBe(false);
  });

  /**
   * A flick is a short, fast gesture. Judging on distance alone would make the
   * sheet feel stuck to it, which is the most common way this feels wrong.
   */
  test("a quick flick dismisses even though it barely moved", () => {
    expect(shouldDismiss(80, 100, HEIGHT)).toBe(true);
  });

  test("the same distance taken slowly does not", () => {
    expect(shouldDismiss(80, 2000, HEIGHT)).toBe(false);
  });

  test("a drag that went nowhere never dismisses", () => {
    expect(shouldDismiss(0, 300, HEIGHT)).toBe(false);
  });

  test("an upward drag never dismisses", () => {
    expect(shouldDismiss(-200, 300, HEIGHT)).toBe(false);
  });

  test("an unmeasured height still honours velocity", () => {
    expect(shouldDismiss(90, 100, 0)).toBe(true);
    expect(shouldDismiss(90, 3000, 0)).toBe(false);
  });

  test("an instant event does not divide by zero into a dismissal", () => {
    expect(() => shouldDismiss(10, 0, HEIGHT)).not.toThrow();
    expect(shouldDismiss(10, 0, HEIGHT)).toBe(false);
  });
});

describe("dragOffset", () => {
  test("follows the finger downward", () => {
    expect(dragOffset(100, 260)).toBe(160);
  });

  test("clamps upward movement to zero, so the sheet cannot lift off its edge", () => {
    expect(dragOffset(300, 120)).toBe(0);
  });

  test("is zero when the finger has not moved", () => {
    expect(dragOffset(200, 200)).toBe(0);
  });
});
