import type { BadgeEntry } from "@ksp-gonogo/ui-kit";
import type { Rp1Avionics } from "../__generated__/contract";
import { RP1 } from "../uplink";

// ---------------------------------------------------------------------------
// RP-1's avionics verdict, in the Navball's header badge row.
//
// The Navball is the host because it is already the widget that reports whether
// the craft can be flown: it reads `vessel.state.isControllable` and
// `vessel.control.*`, and it already models NOT having control (162bd297 stopped
// it drawing an attitude nobody has). This is the one loss of control on an RP-1
// career that the stock flag cannot see.
//
// **It cannot be folded into `isControllable`, and that is why it is a badge.**
// `vessel.state.isControllable` is derived from `vessel.comms.controlState`,
// which is KSP's crew/probe/signal control LEVEL. RP-1 takes the controls with
// `InputLockManager.SetControlLock` plus a per-frame zeroing of the flight
// control state in `OnPostAutopilotUpdate`; neither touches the control level,
// so the stock flag reads TRUE throughout an avionics lock. Verified against the
// shipped RP-1 v4.6.0.0 RP0.dll, 2026-09-10. RP-1's own flight signal is one
// eight-second screen message on the transition, and nothing after it.
//
// Nothing on a stock game, nothing at the space centre, and nothing on a vessel
// RP-1 has cleared: a badge is a claim, and the normal state of a working craft
// is an empty corner.
//
// ## ONE badge, and the width is why
//
// `Panel`'s header aside collapses on a MEASURED fit (usePanelAsideSize): when
// the title and the badge row stop fitting side by side, the WHOLE aside goes
// behind a disclosure chevron, taking the widget's own SAS and RCS badges with
// it. At the Navball's default 8 columns the header holds "ATTITUDE", SAS, RCS
// and exactly one more short pill. Measured, not guessed: rendered at 8x11,
// "NO CONTROL" sits inline beside the other two, and adding a second pill
// collapsed the row and hid the alert completely.
//
// So two things this Uplink knows are deliberately NOT on the badge, and both
// are on `rp1.avionics` for a surface with room:
//
//   - the OVERAGE (`vesselMassTons` minus `supportedMassTons`), which answers
//     how much to shed
//   - `limitedByNonInterplanetary`, the second lock reason, which explains a
//     rating that is short for no visible cause
//
// Either as a second pill, or appended to the first, overflows the row. A
// detail that hides the alert it qualifies is worth less than nothing on a
// launch-safety readout, so the badge carries the verdict and the verdict only.
// ---------------------------------------------------------------------------

/**
 * The badges for one avionics reading, or `null` for none.
 *
 * Pure and exported so a test can call it against a plain payload without going
 * near the contribution registry, the same shape `CrewSurvival/badge.ts` and
 * `packages/components/src/CrewStatus/badge.ts` use.
 *
 * <para><b>Three verdicts, three different answers.</b> `Locked` is no control
 * at all; `Axial` keeps roll and loses steering, so it says so in its own words
 * rather than borrowing the locked wording, and it is a caution rather than an
 * alert because the operator still has an axis. `Unlocked` is the normal state
 * of a working craft and draws nothing.</para>
 *
 * <para><b>An unread verdict draws nothing either</b>, which is not the same
 * decision and is worth keeping separate: outside flight and the editor RP-1
 * does not evaluate the rule, so the channel is absent there, and an absence is
 * not a craft that has been cleared. Both come out as no badge, and only one of
 * them is a claim.</para>
 *
 * <para><b>Exactly one badge, never two</b>, for the width reason in this
 * file's header. The masses and the second lock reason stay on the topic.</para>
 */
export function avionicsBadges(
  avionics: Rp1Avionics | undefined,
): BadgeEntry[] | null {
  const level = avionics?.lockLevel;
  if (level !== "Locked" && level !== "Axial") return null;

  return [
    {
      id: "rp1-avionics-lock",
      label: level === "Locked" ? "No control" : "Roll only",
      tone: level === "Locked" ? "nogo" : "warn",
    },
  ];
}

RP1.registerContribution({
  id: "rp1-avionics-badge",
  contributes: "navball.badges",
  requires: "rp1",
  deps: ["rp1.avionics"],
  compute: (topics) => avionicsBadges(topics["rp1.avionics"]),
});
