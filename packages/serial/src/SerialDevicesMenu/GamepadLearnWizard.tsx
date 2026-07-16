import { FieldHint, GhostButton, PrimaryButton } from "@ksp-gonogo/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { GamepadGlyph } from "../GamepadGlyph";
import type { LabelPack } from "../gamepadLabels";
import { resolveGamepadLabel } from "../gamepadLabels";
import type { GamepadRole } from "../gamepadRoles";
import {
  GAMEPAD_ROLES,
  positionalName,
  STANDARD_AXIS_ROLES,
} from "../gamepadRoles";
import { isCapturable } from "../InputMappingTab";
import { useSerialDeviceService } from "../SerialDeviceContext";
import type { DeviceInput, DeviceInstance, DeviceType } from "../types";

const AXIS_ROLE_SET = new Set<GamepadRole>(STANDARD_AXIS_ROLES);

// Button-shaped roles accept EITHER a boolean press OR an axis crossing the
// same threshold. This is deliberately more permissive than the role's name
// implies: nobody has measured a real non-standard (`mapping === ""`) pad
// yet (see the Wednesday Work spec's DoD item 1 — deferred, needs real
// hardware), and the one thing that IS known to vary across pads/platforms
// is whether a trigger (or d-pad) is wired through the buttons array or the
// axes array once a pad drops off the standard mapping. Accepting both
// means the wizard still captures the right control either way, without
// having to special-case any particular vendor. Axis-shaped roles (the
// sticks) stay analog-only — a stick's X/Y axes are never going to arrive
// as a boolean.
const BUTTON_SHAPED_ACCEPTS = ["button", "analog"] as const;
const AXIS_SHAPED_ACCEPTS = ["analog"] as const;

interface Props {
  /** Only `id` and `labelPack` are read — the rest of the instance is
   *  irrelevant to walking roles. */
  device: Pick<DeviceInstance, "id" | "labelPack">;
  /** The device's current DeviceType. The wizard only ever patches `role`
   *  on a copy of `type.inputs`; `id` (the binding key) is never touched. */
  type: DeviceType;
  /** Called with the next `inputs` array every time a role is assigned or
   *  moved, so progress survives an early close — unlike CalibrateWizard,
   *  there's no separate "Apply" step. Skipping a role never calls this. */
  onApply: (nextInputs: DeviceInput[]) => void;
  onClose: () => void;
}

function axisDirectionHint(role: GamepadRole): string {
  if (role.endsWith("-x")) return "left, then all the way right";
  if (role.endsWith("-y")) return "up, then all the way down";
  return "through its full range";
}

/**
 * Walks `GAMEPAD_ROLES` one at a time, watching live input via
 * `service.onInput` and writing the captured `inputId`'s `role` — modelled
 * on `CalibrateWizard.tsx`'s "watch the live device" pattern. Meant to be
 * opened inside a `<Modal>` (see `SerialDevicesMenu/index.tsx`'s
 * "Learn roles..." offer point) — it renders no dialog chrome of its own.
 *
 * Button-shaped roles (face-*, bumper-*, select/start/home, stick-*-press,
 * dpad-*) capture the FIRST input crossing `isCapturable`'s threshold, same
 * as `InputMappingTab`'s "press to bind" flow, and auto-advance. Axis-
 * shaped roles (stick-*-x/y) instead track the largest excursion seen while
 * the prompt is active — a diagonal push would otherwise false-fire the
 * wrong axis — and only commit on an explicit Confirm.
 *
 * A role already held by a different input is moved, not duplicated: one
 * role, one input, always. `inputId` is never touched, so re-running this
 * wizard is always safe for saved `DashboardItem.inputMappings`.
 */
