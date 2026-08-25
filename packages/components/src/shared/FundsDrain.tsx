import type { CareerEconomy } from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf, value } from "@ksp-gonogo/sitrep-sdk";
import { Unit } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";

/**
 * The standing funds rate a career economy reports: its subsidy less its
 * upkeep, or `null` when either half is missing.
 *
 * Both halves are required because an absent subsidy is not a subsidy of zero.
 * Reading upkeep alone would report a drain against a model that may well be
 * paying for it, which is the one direction this readout must not be wrong in:
 * it would tell an operator their programme is sinking on the strength of half
 * an answer. `CareerEconomy` in `PROGRAMME FUNDING` draws its net the same way,
 * so the two surfaces cannot disagree about what a career is costing.
 */
export function netFundsPerDay(
  economy: CareerEconomy | undefined | null,
): number | null {
  const subsidy = magnitudeOf(economy?.subsidyPerDay);
  const upkeep = magnitudeOf(economy?.upkeepPerDay);
  return subsidy !== null && upkeep !== null ? subsidy - upkeep : null;
}

/**
 * Whether {@link FundsDrain} has anything to say about this rate.
 *
 * Exported because a caller that puts a separator or a label beside the readout
 * needs to know whether the readout is there, and two places deciding what
 * counts as "no drain" is how one of them ends up rendering a lone bullet
 * against an empty span.
 */
export function reportsFundsDrain(netPerDay: number | null): boolean {
  return netPerDay !== null && netPerDay !== 0;
}

/**
 * How long a balance lasts at a rate, as a DURATION rather than a bare count.
 *
 * Both sides of the division are in game-days: `f/day`'s denominator is
 * `KSPUtil.dateTimeFormatter.Day` (`SitrepUnitAttribute.FundsPerDay` says so),
 * so the day cancels and what is left is a count of days. `d` is the unit that
 * says so, and the ladder climbs or descends from there off the live calendar.
 */
function coverDuration(days: number) {
  return value("d", days);
}

export interface FundsDrainProps {
  /**
   * The balance the drain runs against, in funds. `null` when no balance has
   * arrived or the one that did is no longer current, in which case the rate is
   * still shown and the cover figure is not.
   */
  funds: number | null;
  /**
   * Funds per day, subsidy minus upkeep, as answered by whichever money model
   * won the `economy` capability. Negative drains, positive credits. `null` when
   * no model answered, and rendered as nothing.
   */
  netPerDay: number | null;
  /**
   * Renders the cover figure alone, for a cell with room for one number. The
   * full sentence stays reachable through the title.
   */
  compact?: boolean;
  /**
   * Prefixes a middot, for a readout that sits in a run of dot-separated items.
   *
   * Offered here rather than written at the call site because the separator has
   * to sit INSIDE the first no-wrap phrase to stay glued to what follows it, and
   * a caller that wraps this whole component in its own no-wrap span to achieve
   * that turns the readout into one unbreakable run that clips at the panel edge
   * instead of taking a second line.
   */
  separator?: boolean;
}

/**
 * What a career's funds balance is DOING, beside the balance itself.
 *
 * A balance that covers a purchase today is not the same as a balance that
 * covers it and the month after it. Under a career overhaul a programme runs a
 * continuous per-day cost against a subsidy, so the number that decides whether
 * a spend is safe is not the balance but how long the balance lasts, and an
 * operator standing at a spend control should not have to divide one by the
 * other.
 *
 * ## Why it lives here and not in the kit
 *
 * It renders through `Unit` and carries no layout of its own, which is most of
 * what a kit primitive is, and four widgets share it. But it opens by importing
 * `CareerEconomy`: it knows about a DOMAIN, and the kit holds things that know
 * about shapes. Strip the career economy out and what is left is `Unit`
 * formatting over two numbers, which is not enough to be a primitive; keep it,
 * and the kit is holding a contract type. Sharing across widgets never required
 * the kit, only a shared file, which is what this is.
 *
 * An Uplink cannot import this package, so an Uplink that wants the same
 * readout will need its own. That is the isolation rule working rather than a
 * gap: the alternative is a contract type in the design system.
 *
 * ## It reports, it does not permit
 *
 * Nothing here arms or disarms a control. The game decides what is affordable,
 * and under a career overhaul it decides it with arithmetic this package does
 * not have; a readout that said "you cannot afford this" would be inventing a
 * verdict the wire never carried, and would be plainly wrong on stock. So this
 * shows the consequence of a spend and leaves the decision where it was.
 *
 * ## No drain renders as nothing, and that is the point
 *
 * Stock career has no upkeep and no subsidy, and its provider says so with two
 * honest zeros rather than by staying silent. A model that has never answered
 * says nothing at all. Both render as nothing here, because a "0 f/day"
 * chip reads as a programme that happens to break even, and an "unknown" chip
 * beside a balance reads as a link fault. Neither is what happened, and the
 * absence of a mechanism is not a reading about one.
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
      <FundsDrain__Root
        $drain={false}
        title="This programme earns more than it costs to hold"
      >
        <FundsDrain__Phrase>
          {lead}
          <Unit value={value("f/day", netPerDay)} /> credit
        </FundsDrain__Phrase>
      </FundsDrain__Root>
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
      <FundsDrain__Root $drain={true} title={sentence}>
        <FundsDrain__Phrase>
          {lead}
          {days === null ? (
            <Unit value={value("f/day", perDay)} />
          ) : (
            <>
              <Unit value={coverDuration(days)} /> left
            </>
          )}
        </FundsDrain__Phrase>
      </FundsDrain__Root>
    );
  }

  return (
    <FundsDrain__Root $drain={true} title={sentence}>
      {/* The magnitude, unsigned: the word carries the direction. A leading
          minus on a rate is read as a formatting artefact about as often as it
          is read as a direction, which is the reading `CareerEconomy` reached
          for its own "Net drain" row. */}
      <FundsDrain__Phrase>
        {lead}
        <Unit value={value("f/day", perDay)} /> drain
      </FundsDrain__Phrase>
      {/* The separator sits OUTSIDE both phrases, spaces and all: two adjacent
          nowrap spans with no text node between them offer the line breaker no
          opportunity, so the pair behaves as one unbreakable run and clips at
          the panel edge instead of taking a second line. */}
      {days !== null && (
        <>
          {" · "}
          <FundsDrain__Phrase>
            <Unit value={coverDuration(days)} /> left
          </FundsDrain__Phrase>
        </>
      )}
    </FundsDrain__Root>
  );
}

const FundsDrain__Root = styled.span<{ $drain: boolean }>`
  font-variant-numeric: tabular-nums;
  /* The MUTED warning foreground, not the plain one: --color-status-warning-fg
     is near-black because it is meant to sit on the orange fill, and this text
     stands alone on a dark panel. Same trap UpgradesHeld names next door. */
  color: ${({ $drain }) =>
    $drain
      ? "var(--color-status-warning-fg-muted)"
      : "var(--color-status-go-fg)"};
`;

/* Number, unit and the word that qualifies them are one phrase and must not be
   split across a line break; the phrase as a whole is free to wrap, so a narrow
   readout takes a second line rather than clipping at the panel edge. */
const FundsDrain__Phrase = styled.span`
  white-space: nowrap;
`;
