import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  CommandButton,
  Disclosure,
  Inline,
  magnitudeOf,
  Row,
  RowName,
  Stack,
  Switch,
  Text,
  TextField,
  Unit,
  UnitInput,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import type { Rp1CentreEntry, Rp1LcPricing } from "../__generated__/contract";
import { quoteNewComplex } from "./lcCost";

/** Build a new launch complex. Must match `Rp1ComplexConstructionCommands.NewComplexCommand`. */
export const RP1_COMPLEX_NEW_COMMAND = "rp1.complex.new";

/**
 * Building a launch complex from nothing.
 *
 * <para><b>Every field is required and none is defaulted, which is deliberate
 * rather than strict.</b> The tonnage, the envelope and the human rating are all
 * PRICED: human rating alone multiplies the pad half by 1.5 and the integration
 * half by 2, so a substituted default would silently halve or double the price of
 * the thing being bought. The tonnage does something worse than cost money, and
 * the form says so: RP-1 records it as `massOrig` and holds every later renovation
 * between half and twice it, for the life of the complex.</para>
 *
 * <para><b>The centre is the one choice RP-1 does not offer.</b> Its own window has
 * no picker and builds wherever the game's camera happens to be. A career under
 * KSCSwitcher has several, and a command dispatched from a remote vantage cannot
 * mean "wherever you are looking", so the wire records which was chosen. With one
 * centre the form picks it and says which.</para>
 *
 * <para><b>The price is quoted live and the press does not spend it.</b> See
 * `lcCost.ts` for why the arithmetic is here, and `PadNewControl` for what a
 * shortfall actually does: RP-1 draws a construction down as it builds and slows
 * rather than refuses, so a balance that does not cover this is a pace problem.</para>
 */
export function NewComplexControl({
  centres,
  existingNames,
  funds,
  handle,
  pricing,
}: Readonly<{
  centres: readonly Rp1CentreEntry[];
  /** Complex names already at the chosen centre, which RP-1 refuses a duplicate of. */
  existingNames: (kscName: string) => readonly string[];
  funds: number | null;
  handle: Parameters<typeof CommandButton>[0]["handle"];
  pricing: Rp1LcPricing | undefined;
}>) {
  const [name, setName] = useState("");
  const [massMax, setMassMax] = useState(value("t", 100));
  const [width, setWidth] = useState(value("m", 10));
  const [height, setHeight] = useState(value("m", 20));
  const [depth, setDepth] = useState(value("m", 10));
  const [humanRated, setHumanRated] = useState(false);
  const [staffOnComplete, setStaffOnComplete] = useState(false);
  const [kscName, setKscName] = useState<string | null>(null);

  const named = centres
    .map((c) => c.kscName)
    .filter((n): n is string => n != null);
  // One centre needs no choosing, but the wire still records which: a command
  // that meant "the only one" would stop meaning anything the day a career has two.
  const chosen = kscName ?? (named.length === 1 ? named[0] : null);

  const trimmed = name.trim();
  const taken = chosen == null ? [] : existingNames(chosen);
  const duplicate = taken.some(
    (existing) => existing.toLowerCase() === trimmed.toLowerCase(),
  );

  const spec = {
    humanRated,
    isHangar: false,
    massMax: magnitudeOf(massMax) ?? 0,
    resources: new Map<string, number>(),
    sizeMaxDepth: magnitudeOf(depth) ?? 0,
    sizeMaxHeight: magnitudeOf(height) ?? 0,
    sizeMaxWidth: magnitudeOf(width) ?? 0,
  };
  const quote = quoteNewComplex(spec, pricing);
  const short = funds !== null && quote !== null && funds < quote.total;
  const massed = spec.massMax > 0;

  const blocked =
    trimmed === "" || duplicate || chosen == null || !massed || quote === null;

  return (
    <Disclosure
      ariaLabel="Build a new launch complex"
      chevron
      label={(open: boolean) => (open ? "hide new complex" : "new complex")}
      panelHeight="auto"
      variant="inline"
    >
      <Stack gap="sm">
        {named.length > 1 && (
          <Inline gap="xs">
            <Text size="xs" tone="muted">
              centre
            </Text>
            {named.map((n) => (
              <Switch
                aria-label={`Build at ${n}`}
                checked={chosen === n}
                key={n}
                label={n}
                onChange={() => setKscName(n)}
              />
            ))}
          </Inline>
        )}
        {named.length === 1 && (
          <Row as="div">
            <RowName>Centre</RowName>
            <Text size="xs">{named[0]}</Text>
          </Row>
        )}

        <TextField
          invalid={
            duplicate
              ? "a complex at this centre already has that name"
              : undefined
          }
          label="Name"
          maxLength={64}
          onChange={setName}
          placeholder="complex name"
          value={name}
        />

        <UnitInput
          label="Tonnage limit"
          onChange={setMassMax}
          unit="t"
          value={massMax}
        />
        {/*
          RP-1 keeps this as massOrig and holds every later renovation to
          max(3, floor(x2)) above and max(1, ceil(x0.5)) below, permanently. It is
          the one field here whose consequence outlives the purchase.
        */}
        <Text size="xs" tone="muted">
          renovations later are held between{" "}
          <Unit
            value={value("t", Math.max(1, Math.ceil(spec.massMax * 0.5)))}
          />{" "}
          and{" "}
          <Unit value={value("t", Math.max(3, Math.floor(spec.massMax * 2)))} />
        </Text>

        <UnitInput label="Width" onChange={setWidth} unit="m" value={width} />
        <UnitInput
          label="Height"
          onChange={setHeight}
          unit="m"
          value={height}
        />
        <UnitInput label="Length" onChange={setDepth} unit="m" value={depth} />

        <Switch
          checked={humanRated}
          label="Human-rated"
          onChange={setHumanRated}
        />
        <Switch
          checked={staffOnComplete}
          label="Assign idle engineers when it is built"
          onChange={setStaffOnComplete}
        />

        <Row as="div">
          <Text size="xs" tone={short ? "warn" : "muted"}>
            {quote === null ? (
              "no price: RP-1 has not said what this would cost"
            ) : (
              <>
                <Unit value={value("funds", quote.total)} />
                {short && " · more than the balance, so it builds slower"}
              </>
            )}
          </Text>
          <CommandButton
            args={{
              assignEngineersOnComplete: staffOnComplete,
              humanRated,
              kscName: chosen ?? "",
              massMax: spec.massMax,
              name: trimmed,
              size: {
                sizeMaxDepth: spec.sizeMaxDepth,
                sizeMaxHeight: spec.sizeMaxHeight,
                sizeMaxWidth: spec.sizeMaxWidth,
              },
            }}
            aria-label={
              trimmed === ""
                ? "Name the complex before building it"
                : chosen == null
                  ? "Choose which space centre builds it"
                  : !massed
                    ? "Give the complex a tonnage limit"
                    : `Build ${trimmed} at ${chosen}`
            }
            commandLabel={`Build ${trimmed} at ${chosen ?? ""}`}
            confirmAriaLabel={`Confirm building ${trimmed}, whose tonnage limit fixes its renovation range for life`}
            confirmLabel="Confirm"
            disabled={blocked}
            handle={handle}
            label="Build"
            size="sm"
          />
        </Row>
      </Stack>
    </Disclosure>
  );
}
