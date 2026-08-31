using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Xunit;

namespace GonogoRp1Uplink.Tests
{
    /// <summary>
    /// Opens the INSTALLED RP-1 plugin assemblies from the directory the BUILD
    /// found, so the binary that ran cannot disagree with the build that decided
    /// the check was possible.
    /// </summary>
    /// <remarks>
    /// The directory arrives as an assembly-metadata attribute the csproj writes
    /// when it has located RP0.dll (see the <c>Rp1Plugins</c> gate there). When it
    /// has not, this whole file is left out of the compilation and a build warning
    /// says so, so reaching this constructor at all means the file was there when
    /// the build looked. If it has gone since, that is a failure rather than a
    /// soft degrade: the run was built to check something and now cannot.
    /// </remarks>
    public sealed class Rp1InstallFixture : IDisposable
    {
        public InstalledAssembly Rp0 { get; }

        /// <summary>
        /// ROUtils ships beside RP-1 and owns two of the shapes the walk reads.
        /// Absent costs five targets, and says so, rather than costing the run.
        /// </summary>
        public InstalledAssembly? RoUtils { get; }

        public Rp1InstallFixture()
        {
            var plugins = typeof(Rp1InstallFixture).Assembly
                .GetCustomAttributes(typeof(AssemblyMetadataAttribute), inherit: false)
                .Cast<AssemblyMetadataAttribute>()
                .FirstOrDefault(a => a.Key == "Rp1Plugins")?.Value;

            if (string.IsNullOrEmpty(plugins))
            {
                throw new InvalidOperationException(
                    "RP-1 COMPATIBILITY NOT VERIFIED: this assembly was compiled with the installed-RP-1 guard but "
                    + "without the Rp1Plugins path baked in, so it cannot find the binary it is meant to check.");
            }

            var rp0Path = Path.Combine(plugins, "RP0.dll");
            if (!File.Exists(rp0Path))
            {
                throw new FileNotFoundException(
                    "RP-1 COMPATIBILITY NOT VERIFIED: the build located RP0.dll at " + rp0Path
                    + " and it is no longer there, so nothing about RP-1 compatibility was checked.", rp0Path);
            }

            Rp0 = new InstalledAssembly(rp0Path);

            var gameData = Directory.GetParent(plugins)?.Parent?.FullName;
            var roUtilsPath = gameData == null
                ? null
                : Path.Combine(gameData, "ROUtils", "Plugins", "ROUtils.dll");
            if (roUtilsPath != null && File.Exists(roUtilsPath))
            {
                RoUtils = new InstalledAssembly(roUtilsPath);
            }
        }

        public void Dispose()
        {
            Rp0.Dispose();
            RoUtils?.Dispose();
        }
    }

    /// <summary>
    /// The RP-1 Uplink integrates with RP-1 ENTIRELY BY REFLECTION, private fields
    /// included, so nothing in the compiler and nothing else in this suite can
    /// notice a future RP-1 release renaming or reshaping what the walk reads.
    /// This is the check that can: it opens the INSTALLED RP0.dll and holds every
    /// target in <see cref="Rp1ReflectionTargets"/> against it.
    /// </summary>
    /// <remarks>
    /// <para><b>Why <c>Rp0Fixture</c> cannot do this job.</b> That stand-in is
    /// declared in RP-1's namespaces with RP-1's member names, taken from a
    /// disassembly, and its own header says the limitation out loud: a rename on
    /// RP-1's side makes those tests wrong in the same direction it makes
    /// production wrong. Rename <c>confidence</c> and production stops resolving
    /// it while the stand-in goes on carrying the old name, so every test stays
    /// green. It is a self-consistency check. This is the compatibility check.</para>
    ///
    /// <para><b>What this CANNOT do, in the same plain voice.</b> It proves the
    /// members exist, that they are the kind the walk resolves (a readable
    /// property or a field, instance or static as the walk assumes), and that
    /// their declared types are ones the reader accepts. It proves nothing
    /// whatever about a RUNNING RP-1. It cannot tell you that <c>Instance</c> is
    /// non-null in any scene, that a member still holds the quantity its name
    /// suggests, that <c>PredictWeightedEfficiency</c> returns an efficiency
    /// rather than the interval its early-out returns, that a private collection
    /// still contains the things the walk expects to find in it, or that writing a
    /// confidence balance back leaves RP-1 in a state it agrees with. A member
    /// that kept its name and changed its MEANING passes this class completely,
    /// and so does a member whose containing object is never populated. Those stay
    /// live-game questions, and there is no RP-1 install on this machine or the
    /// test rig to answer them.</para>
    ///
    /// <para><b>A pass here always means a binary was opened and read.</b> CI has
    /// no RP-1, and a check that passed quietly when it could not run would report
    /// compatibility it never looked at. So this file is not compiled at all
    /// unless the build located RP0.dll, and the csproj emits a build warning
    /// naming what went unchecked when it did not. A warning prints at normal
    /// verbosity and surfaces as a CI annotation; a passing test's console output
    /// does not, which is why the loud half is in the csproj rather than here.</para>
    /// </remarks>
    public class Rp1InstalledCompatibilityTests : IClassFixture<Rp1InstallFixture>
    {
        private static readonly string[] NumericTypes =
        {
            "System.Double", "System.Single", "System.Int32", "System.Int64",
        };

