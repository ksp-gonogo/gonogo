import type { HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";

export interface WidgetHeaderProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}

/**
 * Standard widget header row: a title slot on the left and an actions slot on
 * the right, separated by a subtle bottom border.
 *
 * Either pass `title` (string / node — typically a `<PanelTitle>`-shaped
 * label) or pass arbitrary `children` for full control of the left side.
 * `actions` is an optional right-aligned slot (toggles, icon buttons, etc.).
 */
export function WidgetHeader({
  title,
  actions,
  children,
  ...rest
}: WidgetHeaderProps) {
  const left = title ?? children;
  return (
    <WidgetHeader__Body {...rest}>
      <WidgetHeader__Title>{left}</WidgetHeader__Title>
      {actions ? (
        <WidgetHeader__Actions>{actions}</WidgetHeader__Actions>
      ) : null}
    </WidgetHeader__Body>
  );
}

const WidgetHeader__Body = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--color-border-subtle);
`;

const WidgetHeader__Title = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
`;

const WidgetHeader__Actions = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
`;
