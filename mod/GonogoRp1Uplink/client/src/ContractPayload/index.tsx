import {
  registerAugment,
  useCommand,
  useTelemetry,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  CommandButton,
  Inline,
  Stack,
  Text,
  Unit,
  UnitInput,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import { current } from "../shared/current";
import { RP1 } from "../uplink";
// Side-effect import: hydrates these Topics' units at decode time. Here rather
// than left to the entry point's import order, because this file is the
// consumer that would silently receive bare numbers without it.
import "../topics";

/** Set the satellite contract payload requirement. Must match `Rp1ContractCommands.SetPayloadCommand`. */
export const RP1_CONTRACT_PAYLOAD_COMMAND = "rp1.contracts.setPayload";

/** RP-1's own bounds, from `ContractGUI.MinPayload` and `MaxPayload`. */
const MIN_PAYLOAD = 400;
const MAX_PAYLOAD = 10_000;

/** RP-1's own step: its slider rounds to hundreds, so a figure between two is not one the game holds. */
const PAYLOAD_STEP = 100;

/**
 * The payload mass RP-1's repeating satellite contracts require.
 *
 * <para><b>Two typed fields and one press, where RP-1 has two sliders.</b> The
 * reason is RP-1's own: changing either figure withdraws the matching
 * pre-generated contract offers so they regenerate against the new requirement,
 * and RP-1 fires that from a comparison it makes every draw frame. A drag across
 * its range crosses ninety-six steps and withdraws at every one.</para>
 *
 * <para>So this is not a slider. Not because dragging is dangerous here (the
 * command fires each withdrawal exactly once whatever the control looks like) but
 * because a control that looks continuous invites the gesture RP-1 punishes, and
 * an operator who learns it here will use it there.</para>
 *
 * <para><b>What it costs is said before the press, not after.</b> The requirement
 * itself is visible on the fields; the churn is not, and the churn is the half
 * RP-1 never mentions.</para>
 *
 * <para>Arm then confirm, because it is not reversible in the sense that matters:
 * setting the figure back does not bring a withdrawn offer back, it withdraws
 * another round.</para>
 */
export function ContractPayload() {
  const available = current(useTelemetry("rp1.available"));

  // Unconditional and above the early return on purpose: a hook after it would
  // change count on the first frame RP-1 answers.
  const setPayload = useCommand(RP1_CONTRACT_PAYLOAD_COMMAND);
  usePanelDelay(setPayload);
  const [comms, setComms] = useState(MIN_PAYLOAD);
  const [weather, setWeather] = useState(MIN_PAYLOAD);

  // Invisible on every install without RP-1, which is most of them.
  if (available !== true) {
    return null;
  }

  const legalPair = legal(comms) && legal(weather);

  return (
    <Stack gap="sm">
      <Text size="xs" tone="muted">
        the payload a repeating satellite contract will require
      </Text>

      <Inline gap="sm" wrap>
        <UnitInput
          label="CommSat payload"
          onChange={(next) => setComms(kilograms(next))}
          unit="kg"
          value={value("kg", comms)}
        />
        <UnitInput
          label="WeatherSat payload"
          onChange={(next) => setWeather(kilograms(next))}
          unit="kg"
          value={value("kg", weather)}
        />
      </Inline>

      <Text size="xs" tone={legalPair ? "muted" : "warn"}>
        {legalPair ? (
          "changing either withdraws the matching pending contract offers, once each, so they regenerate against the new requirement"
        ) : (
          <>
            each figure must be between{" "}
            <Unit value={value("kg", MIN_PAYLOAD)} /> and{" "}
            <Unit value={value("kg", MAX_PAYLOAD)} />, in steps of{" "}
            {PAYLOAD_STEP}
          </>
        )}
      </Text>

      <CommandButton
        args={{ commsPayload: comms, weatherPayload: weather }}
        aria-label={
          legalPair
            ? `Require ${comms} kilograms for CommSat contracts and ${weather} kilograms for WeatherSat contracts, withdrawing the matching pending offers`
            : "One of the payload figures is outside the range RP-1 accepts"
        }
        commandLabel="Set contract payload requirements"
        confirmAriaLabel="Confirm the new payload requirements and withdraw the matching pending offers"
        confirmLabel="Confirm"
        confirmTone="nogo"
        disabled={!legalPair}
        handle={setPayload}
        label="Set payload"
        size="sm"
        tone="warn"
      />
    </Stack>
  );
}

/**
 * A typed mass as the plain kilogram integer the command's wire carries.
 *
 * <para>The ONE place this control reaches for `.magnitude`, and it is unavoidable
 * rather than convenient: `rp1.contracts.setPayload` declares
 * `commsPayload` as an `int?` in kilograms, because RP-1 stores it as an `int` and
 * validates it against integer bounds and an integer step. So a raw number has to
 * exist at the boundary, and doing it once in a named function beats doing it
 * twice inline.</para>
 */
function kilograms(mass: Value<"kg">) {
  return Math.round(mass.magnitude);
}

/**
 * Whether a figure is one RP-1's own control could have produced.
 *
 * <para>Checked here as well as at the command, and not as duplication for its own
 * sake: the command is the authority and refuses, and this is what keeps the press
 * dark rather than letting an operator arm, confirm and read a refusal for
 * something the control could have told them first.</para>
 */
function legal(payload: number) {
  return (
    Number.isFinite(payload) &&
    payload >= MIN_PAYLOAD &&
    payload <= MAX_PAYLOAD &&
    payload % PAYLOAD_STEP === 0
  );
}

registerAugment({
  id: "rp1-contract-payload",
  augments: "contract-manager.sections",
  component: ContractPayload,
  priority: 0,
  owner: RP1,
});
