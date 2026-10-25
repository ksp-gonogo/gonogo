import type { Reading, Tone, Value } from "@ksp-gonogo/sitrep-sdk";
import {
  AugmentSlot,
  CatalogContact,
  combineReadings,
  observedValue,
  stillTrue,
  useStream,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Box,
  Cluster,
  Meter,
  MissionDate,
  Stack,
  Text,
  Tooltip,
  Unit,
} from "@ksp-gonogo/ui-kit";
import {
  type DeployedStation,
  parseStation,
  type StationListing,
} from "./parseStation";
import { POWER_LABEL, POWER_TONE, powerBalance, powerState } from "./power";

const XS2_STYLE = { fontSize: "var(--font-size-caption)" } as const;

const FIGURE_AND_BADGE = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--gap-related)",
} as const;

/** A completion fraction as a percentage, exactly as current as the station's report is. */
function progressPercentReading(
  source: Reading<unknown>,
  fraction: number,
): Reading<Value<"%">> {
  return combineReadings([source], () => value("%", fraction * 100));
}

/** The same completion as the 0..1 fraction a meter's bar is drawn from. */
function progressRatioReading(
  source: Reading<unknown>,
  fraction: number,
): Reading<Value<"ratio">> {
  return combineReadings([source], () => value("ratio", fraction));
}

/** Data held unsent, as current as the station's report is. */
function backlogReading(
  source: Reading<unknown>,
  mits: number,
): Reading<Value<"Mit">> {
  return combineReadings([source], () => value("Mit", mits));
}

const titleCase = (name: string) =>
  name.charAt(0) + name.slice(1).toLowerCase().replace(/_/g, " ");

/** Biome and situation of the station, plus a note when it is known not to sit on the ground. */
function siteLine(station: DeployedStation): string | null {
  const parts = [
    station.biome,
    station.situation === null ? null : titleCase(station.situation),
  ].filter((p): p is string => p !== null && p !== "");
  return parts.length === 0 ? null : parts.join(" · ");
}

interface LinkLabel {
  label: string;
  tone: Tone;
}

/** What the command centre knows of its contact with the station, in the words an operator reads it by. */
function linkLabel(contact: CatalogContact | null): LinkLabel {
  switch (contact) {
    case CatalogContact.InContact:
      return { label: "In contact", tone: "go" };
    case CatalogContact.Silent:
      return { label: "Out of contact", tone: "caution" };
    case CatalogContact.Overdue:
      return { label: "Overdue", tone: "nogo" };
    case CatalogContact.Lost:
      return { label: "Lost", tone: "nogo" };
    case CatalogContact.Gone:
      return { label: "Gone", tone: "nogo" };
    default:
      // Neutral, not `nogo`: nothing has been heard either way.
      return { label: "Contact unknown", tone: "neutral" };
  }
}

/** The unsent data of the experiments that are still sending, or null unless every such store was read. */
function totalBacklog(station: DeployedStation): number | null {
  const sending = station.experiments.filter((e) => e.stranded !== true);
  if (sending.length === 0) return null;
  let total = 0;
  for (const experiment of sending) {
    if (experiment.backlog === null) return null;
    total += experiment.backlog;
  }
  return total;
}

/** The data finished experiments hold that will not be sent, or null when there is none. */
function totalStranded(station: DeployedStation): number | null {
  let total = 0;
  for (const experiment of station.experiments) {
    if (experiment.stranded === true) total += experiment.backlog ?? 0;
  }
  return total > 0 ? total : null;
}

/**
 * One station's card: whether its science is reaching home and when it was last
 * heard, then its power and a meter per experiment. The station's report is
 * timed on the station's own link, so a station out of contact holds its last
 * figures marked as held while the others stay current.
 */
