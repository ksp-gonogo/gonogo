import { AugmentSlot } from "@ksp-gonogo/core";
import { canBeSacked, crewStandingLabel } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Card,
  Cluster,
  type CommandButtonHandle,
  Stack,
  type TabDescriptor,
  Tabs,
} from "@ksp-gonogo/ui-kit";
import { KerbalStats } from "../shared/KerbalStats";
import { FireButton } from "./CrewButtons";
import {
  type CrewRosterRow,
  crewRowKeys,
  crewRowStats,
  groupByStanding,
  orderStandings,
} from "./roster";
import { ASTRONAUT_COMPLEX_CREW_BADGE_SLOT } from "./slots";
import { EMPTY_STYLE, LIST_STYLE, WHO_STYLE } from "./styles";

/**
 * The Active tab, sub-tabbed by the `CrewStanding` values actually present, so
 * no tab is ever empty and a new standing gets a tab with no edit. Grouped by
 * STANDING, not KSP's roster status: RP-1 writes `Dead` into the roster status
 * of a living retiree.
 */
export function ActivePanel({
  crew,
  fireCmd,
  highlightedName,
  armed,
}: {
  crew: CrewRosterRow[];
  /** The shared fire handle; see `ApplicantsPanel`'s `hireCmd`. */
  fireCmd: CommandButtonHandle;
  /** The crew member `fireHighlighted` acts on. */
  highlightedName: string | null;
  /** Whether that crew member's fire is armed: the next `fireHighlighted` press sends it. */
  armed: boolean;
}) {
  // Filters on the `isApplicant` flag: an absent roster ordinal is a field that did not arrive, not an applicant.
  const active = crew.filter((c) => !c.isApplicant);
  if (active.length === 0) {
    return <div style={EMPTY_STYLE}>No active crew</div>;
  }

  const groups = groupByStanding(active);
  const tabs: TabDescriptor[] = orderStandings(groups.keys()).map(
    (standing) => {
      const members = groups.get(standing) ?? [];
      const keys = crewRowKeys(members);
      // Whether the roster accepts a sacking, which is not whether the kerbal can fly: a resting kerbal can be fired.
      const fireable = canBeSacked(standing);
      const label = crewStandingLabel(standing) ?? members[0]?.situation ?? "";
      return {
        // Named after the standing: stable across re-renders and legible in a test failure.
        id: `standing-${standing}`,
        label: `${label} (${members.length})`,
        content: (
          <Stack as="ul" style={LIST_STYLE}>
            {members.map((m, i) => (
              <Card
                as="li"
                key={keys[i]}
                aria-current={
                  fireable && m.name === highlightedName ? "true" : undefined
                }
              >
                {/* The sack control sits at the END of the identity line: firing is rare, and a column of its own would take width off the schedule. The corner is where a career model's mark is read WITH the name. */}
                <Card.TitleRow
                  right={
                    <Cluster align="center">
                      <AugmentSlot
                        name={ASTRONAUT_COMPLEX_CREW_BADGE_SLOT}
                        props={{
                          kerbalName: m.name,
                          standing: m.standing,
                          isApplicant: false,
                        }}
                      />
                      {fireable && m.name === highlightedName && (
                        <Badge
                          severity={armed ? "critical" : undefined}
                          size="sm"
                        >
                          {armed ? "ARMED" : "SELECTED"}
                        </Badge>
                      )}
                      {fireable && (
                        <FireButton kerbalName={m.name} fireCmd={fireCmd} />
                      )}
                    </Cluster>
                  }
                >
                  <Stack style={WHO_STYLE}>
                    <KerbalStats
                      kerbal={crewRowStats(m)}
                      showRank
                      showTraits
                      showExperienceProgress
                      showInfo
                    />
                  </Stack>
                </Card.TitleRow>
                {/* This kerbal's schedule from whichever Uplink manages their career; nothing under stock. */}
                <AugmentSlot
                  name="astronaut-complex.crew"
                  props={{
                    kerbalName: m.name,
                    standing: m.standing,
                    isApplicant: false,
                  }}
                />
              </Card>
            ))}
          </Stack>
        ),
      };
    },
  );

  return <Tabs tabs={tabs} />;
}
