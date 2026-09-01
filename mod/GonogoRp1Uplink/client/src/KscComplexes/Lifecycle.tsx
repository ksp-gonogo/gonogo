import {
  ActionButton,
  CommandButton,
  Inline,
  magnitudeOf,
  NULL_DISPLAY,
  Row,
  Stack,
  Text,
  TextField,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import type { Rp1ComplexEntry, Rp1PadEntry } from "../__generated__/contract";

/** Demolish a launch complex. Must match `Rp1ComplexLifecycleCommands.DismantleComplexCommand`. */
export const RP1_COMPLEX_DISMANTLE_COMMAND = "rp1.complex.dismantle";

/** Demolish one of a complex's pads. Must match `Rp1ComplexLifecycleCommands.DismantlePadCommand`. */
export const RP1_PAD_DISMANTLE_COMMAND = "rp1.pad.dismantle";

/** Build one more pad at a complex. Must match `Rp1ComplexConstructionCommands.NewPadCommand`. */
export const RP1_PAD_NEW_COMMAND = "rp1.pad.new";

/** Rename a complex. Must match `Rp1ComplexLifecycleCommands.RenameComplexCommand`. */
export const RP1_COMPLEX_RENAME_COMMAND = "rp1.complex.rename";

/** Rename one of a complex's pads. Must match `Rp1ComplexLifecycleCommands.RenamePadCommand`. */
export const RP1_PAD_RENAME_COMMAND = "rp1.pad.rename";

/**
 * Demolishing a launch complex.
 *
 * <para><b>The warning is ON THE PRESS, not on the card.</b> It used to be three
 * sentences standing permanently under every complex, explaining what an
 * efficiency record is and what happens to it. The operator's ruling: "this is
 * meant to be a mission control, not a storybook. We present facts and
 * instrumentation, not guidance." A standing explanation of a button nobody has
 * pressed is guidance, and it was repeated on every complex in the career.</para>
 *
 * <para>So the whole of it is now the confirm step's own label, in the operator's
 * own words. What is lost is the distinction between a crew rating that dies with
 * the complex and one that survives in a sibling; what is kept is the fact that a
 * crew rating goes at all, which is the half RP-1's own dialog never mentions. The
 * sibling case is still on the wire as `efficiencySharedWith` for anything that
 * wants it.</para>
 *
 * <para>Arm then confirm, because it is not reversible: a rebuilt complex starts
 * its crew rating again from RP-1's floor.</para>
 */
export function DismantleControl({
  complex,
  name,
  handle,
}: Readonly<{
  complex: Rp1ComplexEntry;
  name: string;
  handle: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  const lcId = complex.lcId;
  if (lcId === undefined || lcId === null) {
    return null;
  }

  // The one complex RP-1 will never demolish, and it says so itself. Drawing a
  // control that can only be refused would be worse than drawing none.
  if (complex.lcType === "Hangar") {
    return null;
  }

  return (
    <CommandButton
      args={{ lcId }}
      aria-label={`Dismantle ${name}`}
      commandLabel={`Dismantle ${name}`}
      confirmAriaLabel={`Confirm dismantling ${name}: removes the whole complex, its pads and its crew rating`}
      confirmLabel="Warning: removes complex, pads and crew rating"
      confirmTone="nogo"
      handle={handle}
      label="Dismantle"
      size="sm"
      tone="warn"
    />
  );
}

/**
 * Demolishing one pad, drawn on the pad's own row.
 *
 * <para><b>Why this is a refusal and not simply a control.</b> RP-1 will not let
 * a complex lose its last working pad, and the way it enforces that is to do
 * nothing: its check short-circuits, its confirmation dialog closes, and the pad
 * is still there with no message posted anywhere. So the control is dark with the
 * reason rather than live and silently inert, and the command refuses in words if
 * it is sent anyway.</para>
 *
 * <para>The count that matters is the OPERATIONAL one, which is why
 * <c>isOperational</c> is on the wire: a pad still under construction does not
 * count toward the one a complex must keep, and cannot itself be dismantled
 * because there is nothing built to remove.</para>
 */
export function PadDismantleControl({
  complex,
  pad,
  handle,
}: Readonly<{
  complex: Rp1ComplexEntry;
  pad: Rp1PadEntry;
  handle: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  const lcId = complex.lcId;
  const padId = pad.padId;
  if (
    lcId === undefined ||
    lcId === null ||
    padId === undefined ||
    padId === null
  ) {
    return null;
  }

  const padName = pad.name ?? NULL_DISPLAY;
  const operational = magnitudeOf(complex.launchPadCount);
  const inService = pad.isOperational === true;
  const last = operational !== null && operational < 2;

  // Two unrelated reasons a press is refused, and an operator who cannot press
  // needs to know which: build another pad, or wait for this one to finish.
  const blockedBecause = !inService
    ? `${padName} is not in service yet, so cancel its construction instead`
    : last
      ? `${padName} is the last working pad at this complex, and a complex must keep one`
      : null;

  return (
    <Inline gap="xs">
      <CommandButton
        args={{ lcId, padId }}
        aria-label={blockedBecause ?? `Dismantle ${padName}, permanently`}
        commandLabel={`Dismantle ${padName}`}
        confirmAriaLabel={`Confirm dismantling ${padName}`}
        confirmLabel="Confirm"
        confirmTone="nogo"
        disabled={blockedBecause !== null}
        handle={handle}
        label="Dismantle"
        size="sm"
        title={blockedBecause ?? undefined}
        tone="warn"
      />
    </Inline>
  );
}

/**
 * Building one more pad at a complex.
 *
 * <para><b>The price is quoted and the press does not spend it.</b> RP-1 draws a
 * construction down as it builds: `ConstructionProject.AddProgress` charges the
 * fraction of the total the progress has reached, so pressing this commits to a
 * total rather than paying it. Read in IL because it decides what the control may
 * claim.</para>
 *
 * <para>And a career that cannot afford a tick is NOT refused. RP-1 spends
 * whatever fraction it can afford, advances the build by that same fraction,
 * stops timewarp with a screen message and carries on: no cancel, no refund,
 * nothing on the pad's own row to say it is crawling. So a shortfall is worth
 * saying BEFORE the press, and worth saying as a slower build rather than as a
 * refusal, because a control that said "cannot afford" would be describing a
 * refusal RP-1 does not make.</para>
 *
 * <para>The balance itself is not drawn here. It is already in this widget's
 * body: the host draws career funds beside its pad line, and the repo rule is
 * per-widget. What the host cannot say is whether the balance covers THIS quote,
 * which is the half that belongs next to the press.</para>
 *
 * <para>Absent price is not a free pad. `newPadCost` is absent for a hangar,
 * which has no pad, and whenever RP-1 would not price one; both draw no control
 * rather than a control quoting nothing.</para>
 */
export function PadNewControl({
  complex,
  funds,
  handle,
  taken,
}: Readonly<{
  complex: Rp1ComplexEntry;
  /** The career balance, for the covers-it reading only. Absent means say nothing. */
  funds: number | null;
  handle: Parameters<typeof CommandButton>[0]["handle"];
  /** Pad names already at this complex, which RP-1 refuses a duplicate of. */
  taken: readonly string[];
}>) {
  const [name, setName] = useState("");

  const lcId = complex.lcId;
  const cost = magnitudeOf(complex.newPadCost);
  if (lcId === undefined || lcId === null || cost === null) {
    return null;
  }

  const trimmed = name.trim();
  const duplicate = taken.some(
    (existing) => existing.toLowerCase() === trimmed.toLowerCase(),
  );
  const invalid = duplicate
    ? "a pad at this complex already has that name"
    : undefined;
  const short = funds !== null && funds < cost;

  return (
    <Stack gap="xs">
      <TextField
        invalid={invalid}
        label={`New pad at ${complex.name ?? NULL_DISPLAY}`}
        maxLength={64}
        onChange={setName}
        placeholder="pad name"
        value={name}
      />
      {/* Not in a list, unlike the pad rows above, so it does not render an li. */}
      <Row as="div">
        <Text size="xs" tone={short ? "warn" : "muted"}>
          <Unit value={complex.newPadCost} />
          {short && " · more than the balance, so it builds slower"}
        </Text>
        <CommandButton
          args={{ lcId, name: trimmed }}
          aria-label={
            trimmed === ""
              ? "Name the pad before building it"
              : `Build ${trimmed} at ${complex.name ?? NULL_DISPLAY}`
          }
          commandLabel={`Build ${trimmed} at ${complex.name ?? NULL_DISPLAY}`}
          confirmAriaLabel={`Confirm building ${trimmed}, committing the career to its cost as it builds`}
          confirmLabel="Confirm"
          disabled={trimmed === "" || duplicate}
          handle={handle}
          label="Build"
          size="sm"
        />
      </Row>
    </Stack>
  );
}

/**
 * Renaming a complex or one of its pads, which are the same act twice.
 *
 * <para><b>It costs no standing height.</b> A rename is occasional and a text
 * field left open on every complex and every pad would be exactly the boilerplate
 * the operator asked to be rid of, so the closed state is one small button and
 * the field appears on the press.</para>
 *
 * <para><b>The duplicate refusal is ours, not RP-1's.</b> RP-1 returns silently
 * when a name is already taken: no message, no change, and the old name still on
 * screen, which reads as a control that did nothing rather than as a refusal. So
 * the duplicate is refused here, before the dispatch, in words. The command
 * refuses it as well for anything that sends it anyway, and reads the name back
 * afterwards for the same reason.</para>
 */
export function RenameControl({
  args,
  currentName,
  handle,
  label,
  onDone,
  open: controlled,
  taken,
}: Readonly<{
  /** Everything the command needs except the name, which this control supplies. */
  args: Record<string, string>;
  currentName: string;
  handle: Parameters<typeof CommandButton>[0]["handle"];
  /** What is being renamed, for the field label and every announced name. */
  label: string;
  /**
   * Open from the start, for a caller that owns the trigger. A pad row's editor
   * REPLACES the row, so the row has to know it is renaming; a complex has no such
   * constraint and lets this control own both halves.
   */
  open?: boolean;
  /** Told when the editor closes, so a caller owning the trigger can follow it. */
  onDone?: () => void;
  /** The names already in use at this scope, which RP-1 would silently refuse. */
  taken: readonly string[];
}>) {
  const [ownOpen, setOwnOpen] = useState(false);
  const [next, setNext] = useState(currentName);
  const open = controlled === true || ownOpen;

  const close = () => {
    setOwnOpen(false);
    onDone?.();
  };

  if (!open) {
    return (
      // An ActionButton, which is the kit's compact bordered control and matches
      // the Dismantle, Build and Rush presses this sits among. It was a
      // TextButton: bare lowercase text with no chrome next to a row of bordered
      // buttons, which is the "why is the rename button a different form to the
      // other buttons?" the operator asked. Not a CommandButton, because opening
      // an editor dispatches nothing.
      <ActionButton
        aria-label={`Rename ${label}`}
        onClick={() => {
          setNext(currentName);
          setOwnOpen(true);
        }}
        type="button"
      >
        Rename
      </ActionButton>
    );
  }

  const trimmed = next.trim();
  const duplicate = taken.some(
    (existing) =>
      existing.toLowerCase() === trimmed.toLowerCase() &&
      existing.toLowerCase() !== currentName.toLowerCase(),
  );
  const unchanged = trimmed === currentName;

  return (
    <Stack gap="xs">
      <TextField
        invalid={duplicate ? "that name is already in use here" : undefined}
        label={`New name for ${label}`}
        maxLength={64}
        onChange={setNext}
        value={next}
      />
      <Inline gap="xs">
        <CommandButton
          args={{ ...args, name: trimmed }}
          aria-label={
            trimmed === ""
              ? `Give ${label} a name`
              : unchanged
                ? `${label} is already called that`
                : `Rename ${label} to ${trimmed}`
          }
          commandLabel={`Rename ${label} to ${trimmed}`}
          disabled={trimmed === "" || duplicate || unchanged}
          handle={handle}
          label="Rename"
          size="sm"
        />
        <ActionButton
          aria-label={`Leave ${label} named ${currentName}`}
          onClick={close}
          type="button"
        >
          Cancel
        </ActionButton>
      </Inline>
    </Stack>
  );
}

/**
 * One pad's row, which becomes its rename editor rather than growing one.
 *
 * <para>The editor takes the whole row instead of the right-hand slot beside the
 * dismantle. Sharing that slot put a text field, a Rename, a cancel and a
 * Dismantle in a column two lines taller than the row it belonged to, which read
 * as a layout accident. A row that turns into the thing being done to it is the
 * same amount of space and says what is happening.</para>
 */
function PadRow({
  complex,
  dismantlePad,
  lcId,
  pad,
  renamePad,
  taken,
}: Readonly<{
  complex: Rp1ComplexEntry;
  dismantlePad: Parameters<typeof CommandButton>[0]["handle"];
  lcId: string | undefined;
  pad: Rp1PadEntry;
  renamePad: Parameters<typeof CommandButton>[0]["handle"];
  taken: readonly string[];
}>) {
  const [renaming, setRenaming] = useState(false);
  const padName = pad.name ?? NULL_DISPLAY;
  const canRename = pad.padId != null && lcId != null;

  if (renaming && canRename) {
    return (
      <Row as="li">
        <RenameControl
          args={{ lcId: lcId as string, padId: pad.padId as string }}
          currentName={padName}
          handle={renamePad}
          label={padName}
          onDone={() => setRenaming(false)}
          open
          taken={taken}
        />
      </Row>
    );
  }

  return (
    <Row>
      <Text size="xs">
        {padName} at level <Unit value={pad.level} />
        {pad.isOperational === false && " · not in service"}
      </Text>
      <Inline gap="xs">
        {canRename && (
          <ActionButton
            aria-label={`Rename ${padName}`}
            onClick={() => setRenaming(true)}
            type="button"
          >
            Rename
          </ActionButton>
        )}
        <PadDismantleControl
          complex={complex}
          handle={dismantlePad}
          pad={pad}
        />
      </Inline>
    </Row>
  );
}

/**
 * A complex's pads as rows rather than a sentence, once any of them has a control
 * on it.
 *
 * <para>The list used to be one muted line naming every pad and its level, which
 * is right for a reading and wrong the moment a pad can be acted on: a press has
 * to sit beside the thing it acts on, and a row of names with buttons run
 * together reads as a row of buttons.</para>
 *
 * <para>The operational count is asked of RP-1 rather than counted off the rows,
 * and that is not laziness: a wrecked pad reports <c>Destroyed</c> rather than
 * non-operational, so counting what is not non-operational overcounts exactly
 * when a launch has just gone wrong. It is also the number RP-1's own rule is
 * stated against.</para>
 */
export function PadRows({
  complex,
  pads,
  dismantlePad,
  funds,
  newPad,
  renamePad,
}: Readonly<{
  complex: Rp1ComplexEntry;
  pads: readonly Rp1PadEntry[];
  dismantlePad: Parameters<typeof CommandButton>[0]["handle"];
  funds: number | null;
  newPad: Parameters<typeof CommandButton>[0]["handle"];
  renamePad: Parameters<typeof CommandButton>[0]["handle"];
}>) {
  const lcId = complex.lcId;
  const taken = pads
    .map((pad) => pad.name)
    .filter((padName): padName is string => padName != null);

  // A complex with no pads still takes one, and this is the state where it most
  // needs to: a pad complex without a pad cannot launch anything.
  if (pads.length === 0) {
    return (
      <Stack gap="xs">
        <Text size="xs" tone="muted">
          no pads
        </Text>
        <PadNewControl
          complex={complex}
          funds={funds}
          handle={newPad}
          taken={taken}
        />
      </Stack>
    );
  }

  return (
    <Stack gap="xs">
      <Text size="xs" tone="muted">
        pads · <Unit value={complex.launchPadCount} /> operational
      </Text>
      <Stack as="ul" gap="xs" style={LIST_STYLE}>
        {pads.map((pad, index) => (
          <PadRow
            complex={complex}
            dismantlePad={dismantlePad}
            key={pad.padId ?? pad.name ?? String(index)}
            lcId={lcId}
            pad={pad}
            renamePad={renamePad}
            taken={taken}
          />
        ))}
      </Stack>
      <PadNewControl
        complex={complex}
        funds={funds}
        handle={newPad}
        taken={taken}
      />
    </Stack>
  );
}

/**
 * A Cluster renders a `<li>` here, so its rows need list semantics around them;
 * see the host widget for the same reset and why it is inline.
 */
const LIST_STYLE = { listStyle: "none", margin: 0, padding: 0 } as const;
