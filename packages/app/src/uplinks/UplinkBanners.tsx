import type { UplinkBannerSeverity } from "@ksp-gonogo/sitrep-sdk";
import { BannerPill } from "@ksp-gonogo/ui";
import { Button, TextButton } from "@ksp-gonogo/ui-kit";
import { useSyncExternalStore } from "react";
import {
  dismissUplinkBanner,
  getUplinkBanners,
  subscribeUplinkBanners,
} from "./uplinkBannerStore";

const ACCENT: Record<UplinkBannerSeverity, string> = {
  info: "var(--color-info-mark)",
  warning: "var(--color-warn-mark)",
  critical: "var(--color-nogo-mark)",
};

/**
 * One pill in the banner stack for each banner an Uplink has raised and the
 * operator has not dismissed, labelled with the Uplink's name, on the main
 * screen and on a station alike. A critical banner is announced as an alert,
 * the others politely. A banner's action is shown as a button and its dismissal
 * as a text control.
 */
export function UplinkBanners() {
  const banners = useSyncExternalStore(
    subscribeUplinkBanners,
    getUplinkBanners,
  );
  return (
    <>
      {banners.map(({ key, uplinkName, banner }) => (
        <BannerPill
          key={key}
          accent={ACCENT[banner.severity]}
          role={banner.severity === "critical" ? "alert" : "status"}
          interactive
          actions={
            <>
              {banner.action && (
                <Button size="sm" onClick={banner.action.onAction}>
                  {banner.action.label}
                </Button>
              )}
              <TextButton
                type="button"
                aria-label={`Dismiss ${uplinkName} banner`}
                onClick={() => dismissUplinkBanner(key)}
              >
                Dismiss
              </TextButton>
            </>
          }
        >
          <strong>{uplinkName}</strong>
          <span>{banner.text}</span>
        </BannerPill>
      ))}
    </>
  );
}
