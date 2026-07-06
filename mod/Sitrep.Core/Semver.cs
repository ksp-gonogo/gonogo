namespace Sitrep.Core
{
    /// <summary>
    /// C# port of <c>mod/sitrep-kernel/src/version.ts</c>. Semantics MUST stay
    /// byte-for-byte identical to the TS reference — conformance is asserted
    /// by <c>Sitrep.Core.Tests</c> against the shared golden fixtures in
    /// <c>mod/golden-fixtures/version.json</c>, not by re-deriving semantics
    /// here. If you touch this file, regenerate the fixture from the TS side
    /// first (`pnpm --filter @gonogo/sitrep-kernel gen:golden-fixtures`) and
    /// re-run `dotnet test` to confirm the two still agree.
    ///
    /// Versions are plain "x.y.z" strings (no external semver dependency).
    /// Missing trailing components are treated as 0 (e.g. "1.2" == "1.2.0").
    /// </summary>
    public static class Semver
    {
        private static (int Major, int Minor, int Patch) ParseVersion(string version)
        {
            var parts = version.Split('.');
            int major = ParseComponent(parts, 0);
            int minor = ParseComponent(parts, 1);
            int patch = ParseComponent(parts, 2);
            return (major, minor, patch);
        }

        private static int ParseComponent(string[] parts, int index)
        {
            if (index >= parts.Length) return 0;
            return int.TryParse(parts[index], out var value) ? value : 0;
        }

        /// <summary>
        /// Numeric (not lexical) semver comparison.
        /// Returns &lt;0 if a&lt;b, 0 if equal, &gt;0 if a&gt;b.
        /// </summary>
        public static int CompareVersions(string a, string b)
        {
            var (aMajor, aMinor, aPatch) = ParseVersion(a);
            var (bMajor, bMinor, bPatch) = ParseVersion(b);

            if (aMajor != bMajor) return aMajor - bMajor;
            if (aMinor != bMinor) return aMinor - bMinor;
            return aPatch - bPatch;
        }

        /// <summary>
        /// Gate: does the running kernel satisfy a provider's declared minimum
        /// kernel version? Inclusive — kernelVersion == minKernelVersion passes.
        /// A null minimum is always satisfied.
        /// </summary>
        public static bool SatisfiesKernel(string kernelVersion, string? minKernelVersion)
        {
            if (minKernelVersion == null) return true;
            return CompareVersions(kernelVersion, minKernelVersion) >= 0;
        }

        /// <summary>
        /// Gate: does a provider's own version fall within a required range?
        /// min is inclusive, max is exclusive; a null max is open-ended.
        /// A null range is always satisfied. A null modVersion cannot satisfy
        /// a non-null range (nothing to verify against).
        /// </summary>
        public static bool SatisfiesModRange(string? modVersion, VersionRange? range)
        {
            if (range == null) return true;
            if (modVersion == null) return false;

            if (CompareVersions(modVersion, range.Min) < 0) return false;
            if (range.Max != null && CompareVersions(modVersion, range.Max) >= 0) return false;

            return true;
        }
    }

    /// <summary>
    /// Inclusive-min/exclusive-max version range. Mirrors the TS
    /// <c>VersionRange</c> interface in <c>version.ts</c>.
    /// </summary>
    public sealed class VersionRange
    {
        /// <summary>Inclusive lower bound.</summary>
        public string Min { get; set; } = "";

        /// <summary>Exclusive upper bound. Open-ended (any version >= min) when null.</summary>
        public string? Max { get; set; }
    }
}
