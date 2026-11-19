import { describe, expect, it } from "vitest";
import { FLIGHT_MATHS_DEBT } from "./one-home-modelling.debt";
import {
  type Finding,
  gradeAgainstDebt,
  listSources,
  printReport,
  type SourceFile,
  scanRoot,
  stripComments,
} from "./one-home-modelling.scan";
import { ratchetRepoRoot } from "./ratchetBaseRef";

/**
 * One-home report 3: flight maths.
 *
 * Orbital elements, Kepler anomalies, gravity, vis-viva, atmosphere pressure
 * and Δv are computed in the shared maths and nowhere else. This lists every
 * module outside those homes that defines such a function or writes the
 * formula inline.
 *
 * Shared homes found in the tree (a module under one of these is never listed):
 * - `mod/sitrep-sdk/src/spine/`: `kepler.ts` (anomalies, state to elements,
 *   propagation), `orbit-patches.ts`, `orbit-trajectory.ts`, `propagation.ts`,
 *   `body-derivations.ts` (escape speed from a body's gravitational
 *   parameter), and their siblings in that directory
 * - `mod/sitrep-sdk/src/maths/`: the entry a worker can import without the
 *   rest of the sdk, where it exists
 * - `mod/sitrep-sdk/src/unit-system/`: standard gravity
 * - `packages/core/src/calc/`: the app's own transfer and body maths
 *
 * Signals, any one of which lists a module:
 * - it defines a function or arrow whose name matches `NAME_PATTERNS`
 *   (elements, anomaly conversions, Kepler solves, vis-viva and orbital speed,
 *   gravity at a radius, atmosphere pressure, Δv and the rocket equation,
 *   period and apsides)
 * - it writes a gravitational-parameter formula inline: a `Math.sqrt` over an
 *   expression containing `mu` or `gravParameter`, or `Math.log` on the same
 *   line as standard gravity
 * - it carries a physical-constant literal (report 1), because a module that
 *   writes `g0` down is doing the maths
 *
 * A module that imports one of the homes still lists when it also defines the
 * function, and the line records whether it imports a home, since a module
 * that does both is the likeliest to be a second copy. Names that read a Topic
 * or format a figure (`use...`, `format...`, `render...`) are skipped, since
 * they present a value rather than compute it. Report only: a finding never
 * fails; the test fails as `BLIND` or on a broken scan.
 *
 * Scope: the shared source scope. Tests, fixtures and test-support
 * directories are skipped.
 */

const HOMES: readonly RegExp[] = [
  /^mod\/sitrep-sdk\/src\/spine\//,
  /^mod\/sitrep-sdk\/src\/maths\//,
  /^mod\/sitrep-sdk\/src\/unit-system\//,
  /^packages\/core\/src\/calc\//,
];

const NAME_PATTERNS: readonly RegExp[] = [
  /kepler/i,
  /(true|mean|eccentric|hyperbolic)anomaly/i,
  /(true|mean|ecc|eccentric)to(true|mean|ecc|eccentric)/i,
  /orbit(al)?elements|elementsfrom|stateto(elements|orbit)|(cartesian|state)toelements|elementsto/i,
  /vis_?viva|orbitalspeed|circularspeed|escapespeed|escapevelocity|speedat(radius|altitude)/i,
  /(surface|local)?gravity(at|accel|from)|gravityacceleration|gravaccel|gravitationalacceleration/i,
  /(air|atmosphere|atmospheric|static|ambient)pressure|pressureat|barometric|pressurealt/i,
  /delta_?v|\bdv(from|at|for)|tsiolkovsky|rocketequation|burnduration/i,
  /orbitalperiod|periodfrom|semimajoraxis|apsides|periapsis(from|at)/i,
];

const NOT_A_COMPUTATION =
  /^(use|format|render|describe|label|is|has|on|set|with)[A-Z_]|Component$/;

const DEFINITION =
  /(?:function\s*\*?\s+([A-Za-z_$][\w$]*)|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>))/g;