        private readonly Rp1InstallFixture _install;

        public Rp1InstalledCompatibilityTests(Rp1InstallFixture install) => _install = install;

        [Fact]
        public void Every_RP1_type_the_uplink_resolves_by_name_is_present_in_the_installed_assemblies()
        {
            var failures = new List<string>();
            foreach (var target in Rp1ReflectionTargets.Types)
            {
                var assembly = AssemblyFor(target.Assembly);
                if (assembly == null)
                {
                    failures.Add(Missing(target.Assembly, target.Type, target.CallSite));
                    continue;
                }
                if (!assembly.HasType(target.Type))
                {
                    failures.Add(
                        target.Type + " does not exist in " + assembly.Identity + ". " + target.CallSite
                        + " resolves it by full name, and a miss there takes the whole reading to unavailable"
                        + " rather than to a wrong number.");
                }
            }

            AssertNone(failures, "types");
        }

        [Fact]
        public void Every_member_the_uplink_reads_is_present_and_the_shape_the_walk_assumes()
        {
            var failures = new List<string>();
            foreach (var target in Rp1ReflectionTargets.Members)
            {
                var assembly = AssemblyFor(target.Assembly);
                if (assembly == null)
                {
                    failures.Add(Missing(target.Assembly, target.Type + "." + target.Member, target.CallSite));
                    continue;
                }

                var facts = assembly.FindMember(target.Type, target.Member);
                if (facts == null)
                {
                    failures.Add(
                        target.Type + "." + target.Member + " is not a readable field or property in "
                        + assembly.Identity + " (read by " + target.CallSite + ")");
                    continue;
                }

                if (facts.IsStatic != target.Static)
                {
                    // Rp1Types.Member binds instance members only and
                    // Rp1Types.StaticValue binds static ones only, so this is not
                    // a stylistic difference: one of the two reads stops finding
                    // anything at all.
                    failures.Add(
                        target.Type + "." + target.Member + " is now "
                        + (facts.IsStatic ? "STATIC" : "an INSTANCE member")
                        + " and " + target.CallSite + " reads it as "
                        + (target.Static ? "a static" : "an instance member"));
                    continue;
                }

                var mismatch = Incompatible(target.Reader, facts, assembly);
                if (mismatch != null)
                {
                    failures.Add(
                        target.Type + "." + target.Member + " " + mismatch + " (read by " + target.CallSite + ")");
                }
            }

            AssertNone(failures, "members");
        }

