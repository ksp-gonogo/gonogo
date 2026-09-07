using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// The PRODUCER-side field-parity gate: a hand-flattened producer that omits
    /// a field of the contract type it stands for.
    ///
    /// <para><b>The bug.</b> <c>vessel.maneuver</c> carried
    /// <c>inertiallyFixed</c>, <c>thrust</c>, <c>specificImpulse</c>,
    /// <c>initialMass</c> and <c>finalMass</c> as null on every Principia plan
    /// while <c>PrincipiaManeuverPlanSource</c> filled all five on every burn it
    /// mapped. Three steps, and the middle two dropped them:
    /// <c>Gonogo.KSP.KspHost.BuildManeuverNodes</c> hand-flattens the contract
    /// node into the capture dictionary and wrote ten keys, none of the five;
    /// <c>VesselViewProvider</c> maps that dictionary back to a
    /// <see cref="ManeuverNode"/> and read the same ten;
    /// <c>VesselViewProvider.ToWire</c> emitted all five and had since they
    /// reached the contract. Neither end was at fault, which is why nothing was
    /// red.</para>
    ///
    /// <para><b>Why the two existing gates are blind to it.</b>
    /// <c>scripts/wire-payload-coverage.mjs</c> asks whether every type that
    /// reaches the wire CAN be written; the type serialises fine here, the
    /// producer just omits fields. <see cref="WirePayloadCoverageTests"/> asks the
    /// same question by reflection over a DEFAULT instance, and excused the whole
    /// hand-flattened half through a <c>FlattenedByProducer</c> allowlist whose
    /// entries were human claims about what a producer does. Reflection cannot
    /// grade a claim, and two of five past failures were sitting on that list
    /// wearing reasons that were simply false.
    /// <see cref="JsonWriterFlattenerParityTests"/> asks THIS question, complete
    /// parity, but only of <c>JsonWriter</c>'s own <c>Append&lt;Type&gt;</c>
    /// helpers, which is the other half of the contract.</para>
    ///
    /// <para>So this grades the hatch rather than trusting the claim. Hand
    /// flattening into a <c>Dictionary&lt;string, object?&gt;</c> stays the
    /// sanctioned escape route (it is the only one open to an Uplink-owned type);
    /// what changes is that a producer using it is now measured against the type
    /// it stands for. <see cref="ProducerFlattenScan"/>'s doc comment has the
    /// mechanism, why it reads source rather than reflecting, and what it counts
    /// as a key.</para>
    ///
    /// <para><b>Polarity: everything IN by default, and there is no allowlist.</b>
    /// The universe is discovered from the contract assembly and the producers
    /// from the mod's sources. A producer that drops a field gets the missing
    /// line, not an entry.</para>
    /// </summary>
    public class ProducerFieldParityTests
    {
        /// <summary>
        /// Every contract type a producer could stand for: <c>[SitrepContract]</c>
        /// minus the inbound-only command-argument types.
        ///
        /// <para>An args type travels client-to-server inside the command
        /// envelope and is only ever DESERIALISED, so it has no producer and no
        /// wire shape to be missing fields from. Excluded by its
        /// <see cref="SitrepCommandAttribute"/> rather than by name, so the
        /// exclusion is a fact about the declaration and cannot widen to a
        /// hand-added type. Measured: without it, an Uplink command handler that
        /// takes its own args type and returns a result dictionary is read as a
        /// producer for the args type and fails for not re-emitting what it was
        /// handed.</para>
        /// </summary>
        private static IEnumerable<Type> GradableContractTypes() =>
            typeof(CommsDelay).Assembly.GetTypes()
                .Where(t => t.IsClass && !t.IsAbstract && !t.IsGenericTypeDefinition)
                .Where(t => t.IsDefined(typeof(SitrepContractAttribute), false))
                .Where(t => !t.IsDefined(typeof(SitrepCommandAttribute), false));

        private static readonly Lazy<IReadOnlyList<FlattenProducer>> Producers = new(() =>
            ProducerFlattenScan.Scan(
                ProducerFlattenScan.ProductionSources(ResolveModDir()),
                new HashSet<string>(GradableContractTypes().Select(t => t.Name), StringComparer.Ordinal)));

        /// <summary>
        /// The contract types this gate grades, i.e. the ones some production
        /// source demonstrably hand-flattens. Public so
        /// <see cref="WirePayloadCoverageTests"/> can take its flatten exclusions
        /// from here rather than from a written-down claim: that list shrank by
        /// exactly this set when this gate landed.
        /// </summary>
        public static IReadOnlyCollection<string> HandFlattenedTypes() =>
            new HashSet<string>(Producers.Value.Select(p => p.TypeName), StringComparer.Ordinal);

        /// <summary>
        /// One case per PRODUCER, never one per type.
        ///
        /// <para>Grading the union of a type's producers is how this gate would
        /// have missed the bug it was built for.
        /// <c>vessel.maneuver</c> had two flatteners for
        /// <see cref="ManeuverNode"/>: <c>KspHost.BuildManeuverNodes</c>, which
        /// dropped five fields, and <c>VesselViewProvider.ToWire</c>, which wrote
        /// all sixteen. A union names every field and reports clean over the
        /// producer that lost the data. Measured, by planting each half of that
        /// incident separately.</para>
        /// </summary>
        public static IEnumerable<object[]> ProducerSites() =>
            Producers.Value
                .Select(p => (p.TypeName, Owner: p.Owner ?? "", p.Method, p.File))
                .Distinct()
                .OrderBy(site => site.TypeName, StringComparer.Ordinal)
                .ThenBy(site => site.Owner, StringComparer.Ordinal)
                .ThenBy(site => site.Method, StringComparer.Ordinal)
                .Select(site => new object[] { site.TypeName, site.Owner, site.Method, site.File });

        [Theory]
        [MemberData(nameof(ProducerSites))]
        public void EveryHandFlattenedProducerNamesEveryFieldOfItsType(
            string typeName, string owner, string method, string file)
        {
            var type = GradableContractTypes().Single(t => t.Name == typeName);
            var sites = Producers.Value
                .Where(p => p.TypeName == typeName && (p.Owner ?? "") == owner && p.Method == method && p.File == file)
                .ToArray();
            Assert.NotEmpty(sites);

            var required = type
                .GetProperties(BindingFlags.Public | BindingFlags.Instance)
                .Where(p => p.CanRead)
                // The provider extension bag is omitted from the wire entirely
                // unless a provider filled it, and ReliabilityExtensionWireTests
                // pins that omission as bytes. Excluded by ATTRIBUTE, the same
                // mechanism JsonWriterFlattenerParityTests uses, so the exemption
                // cannot quietly widen to a hand-added field.
                .Where(p => p.GetCustomAttribute<ProviderExtensionBagAttribute>() == null)
                .Select(p => CamelCase(p.Name))
                .ToArray();

            // A type with nothing to check would pass this test by covering
            // nothing, and would say the same thing as a fully covered one.
            Assert.NotEmpty(required);

            var mentioned = new HashSet<string>(sites.SelectMany(site => site.Literals), StringComparer.Ordinal);
            var missing = required.Where(field => !mentioned.Contains(field)).ToArray();

            Assert.True(
                missing.Length == 0,
                $"{sites[0]} flattens {typeName}, which declares {string.Join(", ", missing)}, and the method does "
                    + $"not name {(missing.Length == 1 ? "that field" : "any of those fields")} at all. So "
                    + $"{(missing.Length == 1 ? "it is" : "they are")} in the generated TS SDK and absent from what "
                    + "this producer emits, which a subscriber reads as permanently null with nothing red anywhere. "
                    + "Add the missing line to the flattener; there is no allowlist to record it in.");
        }

        /// <summary>
        /// The producers this gate must be able to see, each named by the class
        /// and method that carries it.
        ///
        /// <para>Without this, a renamed <c>ToWire</c>, a moved provider or a
        /// tightened regex would take a whole family out of the scan and the
        /// Theory above would go green over the loss: an inventory that is
        /// discovered fails silently in exactly the direction a hand-written one
        /// does not. The pairs cover each of the three ways a subject is
        /// resolved, so an arm of <see cref="ProducerFlattenScan"/> that stopped
        /// resolving is named here rather than merely absent.</para>
        /// </summary>
        public static IEnumerable<object[]> KnownProducers() => new[]
        {
            // Received as the first parameter.
            new object[] { nameof(ManeuverNode), "KspHost", "BuildManeuverNodes" },
            new object[] { nameof(ManeuverNode), "VesselViewProvider", "ToWire" },
            new object[] { nameof(VesselOrbit), "VesselViewProvider", "ToWire" },
            new object[] { nameof(VesselLanding), "VesselViewProvider", "ToWire" },
            new object[] { nameof(PartActions), "PartActionsViewProvider", "ToWire" },
            new object[] { nameof(VesselParts), "VesselPartsViewProvider", "ToWire" },
            // Owner prefix composed with the method stem.
            new object[] { nameof(CareerEconomy), "CareerViewProvider", "BuildEconomy" },
            new object[] { nameof(PartsPower), "PartsViewProvider", "BuildPower" },
            new object[] { nameof(SystemBodies), "SystemViewProvider", "BuildSystemBodies" },
            // Owner prefix alone, the method being just `Build`.
            new object[] { nameof(FleetVesselLink), "FleetVesselLinkBuilder", "Build" },
            // Method stem alone, inside a wire-producing class.
            new object[] { nameof(ArchiveEntry), "ScienceViewProvider", "BuildArchiveEntry" },
        };

        [Theory]
        [MemberData(nameof(KnownProducers))]
        public void DiscoveryFindsTheKnownProducers(string typeName, string owner, string method)
        {
            Assert.True(
                Producers.Value.Any(p => p.TypeName == typeName && p.Owner == owner && p.Method == method),
                $"The scan no longer sees {owner}.{method} as a producer for {typeName}. Either it was renamed or "
                    + "moved (update this pair in the same commit), or ProducerFlattenScan has stopped matching a "
                    + "shape it used to, in which case a whole family of producers is going ungraded while this "
                    + "file reports green. Found for that type: "
                    + string.Join(", ", Producers.Value.Where(p => p.TypeName == typeName).Select(p => p.ToString())));
        }

        /// <summary>
        /// Guards the discovery's SIZE, so a collapse that leaves the named pairs
        /// above intact still fails. The floor is well under the real count (76
        /// types over 83 producer sites when this landed) because this asks "did
        /// discovery collapse", not "is the tree exactly this big".
        /// </summary>
        [Fact]
        public void DiscoveryReachesTheProducers()
        {
            var types = HandFlattenedTypes();
            Assert.True(
                types.Count >= 60,
                "Hand-flattened producer discovery collapsed to " + types.Count
                    + " types, so the parity Theory is covering almost nothing. Found: "
                    + string.Join(", ", types.OrderBy(n => n, StringComparer.Ordinal)));
        }

        /// <summary>
        /// The scan is regex over C#, and a regex that has stopped matching
        /// reports zero producers, which reads exactly like a tree with none.
        /// Every arm is planted here and run through the REAL
        /// <see cref="ProducerFlattenScan.Scan"/>, so a pattern that has gone
        /// quiet fails as BLIND rather than passing.
        /// </summary>
        [Fact]
        public void TheScanCanSeeAPlantedProducerOfEveryShape()
        {
            var planted = new HashSet<string>(new[] { "PlantedPayload", "PlantedEntry" }, StringComparer.Ordinal);

            // Expression-bodied, subject from the first parameter: the shape the
            // whole VesselViewProvider.ToWire family is written in, and the one a
            // block-bodies-only reader misses entirely.
            var expressionBodied = Scan(
                @"namespace P { static class Anything {
                    private static Dictionary<string, object?> ToWire(PlantedPayload p) => new Dictionary<string, object?>
                    {
                        [""alpha""] = p.Alpha,
                        [""beta""] = p.Beta,
                    };
                } }", planted);
            var first = Assert.Single(expressionBodied);
            Assert.Equal("PlantedPayload", first.TypeName);
            Assert.Contains("alpha", first.Literals);
            Assert.Contains("beta", first.Literals);

            // Block-bodied, and the two non-indexer key forms. `Add` and the
            // collection initialiser are both in the tree, and a reader that only
            // knows `["k"] =` grades a producer using them as writing nothing.
            var blockBodied = Scan(
                @"namespace P { static class Anything {
                    internal static Dictionary<string, object?> ToWire(PlantedEntry e)
                    {
                        var wire = new Dictionary<string, object?> { { ""gamma"", e.Gamma } };
                        wire.Add(""delta"", e.Delta);
                        return wire;
                    }
                } }", planted);
            Assert.Contains("gamma", Assert.Single(blockBodied).Literals);
            Assert.Contains("delta", blockBodied[0].Literals);

            // Subject from a WIRE-PRODUCING owner class rather than a parameter,
            // the way CareerViewProvider.BuildEconomy and
            // FleetVesselLinkBuilder.Build are found.
            var byOwner = Scan(
                @"namespace P { static class PlantedPayloadBuilder {
                    public static Dictionary<string, object?> Build(int id) => new Dictionary<string, object?>
                    {
                        [""alpha""] = id,
                    };
                } }", planted);
            Assert.Equal("PlantedPayload", Assert.Single(byOwner).TypeName);

            // And the condition that keeps the capture layer out: the same method
            // in a class that is NOT a wire producer claims nothing, which is what
            // stops KspHost's internal snapshot builders being graded against the
            // wire shape they deliberately differ from.
            Assert.Empty(Scan(
                @"namespace P { static class KspHost {
                    private static Dictionary<string, object?> BuildPlantedEntry(Vessel v) => new Dictionary<string, object?>
                    {
                        [""gamma""] = v.gamma,
                    };
                } }", planted));

            // A method that builds no wire dictionary is not a producer, so a
            // type whose only mention is a reader is correctly ungraded rather
            // than graded against nothing.
            Assert.Empty(Scan(
                @"namespace P { static class Anything {
                    private static PlantedPayload Read(PlantedPayload p) => p;
                } }", planted));

            // The failure the gate exists for, run end to end: a producer that
            // writes one of its type's two fields is DETECTED as missing the
            // other. A scan that can find producers but cannot tell a complete
            // one from an incomplete one would report a clean tree just as
            // loudly.
            var incomplete = Scan(
                @"namespace P { static class Anything {
                    private static Dictionary<string, object?> ToWire(PlantedPayload p) => new Dictionary<string, object?>
                    {
                        [""alpha""] = p.Alpha,
                    };
                } }", planted);
            var mentioned = new HashSet<string>(
                incomplete.SelectMany(site => site.Literals), StringComparer.Ordinal);
            Assert.Contains("alpha", mentioned);
            Assert.DoesNotContain("beta", mentioned);
        }

        /// <summary>
        /// Comments and verbatim strings are blanked before the structure is read,
        /// so a wire key quoted in a doc comment cannot vouch for a producer that
        /// does not write it. Same reasoning as the plant above: this is the half
        /// of the reader that makes a false GREEN possible rather than a false
        /// red.
        /// </summary>
        [Fact]
        public void CommentedOutKeysDoNotCountAsWritten()
        {
            var planted = new HashSet<string>(new[] { "PlantedPayload" }, StringComparer.Ordinal);
            var producers = Scan(
                @"namespace P { static class Anything {
                    /// <summary>Used to write [""beta""] as well.</summary>
                    private static Dictionary<string, object?> ToWire(PlantedPayload p) => new Dictionary<string, object?>
                    {
                        // [""beta""] = p.Beta,
                        [""alpha""] = p.Alpha,
                    };
                } }", planted);
            var site = Assert.Single(producers);
            Assert.Contains("alpha", site.Literals);
            Assert.DoesNotContain("beta", site.Literals);
        }

        private static IReadOnlyList<FlattenProducer> Scan(string source, ISet<string> types) =>
            ProducerFlattenScan.Scan(new[] { new ScannedSource("planted/Producer.cs", source) }, types);

        private static string CamelCase(string name) =>
            string.IsNullOrEmpty(name)
                ? name
                : char.ToLower(name[0], CultureInfo.InvariantCulture) + name.Substring(1);

        /// <summary>
        /// Walks up from the test assembly to the checked-out <c>mod/</c>
        /// directory, same pattern as <see cref="UplinkIsolationTests"/>.
        /// </summary>
        internal static string ResolveModDir()
        {
            var directory = new DirectoryInfo(AppContext.BaseDirectory);
            while (directory is not null)
            {
                var candidate = Path.Combine(directory.FullName, "mod", "Sitrep.Contract");
                if (Directory.Exists(candidate))
                {
                    return Path.Combine(directory.FullName, "mod");
                }

                directory = directory.Parent;
            }

            throw new InvalidOperationException(
                "Could not locate mod/ walking up from " + AppContext.BaseDirectory);
        }
    }
}
