import { AugmentSlot } from "@ksp-gonogo/core";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  DataTable,
  type DataTableColumn,
  EmptyState,
  NULL_DISPLAY,
  ScrollArea,
  Stack,
  Unit,
  Value,
} from "@ksp-gonogo/ui-kit";
import type { ExperimentBreakdownEntry, ParsedExperiment } from "./parsers";

export interface AboardTabProps {
  body: string | undefined;
  situation: string | undefined;
  situationLocale: string;
  breakdown: ExperimentBreakdownEntry[] | null;
  experiments: ParsedExperiment[] | null;
  sciCount: number | undefined;
  sciDataAmount: number | undefined;
  compact: boolean;
}

/**
 * Columns for the full breakdown: subject, where it was taken, what is
 * aboard, and what is still out there. Both figures right-align so a scan
 * down the column answers "which of these is worth transmitting first"
 * without reading a single label.
 */
const BREAKDOWN_COLUMNS: ReadonlyArray<
  DataTableColumn<ExperimentBreakdownEntry>
> = [
  {
    key: "subject",
    header: "Subject",
    width: "1fr",
    // KSP's own subject title is a whole sentence ("Crew Report while flying
    // low over Kerbin's grasslands"), so without a floor this column shrinks
    // to one word per line in a narrow panel.
    minWidth: "22ch",
    render: (b) => b.expTitle,
  },
  {
    key: "biome",
    header: "Biome",
    render: (b) => b.biome || <Value tone="muted">{NULL_DISPLAY}</Value>,
  },
  {
    key: "data",
    header: "Data",
    align: "end",
    width: "9ch",
    render: (b) => <Unit value={value("Mit", b.dataMits)} />,
  },
  {
    key: "remaining",
    header: "Remaining",
    align: "end",
    width: "10ch",
    render: (b) =>
      b.remainingPotential > 0 ? (
        <Unit value={value("science", b.remainingPotential)} />
      ) : (
        <Value tone="muted">complete</Value>
      ),
  },
];

/**
 * The fallback list, used when the breakdown channel has nothing but raw
 * stored results do. Same first and third columns as the breakdown so the
 * two shapes read as one table with less detail, not as a different widget.
 */
const EXPERIMENT_COLUMNS: ReadonlyArray<DataTableColumn<ParsedExperiment>> = [
  {
    key: "subject",
    header: "Subject",
    width: "1fr",
    // KSP's own subject title is a whole sentence ("Crew Report while flying
    // low over Kerbin's grasslands"), so without a floor this column shrinks
    // to one word per line in a narrow panel.
    minWidth: "22ch",
    render: (e) => e.title,
  },
  {
    key: "data",
    header: "Data",
    align: "end",
    width: "9ch",
    render: (e) =>
      e.dataAmount === null ? (
        <Value tone="muted">{NULL_DISPLAY}</Value>
      ) : (
        <Unit value={value("Mit", e.dataAmount)} />
      ),
  },
];

/**
 * The active vessel's onboard ledger. The situation line lives here rather
 * than above the tab strip: it describes what THIS tab is showing, and a
 * career-wide Archive beside it is not "at" a situation at all.
 */
export function AboardTab({
  body,
  situation,
  situationLocale,
  breakdown,
  experiments,
  sciCount,
  sciDataAmount,
  compact,
}: Readonly<AboardTabProps>) {
  const hasBreakdown = breakdown !== null && breakdown.length > 0;
  const hasExperiments = experiments !== null && experiments.length > 0;

  return (
    <Stack gap="sm" fill>
      <Value
        tone="muted"
        size="sm"
        role="status"
        aria-live="polite"
        aria-label="Current situation for science"
      >
        {body && situation
          ? `${body} · ${situation}${situationLocale ? ` · ${situationLocale}` : ""}`
          : "Awaiting situation telemetry"}
      </Value>
      {!compact && typeof sciCount === "number" && (
        <Value size="xs" tone="muted">
          {sciCount} record{sciCount === 1 ? "" : "s"}
          {typeof sciDataAmount === "number" && (
            <>
              {" · "}
              <Unit value={value("Mit", sciDataAmount)} /> collected
            </>
          )}
        </Value>
      )}
      <ScrollArea>
        {hasBreakdown ? (
          <DataTable
            caption="Science aboard the active vessel, by subject"
            columns={BREAKDOWN_COLUMNS}
            rows={breakdown}
            rowKey={(b) => b.subjectId}
            // The File Manager's controls land here, full width beneath their
            // own row, so a bound augment cannot disturb the columns above it.
            rowDetail={(b) => (
              <AugmentSlot
                name="science-data.aboard-row"
                props={{ subjectId: b.subjectId }}
              />
            )}
          />
        ) : hasExperiments ? (
          <DataTable
            caption="Science results stored aboard the active vessel"
            columns={EXPERIMENT_COLUMNS}
            rows={experiments}
            rowKey={(e) => e.subjectId}
          />
        ) : (
          <EmptyState>No science data aboard.</EmptyState>
        )}
      </ScrollArea>
    </Stack>
  );
}
