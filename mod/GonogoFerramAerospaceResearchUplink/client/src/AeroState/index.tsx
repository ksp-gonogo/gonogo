import type { ComponentProps, Value } from "@ksp-gonogo/sitrep-sdk";
import { registerComponent, useTelemetry, value } from "@ksp-gonogo/sitrep-sdk";
import {
  BigReadout,
  Cluster,
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  type ReadoutTone,
  Row,
  RowName,
  Stack,
  StatusPill,
  Unit,
} from "@ksp-gonogo/ui-kit";
// Side-effect import: registers aero.state's unit map into the SDK's runtime
// hydration registry and augments TopicPayloadMap for the type. This widget is
// the consumer of that decode-time wrap, so it pulls the registration itself
// rather than relying on the package entry point's import order.
import "../topics";
import { judgeable } from "../judgeable";
import { AERO } from "../uplink";

type AeroConfig = Record<string, never>;

/**
 * A quantity readout, the way an Uplink is meant to write one: the value carries
 * its own unit off the Topic, so this names neither the unit nor the format, and
 * absence renders as absence rather than as a zero.
 */
function Q({
  value,
  decimals,
}: {
  value?: { magnitude: number } | null;
  decimals?: number;
}) {
  // The cast is the narrowest thing that types here: every field on AeroState is
  // a differently-parameterised `Value<...>`, and a component taking all of them
  // has to be generic over the token, which `<Unit>`'s prop already is.
  return value == null ? (
    NULL_DISPLAY
  ) : (
    // biome-ignore lint/suspicious/noExplicitAny: one readout over fifteen unit tokens
    <Unit value={value as any} decimals={decimals} />
  );
}

/**
 * Where a stall fraction sits, as a word rather than only as a colour.
 *
 * The bands are the shape of the quantity rather than a borrowed threshold: the
 * fraction is wing area weighted, so a small non-zero reading is a control
 * surface at its limit and is worth noticing, while anything approaching a half
 * is most of the wing gone and the aircraft is departing.
 *
 * Compared through the algebra rather than against a bare number, so the
 * thresholds are stated in the same unit the reading arrives in.
 */
const DEPARTING = value("ratio", 0.5);
const NOTICEABLE = value("ratio", 0.02);

function stallBand(fraction: Value<"ratio">): {
  label: string;
  tone: ReadoutTone;
} {
  if (fraction.greaterThanOrEqual(DEPARTING)) {
    return { label: "STALLED", tone: "alert" };
  }
  if (fraction.greaterThan(NOTICEABLE)) {
    return { label: "PARTIAL STALL", tone: "warning" };
  }
  return { label: "ATTACHED", tone: "go" };
}

/**
 * The active vessel's aerodynamic state: what attitude it is holding to the
 * airflow and what that attitude is costing it.
 *
 * <p>Reads the single `aero.state` Topic. Every field on it is independently
 * nullable and every absence is deliberate, so this widget draws absence rather
 * than substituting a zero: a rocket has no stall fraction, a vessel in vacuum
 * has no lift coefficient, and neither of those is the same as a reading of
 * nought. The stall state carries a word as well as a colour, and the "MODEL
 * STALE" pill is a qualifier on everything below it: after a separation the
 * numbers still describe the vehicle's previous shape until the aerodynamics
 * model catches up.</p>
 */
export function AeroStateComponent(_props: ComponentProps<AeroConfig>) {
  const s = judgeable(useTelemetry("aero.state"));
  const stall = s?.stallFraction;
  const band = stall == null ? null : stallBand(stall);
  const modelValid = s?.aeroModelValid ?? false;

  return (
    <Panel panelTitle="Aerodynamics" compactTitle={["AERO"]}>
      <Stack role="status" aria-live="polite">
        <Cluster>
          <StatusPill $tone={band?.tone ?? "default"}>
            {band?.label ?? "NO AERO DATA"}
          </StatusPill>
          {!modelValid && <StatusPill $tone="warning">MODEL STALE</StatusPill>}
        </Cluster>
        <Cluster>
          <div>
            <BigReadout>
              <Q value={s?.angleOfAttack} decimals={1} />
            </BigReadout>
            <ReadoutCaption>Angle of attack</ReadoutCaption>
          </div>
          <div>
            <BigReadout $tone={band?.tone}>
              <Q value={stall} decimals={0} />
            </BigReadout>
            <ReadoutCaption>Stalled</ReadoutCaption>
          </div>
          <div>
            <BigReadout>
              <Q value={s?.liftToDragRatio} decimals={2} />
            </BigReadout>
            <ReadoutCaption>Lift / drag</ReadoutCaption>
          </div>
        </Cluster>
      </Stack>
      <ul>
        <Row>
          <RowName>Sideslip</RowName>
          <Q value={s?.sideslip} decimals={1} />
        </Row>
        <Row>
          <RowName>Indicated airspeed</RowName>
          <Q value={s?.indicatedAirspeed} decimals={0} />
        </Row>
        <Row>
          <RowName>Equivalent airspeed</RowName>
          <Q value={s?.equivalentAirspeed} decimals={0} />
        </Row>
        <Row>
          <RowName>Lift coefficient</RowName>
          <Q value={s?.liftCoefficient} decimals={3} />
        </Row>
        <Row>
          <RowName>Drag coefficient</RowName>
          <Q value={s?.dragCoefficient} decimals={3} />
        </Row>
        <Row>
          <RowName>Reference area</RowName>
          <Q value={s?.referenceArea} decimals={2} />
        </Row>
        <Row>
          <RowName>Lift</RowName>
          <Q value={s?.liftForce} decimals={1} />
        </Row>
        <Row>
          <RowName>Drag</RowName>
          <Q value={s?.dragForce} decimals={1} />
        </Row>
        <Row>
          <RowName>Terminal velocity</RowName>
          <Q value={s?.terminalVelocity} decimals={0} />
        </Row>
        <Row>
          <RowName>Ballistic coefficient</RowName>
          <Q value={s?.ballisticCoefficient} decimals={0} />
        </Row>
        <Row>
          <RowName>Specific excess power</RowName>
          <Q value={s?.specificExcessPower} decimals={1} />
        </Row>
      </ul>
    </Panel>
  );
}

registerComponent<AeroConfig>({
  id: "aero-state",
  name: "Aerodynamics",
  description:
    "Angle of attack, sideslip, stall, lift and drag: the aerodynamic state a full-fidelity aerodynamics model computes.",
  tags: ["flight", "ro"],
  defaultSize: { w: 4, h: 7 },
  minSize: { w: 3, h: 5 },
  component: AeroStateComponent,
  channels: ["aero.state"],
  defaultConfig: {},
  actions: [],
  requires: ["flight"],
  owner: AERO,
});
