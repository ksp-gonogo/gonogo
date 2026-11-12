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
  'crew-status|button "Bob Kerman lamp"':
    'face "sent": div "Bob Kerman" resized -10.0, 0.0px (+1 more)',
  'experiments|button "Deploy"':
    'face "no reply": span.fMSYLu moved 12.8, 0.0px',
  'maneuver-planner|button "Add node"':
    'face "answered": div "Adding..." moved -7.0, 0.0px and resized 7.0, 0.0px',
  'maneuver-planner|button "Delete node"':
    'face "no reply": div "Add Node When...Add node" moved 0.0, 58.0px',
  'navball|button "Arm FBW"':
    'face "answered": span "Stick inputs live" moved 14.0, 0.0px and resized 7.0, 0.0px',
  'navball|button "FBW ARMED"':
    'face "answered": span "Stick inputs off" moved -14.0, 0.0px and resized -7.0, 0.0px',
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
  'space-center-status|button "Upgrade"':
    'face "no reply": span "25kf funds" moved 0.0, 7.0px',
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
