/**
 * Controls whose change of face moves something else in their widget today, so
 * the face gate can hold the rest of the tree from the day it lands.
 *
 * Shrink-only: an entry is a (widget, control) known to report, with what a run
 * measured. A run that finds it no longer reporting says to delete it. Adding an
 * entry means a control got worse, so it goes through the same review as the
 * bug it records.
 *
 * Key: `<widgetId>|<tag> "<accessible name>"`.
 */
export const FACE_DEBT: Readonly<Record<string, string>> = {
  'action-group|button "Rename Chutes"':
    'face "press 1": div "ON" resized 0.0, -8.0px',
  'action-group|summary "1 warning. Panel status and controls"':
    'face "press 1": div "Paused" moved -99.4, 12.0px and resized 99.4, 18.0px',
  'administration-building|button "Active"':
    'face "press 1": div "No active strategies" resized 0.0, -150.2px',
  'administration-building|button "Available"':
    'face "press 1": div "No strategies available right now" resized 0.0, -138.0px',
  'administration-building|button "Eligibility unknown"':
    'face "press 1": div "unknown: another mod changes how strateg" resized 0.0, 101.2px',
  'administration-building|button "Fundraising Campaign"':
    'face "press 1": div "7.3 reputation" moved 0.0, 27.4px (+1 more)',
  'administration-building|button "Locked"':
    'face "press 1": div "Crewed Orbit SurveySurveysRequires more " resized 0.0, -15.2px',
  'administration-building|button "Show more of Administrator Ardent"':
    'face "press 1": div "factor 100 % percentDeactivate" moved 0.0, 153.9px (+1 more)',
  'administration-building|button "Show more of High Altitude Survey"':
    'face "press 1": div "factor 100 % percentDeactivate" moved 0.0, 369.4px (+2 more)',
  'administration-building|button "Show more of Upper Atmosphere Survey"':
    'face "press 1": div "factor 100 % percentDeactivate" moved 0.0, 369.4px (+3 more)',
  'administration-building|summary "Panel status and controls"':
    'face "press 1": div "3 active / 2" moved -182.0, 10.0px and resized 182.0, -10.0px',
  'astronaut-complex|button "Active"':
    'face "press 1": div "Available (2)Assigned (1)Resting (2)Dead" resized 0.0, 154.0px',
  'contract-manager|button "Active0"':
    'face "press 1": div "0 active · 0 offered · 1 recent · 2 fail" resized 0.0, -265.0px',
  'contract-manager|button "Active1"':
    'face "press 1": div "1 active · 1 offered · 0 recentPlant a f" resized 0.0, -268.8px',
  'contract-manager|button "Active2"':
    'face "press 1": div "2 active · 1 offered · 0 recentRescue Ke" resized 0.0, -195.8px',
  'contract-manager|button "Active3"':
    'face "press 1": div "3 active · 0 offered · 1 recentBuild an " resized 0.0, -109.4px',
  'contract-manager|button "Briefing"':
    'face "press 1": div "CANCEL COSTSFUNDS−10,000f fundsREP−3.0 r" moved 0.0, 132.0px (+2 more)',
  'contract-manager|button "Completed0"':
    'face "press 1": div "1 active · 1 offered · 0 recentNo contra" resized 0.0, -652.2px',
  'contract-manager|button "Completed1"':
    'face "press 1": div "0 active · 0 offered · 1 recent · 2 fail" resized 0.0, -223.6px',
  'contract-manager|button "Failed0"':
    'face "press 1": div "1 active · 1 offered · 0 recentNo contra" resized 0.0, -652.2px',
  'contract-manager|button "Failed2"':
    'face "press 1": div "0 active · 0 offered · 1 recent · 2 fail" resized 0.0, -109.4px',
  'contract-manager|button "Offered0"':
    'face "press 1": div "0 active · 0 offered · 1 recent · 2 fail" resized 0.0, -265.0px',
  'contract-manager|button "Offered1"':
    'face "press 1": div "1 active · 1 offered · 0 recentSurvey th" resized 0.0, -451.4px',
  'crew-status|button "Bob Kerman lamp"':
    'face "sent": div "Bob Kerman" resized -10.0, 0.0px (+1 more)',
  'experiments|button "Deploy"':
    'face "no reply": span.fMSYLu moved 12.8, 0.0px',
  'launch-director|button "Alpha Lifter14 parts · 6.4 t tonnes9,800"':
    'face "answered": div "KSC RunwayRunwayOccupancy unreported" moved 0.0, -72.6px (+1 more)',
  'launch-director|button "Fly vessel ▾"':
    'face "answered": div "KSC Launch PadPadClearCraft · 4/4 readyL" moved 0.0, 127.0px',
  'launch-director|button "Kerbin Relay A9 parts · 2.1 t tonnes6,20"':
    'face "answered": div "Alpha Lifter14 parts · 6.4 t tonnes9,800" moved 0.0, -84.0px (+2 more)',
  'launch-director|button "KSC Launch PadPadClear"':
    'face "answered": div "Craft · 4/4 readyLFV-2 Wave31 parts · 17" resized 0.0, -116.6px (+5 more)',
  'launch-director|button "KSC RunwayRunwayOccupancy unreported"':
    'face "answered": div "KSC Launch PadPadClear" resized 0.0, -419.6px',
  'launch-director|button "LFV-2 Wave Probe22 parts · 11.8 t tonnes"':
    'face "answered": div "KSC RunwayRunwayOccupancy unreported" moved 0.0, -72.6px',
  'launch-director|button "LFV-2 Wave31 parts · 17.5 t tonnes · lau"':
    'face "answered": div "Alpha Lifter14 parts · 6.4 t tonnes9,800" moved 0.0, -84.0px (+2 more)',
  'launch-director|button "WoomerangPad · ModdedOccupancy unreporte"':
    'face "answered": div "KSC Launch PadPadClear" resized 0.0, -419.6px',
  'maneuver-planner|button "Add Node When..."':
    'face "press 1": div "Add node" moved 0.0, 189.0px',
  'maneuver-planner|button "Add node"':
    'face "answered": div "Adding..." moved -7.0, 0.0px and resized 7.0, 0.0px',
  'maneuver-planner|button "Delete node"':
    'face "no reply": div "Add Node When...Add node" moved 0.0, 58.0px',
  'maneuver-planner|button "Edit node"':
    'face "press 1": div "Burn windowslasts 45sIgnition20s agoY1 D" moved 0.0, 400.0px',
  'navball|button "Arm FBW"':
    'face "answered": span "Stick inputs live" moved 14.0, 0.0px and resized 7.0, 0.0px',
  'navball|button "FBW ARMED"':
    'face "answered": span "Stick inputs off" moved -14.0, 0.0px and resized -7.0, 0.0px',
  'navball|button "SAS Mode"':
    'face "press 1": div "Fly-by-wireArm FBWStick inputs off" moved 0.0, 116.0px',
  'navball|button "Throttle controls"':
    'face "press 1": div "Fly-by-wireArm FBWStick inputs off" moved 0.0, 68.0px',
  'robotics-console|button "Decrease target"':
    'face "answered": span "55° degrees" moved -47.0, 23.5px (+3 more)',
  'robotics-console|button "Deploy Pistonpiston · 0.85 m metres, OFF"':
    'face "press 1": span "0.85 m metres, OFFLINE, as of Y1 D1 00:0" resized 20.0, 0.0px (+12 more)',
  'robotics-console|button "Deploy Pistonpiston · 0.85 m metres/0.85"':
    'face "press 1": span "0.85 m metres" resized 20.0, 0.0px (+9 more)',
  'robotics-console|button "Increase target"':
    'face "answered": button "Decrease target" moved -47.0, 21.0px (+3 more)',
  'rotor-tachometer|button "Decrease RPM cap"':
    'face "answered": button "Increase RPM cap" moved 62.0, 1.0px (+4 more)',
  'rotor-tachometer|button "Decrease Torque limit"':
    'face "answered": div "RPM cap" moved 0.0, 1.0px (+4 more)',
  'rotor-tachometer|button "Increase RPM cap"':
    'face "answered": button "Decrease RPM cap" moved 0.0, 1.0px (+4 more)',
  'rotor-tachometer|button "Increase Torque limit"':
    'face "refused": div "Torque limit" resized 68.0, 0.0px',
  'rotor-tachometer|button "Tail Rotor0, OFFLINE, as of Y1 D1 00:00:"':
    'face "press 1": button "Motor off, OFFLINE, as of Y1 D1 00:00:00" resized 6.0, 0.0px (+7 more)',
  'rotor-tachometer|button "Tail Rotor0/120 rpm revolutions per minu"':
    'face "press 1": button "Brake on" resized -6.0, 0.0px (+1 more)',
  'science-data|button "Aboard"':
    'face "press 1": div "Mun · Landed0 recordsSearchScience aboar" resized 0.0, -153.0px',
  'science-data|button "Archive"':
    'face "press 1": div "No R&D archive in this save, Sandbox mod" resized 0.0, -278.0px',
  'science-data|summary "2 info. Panel status and controls"':
    'face "press 1": div "RECORDED" moved -133.2, 12.0px and resized 133.2, 18.0px',
  'science-data|summary "2 warning. Panel status and controls"':
    'face "press 1": div "BLACKOUT" moved -133.2, 12.0px and resized 133.2, 18.0px',
  'space-center-status|button "Upgrade"':
    'face "no reply": span "25kf funds" moved 0.0, 7.0px',
  'target-picker|button "▸Bodies (3)"':
    'face "press 1": div "▸Parts (5)Target Docking Port 1Orbiting\u2014" moved 0.0, -70.0px',
  'target-picker|button "▸Vessels (3)"':
    'face "press 1": div "▸Parts (5)Target Docking Port 1Orbiting\u2014" moved 0.0, -109.0px',
  'target-picker|button "Asteroids: hidden (1)"':
    'face "press 1": button "Comsat Relay 4Probe · Orbiting\u2014, Last he" moved 0.0, 36.0px (+1 more)',
  'target-picker|button "Clamp-O-Tron Sr. (aft)Orbiting168.2 km k"':
    'face "answered": span "168.2 km kilometres" moved -20.0, 0.0px',
  'target-picker|button "Clamp-O-Tron Sr. (fore)Orbiting168.2 km "':
    'face "answered": span "168.2 km kilometres" moved -20.0, 0.0px',
  'target-picker|button "Comsat Relay 4Probe · Orbiting950.3 km k"':
    'face "answered": span "950.3 km kilometres, OFFLINE, as of Y1 D" moved -20.0, 0.0px',
  'target-picker|button "Kerbin720.0 km kilometres, OFFLINE, as o"':
    'face "answered": span "720.0 km kilometres, OFFLINE, as of Y1 D" moved -20.0, 0.0px',
  'target-picker|button "Kerbin720.0 km kilometres"':
    'face "answered": span "720.0 km kilometres" moved -20.0, 0.0px',
  'target-picker|button "Mun11.9 Mm megametres, OFFLINE, as of Y1"':
    'face "answered": span "11.9 Mm megametres, OFFLINE, as of Y1 D1" moved -20.0, 0.0px',
  'target-picker|button "Mun11.9 Mm megametres"':
    'face "answered": span "11.9 Mm megametres" moved -20.0, 0.0px',
  'target-picker|button "Munar Transfer StageShip · Escaping1.6 M"':
    'face "answered": span "1.6 Mm megametres" moved -20.0, 0.0px',
  'target-picker|button "Target Docking Port 1Orbiting\u2014"':
    'face "answered": span "Target Docking Port 1Orbiting" resized -20.0, 0.0px',
  'target-picker|button "Target Docking Port 2Orbiting\u2014"':
    'face "answered": span "Target Docking Port 2Orbiting" resized -20.0, 0.0px',
  'tracking-station|button "Reset view"':
    'face "press 1": button "Focus vessel" moved 104.0, 0.0px',
  'tracking-station|g "Minmus"':
    'face "press 1": aside "Minmusorbiting KerbinRadius60.0 km kilom" resized 0.0, 45.0px (+6 more)',
  'tracking-station|g "Mun"':
    'face "press 1": aside "Munorbiting KerbinRadius200.0 km kilomet" resized 0.0, 45.0px (+4 more)',
  'transfer-window|button "in 3.4 y\u2014259 d"':
    'face "answered": div "Current phaseFAR-110.0° degrees / ideal " moved 0.0, -4.0px and resized -1.9, 8.0px (+19 more)',
  'transfer-window|button "in 4.3 y\u2014259 d"':
    'face "answered": div "Current phaseIDEAL44.3° degrees / ideal " resized -5.8, 0.0px (+14 more)',
  'transfer-window|button "in 5.5 y\u2014259 d"':
    'face "answered": div "Current phaseFAR-110.0° degrees / ideal " moved 0.0, -4.0px and resized -1.9, 8.0px (+19 more)',
  'transfer-window|button "in 6.4 y\u2014259 d"':
    'face "answered": div "Current phaseIDEAL44.3° degrees / ideal " resized -5.8, 0.0px (+14 more)',
  'transfer-window|button "in 780 d\u2014259 d"':
    'face "answered": div "Current phaseIDEAL44.3° degrees / ideal " resized -3.9, 0.0px (+14 more)',
  'transfer-window|button "Jupiter"':
    'face "answered": div "Current phaseFAR0.0° degrees / ideal 97." resized -5.8, 0.0px (+38 more)',
  'transfer-window|button "Venus"':
    'face "answered": div "Current phaseFAR0.0° degrees / ideal -54" moved 0.0, 4.0px and resized -3.9, -8.0px (+23 more)',
  'warp-control|button "Pause game"':
    'face "sent": span "PAUSED" moved -6.5, 0.0px and resized 13.0, 0.0px',
  'warp-control|button "Resume game"':
    'face "sent": div "1×" moved 4.5, 2.0px and resized -9.1, -21.0px (+1 more)',
  'warp-control|button "Warp to"':
    'face "press 1": div "No active save" moved 0.0, 121.5px',
};

