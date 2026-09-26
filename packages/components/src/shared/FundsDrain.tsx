import type { CareerEconomy, Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import { combineReadings, magnitudeOf, value } from "@ksp-gonogo/sitrep-sdk";
import { Unit } from "@ksp-gonogo/ui-kit";

/**
 * Subsidy less upkeep, or `null` when either half is missing: an absent
 * subsidy is not a zero subsidy.
 */
export function netFundsPerDay(
  economy: CareerEconomy | undefined | null,
): number | null {
  const subsidy = magnitudeOf(economy?.subsidyPerDay);
  const upkeep = magnitudeOf(economy?.upkeepPerDay);
  return subsidy !== null && upkeep !== null ? subsidy - upkeep : null;
}

/**
 * {@link netFundsPerDay} as a signed Reading, for a surface that draws the
 * figure and so needs its currency.
 */
export function netFundsPerDayReading(
  subsidy: Reading<Value<"f/day">>,
  upkeep: Reading<Value<"f/day">>,
): Reading<Value<"f/day">> {
  return combineReadings([subsidy, upkeep], (paid, spent) => paid.minus(spent));
}

/** Whether {@link FundsDrain} renders anything, for a caller placing a separator beside it. */
export function reportsFundsDrain(netPerDay: number | null): boolean {
  return netPerDay !== null && netPerDay !== 0;
}

/** `f/day` is per game-day, so balance over rate is a count of game-days. */
function coverDuration(days: number) {
  return value("d", days);
}

export interface FundsDrainProps {
  /** `null` when no current balance is known: the rate still shows, the cover figure does not. */
  funds: number | null;
  /** Subsidy minus upkeep; negative drains, positive credits, `null` renders nothing. */
  netPerDay: number | null;
  /** The cover figure alone; the full sentence stays in the title. */
  compact?: boolean;
  /** Prefixes a middot inside the first no-wrap phrase, so it stays glued to what follows. */
  separator?: boolean;
}

/**
 * The standing funds rate and how long the balance lasts at it, beside the
 * balance. It reports and never permits: affordability is the game's verdict.
 * A zero or unanswered rate renders nothing, since "0 f/day" reads as breaking
 * even and "unknown" reads as a link fault.
 */
export function FundsDrain({
  funds,
  netPerDay,
  compact,
  separator,
}: FundsDrainProps) {
  const lead = separator ? "· " : "";
  if (!reportsFundsDrain(netPerDay) || netPerDay === null) return null;

  if (netPerDay > 0) {
    return (
      <span
        style={rootStyle(false)}
        title="This programme earns more than it costs to hold"
      >
        <span style={PHRASE_STYLE}>
          {lead}
          <Unit value={value("f/day", netPerDay)} /> credit
        </span>
      </span>
    );
  }

  const perDay = -netPerDay;
  const days = funds === null ? null : Math.floor(Math.max(funds, 0) / perDay);
  const sentence =
    days === null
      ? "This programme costs more to hold than it earns"
      : `This programme costs more to hold than it earns, and the balance covers ${days} more ${days === 1 ? "day" : "days"} at that rate`;

  if (compact) {
    return (
      <span style={rootStyle(true)} title={sentence}>
        <span style={PHRASE_STYLE}>
          {lead}
          {days === null ? (
            <Unit value={value("f/day", perDay)} />
          ) : (
            <>
              <Unit value={coverDuration(days)} /> left
            </>
          )}
        </span>
      </span>
    );
  }

  return (
    <span style={rootStyle(true)} title={sentence}>
      {/* Unsigned: the word carries the direction. */}
      <span style={PHRASE_STYLE}>
        {lead}
        <Unit value={value("f/day", perDay)} /> drain
      </span>
      {/* Outside both phrases: adjacent nowrap spans with no text between them never break. */}
      {days !== null && (
        <>
          {" · "}
          <span style={PHRASE_STYLE}>
            <Unit value={coverDuration(days)} /> left
          </span>
        </>
      )}
    </span>
  );
}

// The plain warning foreground is near-black, meant for the orange fill; this text sits on a dark panel.
function rootStyle(drain: boolean) {
  return {
    fontVariantNumeric: "tabular-nums",
    color: drain
      ? "var(--color-status-warning-fg-muted)"
      : "var(--color-status-go-fg)",
  } as const;
}

// Number, unit and qualifying word never split; the readout wraps between phrases.
const PHRASE_STYLE = { whiteSpace: "nowrap" } as const;
