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
  children?: ReactNode;
}

const TONE_COLOR: Record<ReadoutTone, string> = {
  default: "var(--color-border-subtle)",
  go: "var(--color-accent-fg)",
  warning: "var(--color-status-warning-bg)",
  alert: "var(--color-status-nogo-bg)",
};

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
  ${({ tone }) => (tone ? `border-left: 2px solid ${TONE_COLOR[tone]};` : "")}
  ${({ dimmed }) => (dimmed ? "opacity: 0.5;" : "")}
`;
