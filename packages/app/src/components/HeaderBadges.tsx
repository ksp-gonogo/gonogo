import {
  Badge,
  badgeFace,
  Cluster,
  ContributionsProvider,
  useContributions,
} from "@ksp-gonogo/ui-kit";

/** The header's one contribution slot. */
const HEADER_BADGE_SLOTS = ["app.header-badges"] as const;

/**
 * The badges contributed to `app.header-badges`, in the screen header's banner
 * strip: facts about the whole board that no one widget owns, a held one read
 * through the kit's held vocabulary like a panel badge. Renders nothing
 * while nothing is contributed, so an install with no contributor draws the
 * strip exactly as before.
 */
export function HeaderBadges() {
  return (
    <ContributionsProvider slots={HEADER_BADGE_SLOTS}>
      <HeaderBadgeList />
    </ContributionsProvider>
  );
}

function HeaderBadgeList() {
  const badges = useContributions("app.header-badges");
  if (badges.length === 0) return null;

  return (
    <Cluster justify="start" align="center" role="status" aria-live="polite">
      {badges.map((badge) => {
        const { label, tone, title } = badgeFace(badge);
        return (
          <Badge
            key={`${badge.contributionId}:${badge.id}`}
            tone={tone}
            title={title}
          >
            {label}
          </Badge>
        );
      })}
    </Cluster>
  );
}