        [Fact]
        public void Every_constructor_the_uplink_invokes_is_present_with_the_arity_it_matches_on()
        {
            var failures = new List<string>();
            foreach (var target in Rp1ReflectionTargets.Constructors)
            {
                var assembly = AssemblyFor(target.Assembly);
                if (assembly == null)
                {
                    failures.Add(Missing(target.Assembly, target.Type + "..ctor", target.CallSite));
                    continue;
                }

                var overloads = assembly.FindMethods(target.Type, ".ctor");
                var match = overloads.FirstOrDefault(m =>
                    m.ParameterTypes.Length == target.Arity
                    && m.IsPublic
                    && (target.FirstParameterType == null
                        || (m.ParameterTypes.Length > 0 && m.ParameterTypes[0] == target.FirstParameterType)));

                if (match == null)
                {
                    var shape = target.Arity + " parameter(s)"
                        + (target.FirstParameterType == null ? "" : ", the first a " + target.FirstParameterType);
                    failures.Add(
                        target.Type + " has no public constructor taking " + shape
                        + ", which is how " + target.CallSite + " finds it. Present instead: "
                        + string.Join(" | ", overloads.Select(Describe)));
                }
            }

            AssertNone(failures, "constructors");
        }

        [Fact]
        public void Every_method_the_uplink_invokes_is_present_with_the_arity_it_matches_on()
        {
            var failures = new List<string>();
            foreach (var target in Rp1ReflectionTargets.Methods)
            {
                var assembly = AssemblyFor(target.Assembly);
                if (assembly == null)
                {
                    failures.Add(Missing(target.Assembly, target.Type + "." + target.Method, target.CallSite));
                    continue;
                }

                var overloads = assembly.FindMethods(target.Type, target.Method);
                if (overloads.Count == 0)
                {
                    failures.Add(
                        target.Type + "." + target.Method + " does not exist in " + assembly.Identity
                        + " (invoked by " + target.CallSite + ")");
                    continue;
                }

                // Production matches on name and arity rather than on parameter
                // types, because naming RP-1's own types would need the
                // compile-time reference this Uplink deliberately does not take.
                // So this is the same match, and it has to be the right
                // accessibility and the right staticness because that is what the
                // BindingFlags ask for. Accessibility is the target's rather than
                // a constant: a member the Uplink reaches with a NON-public lookup
                // would not be found by a public-only check, and the miss would
                // read as a missing overload of a member that is perfectly
                // present.
                var match = overloads.FirstOrDefault(m =>
                    m.ParameterTypes.Length == target.Arity
                    && m.IsStatic == target.Static
                    && m.IsPublic == target.Public);

                if (match == null)
                {
                    failures.Add(
                        target.Type + "." + target.Method + " has no " + (target.Public ? "public " : "non-public ")
                        + (target.Static ? "static" : "instance") + " overload taking " + target.Arity
                        + " parameter(s), which is how " + target.CallSite + " finds it. Present instead: "
                        + string.Join(" | ", overloads.Select(Describe)));
                }
            }

            AssertNone(failures, "methods");
        }

        [Fact]
        public void Every_enum_member_the_uplink_names_to_Enum_Parse_is_present()
        {
            var failures = new List<string>();
            foreach (var target in Rp1ReflectionTargets.EnumMembers)
            {
                var assembly = AssemblyFor(target.Assembly);
                if (assembly == null)
                {
                    failures.Add(Missing(target.Assembly, target.Type + "." + target.Member, target.CallSite));
                    continue;
                }

                if (assembly.IsEnum(target.Type) != true)
                {
                    failures.Add(
                        target.Type + " is no longer an enum in " + assembly.Identity + ", and " + target.CallSite
                        + " calls Enum.Parse against it");
                    continue;
                }

                // Enum.Parse throws on a missing name rather than degrading, and
                // these two names gate a command that SPENDS the career's funds,
                // so a rename here is a refusal at the moment of an operator's
                // press.
                if (assembly.FindMember(target.Type, target.Member) == null)
                {
                    failures.Add(
                        target.Type + " has no member named " + target.Member + " in " + assembly.Identity
                        + " (" + target.CallSite + " parses that name)");
                }
            }

            AssertNone(failures, "enum members");
        }

