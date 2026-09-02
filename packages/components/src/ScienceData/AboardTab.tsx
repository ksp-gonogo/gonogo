import { AugmentSlot, getAugmentsForSlot } from "@ksp-gonogo/core";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  DataTable,
  type DataTableColumn,
  EmptyState,
  NULL_DISPLAY,
  ScrollArea,
  Stack,
  Text,
  Unit,
  useRowFilter,
} from "@ksp-gonogo/ui-kit";
import type { ExperimentBreakdownEntry, ParsedExperiment } from "./parsers";

export interface AboardTabProps {
  body: string | undefined;
  situation: string | undefined;
  situationLocale: string;
  /** Whether the locale was withheld because `vessel.surface` stopped being
   *  current, as opposed to never having carried a biome at all. */
  localeNotCurrent: boolean;
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
    render: (b) => b.biome || <Text tone="muted">{NULL_DISPLAY}</Text>,
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
        <Text tone="muted">complete</Text>
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
        <Text tone="muted">{NULL_DISPLAY}</Text>
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
  localeNotCurrent,
  breakdown,
  experiments,
  sciCount,
  sciDataAmount,
  compact,
}: Readonly<AboardTabProps>) {
  // Nothing registered on the slot means every row would carry an empty
  // detail row: dead vertical space and a rule under each one. A stock save
  // gets the plain table instead.
  const slotFilled = getAugmentsForSlot("science-data.aboard-row").length > 0;
  // Searchable text is the subject plus where it was taken, which is what an
  // operator types when hunting a row: "goo", "grasslands", "flying".
  const filter = useRowFilter({ placeholder: "Filter subjects..." });
  const shownBreakdown = (breakdown ?? []).filter((b) =>
    filter.matches(`${b.expTitle} ${b.biome} ${b.situation}`),
  );
  const shownExperiments = (experiments ?? []).filter((e) =>
    filter.matches(e.title),
  );
  /**
   * A vessel that never reported a biome and a vessel whose biome we can no
   * longer vouch for both leave the locale off the line, and the two say
   * opposite things about the science below it, so the withheld case names
   * itself here instead of quietly shortening the line.
   */
  const localeSuffix = situationLocale
    ? ` · ${situationLocale}`
    : localeNotCurrent
      ? " · locale no longer current"
      : "";
  const hasBreakdown = breakdown !== null && breakdown.length > 0;
  const hasExperiments = experiments !== null && experiments.length > 0;

  return (
    <Stack gap="sm" fill>
      <Text
        tone="muted"
        size="sm"
        role="status"
        aria-live="polite"
        aria-label="Current situation for science"
      >
        {body && situation
          ? `${body} · ${situation}${localeSuffix}`
          : "Awaiting situation telemetry"}
      </Text>
      {!compact && typeof sciCount === "number" && (
        <Text size="xs" tone="muted">
          {sciCount} record{sciCount === 1 ? "" : "s"}
          {typeof sciDataAmount === "number" && (
            <>
              {" · "}
              <Unit value={value("Mit", sciDataAmount)} /> collected
            </>
          )}
        </Text>
      )}
      <ScrollArea>
        {hasBreakdown ? (
          <DataTable
            caption="Science aboard the active vessel, by subject"
            empty="No subject matches the filter."
            columns={BREAKDOWN_COLUMNS}
            rows={shownBreakdown}
            rowKey={(b) => b.subjectId}
            // The File Manager's controls land here, full width beneath their
            // own row, so a bound augment cannot disturb the columns above it.
            rowDetail={
              slotFilled
                ? (b) => (
                    <AugmentSlot
                      name="science-data.aboard-row"
                      props={{ subjectId: b.subjectId }}
                    />
                  )
                : undefined
            }
          />
        ) : hasExperiments ? (
          <DataTable
            caption="Science results stored aboard the active vessel"
            empty="No result matches the filter."
            columns={EXPERIMENT_COLUMNS}
            rows={shownExperiments}
            rowKey={(e) => e.subjectId}
          />
        ) : (
          <EmptyState>No science data aboard.</EmptyState>
        )}
      </ScrollArea>
      {(hasBreakdown || hasExperiments) && filter.control}
    </Stack>
  );
}
