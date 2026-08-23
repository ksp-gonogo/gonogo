using System;
using System.Collections.Generic;
using System.IO;

namespace GonogoPrincipiaUplink
{
    /// <summary>The gate's answer, carrying what it learned rather than only a verdict.</summary>
    public readonly struct PrincipiaConformanceVerdict
    {
        private static readonly string[] NothingMissing = new string[0];

        private PrincipiaConformanceVerdict(
            PrincipiaConformance state,
            PrincipiaBinaryVariant variant,
            string? path,
            string? descriptorSha256,
            string? releaseName,
            int exportCount,
            IReadOnlyList<string> missing,
            string? reason)
        {
            State = state;
            Variant = variant;
            ActivePath = path;
            DescriptorSha256 = descriptorSha256;
            ReleaseName = releaseName;
            ExportCount = exportCount;
            Missing = missing;
            Reason = reason;
        }

        public PrincipiaConformance State { get; }
        public PrincipiaBinaryVariant Variant { get; }
        public string? ActivePath { get; }

        /// <summary>Set whenever a descriptor was read, INCLUDING for an unknown
        /// release, because recording it is how the next release gets vetted.</summary>
        public string? DescriptorSha256 { get; }

        public string? ReleaseName { get; }
        public int ExportCount { get; }
        public IReadOnlyList<string> Missing { get; }
        public string? Reason { get; }

        public bool MayProceed => State == PrincipiaConformance.Conformant;

        public static PrincipiaConformanceVerdict NotEstablished(string reason) =>
            new PrincipiaConformanceVerdict(
                PrincipiaConformance.NotEstablished, PrincipiaBinaryVariant.Unknown,
                null, null, null, 0, NothingMissing, reason);

        public static PrincipiaConformanceVerdict Refused(
            PrincipiaBinaryVariant variant, string? path, string? sha, int exportCount,
            IReadOnlyList<string>? missing, string reason) =>
            new PrincipiaConformanceVerdict(
                PrincipiaConformance.Refused, variant, path, sha, null, exportCount,
                missing ?? NothingMissing, reason);

        public static PrincipiaConformanceVerdict Unknown(
            PrincipiaBinaryVariant variant, string path, string sha, int exportCount) =>
            new PrincipiaConformanceVerdict(
                PrincipiaConformance.UnknownRelease, variant, path, sha, null, exportCount,
                NothingMissing,
                "This Principia release has not been vetted here. Its interface hash is " + sha
                    + ", which is the thing to record when adding it.");

        public static PrincipiaConformanceVerdict Conformant(
            PrincipiaBinaryVariant variant, string path, string sha, string release, int exportCount) =>
            new PrincipiaConformanceVerdict(
                PrincipiaConformance.Conformant, variant, path, sha, release, exportCount,
                NothingMissing, null);
    }

    /// <summary>
    /// Decides whether the Principia build the game loaded is one we may call into,
    /// entirely by READING it. Nothing here loads, maps or executes the binary, which
    /// is what lets it run on a player's machine before the first call.
    ///
    /// <para>The order is not arbitrary. Each step needs the previous one's answer and
    /// each is cheaper than what follows: find which build is live, read its interface
    /// hash, recognise the release, then confirm the exports. A build that fails an
    /// early step is never opened for a later one.</para>
    ///
    /// <para>The file is opened through an injected function rather than
    /// <see cref="File.OpenRead"/> so the whole gate is testable without a 270 MB
    /// fixture on disk.</para>
    /// </summary>
    public static class PrincipiaConformanceGate
    {
        /// <summary>
        /// The vetted set is DATA, and taking it as an argument is what lets every arm
        /// of this gate be exercised: the recognised and disagreeing-count arms both
        /// need a hash that matches, and a descriptor cannot be synthesised to order.
        /// </summary>
        private static PrincipiaRelease? FindIn(IReadOnlyList<PrincipiaRelease> known, string sha)
        {
            foreach (var release in known)
            {
                if (string.Equals(release.DescriptorSha256, sha, StringComparison.OrdinalIgnoreCase))
                {
                    return release;
                }
            }
            return null;
        }

