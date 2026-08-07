import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  CHART_WINDOW_MS,
  computeGeometry,
  TickChart,
} from "@/components/game/tick-chart";
import type { PriceTick } from "@/hooks/use-live-price";

const NOW = 1_700_000_000_000;

/** `count` samples ending at `NOW`, one every second. */
function ticks(prices: number[]): PriceTick[] {
  return prices.map((price, index) => ({
    at: NOW - (prices.length - 1 - index) * 1_000,
    price,
  }));
}

describe("computeGeometry", () => {
  it("draws nothing until there are two points to join", () => {
    expect(computeGeometry({ ticks: [], now: NOW })).toBeNull();
    expect(computeGeometry({ ticks: ticks([65_000]), now: NOW })).toBeNull();
  });

  it("ignores samples that have scrolled out of the window", () => {
    const stale: PriceTick[] = [
      { at: NOW - CHART_WINDOW_MS - 1, price: 1_000 },
      ...ticks([65_000, 65_100]),
    ];

    const geometry = computeGeometry({ ticks: stale, now: NOW });

    // Three samples in, two kept plus the left-edge hold — and the 1_000 outlier
    // never got to stretch the price domain.
    const ys = geometry!.line.split(" ").map((p) => Number(p.split(",")[1]));
    expect(ys).toHaveLength(3);
    for (const y of ys) expect(y).toBeGreaterThanOrEqual(0);
  });

  it("puts the newest sample at the right edge and the oldest further left", () => {
    const geometry = computeGeometry({ ticks: ticks([65_000, 65_100]), now: NOW });
    const xs = geometry!.line.split(" ").map((p) => Number(p.split(",")[0]));

    expect(xs.at(-1)).toBeCloseTo(1000, 5);
    expect(xs[0]).toBeLessThan(xs.at(-1)!);
  });

  it("holds the oldest sample flat to the left edge while the window fills", () => {
    const geometry = computeGeometry({ ticks: ticks([65_000, 65_100]), now: NOW })!;
    const points = geometry.line.split(" ").map((p) => p.split(",").map(Number));

    // The trace starts at x = 0, at the same height as the first real sample.
    expect(points[0][0]).toBeCloseTo(0, 5);
    expect(points[0][1]).toBeCloseTo(points[1][1], 5);

    // And so does the filled area below it, rather than a step up from mid-frame.
    expect(geometry.area).toMatch(/^M 0,300 L 0,/);
  });

  it("does not pad once the window is full", () => {
    const full = [
      { at: NOW - CHART_WINDOW_MS, price: 65_000 },
      { at: NOW, price: 65_100 },
    ];

    expect(computeGeometry({ ticks: full, now: NOW })?.line.split(" ")).toHaveLength(2);
  });

  it("puts a rising price higher on screen than a falling one", () => {
    const geometry = computeGeometry({ ticks: ticks([65_000, 65_500]), now: NOW });
    const ys = geometry!.line.split(" ").map((p) => Number(p.split(",")[1]));
    const [low, high] = ys.slice(-2);

    // SVG y grows downward, so the more expensive point has the smaller y.
    expect(high).toBeLessThan(low);
  });

  it("keeps the entry line inside the frame even when the price has run away", () => {
    const geometry = computeGeometry({
      ticks: ticks([70_000, 70_100, 70_200]),
      entryPrice: 65_000,
      now: NOW,
    });

    expect(geometry?.entryY).not.toBeNull();
    expect(geometry!.entryY!).toBeGreaterThanOrEqual(0);
    expect(geometry!.entryY!).toBeLessThanOrEqual(300);
  });

  it("survives a flat market instead of dividing by a zero-height domain", () => {
    const geometry = computeGeometry({ ticks: ticks([65_000, 65_000]), now: NOW });

    for (const point of geometry!.line.split(" ")) {
      expect(Number(point.split(",")[1])).toBeTypeOf("number");
      expect(Number.isFinite(Number(point.split(",")[1]))).toBe(true);
    }
  });

  it("marks the 60-second point only once it has actually arrived", () => {
    const notYet = computeGeometry({
      ticks: ticks([65_000, 65_100]),
      entryAt: NOW - 30_000,
      now: NOW,
    });
    expect(notYet?.targetX).toBeNull();

    const passed = computeGeometry({
      ticks: ticks([65_000, 65_100]),
      entryAt: NOW - 90_000,
      now: NOW,
    });
    expect(passed?.targetX).not.toBeNull();
  });
});

describe("TickChart", () => {
  it("renders nothing at all rather than an empty frame", () => {
    render(<TickChart ticks={[]} now={NOW} />);

    expect(screen.queryByTestId("tick-chart")).not.toBeInTheDocument();
  });

  it("draws the entry line only while a guess is in flight", () => {
    const { rerender } = render(<TickChart ticks={ticks([65_000, 65_100])} now={NOW} />);
    expect(screen.queryByTestId("entry-line")).not.toBeInTheDocument();

    rerender(
      <TickChart ticks={ticks([65_000, 65_100])} entryPrice={65_050} now={NOW} />,
    );
    expect(screen.getByTestId("entry-line")).toBeInTheDocument();
  });

  it("is hidden from assistive technology — the numbers above say the same thing", () => {
    render(<TickChart ticks={ticks([65_000, 65_100])} now={NOW} />);

    expect(screen.getByTestId("tick-chart")).toHaveAttribute("aria-hidden", "true");
  });
});
