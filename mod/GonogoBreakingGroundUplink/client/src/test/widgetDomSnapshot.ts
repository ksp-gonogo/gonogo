/**
 * Strip styled-components hashes, testing-library auto-ids, and any
 * `sc-*` class/id attributes that change per build. Without this the
 * snapshot churns on every styled-components release / file edit.
 *
 * Copied out of `@ksp-gonogo/components`'s `src/test/widgetDomSnapshot.tsx`
 * alongside the RoboticsConsole/RotorTachometer/DeployedScience move: those
 * three widgets only ever used this one function from that file (the
 * legacy-fixture `snapshotWidgetMode`/`renderWidgetMode` machinery in the
 * original doesn't apply here, all three read the stream canonically with
 * no legacy `MockDataSource` fallback, per each widget's own snapshot test
 * doc comment), so only this function came along.
 */
export function stripVolatile(html: string): string {
  return html
    .replace(/\sclass="[^"]*\bsc-[^"]*"/g, "")
    .replace(/\sid="[^"]*\bsc-[^"]*"/g, "")
    .replace(/\sdata-testid="[^"]+"/g, "")
    .replace(/\sdata-sc[a-z-]*="[^"]*"/g, "");
}
