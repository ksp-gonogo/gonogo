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
  /** The locale was withheld because `vessel.surface` stopped being current, not because it never carried a biome. */
  localeHeld: boolean;
  breakdown: ExperimentBreakdownEntry[] | null;
  experiments: ParsedExperiment[] | null;
  sciCount: number | undefined;
  sciDataAmount: number | undefined;
  compact: boolean;
}

const BREAKDOWN_COLUMNS: ReadonlyArray<
  DataTableColumn<ExperimentBreakdownEntry>
> = [
  {
    key: "subject",
    header: "Subject",
    width: "1fr",
    // KSP subject titles are whole sentences, so without a floor this column wraps a word per line.
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

/** The fallback list, used when the breakdown channel has nothing but raw stored results do. */
const EXPERIMENT_COLUMNS: ReadonlyArray<DataTableColumn<ParsedExperiment>> = [
  {
    key: "subject",
    header: "Subject",
    width: "1fr",
    // KSP subject titles are whole sentences, so without a floor this column wraps a word per line.
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

function localeSuffixOf(locale: string, held: boolean): string {
  if (locale) return ` · ${locale}`;
  // A withheld locale names itself so it does not read like a vessel that never reported a biome.
  if (held) return " · locale held";
  return "";
}

/** The breakdown when the vessel reports one, else the raw stored results, else the empty state. */
function AboardLedger({
  breakdown,
  experiments,
  slotFilled,
}: Readonly<{
  breakdown: ExperimentBreakdownEntry[] | null;
  experiments: ParsedExperiment[] | null;
  slotFilled: boolean;
}>) {
  if (breakdown !== null) {
    return (
      <DataTable
        caption="Science aboard the active vessel, by subject"
        empty="No subject matches the filter."
        columns={BREAKDOWN_COLUMNS}
        rows={breakdown}
        rowKey={(b) => b.subjectId}
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
    );
  }
  if (experiments !== null) {
    return (
      <DataTable
        caption="Science results stored aboard the active vessel"
        empty="No result matches the filter."
        columns={EXPERIMENT_COLUMNS}
        rows={experiments}
        rowKey={(e) => e.subjectId}
      />
    );
  }
  return <EmptyState>No science data aboard</EmptyState>;
}

/** The active vessel's onboard ledger, with the situation line it was taken in. */
export function AboardTab({
  body,
  situation,
  situationLocale,
  localeHeld,
  breakdown,
  experiments,
  sciCount,
  sciDataAmount,
  compact,
}: Readonly<AboardTabProps>) {
  // An unbound slot gets no detail row at all, rather than an empty one under every row.
  const slotFilled = getAugmentsForSlot("science-data.aboard-row").length > 0;
  const filter = useRowFilter({ placeholder: "Filter subjects..." });
  const shownBreakdown = (breakdown ?? []).filter((b) =>
    filter.matches(`${b.expTitle} ${b.biome} ${b.situation}`),
  );
  const shownExperiments = (experiments ?? []).filter((e) =>
    filter.matches(e.title),
  );
  const localeSuffix = localeSuffixOf(situationLocale, localeHeld);
  const hasBreakdown = breakdown !== null && breakdown.length > 0;
  const hasExperiments = experiments !== null && experiments.length > 0;

  return (
    <Stack fill>
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
        <AboardLedger
          breakdown={hasBreakdown ? shownBreakdown : null}
          experiments={hasExperiments ? shownExperiments : null}
          slotFilled={slotFilled}
        />
      </ScrollArea>
      {(hasBreakdown || hasExperiments) && filter.control}
    </Stack>
  );
}
