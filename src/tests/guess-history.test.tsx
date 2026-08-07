import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { GuessHistory } from "@/components/game/guess-history";
import type { LastResult } from "@/lib/types";

const BASE = 1_700_000_000_000;

function result(index: number, overrides: Partial<LastResult> = {}): LastResult {
  return {
    direction: "up",
    entryPrice: 65_000,
    resolvedPrice: 65_100,
    delta: 1,
    resolvedAt: BASE + index * 60_000,
    ...overrides,
  };
}

describe("GuessHistory", () => {
  it("says so plainly when nothing has been played yet", () => {
    render(<GuessHistory results={[]} />);

    expect(screen.getByTestId("history-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("history-list")).not.toBeInTheDocument();
  });

  it("shows the direction, both prices and the outcome of each guess", () => {
    render(<GuessHistory results={[result(0, { direction: "down", delta: -1 })]} />);

    const row = screen.getByTestId("history-row");
    expect(row).toHaveTextContent("down");
    expect(row).toHaveTextContent("$65,000.00 → $65,100.00");
    expect(screen.getByTestId("history-delta")).toHaveTextContent("−1");
  });

  it("marks a win and a loss differently, in words as well as colour", () => {
    const { rerender } = render(<GuessHistory results={[result(0)]} />);
    expect(screen.getByText("won")).toBeInTheDocument();

    rerender(<GuessHistory results={[result(0, { delta: -1 })]} />);
    expect(screen.getByText("lost")).toBeInTheDocument();
  });

  it("shows only the five most recent guesses by default", () => {
    render(<GuessHistory results={[0, 1, 2, 3, 4, 5, 6].map((i) => result(i))} />);

    expect(screen.getAllByTestId("history-row")).toHaveLength(5);
  });

  it("honours an explicit limit", () => {
    render(<GuessHistory results={[0, 1, 2].map((i) => result(i))} limit={2} />);

    expect(screen.getAllByTestId("history-row")).toHaveLength(2);
  });

  it("expands to the whole list and back again", async () => {
    render(<GuessHistory results={[0, 1, 2, 3, 4, 5, 6].map((i) => result(i))} />);

    const toggle = screen.getByTestId("toggle-history");
    expect(toggle).toHaveTextContent("Show all (7)");

    await userEvent.click(toggle);
    expect(screen.getAllByTestId("history-row")).toHaveLength(7);
    expect(toggle).toHaveTextContent("Show less");

    await userEvent.click(toggle);
    expect(screen.getAllByTestId("history-row")).toHaveLength(5);
  });

  it("hides the toggle when everything already fits", () => {
    render(<GuessHistory results={[result(0)]} />);

    expect(screen.queryByTestId("toggle-history")).not.toBeInTheDocument();
  });
});
