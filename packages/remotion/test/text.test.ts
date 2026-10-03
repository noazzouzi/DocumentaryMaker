// Per-word reveal slots (KineticText): a function word never shows alone ("THE" before "TWIST", online EN ~1:27.7).
import { describe, expect, it } from "vitest";
import { revealSlots } from "../src/lib/text";

describe("revealSlots", () => {
  it("a leading article shares the slot of the next content word", () => {
    expect(revealSlots(["THE", "TWIST"], "en")).toEqual({ slots: [0, 0], count: 1 });
    expect(revealSlots(["TEN", "YEARS", "OF", "WAGES"], "en")).toEqual({ slots: [0, 1, 2, 2], count: 3 });
    expect(revealSlots(["LA", "CHUTE", "DU", "MARCHÉ"], "fr")).toEqual({ slots: [0, 0, 1, 1], count: 2 });
  });
  it("trailing function words join the last content word; offsets continue across lines", () => {
    expect(revealSlots(["PRICES", "COLLAPSED", "AND"], "en")).toEqual({ slots: [0, 1, 1], count: 2 });
    expect(revealSlots(["THE", "TWIST"], "en", 3)).toEqual({ slots: [3, 3], count: 1 });
  });
  it("a line of function words only is one slot; content words keep one slot each", () => {
    expect(revealSlots(["OF", "THE"], "en")).toEqual({ slots: [0, 0], count: 1 });
    expect(revealSlots(["BUYERS", "VANISHED"], "en")).toEqual({ slots: [0, 1], count: 2 });
  });
});