export function DeployedStationCard({ listing }: { listing: StationListing }) {
  // The station's report is a fact kept while held; the reading stays named so each figure can carry its currency.
  const reading = useStream<unknown>(
    `deployed.station.${listing.vesselId}.report`,
  );
  const station = parseStation(listing.vesselId, stillTrue(reading, undefined));
  // Whether the station can send is a verdict that means something only while its report is current.
  const current = parseStation(listing.vesselId, observedValue(reading));
  const link = linkLabel(listing.contact);
  const heading = station?.name || listing.name || "Surface station";
  const backlog = station === null ? null : totalBacklog(station);
  const stranded = station === null ? null : totalStranded(station);

  return (
    <Box
      role="group"
      aria-label={heading}
      bordered
      radius="regular"
      style={{
        padding: "var(--inset-surface)",
        borderColor: "var(--color-surface-raised)",
      }}
    >
      <Stack>
        <Cluster justify="start" wrap>
          <Text size="sm" style={{ fontWeight: 600 }}>
            {heading}
          </Text>
          {station?.body && (
            <Text level="muted" size="sm">
              {station.body}
            </Text>
          )}
          <Badge tone={link.tone} data-tone={link.tone} live>
            {link.label}
          </Badge>
        </Cluster>
        <Text level="muted" style={XS2_STYLE}>
          {listing.contact === CatalogContact.InContact ? (
            // The catalog dates an entry in contact from when its listing last changed, which is not a running time.
            "Heard now"
          ) : listing.lastContactUt === null ? (
            "No contact on record"
          ) : (
            <>
              Last heard <MissionDate value={listing.lastContactUt} />
            </>
          )}
        </Text>

        {station === null ? (
          <Text level="muted" style={XS2_STYLE}>
            Waiting for the station's report
          </Text>
        ) : (
          <>
            <Cluster justify="start" wrap>
              {current?.sendPathHome != null && (
                <Badge tone={current.sendPathHome ? "go" : "nogo"} size="sm">
                  {current.sendPathHome ? "Sending home" : "No path home"}
                </Badge>
              )}
              {current?.dataSendFailed === true && (
                <Badge tone="nogo" size="sm">
                  Last send failed
                </Badge>
              )}
              <Badge
                tone={POWER_TONE[powerState(station)]}
                data-tone={POWER_TONE[powerState(station)]}
                held={reading}
                live
                size="sm"
              >
                {POWER_LABEL[powerState(station)]}
              </Badge>
            </Cluster>
            {siteLine(station) && (
              <Text level="muted" style={XS2_STYLE}>
                {siteLine(station)}
              </Text>
            )}
            <Text level="muted" style={XS2_STYLE}>
              {/* Breaking Ground power units, not electric charge. */}
              {powerBalance(station) ?? "Power unknown"}
              {station.experiments.length > 0 && (
                <Text level="faint" style={XS2_STYLE}>
                  {" "}
                  · {station.experiments.length} exp
                </Text>
              )}
              {backlog !== null && (
                <>
                  {" "}
                  · Unsent{" "}
                  <Unit value={backlogReading(reading, backlog)} decimals={1} />
                </>
              )}
              {stranded !== null && (
                <>
                  {" "}
                  · Stranded{" "}
                  <Unit
                    value={backlogReading(reading, stranded)}
                    decimals={1}
                  />
                </>
              )}
            </Text>

            {station.experiments.map((exp) => (
              <Stack key={`${station.id}-${exp.partId}`}>
                {/* No completion draws the absent form, not an empty track. */}
                <Meter
                  label={exp.name}
                  tone="go"
                  value={
                    exp.progress === null
                      ? null
                      : progressRatioReading(reading, exp.progress)
                  }
                  valueLabelNode={
                    exp.progress === null ? undefined : (
                      <span style={FIGURE_AND_BADGE}>
                        <Unit
                          value={progressPercentReading(reading, exp.progress)}
                          decimals={0}
                        />
                        {exp.stranded === true && (
                          <Tooltip text="This experiment has finished and will not send what it still holds, a kerbal has to retrieve it">
                            <Badge tone="caution" size="sm">
                              Stranded
                            </Badge>
                          </Tooltip>
                        )}
                        {exp.collecting === true && (
                          <Tooltip text="This experiment is collecting science now">
                            <Badge tone="go" size="sm">
                              Collecting
                            </Badge>
                          </Tooltip>
                        )}
                      </span>
                    )
                  }
                />
                <AugmentSlot
                  name="deployed-science.experiment"
                  props={{
                    experiment: exp,
                    body: station.body ?? "",
                    held: reading,
                  }}
                />
              </Stack>
            ))}
          </>
        )}
      </Stack>
    </Box>
  );
}
