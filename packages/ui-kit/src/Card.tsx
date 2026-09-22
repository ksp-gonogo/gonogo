import type { ReactNode } from "react";
import styled from "styled-components";
import {
  BLOCK_PARTS,
  Block__Root,
  type BlockProps,
  renderBlockAnatomy,
} from "./Block";
import type { ReadoutTone } from "./Readout";

export interface CardProps extends BlockProps {
  /**
   * How this record is DOING, drawn as a 2px accent rule down the leading edge.
   *
   * Status only. Three sites had hand-rolled exactly this (`PerfBudgets`
   * colouring a budget by how close it is to its cap, `AlarmsModal` colouring
   * an alarm by whether it is firing or arming, `AstronautComplex` colouring a
   * crew row by its situation), each with its own local tone-to-colour table.
   * The tone vocabulary already exists as `ReadoutTone`, so the tables were
   * three copies of a mapping the kit already owns.
   *
   * The leading edge is now this prop's alone. It used to be shared with an
   * `accentColor` that drew identity there and won any tie, which is how one
   * card ended up unable to say both things at once; identity moved to
   * `identityColor` on the top edge, where it had a tab of its own already.
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
   * WHICH THING this record is about, drawn as a short centred tab on the TOP
   * edge: a resource's own colour, a category's hue. Never a status, that is
   * `tone`.
   *
   * The two compose, and that is the whole reason they are separate props.
   * `ResourceOps` needs both at once: a converter's card says which resource it
   * makes and whether it is running, and those answer different questions.
   *
   * Deliberately NOT a full-width border: operator feedback on the first pass
   * called a full-edge strip too busy, it read as a second meter stacked on the
   * card rather than a quiet identity mark. A `--space-24` tab centred on the
   * top edge instead, short enough to read as a label, not a gauge.
   *
   * A plain CSS colour, not a resource name: this primitive has no opinion on
   * how the colour was chosen, the same contract `Meter`'s `fillColor` already
   * states. A caller wanting the resource-identity look resolves it first, e.g.
   * `identityColor={resourceColor(name)}`.
   */
  identityColor?: string;
  /**
   * The roomier inset for a card that IS its screen rather than one record in a
   * list: the serial menu's device cards and the input tab's binding cards,
   * whose panels hold nothing but cards of that one kind, each holding its own
   * select and buttons.
   *
   * The two sites reached it by doing `styled(Card)` over the very token the
   * name would be, twice, which is the kit's own padding being called too tight
   * for anything with a control in it. It is a prop and not a density tier
   * because it is a statement about THIS card's role, which only the call site
   * knows; a tier is a statement a container makes about its descendants, and
   * `--inset-surface-standalone`'s own note in tokens.css says why that is the
   * wrong shape here.
   */
  standalone?: boolean;
  children?: ReactNode;
}

/** The status vocabulary, as edge colours. Shared with `Notice`. */
export const TONE_COLOR: Record<ReadoutTone, string> = {
  default: "var(--color-border-subtle)",
  go: "var(--color-accent-fg)",
  warning: "var(--color-status-warning-bg)",
  alert: "var(--color-status-nogo-bg)",
};

/** 3px, a touch wider than the 2px `tone` accent rule: the identity tab is
 *  meant to read as a distinct visual language from the status accent, not a
 *  same-width recolouring of it. */
const STRIP_WIDTH = "3px";

/**
 * `Block` plus a surface, as a styled extension of the very same root rather
 * than a wrapper around it. The border, the ground, the corner and the inset
 * are everything this adds; the title's type, the four asides and the footer
 * are the arrangement's and arrive unchanged.
 *
 * A card is the app's COMPACT density tier, and it says so by re-declaring
 * both steppable gap names one rung down. Everything rendered inside a card
 * inherits them, across styled-components, across packages and into a third
 * party's own CSS, so a widget written as `gap: var(--gap-related)` tightens
 * inside a card without its author writing a conditional. That is the whole
 * reason the tiers live on custom properties rather than on a React context: a
 * context reaches the kit's own primitives and nothing else, and most of the
 * app's spacing is declared in a widget's own `styled.div`.
 *
 * This stepping is also the ENTIRE case for a semantic gap name, so it is the
 * shape of the vocabulary rather than a feature of it: a name that resolved to
 * the same number in every tier would be a constant with two spellings. A 1px
 * seam is the worked example, and it is why `gap: var(--space-hair)` stays a
 * rung.
 *
 * The insets do not step, because a chip inside a card is still a chip; a card
 * that wanted its children's edges tightened would be saying something about
 * them rather than about itself.
 *
 * Every new density tier needs a written reason like this one, or the
 * vocabulary problem the names were built to fix returns wearing a hat.
 */
const Card__Root = styled(Block__Root)<{
  $tone?: ReadoutTone;
  $dimmed?: boolean;
  $identityColor?: string;
  $standalone?: boolean;
}>`
  --gap-related: var(--space-6, 6px);
  --gap-section: var(--space-12, 12px);

  position: relative;
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-regular, 3px);
  ${({ $standalone }) =>
    $standalone
      ? "padding: var(--inset-surface-standalone);"
      : "padding: var(--inset-surface, var(--space-6, 6px) var(--space-8, 8px));"}
  ${({ $tone }) =>
    $tone ? `border-left: 2px solid ${TONE_COLOR[$tone]};` : ""}
  ${({ $identityColor }) =>
    $identityColor
      ? `
    &::before {
      content: "";
      position: absolute;
      top: -1px;
      left: 50%;
      transform: translateX(-50%);
      width: var(--space-24, 24px);
      height: ${STRIP_WIDTH};
      background: ${$identityColor};
      border-radius: var(--radius-regular, 3px) var(--radius-regular, 3px) 0 0;
    }
  `
      : ""}
  ${({ $dimmed }) => ($dimmed ? "opacity: 0.5;" : "")}
`;

function CardRoot({
  tone,
  dimmed,
  identityColor,
  standalone,
  ...props
}: CardProps): ReactNode {
  return renderBlockAnatomy(Card__Root, {
    ...props,
    $tone: tone,
    $dimmed: dimmed,
    $identityColor: identityColor,
    $standalone: standalone,
  });
}

/**
 * A record on a sunken surface: `Block`'s arrangement inside a bordered, inset
 * box.
 *
 * Its parts are `Block`'s parts, the same objects: `Card.Title === Block.Title`
 * by construction, so a widget hand-composing from either door cannot drift
 * from the other. `Notice` reaches the same set.
 *
 * A widget that wants the grouping and NOT the box writes `Block`. That is not
 * a hypothetical: `ContractManager` hand-built a whole card family to escape
 * this surface and ended up drawing its records the same colour as the panel
 * behind them, with no border at all.
 */
export const Card = Object.assign(CardRoot, BLOCK_PARTS);
