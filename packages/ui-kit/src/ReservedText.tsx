import styled from "styled-components";

const ReservedText__Stack = styled.span`
  display: inline-grid;
  justify-items: center;
`;

const ReservedText__Shown = styled.span`
  grid-area: 1 / 1;
`;

/* Pseudo-element text, so the reserved words hold their width without being read aloud or found as text. */
const ReservedText__Reserve = styled.span`
  grid-area: 1 / 1;
  visibility: hidden;

  &::before {
    content: attr(data-word);
  }
`;

/**
 * Props for {@link ReservedText}.
 *
 * @category Typography
 */
export interface ReservedTextProps {
  /** The text drawn. */
  shown: string;
  /** Every text the place can show, `shown` among them or not; the box is as wide as the widest. */
  reserve: readonly string[];
}

/**
 * A short piece of text drawn in a box as wide as the widest of the texts its
 * place can show, so the place keeps its size as the text changes. Useful for
 * a control whose word changes as the operator uses it, such as a toggle that
 * reads `SENT` while its command is on the way, so nothing beside it moves.
 * Used by the Action Group widget's toggle.
 *
 * Only `shown` is text a screen reader or a text query finds: the reserved
 * texts take up room and nothing else.
 *
 * @example
 * ```tsx
 * import { ReservedText, ToggleButton } from "@ksp-gonogo/ui-kit";
 *
 * function LightToggle(props: { on: boolean; sent: boolean; press: () => void }) {
 *   const word = props.sent ? "SENT" : props.on ? "ON" : "OFF";
 *   return (
 *     <ToggleButton pressed={props.on} onClick={props.press} aria-label="Toggle lights">
 *       <ReservedText shown={word} reserve={["ON", "OFF", "SENT"]} />
 *     </ToggleButton>
 *   );
 * }
 * ```
 *
 * @category Typography
 */
export function ReservedText({ shown, reserve }: Readonly<ReservedTextProps>) {
  return (
    <ReservedText__Stack>
      {[...new Set(reserve)].map((word) => (
        <ReservedText__Reserve key={word} data-word={word} aria-hidden="true" />
      ))}
      <ReservedText__Shown>{shown}</ReservedText__Shown>
    </ReservedText__Stack>
  );
}
