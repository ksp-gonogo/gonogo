import { useTransferPick } from "@ksp-gonogo/sitrep-sdk";
import {
  ArrowLeftRightIcon,
  IconButton,
  Meter,
  MeterStack,
  ResourceFlowRow,
  ResourceTransferPicker,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { useCallback, useState } from "react";
import { useResourceTransfer } from "../shared/useResourceTransfer";
import { carries, type ResourceRow } from "./resources";

/** One meter per resource the craft carries: LF/Ox/RCS/Xe/Power, each with its transfer control and any transfer running. */
export function ResourceListSection({ rows }: { rows: ResourceRow[] }) {
  const transfer = useResourceTransfer();
  const state = useTransferPick();
  const [picking, setPicking] = useState<string | null>(null);
  const close = useCallback(() => setPicking(null), []);

  /* A row with no transfer holds an invisible copy of the control, so every figure ends on the same edge. */
  const anyTransferable = rows.some(
    ({ def, capacity }) =>
      carries(capacity) && transfer.resources.includes(def.name),
  );
  const rowActionFor = (name: ResourceRow["def"]["name"], label: string) => {
    if (!anyTransferable) return undefined;
    if (!transfer.resources.includes(name)) {
      return (
        <span aria-hidden="true" style={RESERVED_SLOT}>
          <IconButton type="button" aria-label="Reserved space" tabIndex={-1}>
            <ArrowLeftRightIcon size={14} />
          </IconButton>
        </span>
      );
    }
    return (
      <IconButton
        type="button"
        aria-label={`Transfer ${label}`}
        aria-expanded={picking === name}
        onClick={() => {
          state.reset(name);
          setPicking(name);
        }}
      >
        <ArrowLeftRightIcon size={14} />
      </IconButton>
    );
  };

  return (
    <>
      <MeterStack style={{ marginTop: "var(--gap-related-compact)" }}>
        {rows
          .filter(({ capacity }) => carries(capacity))
          .flatMap(({ def, amount, capacity }) => [
            <Meter
              key={def.name}
              label={`${def.label} · ${def.scope === "current" ? "stage" : "vessel"}`}
              value={amount}
              capacity={capacity}
              fillColor={def.color}
              layout="row"
              rowAction={rowActionFor(def.name, def.label)}
            />,
            picking === def.name && (
              <div key={`${def.name}-picker`} style={FLOW_CELL}>
                <ResourceTransferPicker
                  transfer={transfer}
                  state={state}
                  form="list"
                  onCancel={close}
                  onStarted={close}
                />
              </div>
            ),
            ...transfer.running
              .filter((job) => job.resource === def.name)
              .map((job) => (
                <div key={job.id} style={FLOW_CELL}>
                  <ResourceFlowRow job={job} transfer={transfer} />
                </div>
              )),
          ])}
      </MeterStack>
    </>
  );
}

const RESERVED_SLOT: CSSProperties = { visibility: "hidden" };

const FLOW_CELL: CSSProperties = { gridColumn: "1 / -1" };
