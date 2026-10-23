import type { RecoveryReport } from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { MissionDate, Unit } from "@ksp-gonogo/ui-kit";
import { Fragment, type ReactNode } from "react";
import {
  LastRecovery__Block,
  LastRecovery__Figures,
  LastRecovery__Label,
} from "./styles";

/**
 * The last recovery on record: the vessel and where it came down, when, and
 * what came home (crew, parts, the science data, and the funds and science it
 * earned where the save awards them). Draws nothing until a recovery has been
 * recorded. Useful for showing the operator that the recovery they just made
 * went through. Used by the Launch & Recovery widget at the Space Center.
 */
export function LastRecovery({
  report,
}: {
  report: RecoveryReport | undefined;
}) {
  if (!report) return null;
  const crew = report.crewBreakdown?.length ?? 0;
  const parts = (report.partBreakdown ?? []).reduce(
    (sum, p) => (p.count ? sum.plus(p.count) : sum.plus(value("count", 1))),
    value("count", 0),
  );
  const science = report.scienceBreakdown ?? [];
  const mits = science.reduce(
    (sum, s) => (s.dataGathered ? sum.plus(s.dataGathered) : sum),
    value("Mit", 0),
  );
  const figures: { key: string; node: ReactNode }[] = [
    {
      key: "what",
      node: (
        <span>
          {crew} crew · <Unit value={parts} /> parts
        </span>
      ),
    },
  ];
  if (science.length > 0) {
    figures.push({
      key: "data",
      node: (
        <span>
          <Unit value={mits} /> of data
        </span>
      ),
    });
  }
  if (report.fundsEarned != null) {
    figures.push({ key: "funds", node: <Unit value={report.fundsEarned} /> });
  }
  if (report.scienceEarned != null) {
    figures.push({
      key: "science",
      node: <Unit value={report.scienceEarned} />,
    });
  }
  return (
    <LastRecovery__Block data-last-recovery role="status">
      <LastRecovery__Label>Last recovery</LastRecovery__Label>
      <div>
        {report.vesselName}
        {report.recoveryLocation ? ` · ${report.recoveryLocation}` : ""} ·{" "}
        <MissionDate value={report.capturedAtUT} />
      </div>
      <LastRecovery__Figures>
        {figures.map((figure, index) => (
          <Fragment key={figure.key}>
            {index > 0 && " · "}
            {figure.node}
          </Fragment>
        ))}
      </LastRecovery__Figures>
    </LastRecovery__Block>
  );
}
