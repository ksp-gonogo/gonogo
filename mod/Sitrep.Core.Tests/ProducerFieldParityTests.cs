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

            var missing = MissingFields(type, sites);
            var helpers = sites.SelectMany(site => site.Helpers).Distinct(StringComparer.Ordinal).ToArray();
            var writers = helpers.Length == 0
                ? "the method does not name"
                : $"neither the method nor the helpers it reaches ({string.Join(", ", helpers)}) name";

            Assert.True(
                missing.Length == 0,
                $"{sites[0]} flattens {typeName}, which declares {string.Join(", ", missing)}, and {writers} "
                    + $"{(missing.Length == 1 ? "that field" : "any of those fields")} at all. So "
                    + $"{(missing.Length == 1 ? "it is" : "they are")} in the generated TS SDK and absent from what "
                    + "this producer emits, which a subscriber reads as permanently null with nothing red anywhere. "
                    + "Add the missing line to the flattener; there is no allowlist to record it in.");
        }

        /// <summary>
        /// The field paths <paramref name="type"/> declares that nothing
        /// <paramref name="sites"/> reach names. The Theory above and the planted
        /// cases below both grade through this, so a plant proves the rule the
        /// tree is held to rather than a copy of it.
        /// </summary>
        private static string[] MissingFields(Type type, IReadOnlyCollection<FlattenProducer> sites)
        {
            var delegated = new HashSet<string>(sites.SelectMany(site => site.DelegatedTypes), StringComparer.Ordinal);
            var required = RequiredFields(type, delegated);

            // A type with nothing to check would pass this test by covering
            // nothing, and would say the same thing as a fully covered one.
            Assert.NotEmpty(required);

            var mentioned = new HashSet<string>(
                sites.SelectMany(site => site.ReachedLiterals), StringComparer.Ordinal);
            return required.Where(field => !mentioned.Contains(field.Key)).Select(field => field.Path).ToArray();
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
        /// Producers that write fields through a helper, each named with one
        /// helper the walk has to reach. Each of these reported clean before the
        /// walk existed while grading none of the fields its helper writes, so a
        /// walk that stopped following calls would put them back there with this
        /// file green.
        /// </summary>
        public static IEnumerable<object[]> KnownHelpers() => new[]
        {
            new object[] { nameof(SystemBodies), "BuildSystemBodies", "BuildBody" },
            new object[] { nameof(SystemBodies), "BuildSystemBodies", "BuildAtmosphere" },
            new object[] { nameof(SystemVessels), "BuildSystemVessels", "BuildOrbit" },
            new object[] { nameof(CareerEconomy), "BuildEconomy", "CarryUpkeep" },
            new object[] { nameof(CareerContracts), "BuildContracts", "BuildContractParameters" },
            new object[] { nameof(CareerStrategies), "BuildStrategies", "BuildStrategyList" },
            new object[] { nameof(CareerTech), "BuildTech", "BuildTechNodes" },
            // Not called by Build at all: the class-name rule.
            new object[] { nameof(FleetVesselResources), "Build", "Add" },
        };

        [Theory]
        [MemberData(nameof(KnownHelpers))]
        public void TheWalkReachesTheKnownHelpers(string typeName, string method, string helper)
        {
            var site = Assert.Single(Producers.Value, p => p.TypeName == typeName && p.Method == method);
            Assert.True(
                site.Helpers.Contains(helper),
                $"{site} no longer reaches {helper}, so the fields it writes are going ungraded. Reached: "
                    + string.Join(", ", site.Helpers));
        }

        /// <summary>
        /// The walk, planted. A field a producer names only through a helper it
        /// calls is credited, a method it never calls vouches for nothing, and a
        /// pair of helpers calling each other does not hang the scan.
        /// </summary>
        [Fact]
        public void AFieldWrittenOnlyInACalledHelperIsCounted()
        {
            var planted = new HashSet<string>(new[] { "PlantedPayload" }, StringComparer.Ordinal);
            var site = Assert.Single(Scan(
                @"namespace P { static class Anything {
                    private static Dictionary<string, object?> ToWire(PlantedPayload p)
                    {
                        var wire = new Dictionary<string, object?> { [""alpha""] = p.Alpha };
                        AddBeta(wire, p);
                        other.AddDelta(wire);
                        return wire;
                    }
                    private static void AddBeta(Dictionary<string, object?> wire, PlantedPayload p)
                    {
                        wire[""beta""] = p.Beta;
                        Anything.Again(wire, p);
                    }
                    private static void Again(Dictionary<string, object?> wire, PlantedPayload p) => AddBeta(wire, p);
                    private static void AddDelta(Dictionary<string, object?> wire) => wire[""delta""] = 1;
                    private static void Stray(Dictionary<string, object?> wire) => wire[""gamma""] = 1;
                } }", planted));

            Assert.DoesNotContain("beta", site.Literals);
            Assert.Contains("beta", site.ReachedLiterals);
            Assert.Equal(new[] { "AddBeta", "Again" }, site.Helpers);
            Assert.DoesNotContain("gamma", site.ReachedLiterals);
            // Through a receiver that is not this class, a same-named method is
            // someone else's.
            Assert.DoesNotContain("delta", site.ReachedLiterals);
        }

        /// <summary>
        /// A helper that is the producer of a DIFFERENT contract type is where
        /// the walk stops, in its own class or another. Folding its keys in would
        /// let a key it happens to share vouch for a field this producer never
        /// writes, and the type it stands for is left to its own site.
        /// </summary>
        [Fact]
        public void AHelperProducingAnotherTypeVouchesForNothingHere()
        {
            var planted = new HashSet<string>(new[] { "PlantedPayload", "PlantedEntry" }, StringComparer.Ordinal);
            var producers = Scan(
                @"namespace P {
                static class Anything {
                    private static Dictionary<string, object?> ToWire(PlantedPayload p) => new Dictionary<string, object?>
                    {
                        [""alpha""] = p.Alpha,
                        [""entry""] = ToWire(p.Entry),
                    };
                    internal static Dictionary<string, object?> ToWire(PlantedEntry e) => new Dictionary<string, object?>
                    {
                        [""beta""] = e.Beta,
                    };
                }
                static class Elsewhere {
                    private static Dictionary<string, object?> ToWire(PlantedPayload p) => new Dictionary<string, object?>
                    {
                        [""entry""] = Anything.ToWire(p.Entry),
                    };
                } }", planted);

            var local = Assert.Single(producers, p => p.TypeName == "PlantedPayload" && p.Owner == "Anything");
            Assert.DoesNotContain("beta", local.ReachedLiterals);
            Assert.Empty(local.Helpers);
            Assert.Contains("PlantedEntry", local.DelegatedTypes);

            var foreign = Assert.Single(producers, p => p.TypeName == "PlantedPayload" && p.Owner == "Elsewhere");
            Assert.DoesNotContain("beta", foreign.ReachedLiterals);
            Assert.Contains("PlantedEntry", foreign.DelegatedTypes);
        }

        /// <summary>
        /// A producer the class name speaks for owns every method of its class,
        /// called or not, because its callers drive the parts.
        /// </summary>
        [Fact]
        public void AClassNamedProducerIsCreditedWithItsSiblings()
        {
            var planted = new HashSet<string>(new[] { "PlantedPayload" }, StringComparer.Ordinal);
            var site = Assert.Single(Scan(
                @"namespace P { static class PlantedPayloadBuilder {
                    public static void Add(Dictionary<string, object?> rows, string name)
                    {
                        rows[name] = new Dictionary<string, object?> { [""beta""] = 1 };
                    }
                    public static Dictionary<string, object?> Build(Dictionary<string, object?> rows) =>
                        new Dictionary<string, object?> { [""alpha""] = rows };
                } }", planted));

            Assert.Equal("Build", site.Method);
            Assert.Contains("beta", site.ReachedLiterals);
        }

        /// <summary>
        /// The reported blindness, end to end against the REAL contract types
        /// and through the same grading the Theory uses: a <c>system.bodies</c>
        /// producer whose rows are written by a helper.
        ///
        /// <para>Before the walk and the nested descent, this gate graded
        /// <see cref="SystemBodies"/> against its one <c>bodies</c> key, and
        /// deleting <c>["initialRotation"]</c> from
        /// <c>SystemViewProvider.BuildBody</c> left it reporting
        /// <c>Passed! - Failed: 0, Passed: 98</c>.</para>
        /// </summary>
        [Fact]
        public void ARowFieldMissingFromTheHelperThatWritesItFails()
        {
            var contract = new HashSet<string>(GradableContractTypes().Select(t => t.Name), StringComparer.Ordinal);
            var rowKeys = RequiredFields(typeof(SystemBodies), new HashSet<string>())
                .Select(field => field.Key)
                .Where(key => key != "bodies")
                .Distinct(StringComparer.Ordinal)
                .ToArray();
            Assert.Contains("initialRotation", rowKeys);

            string Provider(IEnumerable<string> keys, string call) =>
                @"namespace P { static class SystemViewProvider {
                    public static object? BuildSystemBodies(KspSnapshot? snapshot)
                    {
                        var bodies = new List<object?>();
                        bodies.Add(" + call + @"(snapshot));
                        return new Dictionary<string, object?> { [""bodies""] = bodies };
                    }
                    private static Dictionary<string, object?> BuildBody(KspSnapshot? raw) => new Dictionary<string, object?>
                    {
                        " + string.Join("\n", keys.Select(key => "[\"" + key + "\"] = null,")) + @"
                    };
                } }";
            string[] Grade(string source) =>
                MissingFields(typeof(SystemBodies), Scan(source, contract).Where(p => p.TypeName == nameof(SystemBodies)).ToArray());

            // Every row field written, in the helper only: counted, clean.
            Assert.Empty(Grade(Provider(rowKeys, "BuildBody")));

            // One row field dropped from the helper: named, by its path.
            Assert.Equal(
                new[] { "bodies[].initialRotation" },
                Grade(Provider(rowKeys.Where(key => key != "initialRotation"), "BuildBody")));

            // The helper is still in the class but never called: it vouches for
            // nothing, and every row field is missing.
            var detached = Grade(Provider(rowKeys, "Somewhere.BuildBody"));
            Assert.Contains("bodies[].initialRotation", detached);
            Assert.Contains("bodies[].name", detached);
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

        /// <summary>
        /// Every field <paramref name="type"/> puts on the wire, as a dotted path
        /// for the message and the camelCase key the producer has to name.
        ///
        /// <para>Nested contract types are descended into, because a row type
        /// written by the root's helpers has no producer of its own for the
        /// scan to name: <see cref="BodyEntry"/> is filled by
        /// <c>SystemViewProvider.BuildBody</c>, and grading
        /// <see cref="SystemBodies"/> against its one <c>bodies</c> key alone let
        /// a dropped body field ship with this file green. Two kinds of nested
        /// type are not descended into. One whose producer the walk reached is
        /// graded at that producer. One <see cref="JsonWriter"/> writes as a raw
        /// object is handed over whole, so the producer spells none of its
        /// keys, and its writer is held to them by
        /// <see cref="JsonWriterFlattenerParityTests"/>.</para>
        /// </summary>
        private static IReadOnlyList<(string Path, string Key)> RequiredFields(
            Type type, ISet<string> delegated)
        {
            var fields = new List<(string Path, string Key)>();
            var descending = new HashSet<Type> { type };
            void Visit(Type current, string prefix)
            {
                foreach (var property in current
                             .GetProperties(BindingFlags.Public | BindingFlags.Instance)
                             .Where(p => p.CanRead)
                             // The provider extension bag is omitted from the wire
                             // entirely unless a provider filled it, and
                             // ReliabilityExtensionWireTests pins that omission as
                             // bytes. Excluded by ATTRIBUTE, the same mechanism
                             // JsonWriterFlattenerParityTests uses, so the exemption
                             // cannot quietly widen to a hand-added field.
                             .Where(p => p.GetCustomAttribute<ProviderExtensionBagAttribute>() == null))
                {
                    var key = CamelCase(property.Name);
                    fields.Add((prefix + key, key));
                    var many = property.PropertyType != typeof(string)
                        && typeof(System.Collections.IEnumerable).IsAssignableFrom(property.PropertyType);
                    foreach (var nested in NestedContractTypes(property.PropertyType))
                    {
                        if (delegated.Contains(nested.Name) || WrittenRawByJsonWriter(nested) || !descending.Add(nested))
                        {
                            continue;
                        }
                        Visit(nested, prefix + key + (many ? "[]." : "."));
                        descending.Remove(nested);
                    }
                }
            }

            Visit(type, "");
            return fields;
        }

        private static IEnumerable<Type> NestedContractTypes(Type type)
        {
            if (type.IsArray)
            {
                return NestedContractTypes(type.GetElementType()!);
            }
            if (type.IsGenericType)
            {
                return type.GetGenericArguments().SelectMany(NestedContractTypes);
            }
            return GradableContractTypes().Contains(type) ? new[] { type } : Array.Empty<Type>();
        }

        private static readonly Dictionary<Type, bool> RawWritable = new();

        /// <summary>
        /// Whether <see cref="JsonWriter.AppendValue"/> has a case for
        /// <paramref name="type"/>, asked the way
        /// <see cref="WirePayloadCoverageTests"/> asks it: write a default
        /// instance and see whether the switch falls through to its throw.
        /// </summary>
        private static bool WrittenRawByJsonWriter(Type type)
        {
            lock (RawWritable)
            {
                if (RawWritable.TryGetValue(type, out var known))
                {
                    return known;
                }

                bool writable;
                if (type.GetConstructor(Type.EmptyTypes) == null)
                {
                    writable = false;
                }
                else
                {
                    try
                    {
                        WirePayloadCoverageTests.SerializeThroughWire(Activator.CreateInstance(type)!);
                        writable = true;
                    }
                    catch (NotSupportedException)
                    {
                        writable = false;
                    }
                    catch (Exception)
                    {
                        // Past the switch into a writer that choked on a
                        // default instance: the case exists.
                        writable = true;
                    }
                }
                RawWritable[type] = writable;
                return writable;
            }
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
