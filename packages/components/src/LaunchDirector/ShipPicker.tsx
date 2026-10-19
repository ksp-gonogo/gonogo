import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  NULL_DISPLAY,
  SearchBox,
  SelectableRow,
  Tooltip,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { type ReactNode, useState } from "react";
import { type SavedShip, shipBlocked, shipBlockedReason } from "./ships";
import {
  BlockedTag,
  CostTag,
  EmptyNote,
  PadColumn,
  SectionLabel,
  ShipCost,
  ShipDetails,
  ShipList,
  ShipMeta,
  ShipName,
  ShipSelection,
} from "./styles";

/**
 * The open pad's craft, each greyed out while its funds or parts block it, and
 * a search box that narrows the list by name. The picked craft's `detail`
 * (its crew and launch control) opens directly beneath its own row.
 */
export function ShipPicker({
  padCraft,
  selectedShip,
  onSelectShip,
  fundsAvailable,
  detail,
}: {
  padCraft: readonly SavedShip[];
  selectedShip: string | null;
  onSelectShip: (name: string | null) => void;
  fundsAvailable: number;
  /** Shown under the selected craft's row while it is in the list. */
  detail?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? padCraft.filter((s) => s.name.toLowerCase().includes(needle))
    : padCraft;
  const ready = padCraft.filter((s) => !shipBlocked(s, fundsAvailable)).length;
  return (
    <PadColumn>
      <SectionLabel>
        Craft · {ready}/{padCraft.length} ready
      </SectionLabel>
      <SearchBox
        placeholder="Search craft"
        aria-label="Search craft"
        value={query}
        onChange={setQuery}
      />
      <ShipList>
        {shown.length === 0 && <EmptyNote>No craft match "{query}"</EmptyNote>}
        {shown.map((s) => {
          const reason = shipBlockedReason(s, fundsAvailable);
          const blocked = reason !== null;
          const picked = selectedShip === s.file;
          return (
            <ShipSelection key={`${s.facility}/${s.file}`}>
              <Tooltip text={reason ?? undefined}>
                <SelectableRow
                  layout="split"
                  gap="related"
                  selectedLook="outline"
                  data-ship-row
                  selected={selectedShip === s.file}
                  aria-disabled={blocked}
                  onClick={() => {
                    if (blocked) return;
                    onSelectShip(selectedShip === s.file ? null : s.file);
                  }}
                >
                  <ShipMeta>
                    <ShipName>{s.name}</ShipName>
                    <ShipDetails>
                      {s.partCount === null ? NULL_DISPLAY : s.partCount} parts
                      ·{" "}
                      {s.totalMass === null ? (
                        NULL_DISPLAY
                      ) : (
                        <Unit value={value("t", s.totalMass)} decimals={1} />
                      )}
                    </ShipDetails>
                  </ShipMeta>
                  <ShipCost>
                    {/* One Unit carrying the value, so the cost groups like the balance. */}
                    {s.requiresFunds !== null &&
                      s.requiresFunds > fundsAvailable && (
                        <BlockedTag>
                          <Unit value={value("funds", s.requiresFunds)} />
                        </BlockedTag>
                      )}
                    {s.requiresFunds !== null &&
                      s.requiresFunds <= fundsAvailable &&
                      s.requiresFunds > 0 && (
                        <CostTag>
                          <Unit value={value("funds", s.requiresFunds)} />
                        </CostTag>
                      )}
                    {s.missingParts.length > 0 && (
                      <BlockedTag>{s.missingParts.length} locked</BlockedTag>
                    )}
                  </ShipCost>
                </SelectableRow>
              </Tooltip>
              {picked && detail}
            </ShipSelection>
          );
        })}
      </ShipList>
    </PadColumn>
  );
}
