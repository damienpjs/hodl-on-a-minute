import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  currentStreak,
  GameBoard,
  type GameBoardProps,
  STREAK_SLOTS,
} from "@/components/game/game-board";
import type { GameState } from "@/lib/api/game-state";
import type { LastResult } from "@/lib/types";

const ENTRY_AT = 1_700_000_000_000;

/** Enough samples for the chart to draw at all — it renders nothing under two. */
const TICKS = [
  { at: ENTRY_AT - 30_000, price: 64_900 },
  { at: ENTRY_AT, price: 65_000 },
];

function renderBoard(overrides: Partial<GameBoardProps> = {}) {
  const onGuess = vi.fn();

  const props: GameBoardProps = {
    state: { playerId: "p1", score: 0, history: [] },
    price: 65_000,
    priceStatus: "live",
    ticks: [],
    now: ENTRY_AT,
    onGuess,
    placing: null,
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
      history: [],
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

function round(overrides: Partial<LastResult> = {}): LastResult {
  return {
    direction: "up",
    entryPrice: 65_000,
    resolvedPrice: 65_120,
    delta: 1,
    resolvedAt: ENTRY_AT + 60_000,
    ...overrides,
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
    // Visually the dimmed button and its LOCKED caption carry this; the sentence
    // exists so the rule survives being read aloud.
    expect(screen.getByText(/one guess at a time/i)).toBeInTheDocument();
  });

  it("locks the buttons while the guess is still being submitted", () => {
    renderBoard({ placing: "up" });

    expect(screen.getByRole("button", { name: /up/i })).toBeDisabled();
    expect(screen.getByText(/placing your guess/i)).toBeInTheDocument();
  });
});

describe("GameBoard — which direction is lit", () => {
  it("leaves both directions idle while nothing is in flight", () => {
    renderBoard();

    expect(screen.getByTestId("direction-up")).toHaveAttribute("data-state", "idle");
    expect(screen.getByTestId("direction-down")).toHaveAttribute("data-state", "idle");
  });

  it("lights the direction being submitted before the server has answered", () => {
    renderBoard({ placing: "down" });

    // The click has to feel acknowledged during the round trip, otherwise the
    // only feedback is both buttons greying out at once.
    expect(screen.getByTestId("direction-down")).toHaveAttribute("data-state", "chosen");
    expect(screen.getByTestId("direction-up")).toHaveAttribute("data-state", "dimmed");
  });

  it("keeps the guessed direction lit for the whole minute that follows", () => {
    renderBoard(withGuess(ENTRY_AT + 10_000));

    expect(screen.getByTestId("direction-up")).toHaveAttribute("data-state", "chosen");
    expect(screen.getByTestId("direction-down")).toHaveAttribute("data-state", "dimmed");
  });

  it("tells the locked-out button how long it stays locked", () => {
    renderBoard(withGuess(ENTRY_AT + 42_000));

    expect(screen.getByTestId("direction-down")).toHaveTextContent(/locked 18s/i);
  });
});

describe("GameBoard — clearing the screen for the round", () => {
  it("keeps the controls on screen while there is something to click", () => {
    renderBoard();

    expect(screen.getByTestId("controls")).toHaveAttribute("data-hidden", "false");
  });

  it("slides the controls away once the guess is placed", () => {
    renderBoard(withGuess(ENTRY_AT + 10_000));

    // Nothing in that row is actionable during a round, so it costs the player
    // nothing — and it buys back the bottom of the display for the countdown
    // and the chart, which is the only thing they can still act on: watching.
    expect(screen.getByTestId("controls")).toHaveAttribute("data-hidden", "true");
  });

  it("slides them away on the click, not on the server's answer", () => {
    renderBoard({ placing: "up" });

    expect(screen.getByTestId("controls")).toHaveAttribute("data-hidden", "true");
  });

  it("never shows the entry line and the controls at the same time", () => {
    // The reason the slide-out is a fix and not just a flourish. The entry line
    // is drawn at whatever height its price maps to, so it *will* cross the
    // controls row eventually — unless the two are mutually exclusive, which
    // they are: one needs an active guess, the other needs the absence of one.
    renderBoard({ ...withGuess(ENTRY_AT + 10_000), ticks: TICKS });

    expect(screen.getByTestId("entry-line")).toBeInTheDocument();
    expect(screen.getByTestId("controls")).toHaveAttribute("data-hidden", "true");

    cleanup();

    renderBoard({ ticks: TICKS });

    expect(screen.queryByTestId("entry-line")).not.toBeInTheDocument();
    expect(screen.getByTestId("controls")).toHaveAttribute("data-hidden", "false");
  });

  it("still announces why nothing can be clicked", () => {
    renderBoard(withGuess(ENTRY_AT + 10_000));

    // The rule is obvious on screen — the buttons are gone — but "gone" does
    // not survive being read aloud.
    expect(screen.getByText(/one guess at a time/i)).toBeInTheDocument();
  });
});

