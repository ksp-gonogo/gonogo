import type { ReactNode } from "react";
import styled from "styled-components";
import { Spinner } from "../Spinner";

/**
 * The props of {@link InFlightFace}.
 *
 * @category CommandButton
 */
export interface InFlightFaceProps {
  /** The resting label, kept invisible so the control keeps its resting width. */
  holds: ReactNode;
  /** The in-flight wording, given to the spinner as its name. */
  label: string;
  /** The spinner's size in px. Defaults to 12. */
  spinnerSize?: number;
}

/**
 * What a command control draws while its dispatch is in flight: a spinner
 * alone, centred over its resting label held invisible, so the control does not
 * change width. The wording belongs on the control's accessible name and title.
 *
 * @category CommandButton
 */
export function InFlightFace({
  holds,
  label,
  spinnerSize = 12,
}: Readonly<InFlightFaceProps>) {
  return (
    <InFlightFace__Root>
      <InFlightFace__Hold aria-hidden="true">{holds}</InFlightFace__Hold>
      <InFlightFace__Spinner>
        <Spinner size={spinnerSize} ariaLabel={label} />
      </InFlightFace__Spinner>
    </InFlightFace__Root>
  );
}

/* One grid cell both children share, so the face sizes to the held label with no positioned ancestor. */
const InFlightFace__Root = styled.span`
  display: inline-grid;
  & > * {
    grid-area: 1 / 1;
  }
`;

const InFlightFace__Hold = styled.span`
  visibility: hidden;
`;

const InFlightFace__Spinner = styled.span`
  display: flex;
  align-items: center;
  justify-content: center;
`;
