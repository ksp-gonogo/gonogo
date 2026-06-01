import { DataSourceStatusComponent } from "@gonogo/components";
import { useDataSources } from "@gonogo/core";
import { DatabaseIcon, Fab, useModal } from "@gonogo/ui";
import styled from "styled-components";

export function DataSourcesFab({ bottom = 564 }: { bottom?: number } = {}) {
  const { open } = useModal();
  const sources = useDataSources();
  const hasIssue = sources.some(
    (s) => s.status === "disconnected" || s.status === "error",
  );

  function handleClick() {
    open(<DataSourceStatusComponent />, { title: "Data Sources" });
  }

  return (
    <Fab
      bottom={bottom}
      onClick={handleClick}
      aria-label={`Manage data sources${hasIssue ? " (a source is offline)" : ""}`}
      title={hasIssue ? "A data source is offline" : "Data sources"}
    >
      <DatabaseIcon />
      {hasIssue && <StatusDot aria-hidden="true" />}
    </Fab>
  );
}

const StatusDot = styled.span`
  position: absolute;
  top: 4px;
  right: 4px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-status-warning-bg);
  border: 2px solid var(--color-surface-raised);
  pointer-events: none;
`;
