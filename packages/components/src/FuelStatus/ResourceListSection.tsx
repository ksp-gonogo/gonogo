import { Meter, MeterStack } from "@ksp-gonogo/ui-kit";
import { carries, type ResourceRow } from "./resources";

/** One meter per resource the craft carries: LF/Ox/RCS/Xe/Power. */
export function ResourceListSection({ rows }: { rows: ResourceRow[] }) {
  return (
    <MeterStack style={{ marginTop: "var(--gap-related-compact)" }}>
      {rows
        .filter(({ capacity }) => carries(capacity))
        .map(({ def, amount, capacity }) => (
          <Meter
            key={def.name}
            label={`${def.label} · ${def.scope === "current" ? "stage" : "vessel"}`}
            value={amount}
            capacity={capacity}
            fillColor={def.color}
            layout="row"
          />
        ))}
    </MeterStack>
  );
}
