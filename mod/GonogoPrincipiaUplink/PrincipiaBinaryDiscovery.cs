using System;
using System.Collections.Generic;
using System.IO;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Which of Principia's two shipped native builds a process has mapped.
    /// </summary>
    public enum PrincipiaBinaryVariant
    {
        /// <summary>Nothing was identified. The refusing answer, so a caller that
        /// forgets to check gets no binary rather than an arbitrary one.</summary>
        Unknown = 0,

        /// <summary>The baseline build, used on a CPU without FMA.</summary>
        X64 = 1,

        /// <summary>The FMA build, selected only when CPUID reports FMA.</summary>
        X64AvxFma = 2,
    }

    /// <summary>One native Principia build seen in a process's mappings.</summary>
    public readonly struct PrincipiaNativeBinary
    {
        public PrincipiaNativeBinary(PrincipiaBinaryVariant variant, string path)
        {
            Variant = variant;
            Path = path;
        }

        public PrincipiaBinaryVariant Variant { get; }

        /// <summary>The path exactly as the process reported it.</summary>
        public string Path { get; }
    }

    /// <summary>
    /// What the game has loaded, and which of it is live.
    /// </summary>
    public readonly struct PrincipiaBinarySelection
    {
        private static readonly PrincipiaNativeBinary[] NoneMapped = new PrincipiaNativeBinary[0];

        private PrincipiaBinarySelection(
            PrincipiaBinaryVariant active,
            string? activePath,
            IReadOnlyList<PrincipiaNativeBinary> mapped,
            string? reason)
        {
            ActiveVariant = active;
            ActivePath = activePath;
            Mapped = mapped;
            Reason = reason;
        }

        /// <summary>The build whose code the game is actually running.</summary>
        public PrincipiaBinaryVariant ActiveVariant { get; }

        public string? ActivePath { get; }

        /// <summary>
        /// Every native build mapped, which is routinely BOTH of them: Principia's
        /// loader maps the baseline build first to query CPUID through it, then maps
        /// the FMA build when FMA is present, and its own unload stopped taking
        /// effect in April 2026. Confirmed on a running game, where both carried an
        /// executable segment.
        /// </summary>
        public IReadOnlyList<PrincipiaNativeBinary> Mapped { get; }

        /// <summary>Why nothing was selected. Null once something was.</summary>
        public string? Reason { get; }

        public bool Found => ActiveVariant != PrincipiaBinaryVariant.Unknown;

        public static PrincipiaBinarySelection None(string reason) =>
            new PrincipiaBinarySelection(PrincipiaBinaryVariant.Unknown, null, NoneMapped, reason);

        public static PrincipiaBinarySelection Active(
            PrincipiaNativeBinary active,
            IReadOnlyList<PrincipiaNativeBinary> mapped) =>
            new PrincipiaBinarySelection(active.Variant, active.Path, mapped, null);
    }

    /// <summary>
    /// Identifies the Principia native build a process is running, from the paths
    /// that process has mapped.
    ///
    /// <para><b>Which build is live is a property of the GAME's process and must be
    /// read from it.</b> Deriving it instead by asking this machine's CPU whether it
    /// has FMA answers a different question whenever the reader is not the game
    /// host, and answers it in a way that looks like an answer. Nothing here reads
    /// CPUID.</para>
    ///
    /// <para>The rule is <b>if the FMA build is mapped at all, it is the active
    /// one</b>. That follows from the loader: the baseline build is mapped
    /// unconditionally so its own <c>GetCPUIDFeatureFlags</c> export can be called,
    /// and the FMA build is mapped only after that call reports FMA. So the FMA
    /// build's presence is itself the evidence that FMA was detected. Both stay
    /// mapped because unloading no longer takes effect.</para>
    ///
    /// <para>The mapping list is taken as an argument rather than read from a file,
    /// because every case this has to get right (both mapped, one mapped, none,
    /// managed assemblies alongside native ones) is then a test rather than a
    /// rig session.</para>
    /// </summary>
    public static class PrincipiaBinaryDiscovery
    {
        /// <summary>
        /// The directory each build ships in, under <c>GameData/Principia/&lt;os&gt;/</c>.
        /// Matched on the directory rather than the file name because both builds
        /// are called <c>principia.so</c> (or <c>.dll</c>): the name carries no
        /// variant and the parent directory is the only thing that does.
        /// </summary>
        private const string FmaDirectory = "x64_AVX_FMA";
        private const string BaselineDirectory = "x64";

        /// <summary>
        /// The native module's file name per platform. A managed assembly beside it
        /// (<c>ksp_plugin_adapter.dll</c>, or any of our own) must never be mistaken
        /// for the native build, and on Windows both end in <c>.dll</c>, so the name
        /// is checked as well as the directory.
        /// </summary>
        private static readonly string[] NativeFileNames =
        {
            "principia.so",
            "principia.dll",
            "principia.dylib",
        };

        public static PrincipiaBinarySelection FromMappedModules(IEnumerable<string>? mappedPaths)
        {
            if (mappedPaths == null)
            {
                return PrincipiaBinarySelection.None("No mapped-module list was supplied.");
            }

            var mapped = new List<PrincipiaNativeBinary>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var raw in mappedPaths)
            {
                if (string.IsNullOrWhiteSpace(raw))
                {
                    continue;
                }
                var path = raw.Trim();
                var variant = VariantOf(path);
                if (variant == PrincipiaBinaryVariant.Unknown)
                {
                    continue;
                }
                // A process maps one file as several segments, so the same path
                // arrives repeatedly and only the distinct set is interesting.
                if (seen.Add(path))
                {
                    mapped.Add(new PrincipiaNativeBinary(variant, path));
                }
            }

            if (mapped.Count == 0)
            {
                return PrincipiaBinarySelection.None(
                    "No Principia native build is mapped. Either Principia is not installed, or " +
                    "the game has not loaded it yet: the native library is mapped during " +
                    "Principia's own startup, so a read taken while the game is still booting " +
                    "sees nothing and that is not the same as absent.");
            }

            PrincipiaNativeBinary? fma = null;
            PrincipiaNativeBinary? baseline = null;
            foreach (var binary in mapped)
            {
                if (binary.Variant == PrincipiaBinaryVariant.X64AvxFma)
                {
                    fma ??= binary;
                }
                else if (binary.Variant == PrincipiaBinaryVariant.X64)
                {
                    baseline ??= binary;
                }
            }

            var active = fma ?? baseline;
            return active.HasValue
                ? PrincipiaBinarySelection.Active(active.Value, mapped)
                : PrincipiaBinarySelection.None("No Principia native build is mapped.");
        }

        private static PrincipiaBinaryVariant VariantOf(string path)
        {
            var fileName = FileNameOf(path);
            var isNative = false;
            foreach (var name in NativeFileNames)
            {
                if (string.Equals(fileName, name, StringComparison.OrdinalIgnoreCase))
                {
                    isNative = true;
                    break;
                }
            }
            if (!isNative)
            {
                return PrincipiaBinaryVariant.Unknown;
            }

            var directory = DirectoryNameOf(path);
            if (string.Equals(directory, FmaDirectory, StringComparison.OrdinalIgnoreCase))
            {
                return PrincipiaBinaryVariant.X64AvxFma;
            }
            return string.Equals(directory, BaselineDirectory, StringComparison.OrdinalIgnoreCase)
                ? PrincipiaBinaryVariant.X64
                : PrincipiaBinaryVariant.Unknown;
        }

        /// <summary>
        /// Split on both separators regardless of host: a maps file read on Linux
        /// carries forward slashes whatever this code was compiled for, and a
        /// recorded fixture from one platform is read on another.
        /// </summary>
        private static string FileNameOf(string path)
        {
            var cut = path.LastIndexOfAny(new[] { '/', '\\' });
            return cut < 0 ? path : path.Substring(cut + 1);
        }

        private static string DirectoryNameOf(string path)
        {
            var cut = path.LastIndexOfAny(new[] { '/', '\\' });
            if (cut <= 0)
            {
                return string.Empty;
            }
            var parent = path.Substring(0, cut);
            var parentCut = parent.LastIndexOfAny(new[] { '/', '\\' });
            return parentCut < 0 ? parent : parent.Substring(parentCut + 1);
        }
    }
}