        /// <summary>
        /// Run the gate over a process's mapped modules.
        ///
        /// <para><paramref name="intendedExports"/> is the set of functions the caller
        /// means to call. Passing null checks the whole <c>principia__</c> interface
        /// against the release's recorded count, which is the useful default while no
        /// caller has a narrower list: it catches a truncated or substituted build
        /// without anyone having to maintain a list of 170 names.</para>
        /// </summary>
        public static PrincipiaConformanceVerdict Check(
            IEnumerable<string>? mappedPaths,
            Func<string, Stream?> openRead,
            IEnumerable<string>? intendedExports = null,
            IReadOnlyList<PrincipiaRelease>? known = null)
        {
            if (openRead == null)
            {
                return PrincipiaConformanceVerdict.NotEstablished("No way to open the build was supplied.");
            }

            var selection = PrincipiaBinaryDiscovery.FromMappedModules(mappedPaths);
            if (!selection.Found)
            {
                return PrincipiaConformanceVerdict.NotEstablished(
                    selection.Reason ?? "No Principia native build is mapped.");
            }

            var path = selection.ActivePath!;
            Stream? stream;
            try
            {
                stream = openRead(path);
            }
            catch (Exception e)
            {
                return PrincipiaConformanceVerdict.Refused(
                    selection.ActiveVariant, path, null, 0, null,
                    "The mapped build could not be opened: " + e.Message);
            }
            if (stream == null)
            {
                return PrincipiaConformanceVerdict.Refused(
                    selection.ActiveVariant, path, null, 0, null,
                    "The mapped build could not be opened.");
            }

            using (stream)
            {
                var descriptor = PrincipiaDescriptorReader.Read(stream);
                if (!descriptor.Found)
                {
                    return PrincipiaConformanceVerdict.Refused(
                        selection.ActiveVariant, path, null, 0, null,
                        descriptor.Reason ?? "The build embeds no interface descriptor.");
                }

                var sha = descriptor.Sha256!;
                var release = FindIn(known ?? PrincipiaSupportedSet.All, sha);

                var exports = NativeExportReader.Read(stream);
                if (!exports.Found)
                {
                    return PrincipiaConformanceVerdict.Refused(
                        selection.ActiveVariant, path, sha, 0, null,
                        exports.Reason ?? "The build's exports could not be read.");
                }

                var interfaceNames = PrincipiaSymbolGate.InterfaceExports(exports);
                var exportCount = interfaceNames.Count;

                // A caller with a narrower list gets it checked by name. With no list,
                // the count cross-check below is the whole confirmation, which is why
                // the symbol gate is not asked to compare against nothing: it
                // correctly refuses an empty intent rather than passing it.
                if (intendedExports != null)
                {
                    var named = PrincipiaSymbolGate.Check(exports, intendedExports);
                    if (!named.Complete)
                    {
                        return PrincipiaConformanceVerdict.Refused(
                            selection.ActiveVariant, path, sha, exportCount, named.Missing,
                            named.Reason ?? ("This build is missing " + named.Missing.Count
                                + " of the functions the caller intends to use."));
                    }
                }

                if (release == null)
                {
                    // Unrecognised, and that is not a fault. The hash is carried out so
                    // the release can be vetted and added rather than merely rejected.
                    return PrincipiaConformanceVerdict.Unknown(
                        selection.ActiveVariant, path, sha, exportCount);
                }

                // The cross-check, and the reason a release entry records a count at
                // all. The hash and the export table are different parts of the file
                // read by different code, so a hash that matches while the count does
                // not means one of the two readings is wrong, and proceeding on the
                // strength of the other would be guessing which.
                if (exportCount != release.Value.InterfaceExports)
                {
                    return PrincipiaConformanceVerdict.Refused(
                        selection.ActiveVariant, path, sha, exportCount, null,
                        "This build's descriptor matches " + release.Value.Name
                            + ", which carries " + release.Value.InterfaceExports
                            + " exports, but " + exportCount + " were found. The two "
                            + "readings disagree, so neither is trustworthy.");
                }

                return PrincipiaConformanceVerdict.Conformant(
                    selection.ActiveVariant, path, sha, release.Value.Name, exportCount);
            }
        }

    }
}
