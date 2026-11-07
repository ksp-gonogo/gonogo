import { AugmentSlot } from "@ksp-gonogo/core";
import { CrewStanding } from "@ksp-gonogo/sitrep-sdk";
import {
  Card,
  Cluster,
  type CommandButtonHandle,
  Stack,
} from "@ksp-gonogo/ui-kit";
import { KerbalBadges, KerbalName, KerbalStats } from "../shared/KerbalStats";
import { HireButton } from "./CrewButtons";
import { type ApplicantRow, applicantStats } from "./roster";
import { ASTRONAUT_COMPLEX_CREW_BADGE_SLOT } from "./slots";
import { EMPTY_STYLE, LIST_STYLE } from "./styles";

export function ApplicantsPanel({
  applicants,
  hireCost,
  hireCmd,
}: {
  applicants: ApplicantRow[];
  hireCost: number | null;
  /** The shared hire handle; each row's own `CommandButton` holds that applicant's arm and in-flight state. */
  hireCmd: CommandButtonHandle;
}) {
  if (applicants.length === 0) {
    return <div style={EMPTY_STYLE}>No applicants right now</div>;
  }
  return (
    <Stack as="ul" style={LIST_STYLE}>
      {applicants.map((a) => {
        const stats = applicantStats(a);
        return (
          // Kerbal names are unique within the applicant pool, so the name is a stable key.
          <Card as="li" key={a.name}>
            {/* Hand-composed so the KerbalStats block does not inherit the heading type; the corner holds an Uplink's mark, then the action. */}
            <Card.TitleRow
              right={
                <Cluster align="center">
                  <KerbalBadges kerbal={stats} />
                  <AugmentSlot
                    name={ASTRONAUT_COMPLEX_CREW_BADGE_SLOT}
                    props={{
                      kerbalName: a.name,
                      standing: CrewStanding.Applicant,
                      isApplicant: true,
                    }}
                  />
                  <HireButton
                    applicantName={a.name}
                    hireCost={hireCost}
                    hireCmd={hireCmd}
                  />
                </Cluster>
              }
            >
              <KerbalName name={a.name} />
            </Card.TitleRow>
            <KerbalStats kerbal={stats} showRank={false} showTraits showInfo />
            {/* The same cell as the Active list's, flagged so an augment knows which list it is in. */}
            <AugmentSlot
              name="astronaut-complex.crew"
              props={{
                kerbalName: a.name,
                standing: CrewStanding.Applicant,
                isApplicant: true,
              }}
            />
          </Card>
        );
      })}
    </Stack>
  );
}