describe("GameBoard — the wait", () => {
  it("counts down the remaining seconds, and gives them the screen", () => {
    renderBoard(withGuess(ENTRY_AT + 42_000));

    expect(screen.getByTestId("countdown")).toHaveTextContent("18");
    // While a bet is live the countdown owns the readout. The live price is
    // still on screen, but demoted into the entry card underneath it — which is
    // the whole point of the layout, so it is worth asserting rather than
    // assuming.
    expect(screen.getByTestId("entry-card")).toContainElement(
      screen.getByTestId("current-price"),
    );
  });

  it("hands the readout back to the price when no bet is running", () => {
    renderBoard();

    expect(screen.queryByTestId("countdown")).not.toBeInTheDocument();
    expect(screen.getByTestId("current-price")).toHaveTextContent("$65,000.00");
  });

  it("drains the round bar as the minute runs out", () => {
    renderBoard(withGuess(ENTRY_AT + 45_000));

    // 15s left of 60 — a quarter of the track.
    expect(screen.getByTestId("round-progress")).toHaveStyle({ width: "25%" });
  });

  it("stops counting and names what it is waiting for once the minute is up", () => {
    renderBoard(withGuess(ENTRY_AT + 75_000));

    // A counter frozen at 0 reads as a broken app; the real blocker at this
    // point is the price, so the copy says that.
    expect(screen.queryByTestId("countdown")).not.toBeInTheDocument();
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
    history: [round()],
  };

  it("headlines a win, and keeps the detail one click away", async () => {
    // A live price distinct from both result prices, so the row assertion below
    // can only match the history.
    renderBoard({ state: resolved, price: 70_000 });

    expect(screen.getByText(/you were right/i)).toBeInTheDocument();
    expect(screen.getByTestId("result-delta")).toHaveTextContent("+1");

    // Closed by default: the frame belongs to the round in progress.
    expect(screen.queryByTestId("history-row")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("toggle-history"));

    expect(screen.getByTestId("history-row")).toHaveTextContent(
      "$65,000.00 → $65,120.00",
    );
  });

  it("shows a loss as a loss", () => {
    renderBoard({
      state: {
        ...resolved,
        score: -1,
        history: [round({ delta: -1, resolvedPrice: 64_900 })],
      },
    });

    expect(screen.getByText(/you were wrong/i)).toBeInTheDocument();
    // U+2212, matching the price delta above it.
    expect(screen.getByTestId("score")).toHaveTextContent("−1");
  });

  it("signs a positive score so it reads as a gain", () => {
    renderBoard({ state: { playerId: "p1", score: 3, history: [] } });

    expect(screen.getByTestId("score")).toHaveTextContent("+3");
  });

  it("cannot open a history that does not exist yet", () => {
    renderBoard();

    expect(screen.getByTestId("toggle-history")).toBeDisabled();
  });

  it("closes the history panel on Escape", async () => {
    renderBoard({ state: resolved });

    await userEvent.click(screen.getByTestId("toggle-history"));
    expect(screen.getByTestId("history-panel")).toBeInTheDocument();

    // It floats over the board, so it must be dismissible without hunting for
    // the six pixels that opened it.
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("history-panel")).not.toBeInTheDocument();
  });
});

