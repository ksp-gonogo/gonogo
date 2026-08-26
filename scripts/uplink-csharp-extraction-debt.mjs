/**
 * Known C# extraction debt, per Uplink: how many compiler errors that Uplink's
 * plugin assembly still produces when built OUTSIDE `mod/`, against the shipped
 * `Sitrep.Contract.dll` instead of a ProjectReference to the contract source.
 *
 * Zero means the Uplink can leave: copy its two directories into a repository of
 * its own, point one `<Reference>` at the `Sitrep.Contract.dll` that
 * `GameData/Gonogo/Plugins/` already installs, and it compiles.
 *
 * ## What this counts that `UplinkIsolationTests.cs` cannot
 *
 * That gate reads REFERENCES, and it is right about them: no Uplink csproj names
 * a private assembly, and the closure of what it names contains none either. It
 * is blind to everything that arrives without being named:
 *
 *  - `mod/Directory.Build.props`, which supplies `KspManaged` to every project
 *    under `mod/` and does not travel with an extracted directory
 *  - the difference between a ProjectReference and the shipped binary. The
 *    contract source carries `#if SITREP_CODEGEN` members and two target
 *    frameworks; the DLL in GameData is one build of one of them
 *  - a PackageReference reaching the Uplink transitively through the contract
 *    project rather than through its own csproj
 *
 * ## It is a CEILING, never a floor
 *
 * Above its entry fails. Below is reported and does not fail, and is tightened
 * with `--update --only <id>`. Same rule and the same reason as
 * `uplink-extraction-debt.mjs` and `act-warning-debt.mjs`: an SDK patch release
 * is enough to move a count on a branch that touched nothing.
 *
 * ## A new Uplink starts at zero
 *
 * An Uplink with no entry here is held to zero, so anything authored from now on
 * has to be extractable from the day it lands.
 *
 * ## What is NOT counted
 *
 * An Uplink that cannot be BUILT at all is not a count. It is reported as CANNOT
 * BE EXTRACTED and fails outright, because a project MSBuild refused to evaluate
 * has no error total to grade. That is what a ProjectReference pointing outside
 * the extracted directories produces, and it is the finding, not a number.
 *
 * A third-party mod DLL missing from the reference set is neither. It is a gap in
 * the reference set rather than in the Uplink, so it is reported as NOT PROBED
 * and named, and `MISSING_REFERENCE_OK` below is what keeps it from reading as
 * coverage.
 */

export const CSHARP_EXTRACTION_DEBT = {};

/**
 * Uplinks whose third-party mod DLL is absent from the CI reference set, so the
 * probe has nothing to compile them against.
 *
 * Format: `"<uplink id>": "<the reference DLL that is missing>|<why>"`.
 *
 * An entry EXPIRES BY ITSELF, the same contract `uplink-mod-build.sh` uses for
 * its own list: the probe fails as STALE the moment the named DLL appears in the
 * reference set, so the entry has to be deleted rather than quietly outliving
 * what justified it.
 */
export const MISSING_REFERENCE_OK = {
  GonogoMechJebUplink:
    "MechJeb2/Plugins/MechJeb2.dll|MechJeb2.dll is not vendored in ksp-gonogo/ksp-managed, and this Uplink binds MuMech types at compile time rather than reflectively, so there is nothing to compile it against. Same cause and same resolutions as the exemption in scripts/uplink-mod-build.sh: vendor the DLL, or bring the Uplink onto the reflection pattern every other one follows. Either deletes both lines.",
};
