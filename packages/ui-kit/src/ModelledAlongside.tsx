import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import type { ReactNode } from "react";
import styled from "styled-components";
import { HeldHost, HeldMark } from "./HeldMark";
import { MODELLED_TO_SCET, modelledBeyondReceived } from "./readingCurrency";
import { standsApart, writtenAs, writtenQuantity } from "./standsApart";
import { Unit } from "./Unit";
import { VisuallyHidden } from "./VisuallyHidden";

const ModelledAlongside__Figure = styled.span`
  margin-left: 0.6em;
  color: var(--color-text-muted);
`;

/** A modelled quantity beside the quantity observed, drawn through `<Unit>`. */
export interface ModelledQuantityAlongsideProps<UnitSymbol extends string> {
  /** The observation the caller has drawn just before this. */
  observed: Value<UnitSymbol> | null | undefined;
  /** The model's figure; nothing is drawn without one. */
  modelled: Value<UnitSymbol> | null | undefined;
  write?: undefined;
}

/** A modelled figure beside the figure observed, both written by `write`. */
export interface ModelledFigureAlongsideProps<Figure> {
  /** The observation the caller has drawn just before this, written by `write`. */
  observed: Figure | null | undefined;
  /** The model's figure; nothing is drawn without one. */
  modelled: Figure | null | undefined;
  /** How the caller writes the observation, which is how the modelled figure is written and compared. */
  write: (figure: Figure) => string;
}

/**
 * A modelled figure drawn beside the observation it was carried from, never in
 * its place, with the modelled mark. The caller draws the observation first.
 *
 * Drawn only where the figure stands apart from the observation at the
 * precision both are drawn (see `standsApart`), so a model that agrees with
 * what was received to the last place drawn is not repeated. A `Value` pair
 * is drawn through `<Unit>`; anything else goes through `write`.
 */
export function ModelledAlongside<UnitSymbol extends string>(
  props: ModelledQuantityAlongsideProps<UnitSymbol>,
): ReactNode;
export function ModelledAlongside<Figure>(
  props: ModelledFigureAlongsideProps<Figure>,
): ReactNode;
export function ModelledAlongside({
  observed,
  modelled,
  write,
}:
  | ModelledFigureAlongsideProps<unknown>
  | ModelledQuantityAlongsideProps<string>) {
  if (modelled === null || modelled === undefined) return null;
  if (write === undefined) {
    const quantity = modelled as Value<string>;
    if (!standsApart(observed as Value<string>, quantity, writtenQuantity()))
      return null;
    return (
      <ModelledMark>
        <Unit value={quantity} />
      </ModelledMark>
    );
  }
  if (!standsApart(observed, modelled, writtenAs(write))) return null;
  return <ModelledMark>{write(modelled)}</ModelledMark>;
}

function ModelledMark({ children }: { children: ReactNode }) {
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
 * the received edge to a figure that reads apart from it, the model's figure
 * beside it with the modelled mark.
 */
export function ReckonedUnit<UnitSymbol extends string>({
  value,
}: {
  value: Reading<Value<UnitSymbol>>;
}) {
  return (
    <>
      <Unit value={value} />
      <ModelledAlongside
        observed={value.value}
        modelled={modelledBeyondReceived(value)}
      />
    </>
  );
}
