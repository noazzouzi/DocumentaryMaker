import { describe, expect, it } from "vitest";
import { dateLabel, parseIsoDate, spokenDate } from "../src/dates";
import { runs } from "./helpers";

describe("date labels (viewer-facing, localized, precision kept)", () => {
  it("full dates", () => {
    expect(dateLabel("1637-02-05", "en")).toBe("5 Feb 1637");
    expect(dateLabel("1637-02-05", "fr")).toBe("5 févr. 1637");
    expect(dateLabel("1637-02-01", "fr")).toBe("1er févr. 1637");
    expect(dateLabel("2007-08-12T10:00:00Z", "en")).toBe("12 Aug 2007");
  });
  it("month-year and year-only precision", () => {
    expect(dateLabel("1637-02", "en")).toBe("Feb 1637");
    expect(dateLabel("1637-02", "fr")).toBe("févr. 1637");
    expect(dateLabel("1637", "en")).toBe("1637");
    expect(dateLabel("1637", "fr")).toBe("1637");
  });
  it("non-ISO text and invalid dates are left alone", () => {
    expect(dateLabel("Feb 1637", "en")).toBe("Feb 1637");
    expect(dateLabel("winter 1636", "fr")).toBe("winter 1636");
    expect(dateLabel("1637-13-01", "en")).toBe("1637-13-01");
    expect(dateLabel("1637-02-30", "en")).toBe("1637-02-30");
    expect(dateLabel("", "en")).toBe("");
    expect(parseIsoDate("12")).toBeNull();
  });
  it("spoken form uses long month names (VO sync)", () => {
    expect(spokenDate("1637-02-05", "en")).toBe("5 February 1637");
    expect(spokenDate("1637-02", "fr")).toBe("février 1637");
  });
  it("TimelineGraphic / QuoteCard props carry no raw ISO date", () => {
    const iso = /\b\d{4}-\d{2}(-\d{2})?\b/;
    for (const out of Object.values(runs())) {
      for (const o of out.timeline.overlays) {
        const p = o.props as Record<string, unknown>;
        if (o.component === "TimelineGraphic") for (const e of p.events as { dateLabel: string }[]) expect(e.dateLabel).not.toMatch(iso);
        if (o.component === "QuoteCard") expect(p.sourceLabel as string).not.toMatch(iso);
      }
    }
    const tl = runs().policy.timeline.overlays.find((o) => o.component === "TimelineGraphic");
    expect(tl, "the policy scenario has a timeline template").toBeTruthy();
    expect((tl!.props as { events: { dateLabel: string }[] }).events.map((e) => e.dateLabel)).toContain("3 Feb 1637");
  });
});
