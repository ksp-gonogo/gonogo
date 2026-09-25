import {
  defineUplinkClient,
  registerBarePrimitiveTopic,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  magnitudeOf,
  magnitudeOr,
  type Quantityish,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";

/**
 * A planted Uplink for the render probes: contributions a real Uplink would
 * make into built-in widgets, so a render whose subject is a built-in widget
 * WITH an Uplink's contributions can be taken without importing one.
 *
 * Every contribution requires the planted Domain, so a fixture opts in by
 * emitting {@link PLANTED_AVAILABLE_TOPIC} and every other fixture renders the
 * built-in widget alone. The numbers are stand-ins, chosen for what each render
 * needs to show, and describe no mod.
 *
 * Imported after `probe-install-host`: the handle and the Topic registration
 * resolve through the installed host.
 */
export const PLANTED_UPLINK = defineUplinkClient({
  id: "planted",
  version: "0.0.0-dev",
  name: "Planted",
});

export const PLANTED_AVAILABLE_TOPIC = "planted.available";

registerBarePrimitiveTopic(PLANTED_AVAILABLE_TOPIC);

/** The propellants the built-in `ship-map.part-meters` contribution meters. */
const BUILTIN_METERED = new Set([
  "LiquidFuel",
  "Oxidizer",
  "SolidFuel",
  "MonoPropellant",
  "XenonGas",
]);

interface PartsWire {
  parts: {
    id: string | number;
    resources: Record<
      string,
      { amount?: Quantityish; maxAmount?: Quantityish }
    >;
  }[];
}

/**
 * A meter for every stored resource the built-in contribution leaves alone,
 * on the same slot, so a ship map shows two contributors side by side and a
 * spread of resource colours beyond the five propellants.
 */
PLANTED_UPLINK.registerContribution({
  id: "ship-map-part-meters",
  contributes: "ship-map.part-meters",
  deps: ["vessel.parts"],
  requires: "planted",
  compute: (topics) => {
    const wire = topics["vessel.parts"] as PartsWire | undefined;
    if (!wire) return null;
    const entries = [];
    for (const part of wire.parts) {
      for (const [resource, flow] of Object.entries(part.resources)) {
        if (BUILTIN_METERED.has(resource)) continue;
        const capacity = magnitudeOr(flow.maxAmount, 0);
        const amount = magnitudeOf(flow.amount);
        if (capacity <= 0 || amount === null) continue;
        const ratio = amount / capacity;
        entries.push({
          partId: String(part.id),
          resource,
          displayName: resource,
          amount: value("units", amount),
          capacity: value("units", capacity),
          status:
            ratio < 0.05
              ? ("critical" as const)
              : ratio < 0.15
                ? ("low" as const)
                : null,
        });
      }
    }
    return entries.length > 0 ? entries : null;
  },
});

/**
 * Per-kerbal stand-in accumulators, as fractions toward fatal. Jebediah is
 * past the danger line so the row tone and the panel badge both have a kerbal
 * to fire on; the other two sit below it for contrast.
 */
const CREW_RULES: Readonly<Record<string, readonly [string, number][]>> = {
  "Jebediah Kerman": [
    ["Radiation dose", 0.94],
    ["CO2 poisoning", 0.62],
    ["Eating", 0.55],
    ["Drinking", 0.35],
    ["Stress", 0.3],
    ["Breathing", 0.15],
    ["Climatization", 0.1],
  ],
  "Bill Kerman": [["Stress", 0.2]],
  "Bob Kerman": [
    ["Radiation dose", 0.12],
    ["Stress", 0.08],
  ],
};

const CRITICAL = 0.8;

const toneFor = (fraction: number) =>
  fraction >= CRITICAL
    ? ("nogo" as const)
    : fraction >= 0.5
      ? ("warn" as const)
      : ("go" as const);

interface CrewWire {
  crew: { name: string }[];
}

/** The planted rules for the kerbals actually aboard, in roster order. */
function aboard(wire: unknown): [string, readonly [string, number][]][] {
  const crew = (wire as CrewWire | undefined)?.crew ?? [];
  return crew
    .map((k): [string, readonly [string, number][]] => [
      k.name,
      CREW_RULES[k.name] ?? [],
    ])
    .filter(([, rules]) => rules.length > 0);
}

PLANTED_UPLINK.registerContribution({
  id: "crew-status-meters",
  contributes: "crew-status.meters",
  deps: ["vessel.crew"],
  requires: "planted",
  compute: (topics) => {
    const entries = aboard(topics["vessel.crew"]).flatMap(([name, rules]) =>
      rules.map(([label, fraction]) => ({
        id: `${name}:${label}`,
        label,
        value: value("ratio", fraction),
        tone: toneFor(fraction),
        valueLabel: writeQuantity(value("%", fraction * 100), { decimals: 0 }),
        row: name,
      })),
    );
    return entries.length > 0 ? entries : null;
  },
});

PLANTED_UPLINK.registerContribution({
  id: "crew-status-row-tone",
  contributes: "crew-status.row-tone",
  deps: ["vessel.crew"],
  requires: "planted",
  compute: (topics) => {
    const entries = aboard(topics["vessel.crew"])
      .filter(([, rules]) => rules.some(([, f]) => f >= CRITICAL))
      .map(([crewName]) => ({ crewName, severity: "critical" as const }));
    return entries.length > 0 ? entries : null;
  },
});

PLANTED_UPLINK.registerContribution({
  id: "crew-status-badge",
  contributes: "crew-status.badges",
  deps: ["vessel.crew"],
  requires: "planted",
  compute: (topics) => {
    const critical = aboard(topics["vessel.crew"]).filter(([, rules]) =>
      rules.some(([, f]) => f >= CRITICAL),
    ).length;
    if (critical === 0) return null;
    const label =
      critical === 1 ? "Crew critical" : `${critical} crew critical`;
    return [{ id: "planted-crew-critical", label, tone: "nogo" as const }];
  },
});
