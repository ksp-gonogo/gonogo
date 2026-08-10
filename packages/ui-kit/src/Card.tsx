import type { HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import type { ReadoutTone } from "./Readout";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Draws a 2px accent rule down the leading edge in the tone's colour.
   *
   * Three sites had hand-rolled exactly this (`PerfBudgets` colouring a budget
   * by how close it is to its cap, `AlarmsModal` colouring an alarm by whether
   * it is firing or arming, `StaffRoster` next door in the same file), each
   * with its own local tone-to-colour table. The tone vocabulary already exists
   * as `ReadoutTone`, so the tables were three copies of a mapping the kit
   * already owns.
   *
   * Ignored on the leading edge whenever `accentColor` also resolves to a
   * colour (see below); a card carries either a STATUS accent or an IDENTITY
   * strip on that edge, never both fighting for the same pixel.
   */
  tone?: ReadoutTone;
  /**
   * Dims the card to signal unavailable-but-still-listed: a crew member on a
   * mission, a part not yet unlocked. A record that is greyed rather than
   * hidden keeps the list stable, which is why widgets reach for it.
   *
   * Opacity rather than a colour swap so it composes with `tone`: a dimmed
   * card keeps its accent rule, just quieter.
   */
  dimmed?: boolean;
  /**
   * Explicit CSS colour for the leading-edge strip: the IDENTITY counterpart
   * to `tone`'s STATUS accent (a resource's strip says WHICH resource this
   * card is about, never how it is doing), the same split `Meter`'s
   * `fillColor` already draws against its own `tone`. Wins over `tone`'s
   * accent rule when both are given.
   *
   * A plain colour, not a resource name: this primitive has no opinion on
   * how a colour gets chosen. A caller wanting the resource-identity look
   * (the same name -> hue/lightness mapping ShipMap's per-part meters use)
   * resolves it first, e.g. `accentColor={resourceColor(name)}`, and passes
   * the result in, exactly like `Meter`'s own `fillColor` doc already asks
   * for. ui-kit stays a dumb rendering primitive; the naming policy lives
   * with the caller.
   */
  accentColor?: string;
  /**
   * Explicit CSS colour for a TOP-edge strip: the resource/category identity
   * counterpart to the leading edge, which stays reserved for STATUS
   * (`tone`/`accentColor`). The operator's own colour-language split: status
   * reads on the left, "what kind of thing is this" reads on top. The two
   * compose deliberately, a card can show a status accent on its left AND a
   * resource-identity strip on top at the same time, they answer different
   * questions and neither should have to win over the other the way
   * `accentColor` wins over `tone` on the shared left edge.
   *
   * A plain colour, not a resource name, same contract as `accentColor`:
   * this primitive has no opinion on how the colour was chosen. A caller
   * wanting the resource-identity look resolves it first (e.g. via a
   * `resourceColor(name)`-backed map) and passes the result in.
   */
  categoryColor?: string;
  children?: ReactNode;
}

const TONE_COLOR: Record<ReadoutTone, string> = {
  default: "var(--color-border-subtle)",
  go: "var(--color-accent-fg)",
  warning: "var(--color-status-warning-bg)",
  alert: "var(--color-status-nogo-bg)",
};

/** 3px, a touch wider than the 2px `tone` accent rule: the identity strip is
 *  meant to read as a distinct visual language from the status accent, not a
 *  same-width recolouring of it. */
const STRIP_WIDTH = "3px";

/**
 * Sunken inset card: a nested surface for a single record inside a list
 * (a tracked vessel, a fleet entry). Extracted from the Scanning widget's
 * `VesselCard`.
 */
export const Card = styled.div<CardProps>`
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm, 3px);
  padding: var(--space-6, 6px) var(--space-8, 8px);
  ${({ tone, accentColor }) => {
    if (accentColor) return `border-left: ${STRIP_WIDTH} solid ${accentColor};`;
    return tone ? `border-left: 2px solid ${TONE_COLOR[tone]};` : "";
  }}
  ${({ categoryColor }) =>
    categoryColor ? `border-top: ${STRIP_WIDTH} solid ${categoryColor};` : ""}
  ${({ dimmed }) => (dimmed ? "opacity: 0.5;" : "")}
`;
