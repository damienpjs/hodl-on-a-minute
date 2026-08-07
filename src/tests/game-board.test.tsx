import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { GameBoard, type GameBoardProps } from "@/components/game/game-board";
import type { GameState } from "@/lib/api/game-state";

const ENTRY_AT = 1_700_000_000_000;

function renderBoard(overrides: Partial<GameBoardProps> = {}) {
  const onGuess = vi.fn();

  const props: GameBoardProps = {
    state: { playerId: "p1", score: 0 },
    price: 65_000,
    priceStatus: "live",
    now: ENTRY_AT,
    onGuess,
    isPlacing: false,
    actionError: null,
    ...overrides,
  };

  render(<GameBoard {...props} />);
  return { onGuess };
}

function withGuess(now: number, extra: Partial<GameState> = {}): Partial<GameBoardProps> {
  return {
    state: {
      playerId: "p1",
      score: 0,
      activeGuess: {
        id: "g1",
        direction: "up",
        entryPrice: 65_000,
        entryAt: ENTRY_AT,
      },
      ...extra,
    },
    now,
  };
}

describe("GameBoard — placing a guess", () => {
  it("offers both directions when nothing is in flight", async () => {
    const { onGuess } = renderBoard();

    const up = screen.getByRole("button", { name: /up/i });
    expect(up).toBeEnabled();
    expect(screen.getByRole("button", { name: /down/i })).toBeEnabled();

    await userEvent.click(up);
    expect(onGuess).toHaveBeenCalledWith("up");
  });

  it("locks both buttons while a guess is in flight, and says why", () => {
    renderBoard(withGuess(ENTRY_AT + 10_000));

    expect(screen.getByRole("button", { name: /up/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /down/i })).toBeDisabled();
    expect(screen.getByText(/one guess at a time/i)).toBeInTheDocument();
  });

  it("locks the buttons while the guess is still being submitted", () => {
    renderBoard({ isPlacing: true });

    expect(screen.getByRole("button", { name: /up/i })).toBeDisabled();
    expect(screen.getByText(/placing your guess/i)).toBeInTheDocument();
  });
});

describe("GameBoard — the wait", () => {
  it("counts down the remaining seconds", () => {
    renderBoard(withGuess(ENTRY_AT + 42_000));

    expect(screen.getByText("18s")).toBeInTheDocument();
  });

  it("stops counting and names what it is waiting for once the minute is up", () => {
    renderBoard(withGuess(ENTRY_AT + 75_000));

    // A counter frozen at 0s reads as a broken app; the real blocker at this
    // point is the price, so the copy says that.
    expect(screen.queryByText("0s")).not.toBeInTheDocument();
    expect(screen.getByTestId("waiting-for-move")).toBeInTheDocument();
  });

  it("tells the player when the price feed is down, without resolving anything", () => {
    renderBoard(withGuess(ENTRY_AT + 75_000, { priceUnavailable: true }));

    expect(screen.getByRole("alert")).toHaveTextContent(/price feed unreachable/i);
    expect(screen.getByRole("button", { name: /up/i })).toBeDisabled();
  });
});

describe("GameBoard — reporting the outcome", () => {
  const resolved: GameState = {
    playerId: "p1",
    score: 1,
    lastResult: {
      direction: "up",
      entryPrice: 65_000,
      resolvedPrice: 65_120,
      delta: 1,
      resolvedAt: ENTRY_AT + 60_000,
    },
  };

  it("shows both prices and the delta after a win", () => {
    // A live price distinct from both result prices, so each assertion below
    // can only match the result panel.
    renderBoard({ state: resolved, price: 70_000 });

    expect(screen.getByText(/you were right/i)).toBeInTheDocument();
    expect(screen.getByTestId("result-delta")).toHaveTextContent("+1");
    expect(screen.getByText("$65,000.00")).toBeInTheDocument();
    expect(screen.getByText("$65,120.00")).toBeInTheDocument();
  });

  it("shows a loss as a loss", () => {
    renderBoard({
      state: {
        ...resolved,
        score: -1,
        lastResult: { ...resolved.lastResult!, delta: -1, resolvedPrice: 64_900 },
      },
    });

    expect(screen.getByText(/you were wrong/i)).toBeInTheDocument();
    expect(screen.getByTestId("score")).toHaveTextContent("-1");
  });

  it("signs a positive score so it reads as a gain", () => {
    renderBoard({ state: { playerId: "p1", score: 3 } });

    expect(screen.getByTestId("score")).toHaveTextContent("+3");
  });
});

describe("GameBoard — the price display", () => {
  it("shows a placeholder instead of a zero before the first price arrives", () => {
    renderBoard({ price: null, priceStatus: "connecting" });

    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("GameBoard — the price-feed indicator", () => {
  it("pulses only when the feed is genuinely live", () => {
    renderBoard({ priceStatus: "live" });

    expect(screen.getByTestId("price-status")).toHaveAttribute("data-status", "live");
    expect(screen.getByTestId("price-status-pulse")).toBeInTheDocument();
    expect(screen.getByText("live")).toBeInTheDocument();
  });

  it.each([
    ["degraded", /server fallback/i],
    ["connecting", /connecting/i],
    ["offline", /no price feed/i],
  ] as const)(
    "shows %s without a pulse, and never calls it live",
    (status, label) => {
      renderBoard({ priceStatus: status });

      const badge = screen.getByTestId("price-status");
      expect(badge).toHaveAttribute("data-status", status);
      expect(badge).toHaveTextContent(label);
      // The green pulsing dot is the promise of a live feed. Anything less must
      // not wear it.
      expect(screen.queryByTestId("price-status-pulse")).not.toBeInTheDocument();
      expect(screen.queryByText("live")).not.toBeInTheDocument();
    },
  );
});