        [Fact]
        public void The_run_names_the_binary_it_checked_rather_than_only_that_it_passed()
        {
            // RP-1 stamps its release version nowhere the metadata carries: the
            // assembly calls itself 1.0.0.0 in a build the mod ships as 4.6.0.0.
            // So the digest is the only thing that says WHICH binary a green run
            // was green against, and a report that cannot say that is one a reader
            // cannot check.
            Assert.False(string.IsNullOrWhiteSpace(_install.Rp0.Digest));

            Console.Error.WriteLine(
                "RP-1 compatibility verified against " + _install.Rp0.Path + " ("
                + _install.Rp0.Identity + ", sha256:" + _install.Rp0.Digest + ")"
                + (_install.RoUtils == null
                    ? "; ROUtils.dll ABSENT, so its five targets were not checked"
                    : " and " + _install.RoUtils.Path + " (sha256:" + _install.RoUtils.Digest + ")"));
        }

        [Fact]
        public void ROUtils_is_present_too_so_the_five_targets_it_owns_are_not_silently_skipped()
        {
            // The RP0.dll half passing while these five went unchecked is exactly
            // the shape of partial verification that reads as full verification,
            // so the gap gets its own failure rather than a line in a message
            // nobody reads on a green run.
            Assert.True(
                _install.RoUtils != null,
                "ROUtils.dll was not found beside " + _install.Rp0.Path
                + ", so the curve keys and PersistentCompressedCraftNode.IsEmpty were NOT checked. RP-1 ships"
                + " ROUtils as a dependency, so an install without it is an incomplete install rather than a"
                + " configuration this guard should accept.");
        }

        private InstalledAssembly? AssemblyFor(string assemblyName) =>
            assemblyName == Rp1ReflectionTargets.RoUtils ? _install.RoUtils : _install.Rp0;

        private static string Missing(string assemblyName, string target, string callSite) =>
            assemblyName + ".dll was not found, so " + target + " was not checked at all (read by " + callSite + ")";

        private static string Describe(InstalledAssembly.MethodFacts method) =>
            (method.IsPublic ? "public " : "non-public ")
            + (method.IsStatic ? "static " : "")
            + method.Name + "(" + string.Join(", ", method.ParameterTypes) + ")";

        private static string? Incompatible(
            Rp1Reader reader, InstalledAssembly.MemberFacts facts, InstalledAssembly assembly)
        {
            switch (reader)
            {
                case Rp1Reader.Presence:
                    return null;

                case Rp1Reader.Numeric:
                    return NumericTypes.Contains(facts.TypeName)
                        ? null
                        : "is declared " + facts.TypeName
                          + ", and ToDouble accepts only Double, Single, Int32 or Int64, so the read comes back absent";

                case Rp1Reader.NumericWrite:
                    if (!NumericTypes.Contains(facts.TypeName))
                    {
                        return "is declared " + facts.TypeName
                            + ", and WriteDouble converts to a numeric width, so the write returns false and the"
                            + " withheld quantity leaks";
                    }
                    return facts.IsWritable
                        ? null
                        : "cannot be written (" + facts.Shape
                          + " with no setter), and the withholder has to put a balance back through it";

                case Rp1Reader.GuidWrite:
                    if (facts.TypeName is not ("System.Guid" or "System.String"))
                    {
                        return "is declared " + facts.TypeName
                            + ", and the value written to it is another member's Guid";
                    }
                    return facts.IsWritable
                        ? null
                        : "cannot be written (" + facts.Shape
                          + " with no setter), so a build would land at whichever complex was active";

                case Rp1Reader.Bool:
                    return facts.TypeName == "System.Boolean"
                        ? null
                        : "is declared " + facts.TypeName + ", and ReadBool answers absent for anything but Boolean";

                case Rp1Reader.Text:
                    return facts.TypeName == "System.String"
                        ? null
                        : "is declared " + facts.TypeName
                          + ", and ReadString casts to String and answers absent otherwise";

                case Rp1Reader.GuidText:
                    return facts.TypeName is "System.Guid" or "System.String"
                        ? null
                        : "is declared " + facts.TypeName + ", and ReadGuidString answers only for a Guid or a String";

                case Rp1Reader.EnumText:
                    // A type this assembly does not declare cannot be checked from
                    // here. KSP's SpaceCenterFacility is the case that matters, and
                    // reporting it as a failure would make the guard cry wolf.
                    return assembly.IsEnum(facts.TypeName) switch
                    {
                        true => null,
                        null => null,
                        _ => "is declared " + facts.TypeName
                             + ", which is not an enum, and ReadEnumName falls back to Convert.ToString on it",
                    };

                default:
                    return null;
            }
        }

