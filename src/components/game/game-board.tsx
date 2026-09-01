"use client"

import { ArrowDown, ArrowRight, ArrowUp, Loader2, X } from "lucide-react"
import Image from "next/image"
import { useEffect, useState } from "react"

import { GuessHistory } from "@/components/game/guess-history"
import { PriceStatusBadge } from "@/components/game/price-status"
import { TickChart } from "@/components/game/tick-chart"
import type { PriceStatus, PriceTick } from "@/hooks/use-live-price"
import { RESOLUTION_DELAY_MS } from "@/lib/game"
import type { GameState } from "@/lib/api/game-state"
import { siteMetadata } from "@/lib/metadata"
import type { Direction, LastResult } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * The whole interface, as a function of its props.
 *
 * No data fetching and no clock of its own: `now` arrives as a number, so every
 * state the player can be in — idle, counting down, waiting for a move, just
 * won, just lost — is reachable in a test by passing different props. The one
 * exception is whether the history drawer is open, which is view state and
 * belongs to nobody else.
 *
 * ## The layout, and why it stopped being three cards
 *
 * The previous board laid the game out as three equal-weight panels — market,
 * score and controls, history — which is a faithful map of the data and a poor
 * map of the game. Nothing on that screen said what the game is actually about:
 * *a countdown you have already bet on*. The 60 seconds were a line of body
 * text, the price you had to beat was one number among six, and the two buttons
 * that are the entire interaction sat at the bottom of the middle card.
 *
 * So this is one screen, not three cards, and it is ordered by how loud each
 * thing deserves to be:
 *
 * 1. **The countdown owns the middle of the frame.** While a bet is live it is
 *    the largest thing by an order of magnitude, and it glows. With no bet it
 *    steps aside and the live price takes the slot at half the size — the
 *    number you are about to bet on, not the one you are waiting on.
 * 2. **Entry → now, side by side, directly under it**, with the difference
 *    called out as a signed pill. This is the arithmetic the player is doing in
 *    their head, so the screen does it for them.
 * 3. **Up and Down are the primary target**, not a footnote: two 92px slabs
 *    across the bottom — and then they leave. The whole bottom row slides out
 *    the moment a guess is placed, because none of it is actionable until the
 *    round resolves, and a screen with no buttons on it says "one guess at a
 *    time" more plainly than a greyed-out button ever did. The score rides out
 *    with them and comes back as a header pill for the duration — it is the one
 *    passenger in that row that was never a control. See `ScorePill`.
 * 4. **The chart becomes wallpaper.** It is context, not content — it never
 *    tells you anything you must read, so it goes behind everything under a
 *    scrim, where it still shows the shape of the last two minutes.
 */

export type GameBoardProps = {
  state: GameState
  price: number | null
  priceStatus: PriceStatus
  ticks: PriceTick[]
  now: number
  onGuess: (direction: Direction) => void
  /** The direction being submitted right now, or `null` when nothing is in flight. */
  placing: Direction | null
  actionError: string | null
}

/** How many rounds the streak strip shows. Six slots, oldest on the left. */
export const STREAK_SLOTS = 6

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
})

/** U+2212, not a hyphen: at 30px next to tabular figures a hyphen reads as a dash. */
function signed(value: number): string {
  const magnitude = Math.abs(value).toFixed(2)
  return value < 0 ? `−${magnitude}` : `+${magnitude}`
}

/**
 * The score as it is read: signed, and never as a bare `-`.
 *
 * Shared by the score card and the header pill, so the same number cannot end
 * up punctuated two ways depending on where you happen to be reading it. U+2212
 * for the same reason as the price delta — at 34px an ASCII hyphen sits too
 * high and too short next to tabular figures, and a score is read as an
 * arithmetic quantity.
 */
export function formatScore(score: number): string {
  if (score > 0) return `+${score}`
  if (score < 0) return `−${Math.abs(score)}`
  return "0"
}

/**
 * Consecutive wins, counting back from the most recent round.
 *
 * Exported because it is the one piece of arithmetic on this screen that can be
 * wrong without looking wrong — a streak that keeps counting through a loss is
 * indistinguishable from a lucky player.
 */
export function currentStreak(history: LastResult[]): number {
  let streak = 0
  for (const result of history) {
    if (result.delta !== 1) break
    streak += 1
  }
  return streak
}

