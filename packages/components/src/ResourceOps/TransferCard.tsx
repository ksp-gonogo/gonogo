import {
  type ResourceTransferJob,
  transferResourceLabel,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Card,
  ResourceFlowRow,
  resourceColor,
  type UiResourceTransferModel,
} from "@ksp-gonogo/ui-kit";

/** A running resource transfer, as one more process in the list. */
export function TransferCard({
  job,
  transfer,
}: Readonly<{ job: ResourceTransferJob; transfer: UiResourceTransferModel }>) {
  return (
    <Card
      tone={transfer.held ? "neutral" : "go"}
      identityColor={resourceColor(job.resource)}
      title={`${transferResourceLabel(job.resource)} transfer`}
      titleRight={
        transfer.held ? (
          <Badge tone="info">run state held</Badge>
        ) : (
          <Badge tone="go">running</Badge>
        )
      }
    >
      <ResourceFlowRow job={job} transfer={transfer} />
    </Card>
  );
}