export function GamepadLearnWizard({
  device,
  type,
  onApply,
  onClose,
}: Readonly<Props>) {
  const svc = useSerialDeviceService();
  const pack: LabelPack = device.labelPack ?? "positional";

  const [draft, setDraft] = useState<DeviceInput[]>(() =>
    type.inputs.map((i) => ({ ...i })),
  );
  const [roleIdx, setRoleIdx] = useState(0);
  const role: GamepadRole | undefined = GAMEPAD_ROLES[roleIdx];
  const isAxisRole = role !== undefined && AXIS_ROLE_SET.has(role);

  // Best-excursion-so-far per inputId while an axis-shaped role's prompt is
  // active. Only inputs that already cross the shared capture threshold are
  // recorded here — an idle/drifting axis never enters this map, so
  // Confirm-with-nothing-captured is indistinguishable from Skip.
  const axisBestRef = useRef<Map<string, number>>(new Map());
  const [axisBestInputId, setAxisBestInputId] = useState<string | null>(null);

  // Stable identities (via useCallback) so the input-watching effect below
  // can list them as dependencies without resubscribing on every render —
  // neither closes over anything but state setters/refs and the `onApply`
  // prop, so an empty-ish dependency list is correct, not a lint workaround.
  const assignRole = useCallback(
    (targetRole: GamepadRole, inputId: string) => {
      setDraft((prev) => {
        const next = prev.map((i) => {
          if (i.id === inputId) return { ...i, role: targetRole };
          if (i.role === targetRole) return { ...i, role: undefined };
          return i;
        });
        onApply(next);
        return next;
      });
    },
    [onApply],
  );

  const goToRole = useCallback((idx: number) => {
    axisBestRef.current = new Map();
    setAxisBestInputId(null);
    setRoleIdx(idx);
  }, []);

  const skip = () => goToRole(roleIdx + 1);
  const back = () => goToRole(Math.max(0, roleIdx - 1));

  const confirmAxis = () => {
    if (!role) return;
    let best: string | null = null;
    let bestVal = 0;
    for (const [inputId, val] of axisBestRef.current) {
      if (val > bestVal) {
        bestVal = val;
        best = inputId;
      }
    }
    if (best) assignRole(role, best);
    goToRole(roleIdx + 1);
  };

  // Watch the live device for the currently-prompted role. Pauses the
  // action dispatcher for the duration (same `setCaptureMode` used by
  // InputMappingTab's press-to-bind) so teaching the wizard never also
  // fires whatever dashboard action a control happens to be bound to.
  useEffect(() => {
    if (!role) return;
    svc.setCaptureMode(true);
    const unsub = svc.onInput((incomingDeviceId, event) => {
      if (incomingDeviceId !== device.id) return;
      if (isAxisRole) {
        if (typeof event.value !== "number") return;
        if (!isCapturable(AXIS_SHAPED_ACCEPTS, event.value)) return;
        const abs = Math.abs(event.value);
        const prevBest = axisBestRef.current.get(event.inputId) ?? 0;
        if (abs <= prevBest) return;
        axisBestRef.current.set(event.inputId, abs);
        let winner: string | null = null;
        let winnerVal = 0;
        for (const [id, v] of axisBestRef.current) {
          if (v > winnerVal) {
            winnerVal = v;
            winner = id;
          }
        }
        setAxisBestInputId(winner);
        return;
      }
      if (!isCapturable(BUTTON_SHAPED_ACCEPTS, event.value)) return;
      assignRole(role, event.inputId);
      goToRole(roleIdx + 1);
    });
    return () => {
      unsub();
      svc.setCaptureMode(false);
    };
    // `roleIdx` drives `role`, which IS a dependency — re-subscribing on
    // every role change is the point (a stale closure here would keep
    // assigning the PREVIOUS role to new presses).
  }, [svc, device.id, role, roleIdx, isAxisRole, assignRole, goToRole]);

  const assignedCount = useMemo(
    () => GAMEPAD_ROLES.filter((r) => draft.some((i) => i.role === r)).length,
    [draft],
  );

  if (!role) {
    return (
      <Wrap>
        <Progress>
          {assignedCount} of {GAMEPAD_ROLES.length} roles assigned
        </Progress>
        <FinishedHint role="status" aria-live="polite">
          Walked every role. Re-open this wizard any time to relearn one — it's
          safe to run again, and never touches existing bindings.
        </FinishedHint>
        <Actions>
          <PrimaryButton type="button" onClick={onClose}>
            Done
          </PrimaryButton>
        </Actions>
      </Wrap>
    );
  }

  const currentHolder = draft.find((i) => i.role === role);

  return (
    <Wrap>
      <Progress>
        {roleIdx + 1} of {GAMEPAD_ROLES.length} — {assignedCount} assigned so
        far
      </Progress>

      <PromptRow>
        <GamepadGlyph role={role} pack={pack} size={28} />
        <PromptName>{resolveGamepadLabel(role, pack)}</PromptName>
        {pack !== "positional" && (
          <PromptPositional>({positionalName(role)})</PromptPositional>
        )}
      </PromptRow>

      {isAxisRole ? (
        <>
          <FieldHint>
            Move the stick all the way {axisDirectionHint(role)}, then Confirm.
          </FieldHint>
          <ListenStatus role="status" aria-live="polite">
            <ListenDot />
            {axisBestInputId
              ? `Best candidate so far: ${axisBestInputId}`
              : "Waiting for movement past the capture threshold..."}
          </ListenStatus>
        </>
      ) : (
        <ListenStatus role="status" aria-live="polite">
          <ListenDot />
          Press it now...
        </ListenStatus>
      )}

      {currentHolder && (
        <FieldHint>
          Currently assigned to {currentHolder.name || currentHolder.id} (
          {currentHolder.id}).
        </FieldHint>
      )}

      <Actions>
        <GhostButton type="button" onClick={back} disabled={roleIdx === 0}>
          Back
        </GhostButton>
        <GhostButton type="button" onClick={skip}>
          Skip
        </GhostButton>
        {isAxisRole && (
          <PrimaryButton type="button" onClick={confirmAxis}>
            Confirm
          </PrimaryButton>
        )}
      </Actions>
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const Progress = styled.div`
  font-size: var(--font-size-xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-text-faint);
`;

const PromptRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  background: var(--color-surface-raised);
  border-radius: 4px;
`;

const PromptName = styled.span`
  font-size: var(--font-size-lg, 16px);
  font-weight: 700;
  color: var(--color-text-primary);
`;

const PromptPositional = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
`;

const ListenStatus = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-xs);
  color: var(--color-status-info-fg);
`;

const ListenDot = styled.span`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-status-info-fg);
  box-shadow: 0 0 6px rgba(124, 204, 255, 0.7);
  flex-shrink: 0;

  @media (prefers-reduced-motion: no-preference) {
    animation: gamepad-learn-pulse 1.2s ease-in-out infinite;
  }

  @keyframes gamepad-learn-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }
`;

const FinishedHint = styled.div`
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  line-height: 1.5;
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;
