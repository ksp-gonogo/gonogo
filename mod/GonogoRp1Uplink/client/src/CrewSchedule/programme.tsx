import type { Reading } from "@ksp-gonogo/sitrep-sdk";
import { registerAugment, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import {
  magnitudeOf,
  ReadoutCaption,
  Section,
  SectionTitle,
  Stack,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import type { Rp1CrewProgram } from "../__generated__/contract";
import { RP1 } from "../uplink";
import "../topics";

/**
 * The crew rules this save is running that are NOT the ones RP-1 ships, below
 * the roster the Astronaut Complex already shows.
 *
 * <para><b>These are difficulty SETTINGS, not career state.</b> All five come
 * off <c>RP0Settings</c>, a KSP <c>CustomParameterNode</c> in the pause menu's
 * Difficulty Options under a section RP-1 titles "RP-1";
 * <c>CrewHandler.LoadSettings</c> copies them in on
 * <c>GameEvents.OnGameSettingsApplied</c> and <c>onGameStateLoad</c> and nothing
 * in RP-1's gameplay ever writes them back. So they are set once when a career
 * is created and then left, and five permanent rows restating a career's own
 * difficulty settings on the crew surface is five rows of noise on every save
 * that took the defaults.</para>
 *
 * <para><b>Which is why only the exceptions render.</b> A rule at RP-1's own
 * default changes nothing about how the roster above reads and says nothing an
 * operator has to hold; a rule OFF that default does, and those are exactly the
 * states where a reader who assumed the defaults would be wrong. Retirement off
 * means the roster's retirement dates are gone rather than met; R&amp;R off means
 * a roster with no RESTING crew is not a crew that all happens to be on duty; a
 * rate away from 1 is why a course's ETA is not the length the catalogue quotes.
 * With every rule at its default this section renders nothing at all.</para>
 *
 * <para><b>And no controls.</b> They would be commands writing the player's
 * difficulty settings from a telemetry surface, behind the back of the dialog
 * that owns them, and RP-1 offers no API for it: the fields are plain
 * <c>GameParameters</c> members re-read from the node on an event. A readout
 * that only appears when it changes the reading is the honest shape here.</para>
 *
 * <para>The extension cap that used to sit here is gone for a different reason:
 * it is not a setting at all but <c>Database.SettingsCrew.retireIncreaseCap</c>,
 * a constant out of RP-1's own config files with no UI anywhere, and each
 * kerbal's row already states where their own date can be pushed to.</para>
 */
export function CrewProgramme() {
  const available = current(useTelemetry("rp1.available"));
  const program = current(useTelemetry("rp1.crewProgram"));

  // Invisible without RP-1, rather than a section of dashes on a stock game.
  if (available !== true) {
    return null;
  }

  const exceptions = exceptionsOf(program);
  if (exceptions.length === 0) {
    return null;
  }

  return (
    <Section>
      <SectionTitle>CREW RULES</SectionTitle>
      <Stack gap="xs">
        {exceptions.map((exception) => (
          <ReadoutCaption key={exception.key}>{exception.line}</ReadoutCaption>
        ))}
      </Stack>
    </Section>
  );
}

/** One rule this save runs differently from RP-1's own default. */
interface Exception {
  key: string;
  line: ReactNode;
}

/**
 * Every crew rule off RP-1's default, in the order they change what the roster
 * means: whether a mechanic is running at all first, then how fast it runs.
 *
 * <para>An UNREAD rule is not a rule at its default and never reports as one:
 * it produces nothing, the same as a rule that matches. A switch nobody could
 * read is not a switch that is off, and announcing one as an exception would
 * say retirement is disabled on a career that retires people.</para>
 */
function exceptionsOf(program: Rp1CrewProgram | undefined): Exception[] {
  const exceptions: Exception[] = [];
  if (program?.retirementEnabled === false) {
    exceptions.push({ key: "retirement", line: "Retirement off" });
  }
  if (program?.crewRnREnabled === false) {
    exceptions.push({ key: "rnr", line: "Post-flight R&R off" });
  }
  if (program?.missionTrainingEnabled === false) {
    exceptions.push({ key: "mission", line: "Mission training off" });
  }
  const proficiency = magnitudeOf(program?.proficiencyTrainingRate);
  if (proficiency !== null && proficiency !== 1) {
    exceptions.push({
      key: "proficiencyRate",
      line: (
        <>
          Proficiency training at{" "}
          <Unit value={program?.proficiencyTrainingRate} />× rate
        </>
      ),
    });
  }
  const mission = magnitudeOf(program?.missionTrainingRate);
  /* Silent while mission training is switched off, whatever rate rides along:
     RP-1 generates no mission template at all there, so a rate on trainings
     that do not exist is not a rule anybody is running. */
  if (
    mission !== null &&
    mission !== 1 &&
    program?.missionTrainingEnabled !== false
  ) {
    exceptions.push({
      key: "missionRate",
      line: (
        <>
          Mission training at <Unit value={program?.missionTrainingRate} />×
          rate
        </>
      ),
    });
  }
  return exceptions;
}

/** The value where one is current; see LaunchComplexStatus for why reckonable counts. */
function current<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

registerAugment({
  id: "rp1-crew-programme",
  augments: "astronaut-complex.sections",
  component: CrewProgramme,
  owner: RP1,
});
