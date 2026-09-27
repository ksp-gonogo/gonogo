import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import type { ReactNode } from "react";
import styled from "styled-components";
import { HeldHost, HeldMark } from "./HeldMark";
import { MODELLED_TO_SCET } from "./readingCurrency";
import { Unit } from "./Unit";
import { VisuallyHidden } from "./VisuallyHidden";

const ModelledAlongside__Figure = styled.span`
  margin-left: 0.6em;
  color: var(--color-text-muted);
`;

/**
 * A modelled figure drawn beside the observation it was carried from, never in
 * its place, with the modelled mark. The caller draws the observation first.
 */
export function ModelledAlongside({ children }: { children: ReactNode }) {
  return (
    <ModelledAlongside__Figure data-modelled-alongside="">
      <HeldHost data-held="" title={MODELLED_TO_SCET}>
        {children}
        <HeldMark aria-hidden="true" data-held-mark="" />
      </HeldHost>
      <VisuallyHidden data-unit-currency="">
        , {MODELLED_TO_SCET}
      </VisuallyHidden>
    </ModelledAlongside__Figure>
  );
}

/**
 * A reading's observation through `<Unit>`, and where its model reaches past
 * the received edge, the model's figure beside it with the modelled mark.
 */
export function ReckonedUnit<U extends string>({
  value,
}: {
  value: Reading<Value<U>>;
}) {
  const { reckoning } = value;
  const modelled =
    value.state === "observed" &&
    reckoning.status === "available" &&
    reckoning.beyondReceived
      ? reckoning.modelled
      : undefined;
  return (
    <>
      <Unit value={value} />
      {modelled !== undefined && (
        <ModelledAlongside>
          <Unit value={modelled} />
        </ModelledAlongside>
      )}
    </>
  );
}
