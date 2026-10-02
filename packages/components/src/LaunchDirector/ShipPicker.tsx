import { value } from "@ksp-gonogo/sitrep-sdk";
import { SelectableRow, Tooltip, Unit } from "@ksp-gonogo/ui-kit";
import { type SavedShip, shipBlocked } from "./ships";
import {
  BlockedTag,
  CostTag,
  PadColumn,
  SectionLabel,
  ShipCost,
  ShipDetails,
  ShipList,
  ShipMeta,
  ShipName,
} from "./styles";

/** The open pad's craft, each greyed out while its funds or parts block it. */
export function ShipPicker({
  padCraft,
  selectedShip,
  onSelectShip,
  fundsAvailable,
}: {
  padCraft: readonly SavedShip[];
  selectedShip: string | null;
  onSelectShip: (name: string | null) => void;
  fundsAvailable: number;
}) {
  const ready = padCraft.filter((s) => !shipBlocked(s, fundsAvailable)).length;
  return (
    <PadColumn>
      <SectionLabel>
        Craft · {ready}/{padCraft.length} ready
      </SectionLabel>
      <ShipList>
        {padCraft.map((s) => {
          const blocked = shipBlocked(s, fundsAvailable);
          return (
            <SelectableRow
              key={`${s.facility}/${s.file}`}
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
                  {s.partCount} parts ·{" "}
                  <Unit value={value("t", s.totalMass)} decimals={1} />
                </ShipDetails>
              </ShipMeta>
              <ShipCost>
                {/* One Unit carrying the value, so the cost groups like the balance. */}
                {s.requiresFunds > fundsAvailable && (
                  <Tooltip text="Insufficient funds" focusable>
                    <BlockedTag>
                      <Unit value={value("funds", s.requiresFunds)} />
                    </BlockedTag>
                  </Tooltip>
                )}
                {s.requiresFunds <= fundsAvailable && s.requiresFunds > 0 && (
                  <CostTag>
                    <Unit value={value("funds", s.requiresFunds)} />
                  </CostTag>
                )}
                {s.missingParts.length > 0 && (
                  <Tooltip
                    text={`Missing: ${s.missingParts.join(", ")}`}
                    focusable
                  >
                    <BlockedTag>{s.missingParts.length} locked</BlockedTag>
                  </Tooltip>
                )}
              </ShipCost>
            </SelectableRow>
          );
        })}
      </ShipList>
    </PadColumn>
  );
}