/** Findings are `<widgetId> @ <mode> (<scene>): <control> face "<face>": <what moved>`. */
const FINDING = /^(\S+) @ .+? \(.+?\): (.+?) face "/;

/** The debt key a finding falls under, or undefined for a line that is not a face finding. */
export function faceDebtKey(finding: string): string | undefined {
  const head = FINDING.exec(finding);
  return head ? `${head[1]}|${head[2]}` : undefined;
}

/**
 * Separates the findings known debt covers from those it does not, and names
 * the entries that reported nothing. An entry is only judged when its widget was
 * checked in this run, since a scoped run says nothing about the rest.
 */
export function settleFaceDebt(
  findings: readonly string[],
  checkedWidgets: ReadonlySet<string>,
  debt: Readonly<Record<string, string>> = FACE_DEBT,
): { covered: number; reported: string[]; stale: string[] } {
  const used = new Set<string>();
  const reported: string[] = [];
  let covered = 0;
  for (const line of findings) {
    const key = faceDebtKey(line);
    if (key !== undefined && key in debt) {
      used.add(key);
      covered++;
    } else {
      reported.push(line);
    }
  }
  const stale = Object.keys(debt).filter(
    (key) => checkedWidgets.has(key.split("|")[0]) && !used.has(key),
  );
  return { covered, reported, stale };
}

/** A reason whose moved element is named by what it reads: `face "sent": div "Mode" moved`. */
const NAMED_ELEMENT = /^face "[^"]*": \S+ "/;

/**
 * The debt entries a run would need to cover every finding, one per control,
 * each with the first measured reason, as lines to paste into {@link FACE_DEBT}.
 */
export function seedFaceDebt(findings: readonly string[]): string[] {
  const reasons = new Map<string, string>();
  for (const line of findings) {
    const key = faceDebtKey(line);
    if (key === undefined) continue;
    const reason = line.slice(line.indexOf(' face "') + 1);
    const previous = reasons.get(key);
    // Prefer a reason that names the element by what it reads, over one that only has a tag.
    if (
      previous === undefined ||
      (!NAMED_ELEMENT.test(previous) && NAMED_ELEMENT.test(reason))
    ) {
      reasons.set(key, reason);
    }
  }
  return [...reasons.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([key, reason]) => `  ${JSON.stringify(key)}: ${JSON.stringify(reason)},`,
    );
}
