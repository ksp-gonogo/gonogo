import { Cluster } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import styled from "styled-components";

/**
 * One row of a banner: the facts it states, wrapping on their own, and the
 * controls that act on it, held at the far right edge of the banner whether the
 * facts take one line or several. Used by {@link BannerPill} for a pill that
 * has controls, and by the alarm strips on the main screen and on stations.
 */
export function BannerRow({
  children,
  actions,
}: Readonly<{ children: ReactNode; actions?: ReactNode }>) {
  return (
    <BannerLine>
      <Cluster justify="start" align="baseline" wrap style={FACTS_STYLE}>
        {children}
      </Cluster>
      {actions ? <Actions>{actions}</Actions> : null}
    </BannerLine>
  );
}

const FACTS_STYLE = {
  flex: "1 1 auto",
  minWidth: 0,
  whiteSpace: "normal",
} as const;

const BannerLine = styled.div`
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: var(--gap-related);
  min-width: 0;
`;

const Actions = styled.div`
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--gap-related);
  margin-left: auto;
`;