describe("GameBoard — the streak strip", () => {
  it("counts wins back from the most recent round, and stops at the first loss", () => {
    expect(currentStreak([])).toBe(0);
    expect(currentStreak([round({ delta: -1 })])).toBe(0);
    expect(
      currentStreak([round(), round(), round({ delta: -1 }), round()]),
    ).toBe(2);
  });

  it("puts the streak in the header", () => {
    renderBoard({
      state: {
        playerId: "p1",
        score: 2,
        history: [round({ resolvedAt: 2 }), round({ resolvedAt: 1 })],
      },
    });

    expect(screen.getByTestId("streak")).toHaveTextContent("2");
  });

  it("shows the last rounds oldest-first, so the empty slot is where the next one lands", () => {
    renderBoard({
      state: {
        playerId: "p1",
        score: -1,
        // Newest first, as the server sends it: a loss, then two wins.
        history: [
          round({ delta: -1, resolvedAt: 3 }),
          round({ resolvedAt: 2 }),
          round({ resolvedAt: 1 }),
        ],
      },
    });

    const outcomes = screen
      .getAllByTestId("streak-pip")
      .map((pip) => pip.getAttribute("data-outcome"));

    expect(outcomes).toEqual(["won", "won", "lost"]);
  });

  it("never shows more rounds than it has slots for", () => {
    renderBoard({
      state: {
        playerId: "p1",
        score: 9,
        history: Array.from({ length: 12 }, (_, index) =>
          round({ resolvedAt: index + 1 }),
        ),
      },
    });

    expect(screen.getAllByTestId("streak-pip")).toHaveLength(STREAK_SLOTS);
  });
});

describe("GameBoard — the price display", () => {
  it("shows a placeholder instead of a zero before the first price arrives", () => {
    renderBoard({ price: null, priceStatus: "connecting" });

    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows only the current price while no guess is in flight", () => {
    renderBoard();

    expect(screen.getByTestId("current-price")).toHaveTextContent("$65,000.00");
    expect(screen.queryByTestId("price-to-beat")).not.toBeInTheDocument();
  });

  it("puts the price to beat next to the current one once a guess is live", () => {
    renderBoard({ ...withGuess(ENTRY_AT + 10_000), price: 65_400 });

    expect(screen.getByTestId("price-to-beat")).toHaveTextContent("$65,000.00");
    expect(screen.getByTestId("current-price")).toHaveTextContent("$65,400.00");
  });

  it("states the distance from the entry as a signed figure", () => {
    renderBoard({ ...withGuess(ENTRY_AT + 10_000), price: 65_400 });
    expect(screen.getByTestId("price-delta")).toHaveTextContent("+400.00");

    cleanup();

    // U+2212, not a hyphen — the glyph the tabular figures were drawn with.
    renderBoard({ ...withGuess(ENTRY_AT + 10_000), price: 64_600 });
    expect(screen.getByTestId("price-delta")).toHaveTextContent("−400.00");
  });

  it("tints the current price by where it stands, without flashing", () => {
    renderBoard({ ...withGuess(ENTRY_AT + 10_000), price: 65_400 });
    expect(screen.getByTestId("current-price")).toHaveAttribute("data-tone", "up");

    cleanup();

    renderBoard({ ...withGuess(ENTRY_AT + 10_000), price: 64_600 });
    expect(screen.getByTestId("current-price")).toHaveAttribute("data-tone", "down");
  });

  it("leaves the current price untinted while it sits exactly on the entry", () => {
    renderBoard({ ...withGuess(ENTRY_AT + 10_000), price: 65_000 });

    expect(screen.getByTestId("current-price")).toHaveAttribute("data-tone", "level");
    expect(screen.queryByTestId("price-delta")).not.toBeInTheDocument();
  });

  it("says which way the round is going, in words, from the player's side", () => {
    renderBoard({ ...withGuess(ENTRY_AT + 10_000), price: 65_400 });
    expect(screen.getByTestId("verdict")).toHaveTextContent(
      /you called up — currently ahead/i,
    );

    cleanup();

    renderBoard({ ...withGuess(ENTRY_AT + 10_000), price: 64_600 });
    expect(screen.getByTestId("verdict")).toHaveTextContent(
      /you called up — currently behind/i,
    );
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
