using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// The mod-side ownership guard from the uplink-types-out-of-core plan
    /// (<c>local_docs/design/2026-08-10-uplink-types-out-of-core-plan.md</c>
    /// §5a): NO Uplink-specific wire type may live in
    /// <c>mod/Sitrep.Contract/</c>, even for an in-monorepo Uplink. Mirrors
    /// the frontend's <c>packages/core/src/uplink-boundary.test.ts</c>
    /// mechanically (a registered token's distinctive pattern, scanned
    /// outside the owning Uplink's directory), scoped here to the ONE
    /// directory that must never carry a registered token at all:
    /// <c>Sitrep.Contract</c> is core, not an owning directory for anything.
    ///
    /// <para><b>Polarity, deliberately different from the frontend
    /// ratchet.</b> The frontend allowlist has a <c>permanent</c> bucket
    /// because, TODAY, a mod's wire types genuinely belong in
    /// <c>Sitrep.Contract</c> by design (see that file's own header comment
    /// on the 5 already-registered tokens). This gate's whole point is the
    /// opposite: for a token registered here,
    /// <c>Sitrep.Contract</c> should hold ZERO references to its
    /// DECLARATIONS, permanently. So there is no allowlist, no
    /// permanent/domainDebt split, just a hard "0 non-comment matches per
    /// registered token" assertion. A future re-add is a violation, not an
    /// allowlist candidate.</para>
    ///
    /// <para><b>Comment lines are exempt.</b> A relocation's own PROVENANCE
    /// record legitimately names the mod it moved out (see
    /// <c>ContractVersion.cs</c>'s Minor-history doc-comment, or
    /// <c>RtConfig.cs</c>'s "moved OUT of core into
    /// GonogoMechJebUplink.Contract" comment): historical prose, not a type
    /// declaration or a live reference. A pure text scan would flag those and
    /// force a choice between an honest changelog and a green gate; this
    /// scan strips <c>//</c>/<c>///</c>-prefixed lines before matching, so
    /// prose stays free while an actual <c>class MechJebFoo</c> or
    /// <c>typeof(MechJebFoo)</c> still fails loudly. <see cref="Sitrep.Contract"/>
    /// carries no block comments as of this writing (verified by grep), so
    /// only line comments need stripping; a future block comment would need
    /// this scan extended.</para>
    ///
    /// <para><b>MechJeb, Avionics, Kerbcast, SCANsat, and Kerbalism are
    /// registered today</b> (the pilot and the second through fifth
    /// relocations).
    /// Each of the plan's
    /// remaining relocations (see
    /// the plan doc's §6 sequencing list) registers its own
    /// token here in the same commit that moves its types out, exactly like
    /// the frontend ratchet's own token-per-Uplink shape. Naming those other
    /// mods here would itself trip THEIR frontend uplink-boundary tokens
    /// (this file lives outside every owning Uplink dir), so the plan's own
    /// document is the cross-reference, not this comment. Deliberately NOT
    /// sharing pattern
    /// data with <c>uplink-boundary.allowlist.ts</c> yet (the plan flags this
    /// as a good follow-up, "worth doing regardless of relocation scope"):
    /// two independent small pattern lists is an acceptable duplication for
    /// one token, and cross-linking them (a shared generated JSON) is real
    /// work better justified once a second or third token proves the pattern
    /// need not drift.</para>
    /// </summary>
    public class UplinkContractOwnershipTests
    {
        /// <summary>
        /// Token name -> distinctive pattern. Add a line here in the SAME
        /// commit a type moves out of <c>Sitrep.Contract</c> into that
        /// Uplink's own contract slice.
        /// </summary>
        private static readonly Dictionary<string, Regex> RelocatedModTokens = new(StringComparer.Ordinal)
        {
            ["mechjeb"] = new Regex("MechJeb", RegexOptions.IgnoreCase | RegexOptions.Compiled),
            ["avionics"] = new Regex("Avionics", RegexOptions.IgnoreCase | RegexOptions.Compiled),
            ["kerbcast"] = new Regex("Kerbcast", RegexOptions.IgnoreCase | RegexOptions.Compiled),
            // scansat is the first token here that CANNOT be a single bare mod
            // name. The three above are distinctive words; "Scan" is not (it
            // prefixes plenty of unrelated identifiers, and this repo's own
            // ratchets use SCAN_ROOTS to mean "directories to walk", the exact
            // collision packages/core/src/uplink-boundary.test.ts's scansat
            // patterns already document). So this alternation names the mod
            // itself PLUS each relocated type by full name, which is also
            // sharper about what it is guarding: a re-added
            // ScanningVesselEntry fails on its own name, not on a substring
            // that might belong to something else.
            ["scansat"] = new Regex(
                @"scansat|Scan(?:ningVesselEntry|SensorEntry|TrackColor|ScienceEntry|AnomalyEntry)",
                RegexOptions.IgnoreCase | RegexOptions.Compiled),
            // "Kerbalism" is back to being distinctive enough for a bare mod
            // name, unlike "Scan" above: no unrelated identifier in this
            // repository contains it, and every one of the fifteen relocated
            // types is prefixed with it. Note it is deliberately NOT "Kerbal":
            // that IS a colliding token in a Kerbal Space Program codebase (crew
            // members, kerbal names, KerbalX, half the domain vocabulary), so
            // the full mod name is what makes a bare pattern safe here.
            ["kerbalism"] = new Regex("Kerbalism", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        };

        [Fact]
        public void NoRelocatedUplinkTokenAppearsInSitrepContractOutsideAComment()
        {
            var contractDir = ResolveSitrepContractSourceDir();
            var violations = new List<string>();

            foreach (var file in Directory.EnumerateFiles(contractDir, "*.cs", SearchOption.TopDirectoryOnly))
            {
                var fileName = Path.GetFileName(file);
                var lines = File.ReadAllLines(file);
                for (var i = 0; i < lines.Length; i++)
                {
                    var line = lines[i];
                    var trimmed = line.TrimStart();
                    if (trimmed.StartsWith("//", StringComparison.Ordinal))
                    {
                        continue; // line comment (including /// doc comments): provenance/prose is fine.
                    }

                    foreach (var (token, pattern) in RelocatedModTokens)
                    {
                        if (pattern.IsMatch(line))
                        {
                            violations.Add($"{fileName}:{i + 1}: \"{token}\" -- {line.Trim()}");
                        }
                    }
                }
            }

            Assert.True(
                violations.Count == 0,
                "Sitrep.Contract carries a reference to a relocated Uplink token outside a comment. " +
                "Every Uplink registered in RelocatedModTokens above must have ZERO non-comment " +
                "presence in Sitrep.Contract: its wire types live in its OWN contract slice " +
                "(<Uplink>.Contract), never here. Move the code, or if this really is provenance " +
                "prose, put it on a // or /// comment line:\n  " +
                string.Join("\n  ", violations));
        }

        /// <summary>
        /// Walks up from the test assembly to find the checked-out
        /// <c>mod/Sitrep.Contract/</c> directory, same pattern as
        /// <c>ContractShapeGateTests.ResolveLedgerSourcePath</c> /
        /// <c>UnitCoverageTests.ResolveBaselineSourcePath</c>.
        /// </summary>
        private static string ResolveSitrepContractSourceDir()
        {
            var directory = new DirectoryInfo(AppContext.BaseDirectory);
            while (directory is not null)
            {
                var candidate = Path.Combine(directory.FullName, "mod", "Sitrep.Contract");
                if (Directory.Exists(candidate))
                {
                    return candidate;
                }

                directory = directory.Parent;
            }

            throw new InvalidOperationException(
                "Could not locate mod/Sitrep.Contract walking up from " + AppContext.BaseDirectory);
        }
    }
}
