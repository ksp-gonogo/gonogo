using System;
using System.Collections.Generic;

namespace GonogoPrincipiaUplink
{
    /// <summary>One Principia release we have vetted, keyed by its descriptor hash.</summary>
    public readonly struct PrincipiaRelease
    {
        public PrincipiaRelease(string descriptorSha256, string name, int interfaceExports)
        {
            DescriptorSha256 = descriptorSha256;
            Name = name;
            InterfaceExports = interfaceExports;
        }

        /// <summary>
        /// Lowercase hex SHA-256 of the embedded descriptor, which is byte-identical
        /// across all six builds of a release and so names the INTERFACE rather than
        /// the file.
        /// </summary>
        public string DescriptorSha256 { get; }

        /// <summary>Principia's own build stamp, as it appears in the binary.</summary>
        public string Name { get; }

        /// <summary>
        /// How many <c>principia__</c> exports the release carries. Redundant with the
        /// hash on purpose: two instruments reading different parts of the file have
        /// to agree, so a hash that matches while the export table does not is a loud
        /// failure rather than a silent pass.
        /// </summary>
        public int InterfaceExports { get; }
    }

    /// <summary>
    /// The releases whose ABI has been derived and checked, so a build can be
    /// recognised before anything calls into it.
    ///
    /// <para>Principia publishes no interface version to gate on, and its own commit
    /// title for the change that altered an export's arity was "compatibility is
    /// overrated". The descriptor hash is the substitute: a release's interface,
    /// identified without executing a byte of it.</para>
    ///
    /// <para><b>An unrecognised build is not a refusal.</b> It is readable, its hash
    /// can be recorded, and it can be vetted and added later. Collapsing "I have not
    /// seen this before" into "this is broken" would tell an operator to go looking
    /// for a fault that is not there.</para>
    /// </summary>
    public static class PrincipiaSupportedSet
    {
        /// <summary>
        /// Entries are added only once a release's layouts have actually been derived
        /// and compared against the compiled binary, never on the strength of it
        /// looking similar to the last one. The measurement for this entry covered all
        /// six shipped builds: 170 exports and 33 interchange structs derived from the
        /// descriptor alone, checked against DWARF on both Linux builds and PDB on both
        /// Windows builds.
        /// </summary>
        private static readonly PrincipiaRelease[] Known =
        {
            new PrincipiaRelease(
                "b2569d212a9fbbe5334e49ed05f08b464a4e387469231245e3f682f5c6ce11b3",
                "2026081218-Levi-Civita-0-gc6615048e8fc76722b081bb3f1f4536afcf66870",
                170),
        };

        public static IReadOnlyList<PrincipiaRelease> All => Known;

        /// <summary>The release with this descriptor hash, or null when unrecognised.</summary>
        public static PrincipiaRelease? Find(string? descriptorSha256)
        {
            if (string.IsNullOrEmpty(descriptorSha256))
            {
                return null;
            }
            foreach (var release in Known)
            {
                if (string.Equals(release.DescriptorSha256, descriptorSha256, StringComparison.OrdinalIgnoreCase))
                {
                    return release;
                }
            }
            return null;
        }
    }
}
