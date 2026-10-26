import type { Tone } from "@ksp-gonogo/sitrep-sdk";
import styled from "styled-components";
import { TONE_MARK } from "./tone";

/**
 * Props for {@link Pips}. Useful for setting how many pips show the operator
 * a rating. Taken by {@link Pips}.
 *
 * @category Meter
 */
export interface PipsProps {
  /** How many pips are filled, between zero and `of`. */
  filled: number;
  /** How many pips the row has. */
  of: number;
  /**
   * Colour of the pips.
   *
   * @defaultValue `"info"`
   */
  tone?: Tone;
  /** What the row rates, spoken before the count: "Difficulty" reads "Difficulty: 2 of 3". */
  label?: string;
}

/**
 * A row of round pips with `filled` of them solid and the rest outlined, as in
 * a difficulty rating. Useful for showing the operator a small whole-number
 * rating at a glance, such as how hard a contract is. Used by the contract
 * board widget for a contract's difficulty.
 *
 * It is sized in em, so it scales with the text beside it.
 *
 * @category Meter
 */
export function Pips({ filled, of, tone = "info", label }: PipsProps) {
  const count = `${filled} of ${of}`;
  return (
    <Pips__Root
      role="img"
      aria-label={label === undefined ? count : `${label}: ${count}`}
      data-pips=""
    >
      {Array.from({ length: of }, (_, index) => (
        <Pips__Pip
          // biome-ignore lint/suspicious/noArrayIndexKey: a pip is its position
          key={index}
          $colour={TONE_MARK[tone]}
          $filled={index < filled}
        />
      ))}
    </Pips__Root>
  );
}

const Pips__Root = styled.span`
  display: inline-flex;
  align-items: center;
  gap: var(--gap-related);
  flex: none;
`;

const Pips__Pip = styled.span<{ $colour: string; $filled: boolean }>`
  width: 1em;
  height: 1em;
  border-radius: var(--radius-circle);
  border: 2px solid ${({ $colour }) => $colour};
  background: ${({ $colour, $filled }) => ($filled ? $colour : "transparent")};
`;
