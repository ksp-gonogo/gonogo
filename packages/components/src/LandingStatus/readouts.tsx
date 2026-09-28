/** Readouts through `Unit` at this widget's own precision: on a descent the last kilometre is read to the metre. */
import { type Value as Quantity, value } from "@ksp-gonogo/sitrep-sdk";
import {
  magnitudeOf,
  NULL_DISPLAY,
  ReadoutCaption,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";

/** A quantity or a bare number, parameterised by unit so a length handed to `Mps` is a compile error. */
export type Quantityish<UnitSymbol extends string> =
  | Quantity<UnitSymbol>
  | number
  | null
  | undefined;

/** A speed, read finer the slower it is: a touchdown is decided in cm/s. */
export function Mps({ v }: { v: Quantityish<"m/s"> }) {
  const n = magnitudeOf(v);
  if (n === null) return NULL_DISPLAY;
  const abs = Math.abs(n);
  return (
    <Unit
      value={value("m/s", n)}
      format="m/s"
      decimals={abs < 10 ? 2 : abs < 100 ? 1 : 0}
    />
  );
}

const ONE_KM = value("m", 1000);
const TEN_KM = value("m", 10_000);

/** This widget's precision ladder for a height, shared by the AGL and ASL readouts; the rungs compare as lengths, not bare numbers. */
export function altitudeDecimals(m: Quantity<"m">): number {
  const abs = m.abs();
  return abs.greaterThanOrEqual(TEN_KM)
    ? 1
    : abs.greaterThanOrEqual(ONE_KM)
      ? 2
      : 0;
}

/** An altitude or a distance, on the shared length ladder. */
export function Metres({ m }: { m: Quantityish<"m"> }) {
  const n = magnitudeOf(m);
  if (n === null) return NULL_DISPLAY;
  const height = value("m", n);
  return <Unit value={height} decimals={altitudeDecimals(height)} />;
}

/** A delta-v budget, in whole m/s. */
export function Dv({ v }: { v: Quantityish<"m/s"> }) {
  const n = magnitudeOf(v);
  if (n === null) return NULL_DISPLAY;
  return <Unit value={value("m/s", n)} format="m/s" decimals={0} />;
}

/** A labelled value row inside a two-column readout grid. */
export function GridCellPair({
  label,
  children,
  tone,
}: {
  label: string;
  children: ReactNode;
  tone?: "accent" | "default" | "muted";
}) {
  return (
    <>
      <ReadoutCaption>{label}</ReadoutCaption>
      <Text tone={tone ?? "default"}>{children}</Text>
    </>
  );
}

/** A caption over its value, for the reticle's narrow side column where side by side would wrap. */
export function StackedField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <ReadoutCaption>{label}</ReadoutCaption>
      <Text>{children}</Text>
    </div>
  );
}
