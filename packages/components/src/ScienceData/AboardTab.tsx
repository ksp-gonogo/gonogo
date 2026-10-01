import { AugmentSlot } from "@ksp-gonogo/core";
import { type CarriedCurrency, datedFrom, value } from "@ksp-gonogo/sitrep-sdk";
import {
  DataTable,
  type DataTableColumn,
  EmptyState,
  FilterRegion,
  NULL_DISPLAY,
  ScrollArea,
  Stack,
  Text,
  Unit,
  useRowFilter,
  useSlotBound,
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
  /** What the ledgers were last reported by, so a held ledger draws held figures. */
  ledgerFrom: readonly CarriedCurrency[];
}

/** A ledger figure dated by the readings the ledger was read from. */
function dated<UnitSymbol extends string>(
  from: readonly CarriedCurrency[],
  unit: UnitSymbol,
  amount: number,
) {
  return datedFrom(from, value(unit, amount));
}

const breakdownColumns = (
  from: readonly CarriedCurrency[],
): ReadonlyArray<DataTableColumn<ExperimentBreakdownEntry>> => [
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
    render: (b) => b.biome || <Text level="muted">{NULL_DISPLAY}</Text>,
  },
  {
    key: "data",
    header: "Data",
    align: "end",
    width: "9ch",
    render: (b) => <Unit value={dated(from, "Mit", b.dataMits)} />,
  },
  {
    key: "remaining",
    header: "Remaining",
    align: "end",
    width: "10ch",
    render: (b) =>
      b.remainingPotential > 0 ? (
        <Unit value={dated(from, "science", b.remainingPotential)} />
      ) : (
        <Text level="muted">complete</Text>
      ),
  },
];

/** The fallback list, used when the breakdown channel has nothing but raw stored results do. */
const experimentColumns = (
  from: readonly CarriedCurrency[],
): ReadonlyArray<DataTableColumn<ParsedExperiment>> => [
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
        <Text level="muted">{NULL_DISPLAY}</Text>
      ) : (
        <Unit value={dated(from, "Mit", e.dataAmount)} />
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
  from,
}: Readonly<{
  breakdown: ExperimentBreakdownEntry[] | null;
  experiments: ParsedExperiment[] | null;
  slotFilled: boolean;
  from: readonly CarriedCurrency[];
}>) {
  if (breakdown !== null) {
    return (
      <DataTable
        caption="Science aboard the active vessel, by subject"
        empty="No subject matches the filter."
        columns={breakdownColumns(from)}
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
        columns={experimentColumns(from)}
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
  ledgerFrom,
}: Readonly<AboardTabProps>) {
  // An unbound slot gets no detail row at all, rather than an empty one under every row.
  const slotFilled = useSlotBound("science-data.aboard-row");
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

  const ledger = (
    <ScrollArea>
      <AboardLedger
        breakdown={hasBreakdown ? shownBreakdown : null}
        experiments={hasExperiments ? shownExperiments : null}
        slotFilled={slotFilled}
        from={ledgerFrom}
      />
    </ScrollArea>
  );

  return (
    <Stack fill>
      <Text
        level="muted"
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
        <Text size="xs" level="muted">
          {sciCount} record{sciCount === 1 ? "" : "s"}
          {typeof sciDataAmount === "number" && (
            <>
              {" · "}
              <Unit value={dated(ledgerFrom, "Mit", sciDataAmount)} /> collected
            </>
          )}
        </Text>
      )}
      {hasBreakdown || hasExperiments ? (
        <FilterRegion filter={filter} fill>
          {ledger}
        </FilterRegion>
      ) : (
        ledger
      )}
    </Stack>
  );
}
