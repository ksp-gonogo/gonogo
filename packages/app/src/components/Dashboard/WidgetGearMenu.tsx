import { type AnyDef, ErrorBoundary, useChromeWrap } from "@ksp-gonogo/core";
import { AppError, handleError } from "@ksp-gonogo/logger";
import {
  type InputMappings,
  InputMappingTab,
  SerialDeviceProvider,
  useSerialDeviceService,
} from "@ksp-gonogo/serial";
import { GearIcon, Tabs, useModal } from "@ksp-gonogo/ui";
import { useState } from "react";
import styled from "styled-components";
import type { DashboardItem } from "./index";
import { handleMouseDown } from "./mouseHandlers";
import { WidgetError } from "./shared";

type GearButtonProps = Readonly<{
  item: DashboardItem;
  def: AnyDef;
  onSaveConfig: (c: Record<string, unknown>) => void;
  onSaveMappings: (m: InputMappings) => void;
}>;

export function GearButton({
  item,
  def,
  onSaveConfig,
  onSaveMappings,
}: GearButtonProps) {
  const { open, close } = useModal();
  // ModalProvider lives at the app root, above the screen-side providers.
  // Modal content rendered via portal doesn't see those contexts unless we
  // capture the service here (where the provider IS in scope) and
  // re-provide inside the modal content. Mirrors the on-add pattern in
  // ComponentOverlay. SerialDeviceProvider is hand-wired (out of scope for
  // the generic chrome-provider registry); any other context a config
  // component reaches for goes through useChromeWrap instead.
  const serialService = useSerialDeviceService();
  const wrapChrome = useChromeWrap();
  const ConfigComp = def.configComponent;
  const actions = def.actions ?? [];
  const hasConfig = Boolean(ConfigComp);
  const hasActions = actions.length > 0;

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!hasConfig && !hasActions) {
      handleError(new AppError("Nothing to configure"));
      return;
    }
    const id = open(
      <SerialDeviceProvider service={serialService}>
        {wrapChrome(
          <ErrorBoundary
            fallback={(error, reset) => (
              <WidgetError
                componentName={`${def.name} config`}
                error={error}
                onRetry={reset}
              />
            )}
          >
            <GearModalContent
              item={item}
              def={def}
              onSaveConfig={(c) => {
                onSaveConfig(c);
                close(id);
              }}
              onSaveMappings={(m) => {
                onSaveMappings(m);
                close(id);
              }}
            />
          </ErrorBoundary>,
        )}
      </SerialDeviceProvider>,
      { title: def.name },
    );
  }

  return (
    <GearBtn
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      aria-label={`Configure ${def.name}`}
      title="Configure"
    >
      <GearIcon size={14} />
    </GearBtn>
  );
}

function GearModalContent({
  item,
  def,
  onSaveConfig,
  onSaveMappings,
}: Readonly<{
  item: DashboardItem;
  def: AnyDef;
  onSaveConfig: (c: Record<string, unknown>) => void;
  onSaveMappings: (m: InputMappings) => void;
}>) {
  const ConfigComp = def.configComponent;
  const actions = def.actions ?? [];
  const hasConfig = Boolean(ConfigComp);
  const hasActions = actions.length > 0;

  const [activeTab, setActiveTab] = useState<"config" | "inputs">(
    hasConfig ? "config" : "inputs",
  );

  if (hasConfig && hasActions && ConfigComp) {
    return (
      <Tabs
        activeId={activeTab}
        onChange={(id) => setActiveTab(id as "config" | "inputs")}
        tabs={[
          {
            id: "config",
            label: "Settings",
            content: (
              <ConfigComp
                config={item.config ?? def.defaultConfig ?? {}}
                onSave={onSaveConfig}
              />
            ),
          },
          {
            id: "inputs",
            label: "Inputs",
            content: (
              <InputMappingTab
                actions={actions}
                mappings={item.inputMappings ?? {}}
                onSave={onSaveMappings}
              />
            ),
          },
        ]}
      />
    );
  }

  if (hasConfig && ConfigComp) {
    return (
      <ConfigComp
        config={item.config ?? def.defaultConfig ?? {}}
        onSave={onSaveConfig}
      />
    );
  }

  return (
    <InputMappingTab
      actions={actions}
      mappings={item.inputMappings ?? {}}
      onSave={onSaveMappings}
    />
  );
}

export const GearWrapper = styled.div``;

const GearBtn = styled.button`
  pointer-events: all;
  background: none;
  border: none;
  color: var(--color-text-faint);
  cursor: pointer;
  font-size: 11px;
  line-height: 1;
  padding: 1px 2px;

  &:hover {
    color: var(--color-text-muted);
  }
`;