export function GameBoard({ state, price, priceStatus, ticks, now, onGuess, placing, actionError }: GameBoardProps) {
  const [historyOpen, setHistoryOpen] = useState(false)

  // The history is a panel floating over the board, and a panel that only closes
  // by clicking the exact six pixels that opened it is a trap. Bound to the
  // document rather than to the panel: the player's focus is usually still on
  // the call buttons when they want it gone.
  useEffect(() => {
    if (!historyOpen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHistoryOpen(false)
    }

    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [historyOpen])

  const guess = state.activeGuess
  const isLocked = Boolean(guess) || placing !== null

  // The direction the player is committed to, from the instant they click:
  // `placing` covers the round-trip, `guess.direction` everything after it. The
  // buttons key their colour off this, so the choice is never briefly forgotten.
  const chosen = guess?.direction ?? placing

  // Client clock against a server timestamp. Good enough for a countdown; the
  // resolution decision itself is made server-side and never trusts this.
  const remainingMs = guess ? Math.max(0, guess.entryAt + RESOLUTION_DELAY_MS - now) : 0
  const remainingSeconds = Math.ceil(remainingMs / 1000)
  const remainingFraction = guess ? remainingMs / RESOLUTION_DELAY_MS : 0

  // Past the 60-second mark the app is genuinely waiting on something else —
  // the price moving — so the countdown stands down rather than freezing at 0.
  const counting = guess !== undefined && remainingSeconds > 0

  // A round is on the board — which is not the same question as "is the clock
  // still counting". Past the 60-second mark the countdown stands down, but the
  // entry line, the locked controls and the missing score card are all still
  // true, so everything that dresses the frame for a live round keys off this
  // rather than off `counting`. Keying it off the clock would repaint the whole
  // screen at the exact moment the player is waiting on a price to move.
  const roundLive = guess !== undefined

  return (
    // `min-h-dvh` rather than `h-dvh`: dvh already tracks the mobile browser
    // chrome collapsing, but a viewport short enough that the frame's own
    // content does not fit still has to scroll rather than clip the buttons.
    <div className="flex min-h-dvh flex-1 flex-col">
      <div className={cn("relative isolate flex flex-1 flex-col overflow-hidden", "bg-[var(--arcade-ink)]")} data-testid="arcade-frame" data-round={roundLive ? "live" : "idle"}>
        {/* Layer 1: the market, as wallpaper. It carries its own scrim between
            its trace and its guides — see `TickChart`, which is the only place
            that knows which of its marks are decoration and which are read. */}
        <div className="pointer-events-none absolute inset-0 -z-10">
          <TickChart variant="wallpaper" ticks={ticks} entryPrice={guess?.entryPrice} entryAt={guess?.entryAt} now={now} />

          {/*
            The plate: a pool of ink over the chart's guides, only while a round
            is running.

            It exists because the grid and the entry line are painted over the
            chart's own scrim on purpose — they carry information, so they may
            not be washed out along with the trace. The cost is that their
            height is a price, and a price eventually maps to the middle of the
            frame: an amber rule straight through a 12rem numeral. Deepening the
            scrim does nothing about it, because the scrim is underneath them.

            Soft-edged and sized to the readout rather than to the frame, which
            is what keeps it from being merely a third scrim: the marks hold
            their full strength out at the edges, where their own labels are
            pinned, and give way only in the column the board writes in.

            ## It lives in here, and that is not an arrangement of convenience

            It belongs *above the guides and below the text*, and there is
            exactly one place in this tree that means both. Putting it in the
            content layer as an early sibling does not: an absolutely positioned
            element paints after its in-flow siblings whatever the document
            order says, so it went over the countdown rather than under it —
            which is the opposite of its entire job.

            This wrapper is positioned with a real `z-index`, so it is a
            stacking context: everything inside it is sealed behind the board's
            text, and inside it document order does apply. After `TickChart`,
            therefore over its guides. Both halves of the requirement, held by
            construction rather than by a z-index that has to be kept in sync.
          */}
          <div
            className={cn("arcade-plate absolute inset-0 transition-opacity duration-500 ease-out motion-reduce:transition-none", roundLive ? "opacity-100" : "opacity-0")}
            aria-hidden="true"
            data-testid="readout-plate"
            data-active={roundLive ? "true" : "false"}
          />
        </div>

        {/* Layer 2: the cabinet's light. Nothing to do with the chart — it is
            the pool the countdown sits in, and it shows on an empty frame too. */}
        <div className="arcade-bloom pointer-events-none absolute inset-0 -z-10" />

        {/* Layer 3: everything you read. `border-box` throughout, so the padding
            is inside the frame and the buttons cannot spill past its edges. */}
        <div className="relative flex flex-1 flex-col p-5 sm:p-8 lg:p-10">
          <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            {/* Both strings come from the document metadata, so the tab, the
                link preview and the header can never say three different
                things. The tagline is set smaller and in the dim grey rather
                than the amber: it is read once, on arrival, and then it is
                furniture — giving it the accent colour would put it in
                competition with the title it explains. */}
            <div className="flex items-center gap-2.5 sm:gap-3">
              {/* The same file the tab loads — see `@/lib/metadata`. `alt=""`
                  because the `h1` beside it already says the name, and a mark
                  that repeats its own label out loud is noise to a screen
                  reader. `unoptimized` because there is nothing to optimise:
                  the optimiser refuses SVG by default, and this one is under a
                  kilobyte. The rounded corners are the artwork's own, so
                  nothing here clips it. */}
              <Image src="/logo.svg" alt="" width={64} height={64} unoptimized priority className="size-8 shrink-0 sm:size-9" />
              <div>
                <h1 className="font-mono text-[11px] font-bold tracking-[0.22em] text-[var(--arcade-amber)] uppercase sm:text-[13px]">{siteMetadata.title}</h1>
                <p className="mt-1 font-mono text-[9px] font-medium tracking-[0.14em] text-[var(--arcade-dim)] uppercase sm:text-[10px]">{siteMetadata.description}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 sm:gap-4">
              <PriceStatusBadge status={priceStatus} />
              {/* No gap between these two: the score's own margin lives inside
                  the sleeve that collapses, so the header closes up completely
                  when it leaves instead of keeping a 12px hole open. */}
              <div className="flex items-center">
                <ScorePill score={state.score} visible={isLocked} />
                <StreakPill streak={currentStreak(state.history)} />
              </div>
            </div>
          </header>

          <div className="flex flex-1 flex-col items-center justify-center gap-5 py-8 sm:gap-6">
            <MainReadout counting={counting} remainingSeconds={remainingSeconds} price={price} waitingForMove={guess !== undefined && !counting} />

            {/* Only while a round is live. With nothing running there is no
                elapsed fraction to draw, and an empty track reads as a stalled
                one. */}
            {guess && (
              <div className="h-1 w-full max-w-[420px] overflow-hidden rounded-full bg-white/10" role="presentation">
                <div className="h-full rounded-full bg-[var(--arcade-amber)] transition-[width] duration-200 ease-linear motion-reduce:transition-none" style={{ width: `${Math.min(1, remainingFraction) * 100}%` }} data-testid="round-progress" />
              </div>
            )}

            {guess && <EntryToNow entryPrice={guess.entryPrice} price={price} />}

            <Verdict guess={guess} placing={placing} price={price} lastResult={state.history[0]} priceUnavailable={state.priceUnavailable === true} actionError={actionError} />
          </div>

          {/*
            Three across from `md` up, not `lg`. At 800px the two-row fallback
            gives the score card the full width of the frame to hold a two-digit
            number and six pips, and it reads as an empty shelf.

            `minmax(14.25rem, 3fr)` rather than a fixed width, because the frame
            is now as wide as the display. The floor is not arbitrary: six pips
            of 28px with 4px between them is 188px, so anything narrower wraps
            the strip. Above the floor the column keeps the mockup's 228:378
            ratio, which is what stops the score card from turning into a sliver
            next to two 500px buttons on a wide screen.
          */}
          {/*
            ## Why this row leaves the screen while a round runs

            Every control in it is disabled between the moment a guess is placed
            and the moment it resolves, so sliding it out costs the player
            nothing they could have acted on — and it buys back the bottom
            quarter of the display for the one thing they *are* watching.

            It also settles a collision that has no good answer otherwise: the
            entry line is drawn at whatever height its price maps to, and that
            height is data, so sooner or later it lands exactly across these
            three cards — an amber rule through the word DOWN. Reserving space
            for the row inside the chart's scale would have squashed the trace
            permanently to solve a problem that only exists while a round is
            live. Taking the row away instead solves it exactly when it occurs,
            and for free: the entry line and this row are never on screen
            together, by construction rather than by arrangement.

            The row keeps its space in the layout and only moves: collapsing it
            would re-centre the countdown mid-round, which is a jump in the one
            element that must look like it is not moving.

            Mounted and merely translated, not unmounted — it is still a
            disabled control that a screen reader should be able to find, and
            the "one guess at a time" status below still explains why.
          */}
          {/*
            Two things here are load-bearing and neither is obvious.

            `transition-[translate,opacity]`, not `transform`: Tailwind v4
            compiles `translate-y-*` to the independent `translate` property
            rather than to `transform`. A transition listing `transform` watches
            a property nothing is changing, so the row teleports off screen and
            only its opacity fades — which, once it has already teleported,
            looks exactly like no animation at all.

            `translate-y-0` on the base, not just `translate-y-[130%]` on the
            hidden state: with no translate utility at all the computed value is
            `none`, and `none` does not interpolate to a length any more than
            `display` does. Both ends have to be real values for there to be
            anything in between.
          */}
          <div
            className={cn(
              "grid translate-y-0 grid-cols-2 gap-3 transition-[translate,opacity] duration-500 ease-out sm:gap-4 md:grid-cols-[minmax(14.25rem,3fr)_5fr_5fr]",
              "motion-reduce:transition-none",
              // 130%, not 100%: the row has to clear its own drop shadow and the
              // frame's bottom padding, or a sliver of green stays on screen.
              isLocked && "pointer-events-none translate-y-[130%] opacity-0",
            )}
            data-testid="controls"
            data-hidden={isLocked ? "true" : "false"}
          >
            <ScoreCard score={state.score} history={state.history} historyOpen={historyOpen} onToggleHistory={() => setHistoryOpen((open) => !open)} />
            <DirectionButton direction="up" chosen={chosen} locked={isLocked} isPlacing={placing === "up"} remainingSeconds={remainingSeconds} onClick={onGuess} />
            <DirectionButton direction="down" chosen={chosen} locked={isLocked} isPlacing={placing === "down"} remainingSeconds={remainingSeconds} onClick={onGuess} />
          </div>

          {/*
            On screen the rule needs no words at all: there is nothing left to
            click. That is the clearest statement of it the interface can make,
            and it is the one that survives being read aloud least well — an
            element that has slid out of view is still in the accessibility
            tree, so "there are no buttons" is not a thing a screen reader can
            notice. Hence this.

            Only for a guess that is already placed. The in-flight case is spoken
            by the verdict line, which is a live region for exactly that reason;
            saying it in both places would announce it twice and, less subtly,
            put the same sentence on screen twice for a test to trip over.
          */}
          {guess && (
            <p className="sr-only" role="status">
              One guess at a time — wait for this one to resolve.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The score, for as long as its card is off the screen.
 *
 * The card at the bottom leaves with the controls row it belongs to, which is
 * right — every control in that row is dead mid-round — but the score is not a
 * control, and taking the running total of the game away while the game is
 * running is the one thing in that trade that cost the player something. So it
 * comes up here for the duration, in the header's existing vocabulary of pills,
 * next to the streak that never left.
 *
 * Never two copies of the number at once: this arrives on the same 500ms the
 * row leaves on, a beat later, so the handover reads as the score moving rather
 * than as a second one appearing. Smaller than the card's 34px on purpose — up
 * here it is a reference, and the headline mid-round is the clock.
 *
 * ## Two things worth knowing about how it collapses
 *
 * `grid-template-columns: 0fr → 1fr` around an `overflow-hidden` sleeve, rather
 * than a width or a `hidden`. A width would need a magic number that breaks the
 * day a score reaches three digits, and `hidden` does not interpolate at all.
 * The `fr` pair animates from nothing to exactly the content's width without
 * anyone having to know what that width is.
 *
 * `aria-hidden` unconditionally, which is not an oversight. The score card is
 * only translated off screen, never unmounted — deliberately, so that a screen
 * reader can still reach it — so the score is in the accessibility tree the
 * whole time. Announcing this copy as well would simply say it twice.
 */
function ScorePill({ score, visible }: { score: number; visible: boolean }) {
  return (
    <div
      className={cn(
        "grid transition-[grid-template-columns,opacity] duration-500 ease-out motion-reduce:transition-none",
        visible ? "grid-cols-[1fr] opacity-100 delay-150" : "grid-cols-[0fr] opacity-0",
      )}
      aria-hidden="true"
      data-testid="score-pill"
      data-hidden={visible ? "false" : "true"}
    >
      <div className="overflow-hidden">
        {/* The margin lives in here, inside the sleeve, so it collapses too. */}
        <span className="mr-3 flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 whitespace-nowrap sm:mr-4">
          <span className="font-mono text-[10px] font-medium tracking-[0.12em] text-[var(--arcade-dim)] uppercase">Score</span>
          {/* White, matching the card it stands in for. The streak beside it
              earns its amber by being a run; a score of zero is only where
              everyone starts, and two accents in one cluster is one too many. */}
          <span className="font-mono text-[13px] font-bold tabular-nums text-white" data-testid="score-pill-value">
            {formatScore(score)}
          </span>
        </span>
      </div>
    </div>
  )
}

function StreakPill({ streak }: { streak: number }) {
  return (
    <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5" data-testid="streak">
      <span className="font-mono text-[10px] font-medium tracking-[0.12em] text-[var(--arcade-dim)] uppercase">Streak</span>
      <span
        className={cn(
          "font-mono text-[13px] font-bold tabular-nums",
          // Zero is not an achievement, so it does not get the accent colour.
          streak > 0 ? "text-[var(--arcade-amber)]" : "text-[var(--arcade-dim)]",
        )}
      >
        {streak}
      </span>
    </span>
  )
}

/**
 * The middle of the screen, which holds exactly one number at a time.
 *
 * Which number is the whole design: while a bet is live it is the seconds left,
 * because that is the only thing the player can do nothing about. The rest of
 * the time it is the price, because that is the thing they are about to bet on.
 * Showing both at once would mean neither is the answer to "what am I looking
 * at".
 */
function MainReadout({ counting, remainingSeconds, price, waitingForMove }: { counting: boolean; remainingSeconds: number; price: number | null; waitingForMove: boolean }) {
  if (counting) {
    return (
      <div className="flex flex-col items-center">
        <p className="font-mono text-[10px] font-medium tracking-[0.28em] text-[var(--arcade-dim)] uppercase sm:text-[11px]">Seconds remaining</p>
        <p
          // Capped against the viewport's *height* as well as its width. On a
          // wide-and-short window — a laptop with the dock and the browser
          // chrome taking their cut — 17vw alone puts a 250px number in a 500px
          // frame and the call buttons go under the fold.
          className="arcade-glow font-mono text-[clamp(6rem,min(28vw,24vh),12rem)] leading-[1.05] font-bold tracking-[-0.05em] tabular-nums text-white"
          aria-live="off"
          data-testid="countdown"
        >
          {remainingSeconds}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center">
      {waitingForMove ? (
        <p className="font-mono text-[10px] font-medium tracking-[0.28em] text-[var(--arcade-amber)] uppercase sm:text-[11px]" data-testid="waiting-for-move">
          Waiting for a move
        </p>
      ) : (
        <p className="font-mono text-[10px] font-medium tracking-[0.28em] text-[var(--arcade-dim)] uppercase sm:text-[11px]">BTC / USD</p>
      )}

      {/*
        Roughly half the countdown at every size, on purpose. A price set as
        large as the clock would make the idle screen shout as loudly as the live
        one, and then nothing about the layout would tell you whether a bet is
        running. It is nine glyphs against two, so it takes the viewport's height
        into account as well — the countdown can afford 24vh, this cannot.
      */}
      <p className="font-mono text-[clamp(2.75rem,min(9vw,14vh),5.5rem)] leading-[1.15] font-bold tracking-[-0.02em] tabular-nums text-white" aria-live="polite" data-testid={waitingForMove ? "waiting-price" : "current-price"}>
        {price === null ? "—" : usd.format(price)}
      </p>
    </div>
  )
}

/**
 * Entry and now, and the distance between them.
 *
 * The entry price is set smaller and dimmer than the current one even though it
 * is the number being chased: it is fixed for the whole round, so after the
 * first read it is a reference, while the one next to it changes every second.
 */
function EntryToNow({ entryPrice, price }: { entryPrice: number; price: number | null }) {
  const delta = price === null ? null : price - entryPrice
  const ahead = delta !== null && delta > 0

  return (
    <div className="flex w-full max-w-[420px] items-center gap-3 rounded-[14px] border border-white/[0.09] bg-black/35 px-4 py-3 sm:gap-4 sm:px-5" data-testid="entry-card">
      <div className="shrink-0">
        <p className="font-mono text-[9px] font-medium tracking-[0.16em] text-[var(--arcade-dim)] uppercase">Entry</p>
        <p className="font-mono text-[13px] tabular-nums text-[#c9ccd1] sm:text-[15px]" data-testid="price-to-beat">
          {usd.format(entryPrice)}
        </p>
      </div>

      <ArrowRight className="size-4 shrink-0 text-[var(--arcade-quiet)]" aria-hidden="true" />

      <div className="min-w-0 flex-1">
        <p className="font-mono text-[9px] font-medium tracking-[0.16em] text-[var(--arcade-dim)] uppercase">Now</p>
        <p
          className="truncate font-mono text-[18px] font-bold tabular-nums text-white sm:text-[24px]"
          aria-live="polite"
          data-testid="current-price"
          // Asserted on instead of a colour class: the tone is the claim, the
          // hex that renders it is an implementation detail.
          data-tone={delta === null || delta === 0 ? "level" : ahead ? "up" : "down"}
        >
          {price === null ? "—" : usd.format(price)}
        </p>
      </div>

      {delta !== null && delta !== 0 && (
        <span
          className={cn(
            "shrink-0 rounded-lg px-2 py-1.5 font-mono text-[12px] font-bold tabular-nums sm:text-[15px]",
            ahead ? "bg-[color-mix(in_srgb,var(--arcade-up)_12%,transparent)] text-[var(--arcade-up)]" : "bg-[color-mix(in_srgb,var(--arcade-down)_12%,transparent)] text-[var(--arcade-down)]",
          )}
          data-testid="price-delta"
        >
          {signed(delta)}
        </span>
      )}
    </div>
  )
}

/**
 * One line of prose under the numbers, and only ever one.
 *
 * It is the only place on the screen that says something in words rather than
 * in a shape or a colour, so it is reserved for whatever is most true right now,
 * in this order: an error, a broken feed, a bet in flight, a bet running, the
 * last result, the invitation.
 */
function Verdict({
  guess,
  placing,
  price,
  lastResult,
  priceUnavailable,
  actionError,
}: {
  guess: GameState["activeGuess"]
  placing: Direction | null
  price: number | null
  lastResult?: LastResult
  priceUnavailable: boolean
  actionError: string | null
}) {
  if (actionError) {
    return (
      <p className="text-center text-[13px] font-medium text-[var(--arcade-down)]" role="alert">
        {actionError}
      </p>
    )
  }

  if (priceUnavailable) {
    return (
      <p className="max-w-[36rem] text-center text-[13px] font-medium text-[var(--arcade-down)]" role="alert">
        Price feed unreachable — your guess stays open until we can read a price.
      </p>
    )
  }

  if (placing) {
    return (
      <p className="flex items-center gap-2 text-[13px] font-medium text-[var(--arcade-dim)]" role="status">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        Placing your guess…
      </p>
    )
  }

  if (guess) {
    const delta = price === null ? null : price - guess.entryPrice
    const winning = delta === null || delta === 0 ? null : guess.direction === "up" ? delta > 0 : delta < 0

    return (
      <p className={cn("text-center text-[13px] font-medium", winning === null && "text-[var(--arcade-dim)]", winning === true && "text-[var(--arcade-up)]", winning === false && "text-[var(--arcade-down)]")} data-testid="verdict">
        You called {guess.direction === "up" ? "Up" : "Down"} — {winning === null ? "level with your entry" : winning ? "currently ahead" : "currently behind"}
      </p>
    )
  }

  if (lastResult) {
    const won = lastResult.delta === 1

    return (
      <p className="flex items-center gap-2.5 text-[13px] font-medium" data-testid="verdict">
        <span className={won ? "text-[var(--arcade-up)]" : "text-[var(--arcade-down)]"}>{won ? "You were right" : "You were wrong"}</span>
        <span
          className={cn(
            "rounded-md px-1.5 py-0.5 font-mono text-[12px] font-bold tabular-nums",
            won ? "bg-[color-mix(in_srgb,var(--arcade-up)_14%,transparent)] text-[var(--arcade-up)]" : "bg-[color-mix(in_srgb,var(--arcade-down)_14%,transparent)] text-[var(--arcade-down)]",
          )}
          data-testid="result-delta"
        >
          {won ? "+1" : "−1"}
        </span>
      </p>
    )
  }

  return <p className="max-w-[32rem] text-center text-[13px] font-medium text-[var(--arcade-dim)]">Pick a direction. In 60 seconds, once the price has moved, you win or lose a point.</p>
}

/**
 * Score, and the shape of how you got there.
 *
 * A score of −3 says almost nothing on its own: it is the same number for
 * someone who has lost three in a row and someone who is four-and-seven and
 * climbing. The pips put the last six rounds next to it in the space a second
 * number would have taken, and they are the control that opens the full table —
 * which is where the player's eye already is when they want it.
 *
 * The table opens *over* the board rather than under it. When the frame was a
 * 1080px card there was a page underneath to grow into; edge to edge there is
 * not, and a drawer below the fold is a drawer nobody finds. So it is a panel
 * anchored to the top edge of this card — one grid cell away from the pips that
 * summon it — and it closes on Escape, on the pips, or on its own button.
 */
function ScoreCard({ score, history, historyOpen, onToggleHistory }: { score: number; history: LastResult[]; historyOpen: boolean; onToggleHistory: () => void }) {
  // Newest-first from the server, oldest-first on screen, so the strip fills
  // left to right and the empty slot is always where the next round lands.
  const recent = history.slice(0, STREAK_SLOTS).reverse()
  const blanks = STREAK_SLOTS - recent.length

  return (
    <div className="relative col-span-2 flex flex-col justify-between rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-3.5 sm:px-5 sm:py-4 md:col-span-1">
      <p className="font-mono text-[9px] font-medium tracking-[0.16em] text-[var(--arcade-dim)] uppercase">Score</p>
      <p className="font-mono text-[28px] leading-none font-bold tabular-nums text-white sm:text-[34px]" data-testid="score">
        {formatScore(score)}
      </p>

      <button
        type="button"
        onClick={onToggleHistory}
        // Disabled rather than hidden: the strip is part of the card's shape,
        // and a card that grows a row of pips after the first round would shift
        // the two buttons next to it.
        disabled={history.length === 0}
        aria-expanded={historyOpen}
        aria-controls="history-panel"
        className="group mt-3 flex gap-1 rounded-sm focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none enabled:cursor-pointer"
        data-testid="toggle-history"
      >
        <span className="sr-only">{history.length === 0 ? "No rounds played yet" : historyOpen ? "Hide the full history" : `Show the full history (${history.length} rounds)`}</span>

        {recent.map((result) => (
          <span
            key={result.resolvedAt}
            aria-hidden="true"
            data-testid="streak-pip"
            data-outcome={result.delta === 1 ? "won" : "lost"}
            className={cn("h-[5px] w-7 rounded-[2px] transition-opacity group-hover:opacity-80", result.delta === 1 ? "bg-[var(--arcade-up)]" : "bg-[var(--arcade-down)]")}
          />
        ))}
        {Array.from({ length: blanks }, (_, index) => (
          <span key={`blank-${index}`} aria-hidden="true" className="h-[5px] w-7 rounded-[2px] bg-white/[0.14]" />
        ))}
      </button>

      {historyOpen && (
        <div
          id="history-panel"
          // Opaque, not translucent. Everything behind it is a chart and a
          // 12rem number, and a frosted panel over that is a legibility problem
          // dressed up as depth.
          className={cn("absolute bottom-full left-0 z-20 mb-3 rounded-2xl border border-white/12 bg-[#0f1216] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.6)]", "w-[min(26rem,calc(100vw-2.5rem))]")}
          data-testid="history-panel"
        >
          <button
            type="button"
            onClick={onToggleHistory}
            className="absolute top-3 right-3 cursor-pointer rounded-md p-1 text-[var(--arcade-dim)] hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none"
          >
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only">Close the history</span>
          </button>

          {/* Its own scroll, capped against the viewport: "Show all" can list
              twenty rounds, and on a short window that is taller than the
              screen the panel is floating in. */}
          <div className="max-h-[min(24rem,50vh)] overflow-y-auto pr-1">
            <GuessHistory results={history} />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The two colours are the app's whole vocabulary — green is up, red is down —
 * so the surest way to keep the player's choice in front of them is to leave
 * their colour switched on and switch the other one off.
 *
 * Three states, and only three:
 *
 * - `idle`    — both playable, tinted, hoverable.
 * - `chosen`  — locked in. Full colour, ringed, and labelled YOUR CALL.
 * - `dimmed`  — the road not taken. Stripped of colour and labelled with how
 *               long it stays that way, so it reads as unavailable rather than
 *               as a second live option.
 *
 * A plain `<button>` rather than the shadcn one. Every prop that component
 * offers here — size, variant, the disabled fade — is one this design overrides,
 * and a 92px slab with two stacked labels is not a variant of a 36px control.
 */
const DIRECTION_TONE = {
  up: {
    accent: "var(--arcade-up)",
    idle: "border-[color-mix(in_srgb,var(--arcade-up)_30%,transparent)] bg-[color-mix(in_srgb,var(--arcade-up)_8%,transparent)] text-[var(--arcade-up)] hover:bg-[color-mix(in_srgb,var(--arcade-up)_14%,transparent)]",
    chosen: "border-[color-mix(in_srgb,var(--arcade-up)_45%,transparent)] bg-gradient-to-b from-[color-mix(in_srgb,var(--arcade-up)_16%,transparent)] to-[color-mix(in_srgb,var(--arcade-up)_6%,transparent)] text-[var(--arcade-up)]",
  },
  down: {
    accent: "var(--arcade-down)",
    idle: "border-[color-mix(in_srgb,var(--arcade-down)_30%,transparent)] bg-[color-mix(in_srgb,var(--arcade-down)_8%,transparent)] text-[var(--arcade-down)] hover:bg-[color-mix(in_srgb,var(--arcade-down)_14%,transparent)]",
    chosen: "border-[color-mix(in_srgb,var(--arcade-down)_45%,transparent)] bg-gradient-to-b from-[color-mix(in_srgb,var(--arcade-down)_16%,transparent)] to-[color-mix(in_srgb,var(--arcade-down)_6%,transparent)] text-[var(--arcade-down)]",
  },
} as const

const DIRECTION_ICON = { up: ArrowUp, down: ArrowDown } as const

function DirectionButton({
  direction,
  chosen,
  locked,
  isPlacing,
  remainingSeconds,
  onClick,
}: {
  direction: Direction
  chosen: Direction | null
  locked: boolean
  isPlacing: boolean
  remainingSeconds: number
  onClick: (direction: Direction) => void
}) {
  const tone = DIRECTION_TONE[direction]
  const Icon = DIRECTION_ICON[direction]

  const state = !locked ? "idle" : chosen === direction ? "chosen" : "dimmed"

  // Careful with the wording of these: they land inside the button, so they are
  // part of its accessible name. Neither may contain the other direction's word.
  //
  // `normal-case` on the seconds is not a detail — the caption is uppercased in
  // CSS, and an uppercased unit gives "LOCKED 42S", which reads as a letter.
  const caption =
    state === "chosen" ? (
      isPlacing ? (
        "Placing…"
      ) : (
        "Your call"
      )
    ) : state === "dimmed" ? (
      remainingSeconds > 0 ? (
        <>
          Locked <span className="normal-case">{remainingSeconds}s</span>
        </>
      ) : (
        "Locked"
      )
    ) : direction === "up" ? (
      <>
        Higher in <span className="normal-case">60s</span>
      </>
    ) : (
      <>
        Lower in <span className="normal-case">60s</span>
      </>
    )

  return (
    <button
      type="button"
      className={cn(
        "flex min-h-[4.75rem] flex-col items-center justify-center gap-0.5 rounded-2xl border-[1.5px]",
        "transition-colors focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none",
        "sm:min-h-[5.75rem]",
        state === "idle" && cn(tone.idle, "cursor-pointer"),
        state === "chosen" && tone.chosen,
        state === "dimmed" && "border-white/[0.08] bg-white/[0.03] text-white/28",
        locked && "cursor-not-allowed",
      )}
      disabled={locked}
      onClick={() => onClick(direction)}
      data-testid={`direction-${direction}`}
      data-state={state}
    >
      <span className="flex items-center gap-2 font-sans text-[20px] font-bold sm:text-[26px]">
        {isPlacing ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <Icon className="size-5 sm:size-6" aria-hidden="true" />}
        {direction === "up" ? "Up" : "Down"}
      </span>
      <span className="font-mono text-[9px] font-medium tracking-[0.18em] uppercase opacity-70 sm:text-[10px]">{caption}</span>
    </button>
  )
}