        /// <summary>
        /// The research command's authored node covers every <c>[Persistent]</c>
        /// field the SHIPPED <c>ResearchProject</c> loads, and no more.
        /// </summary>
        /// <remarks>
        /// <para>This is the check the whole <c>Load(ConfigNode)</c> route was
        /// chosen for. That route's claim is that its failure mode is a CHECKLIST
        /// rather than a reading-comprehension test, and a checklist is only worth
        /// having if something reads the list off the thing being checked. It does:
        /// the field names come out of RP0.dll's metadata by attribute, so a
        /// release that adds an eighth persistent field fails here rather than
        /// silently persisting its default.</para>
        ///
        /// <para><b>A missing key does not throw at load time</b>, which is why no
        /// other test can stand in for this one.
        /// <c>ConfigNode.LoadObjectFromConfig</c> writes only the fields the node
        /// has a value for and leaves the rest alone, so an unauthored
        /// <c>workRate</c> lands on the queue at whatever the constructor set and
        /// every value assertion in <c>Rp1ResearchCommandsTests</c> agrees with
        /// it.</para>
        ///
        /// <para>The EXTRA direction is checked as well, and is not tidiness: a key
        /// this Uplink authors that RP-1 does not load is a typo in a field name,
        /// and the field it was meant for is the one silently taking its
        /// default.</para>
        ///
        /// <para>The empty-list guard is the point of it. An attribute name that
        /// stopped matching would find nothing, and a subset check against nothing
        /// passes: that is a check reporting success for a question it never
        /// asked.</para>
        /// </remarks>
        [Fact]
        public void The_authored_research_node_covers_every_persistent_field_RP1_loads()
        {
            var declared = _install.Rp0.FieldsWithAttribute("RP0.ResearchProject", "Persistent");

            Assert.True(
                declared.Count > 0,
                "No [Persistent] fields were found on RP0.ResearchProject in " + _install.Rp0.Identity
                + ". Either the type is gone or the attribute is no longer the type KSP calls Persistent; either way"
                + " this check asked nothing, and a subset test against an empty list passes for free.");

            var authored = Rp1ResearchCommands
                .Draft("techId", "Tech Name", 1, "Unavailable", 0, 0, Array.Empty<string>())
                .Values.Select(v => v.Key).ToList();

            var unauthored = declared.Where(d => !authored.Contains(d)).ToList();
            var unloaded = authored.Where(a => !declared.Contains(a)).ToList();

            Assert.True(
                unauthored.Count == 0,
                "RP0.ResearchProject in " + _install.Rp0.Identity + " loads [Persistent] fields the research"
                + " command does not author, so RP-1 would persist their DEFAULTS onto the save with no error:"
                + Environment.NewLine + "  - " + string.Join(Environment.NewLine + "  - ", unauthored));

            Assert.True(
                unloaded.Count == 0,
                "The research command authors keys RP0.ResearchProject does not load in " + _install.Rp0.Identity
                + ", which means a field name is misspelled and the field it was meant for is taking its default:"
                + Environment.NewLine + "  - " + string.Join(Environment.NewLine + "  - ", unloaded));
        }

        private static void AssertNone(List<string> failures, string kind)
        {
            Assert.True(
                failures.Count == 0,
                "The installed RP-1 no longer carries what this Uplink's reflection walk reads. "
                + failures.Count + " " + kind + " broken:" + Environment.NewLine
                + "  - " + string.Join(Environment.NewLine + "  - ", failures));
        }
    }
}
