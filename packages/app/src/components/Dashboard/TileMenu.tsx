import {
  ActionMenu,
  type ActionMenuItem,
  Floating,
  Tooltip,
} from "@ksp-gonogo/ui-kit";
import { useCallback, useRef, useState } from "react";
import styled from "styled-components";
import { usePushClient } from "../../pushToMain/PushClientContext";
import type { DashboardItem } from "./index";
import { touchTarget } from "./touchTarget";

interface TileMenuProps {
  item: DashboardItem;
  name: string;
  pushable: boolean;
  /** Tile size in grid units, sent with a push to the main screen. */
  w: number;
  h: number;
  isFirst: boolean;
  isLast: boolean;
  half: boolean;
  halfHeight: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleWidth: () => void;
  onToggleHeight: () => void;
  onRemove: () => void;
}

/**
 * The list dashboard's per-tile controls behind one button: reorder, width,
 * height, push to the main screen and remove. A half-width tile has no room
 * for five 44px targets beside its name, so they open from here instead.
 */
export function TileMenu({
  item,
  name,
  pushable,
  w,
  h,
  isFirst,
  isLast,
  half,
  halfHeight,
  onMoveUp,
  onMoveDown,
  onToggleWidth,
  onToggleHeight,
  onRemove,
}: Readonly<TileMenuProps>) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const pushClient = usePushClient();
  const pushed = pushClient?.isPushed(item.i) ?? false;

  const dismiss = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const anchor = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    return rect ? { x: rect.right, y: rect.bottom } : null;
  }, []);

  const items: ActionMenuItem[] = [
    { key: "up", label: "Move up", disabled: isFirst },
    { key: "down", label: "Move down", disabled: isLast },
    {
      key: "width",
      label: half ? "Expand to full width" : "Shrink to half width",
    },
    {
      key: "height",
      label: halfHeight ? "Expand to full height" : "Shrink to half height",
    },
    ...(pushable && pushClient
      ? [
          {
            key: "push",
            label: pushed ? "Recall from main" : "Push to main",
          },
        ]
      : []),
    { key: "remove", label: `Remove ${name}` },
  ];

  const select = (key: string) => {
    switch (key) {
      case "up":
        onMoveUp();
        break;
      case "down":
        onMoveDown();
        break;
      case "width":
        onToggleWidth();
        break;
      case "height":
        onToggleHeight();
        break;
      case "push":
        if (pushed) pushClient?.recall(item.i);
        else
          pushClient?.push({
            widgetInstanceId: item.i,
            componentId: item.componentId,
            config: (item.config ?? {}) as Record<string, unknown>,
            width: w,
            height: h,
          });
        break;
      case "remove":
        onRemove();
        return;
      default:
        break;
    }
    dismiss();
  };

  return (
    <>
      <Tooltip text={`${name} options`}>
        <Trigger
          ref={triggerRef}
          type="button"
          aria-label={`${name} options`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        </Trigger>
      </Tooltip>
      {open && (
        <Floating anchor={anchor}>
          <ActionMenu
            items={items}
            aria-label={`${name} options`}
            style={{ position: "static" }}
            onSelect={select}
            onDismiss={dismiss}
          />
        </Floating>
      )}
    </>
  );
}

const Trigger = styled.button`
  background: none;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-regular);
  color: var(--color-text-muted);
  cursor: pointer;
  line-height: var(--line-height-flush);
  padding: var(--inset-control-compact);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  ${touchTarget}

  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;
