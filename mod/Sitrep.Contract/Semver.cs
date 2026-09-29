namespace Sitrep.Contract
{
    /// <summary>
    /// Version comparison and gating for the kernel's provider selection.
    /// Versions are plain <c>"x.y.z"</c> strings; a missing trailing component
    /// is 0 (<c>"1.2"</c> equals <c>"1.2.0"</c>), and a component that is not
    /// an integer also reads as 0. Pre-release and build suffixes are not
    /// understood.
    /// <internal>
    /// Semantics must stay identical to mod/sitrep-kernel/src/version.ts:
    /// Sitrep.Core.Tests asserts conformance against the shared golden fixtures
    /// in mod/golden-fixtures/version.json. If you touch this file, regenerate
    /// the fixture from the TS side first
    /// (pnpm --filter @ksp-gonogo/sitrep-kernel gen:golden-fixtures) and re-run
    /// dotnet test.
    /// </internal>
    /// </summary>
    /// <category>Host and Kernel</category>
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
        /// Numeric (not lexical) comparison of two versions.
        /// </summary>
        /// <param name="a">The first version.</param>
        /// <param name="b">The second version.</param>
        /// <returns>Less than 0 if <paramref name="a"/> is lower, 0 if equal, greater than 0 if higher.</returns>
        public static int CompareVersions(string a, string b)
        {
            var (aMajor, aMinor, aPatch) = ParseVersion(a);
            var (bMajor, bMinor, bPatch) = ParseVersion(b);

            if (aMajor != bMajor) return aMajor - bMajor;
            if (aMinor != bMinor) return aMinor - bMinor;
            return aPatch - bPatch;
        }

        /// <summary>
        /// Whether the running kernel satisfies a provider's declared minimum
        /// kernel version. Inclusive: an equal version passes. A null minimum is
        /// always satisfied.
        /// </summary>
        /// <param name="kernelVersion">The running kernel's version.</param>
        /// <param name="minKernelVersion">The provider's minimum, or null for none.</param>
        /// <returns><c>true</c> when the kernel is at or above the minimum.</returns>
        public static bool SatisfiesKernel(string kernelVersion, string? minKernelVersion)
        {
            if (minKernelVersion == null) return true;
            return CompareVersions(kernelVersion, minKernelVersion) >= 0;
        }

        /// <summary>
        /// Whether a provider's own version falls within a required range. The
        /// minimum is inclusive and the maximum exclusive; a null maximum is
        /// open-ended. A null range is always satisfied, and a null
        /// <paramref name="modVersion"/> never satisfies a non-null range.
        /// </summary>
        /// <param name="modVersion">The version to test, or null when unknown.</param>
        /// <param name="range">The required range, or null for none.</param>
        /// <returns><c>true</c> when the version is within the range.</returns>
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
    /// A version range with an inclusive minimum and an exclusive maximum, as
    /// <see cref="Semver.SatisfiesModRange"/> tests it.
    /// <internal>
    /// Mirrors the TS VersionRange interface in version.ts.
    /// </internal>
    /// </summary>
    /// <category>Host and Kernel</category>
    public sealed class VersionRange
    {
        /// <summary>Inclusive lower bound.</summary>
        public string Min { get; set; } = "";

        /// <summary>Exclusive upper bound. Open-ended (any version at or above <see cref="Min"/>) when null.</summary>
        public string? Max { get; set; }
    }
}