const INLINE_FORMULAS: readonly {
  readonly label: string;
  readonly pattern: RegExp;
}[] = [
  {
    label: "sqrt over mu",
    pattern: /Math\.sqrt\([^;\n]*\b(?:mu|gravParameter|mu[A-Z]\w*)\b/,
  },
  {
    label: "log with standard gravity",
    pattern:
      /Math\.log\([^\n]*\b(?:STANDARD_GRAVITY|g0|G0)\b|\b(?:STANDARD_GRAVITY|g0|G0)\b[^\n]*Math\.log\(/,
  },
];

const CONSTANT_LITERAL =
  /(?<![\d.])(?:9\.80665|101\.325|101_?325|6\.67\d*e-?11|287\.0\d*|8\.314\d*)(?![\d.])/i;

function isHome(path: string): boolean {
  return HOMES.some((re) => re.test(path));
}

function scanFlightMaths(sources: readonly SourceFile[]): Finding[] {
  const out: Finding[] = [];
  for (const file of sources) {
    if (isHome(file.path)) continue;
    const code = stripComments(file.text);
    const signals: string[] = [];

    const names = new Set<string>();
    for (const m of code.matchAll(DEFINITION)) {
      const name = m[1] ?? m[2];
      if (!name || NOT_A_COMPUTATION.test(name)) continue;
      if (NAME_PATTERNS.some((re) => re.test(name))) names.add(name);
    }
    if (names.size > 0) signals.push(`defines ${[...names].join(", ")}`);

    for (const f of INLINE_FORMULAS) {
      if (f.pattern.test(code)) signals.push(`inline: ${f.label}`);
    }
    if (CONSTANT_LITERAL.test(code)) signals.push("physical-constant literal");
    if (signals.length === 0) continue;

    const importsHome =
      /from\s+["'](?:@ksp-gonogo\/sitrep-sdk[^"']*|[^"']*\/calc\/[^"']*)["']/.test(
        file.text,
      );
    out.push({
      key: file.path,
      where: file.path,
      detail: `${signals.join("; ")} (${importsHome ? "imports the sdk or calc" : "imports no home"})`,
    });
  }
  return out;
}

const sources = listSources(scanRoot(ratchetRepoRoot()));
const report = gradeAgainstDebt(
  "one-home flight maths",
  scanFlightMaths(sources),
  FLIGHT_MATHS_DEBT,
  sources.length,
);
printReport(report);

describe("one-home report: flight maths", () => {
  it("read a believable number of source files", () => {
    expect(sources.length).toBeGreaterThan(1000);
  });

  it("finds every shared home it names", () => {
    for (const home of HOMES.filter(
      (re) => !re.test("mod/sitrep-sdk/src/maths/"),
    )) {
      expect(sources.some((s) => home.test(s.path))).toBe(true);
    }
  });

  it("carries a reason on every debt entry", () => {
    expect(report.unexplained).toEqual([]);
  });

  it("is not BLIND: sees each kind of planted second copy outside the homes", () => {
    const planted: SourceFile[] = [
      {
        path: "packages/planted/src/a.ts",
        text: "export function solveKeplerEquation(m: number, e: number) { return m + e; }",
      },
      {
        path: "packages/planted/src/b.ts",
        text: "export const speed = (mu: number, r: number) => Math.sqrt(mu / r);",
      },
      {
        path: "packages/planted/src/c.ts",
        text: "export const g = 9.80665;",
      },
      {
        path: "packages/planted/src/d.ts",
        text: "export const surfaceGravityAt = (r: number) => r;",
      },
    ];
    expect(scanFlightMaths(planted).map((f) => f.key)).toEqual(
      planted.map((p) => p.path),
    );
  });

  it("skips a module inside a home and a name that only formats", () => {
    const quiet: SourceFile[] = [
      {
        path: "mod/sitrep-sdk/src/spine/kepler.ts",
        text: "export function solveKepler() { return 1; }",
      },
      {
        path: "packages/planted/src/f.ts",
        text: "export const formatDeltaV = (v: number) => String(v);",
      },
    ];
    expect(scanFlightMaths(quiet)).toEqual([]);
  });
});
