import { Badge, Button, Stack, Text } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";
import type { UplinkPage } from "./UplinksSettings";

/**
 * The one line that says what became of a build named with `--uplink`: whether
 * its client loaded, why not when it did not, and whether the mod reports the
 * Uplink, so a widget with no data is explained rather than blamed on the client.
 */
export function localStatusLine(page: UplinkPage): string {
  const local = page.local;
  if (!local) return "";
  const client = (() => {
    if (local.state === "waiting" && page.client?.status !== "loaded")
      return "waiting for the first build, run the Uplink's watch build";
    if (local.state === "failed") {
      const kept =
        page.client?.status === "loaded"
          ? ", the last good build is loaded"
          : "";
      return `build failed: ${local.error ?? "no reason given"}${kept}`;
    }
    if (page.client?.status === "quarantined")
      return `quarantined: ${page.client.reason ?? "no reason given"}`;
    if (page.client?.status === "loaded") return "loaded";
    return "not loaded yet";
  })();
  const mod = page.health
    ? `mod: reporting, v${page.health.version}`
    : `mod: not reporting ${page.id}`;
  return `Client: ${client} · ${mod}`;
}

const builtAt = (iso: string | null): string | null => {
  if (!iso) return null;
  const when = new Date(iso);
  return Number.isNaN(when.getTime()) ? null : when.toLocaleTimeString();
};

/** The facts a row leads with: version, when it was built, and where it came from. */
function localFacts(page: UplinkPage): string {
  const local = page.local;
  if (!local) return "";
  const built = builtAt(local.builtAt);
  return [
    local.version && `v${local.version}`,
    built && `built ${built}`,
    local.path,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Every Uplink named with `--uplink`, with a way to pick up a fresh build. */
export function LocalBuilds({
  pages,
  reload = () => window.location.reload(),
}: {
  pages: UplinkPage[];
  reload?: () => void;
}) {
  return (
    <Stack
      as="ul"
      gap="related-comfortable"
      style={{ listStyle: "none", margin: 0, padding: 0 }}
    >
      {pages.map((page) => (
        <BuildRow key={page.id}>
          <Stack gap="related">
            <Heading>
              <Text weight="semibold">{page.name}</Text>
              <Badge tone="warn" size="sm">
                Local
              </Badge>
            </Heading>
            <Text size="sm" level="muted">
              {localFacts(page)}
            </Text>
            <Text size="sm" level="faint">
              {localStatusLine(page)}
            </Text>
          </Stack>
          <Button variant="ghost" type="button" onClick={reload}>
            Reload
          </Button>
        </BuildRow>
      ))}
    </Stack>
  );
}

const BuildRow = styled.li`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--gap-section);
`;

const Heading = styled.span`
  display: flex;
  align-items: center;
  gap: var(--gap-related);
`;
