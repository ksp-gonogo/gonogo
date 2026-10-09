using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// The descriptor the mod can serve, against the descriptor codegen wrote.
    ///
    /// <para>Both come from one reflection pass over one assembly, which is
    /// the point: the alternative was to bake the generated file in as a
    /// resource, and a baked copy is free to drift from the attributes it
    /// claims to describe the moment somebody annotates a property without
    /// re-running codegen. This asserts the two really are one implementation
    /// rather than trusting the comment that says so.</para>
    /// </summary>
    public class UnitDescriptorTests
    {
        /// <summary>
        /// Walks up from the test binary to the repo root. The committed
        /// descriptor lives in the SDK's generated directory, which is not
        /// copied next to the test assembly.
        /// </summary>
        private static string CommittedDescriptorPath()
        {
            // Stop at the repo root. `.git` is a DIRECTORY in a normal clone but
            // a FILE (a `gitdir:` pointer) in a git worktree, so accept either,
            // else this walks past the root to null when run from a worktree.
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (
                dir != null
                && !Directory.Exists(Path.Combine(dir.FullName, ".git"))
                && !File.Exists(Path.Combine(dir.FullName, ".git")))
            {
                dir = dir.Parent;
            }

            Assert.NotNull(dir);
            return Path.Combine(
                dir.FullName, "mod", "sitrep-sdk", "src", "__generated__", "units.json");
        }

        [Fact]
        public void RuntimeDescriptorMatchesTheCommittedOne()
        {
            var committed = File.ReadAllText(CommittedDescriptorPath())
                .Replace("\r\n", "\n");

            Assert.Equal(committed, UnitDescriptor.ToJson());
        }

        [Fact]
        public void RuntimeCollectionDoesNotThrowOnAnUnknownToken()
        {
            // Codegen validates the vocabulary because everything it reflects
            // is compiled into this assembly, so a stray token is drift and
            // should stop the build. The RUNTIME pass must not: throwing
            // inside KSP over a descriptor nobody asked for would take the mod
            // down, and the generated `SitrepUnit` union is open precisely so
            // an unknown token is a survivable state.
            var maps = UnitDescriptor.Collect();
            Assert.NotEmpty(maps.ByTopic);
        }

        [Fact]
        public void EveryTokenTheMapsUseIsInThePublishedVocabulary()
        {
            // A consumer resolves units from this ONE document, so what it
            // uses and what it publishes have to agree.
            var maps = UnitDescriptor.Collect();
            var used = maps.ByType.Values
                .Concat(maps.ByTopic.Values)
                .SelectMany(fields => fields.Values)
                .Distinct();

            Assert.All(used, token => Assert.Contains(token, maps.Vocabulary));
        }

        /// <summary>
        /// A THIRD-PARTY contract shape, living in this test assembly rather
        /// than in Sitrep.Contract. Nothing about it is registered with the
        /// first party: it exists only to be reflected over.
        /// </summary>
        [SitrepTopic("example.reactor")]
        public sealed class ExampleUplinkPayload
        {
            [SitrepUnit("kW")]
            public double OutputPower { get; set; }

            // A unit the first-party catalog has never heard of. An Uplink
            // cannot add to `Units` (a const-string class in the contract
            // assembly), which is exactly why the generated `SitrepUnit` union
            // is open and why an Uplink token must survive even the
            // validating pass.
            [SitrepUnit("banana")]
            public double Silliness { get; set; }

            [SitrepUnit(Units.Text)]
            public string Label { get; set; }
        }

        [Fact]
        public void EveryNamedEnumFieldHasItsMembers()
        {
            var maps = UnitDescriptor.Collect();
            var named = maps.EnumsByType.Values
                .Concat(maps.EnumsByTopic.Values)
                .SelectMany(fields => fields.Values)
                .Where(enumName => enumName != null);

            Assert.All(named, enumName => Assert.True(maps.EnumMembers.ContainsKey(enumName), enumName + " has no members"));
        }

        [Fact]
        public void AnOrdinalEnumNamesItsMembersAStringIsNullAndAMaskIsAbsent()
        {
            var maps = UnitDescriptor.Collect();

            Assert.Equal("Situation", maps.EnumsByType["VesselIdentity"]["situation"]);
            foreach (Situation member in Enum.GetValues(typeof(Situation)))
            {
                Assert.Equal(member.ToString(), maps.EnumMembers["Situation"][(long)member]);
            }

            Assert.Null(maps.EnumsByType["CommcastTraffic"]["kind"]);
            Assert.False(maps.EnumsByType.TryGetValue("ActionBinding", out var binding) && binding.ContainsKey("groupsMask"));
        }

        [Fact]
        public void DescribesAnUplinksOwnAssemblyWithNoFirstPartyEdit()
        {
            // The codegen half of a symmetry that already existed on the
            // declaring side: SitrepUnitAttribute always took an arbitrary
            // string, so an Uplink could annotate its own fields; what it
            // could not do was GENERATE from them, which meant hand-writing
            // what the first party generates, which is the drift generation
            // exists to prevent.
            var maps = UnitDescriptor.Collect(assembly: typeof(ExampleUplinkPayload).Assembly);

            var fields = maps.ByType[nameof(ExampleUplinkPayload)];
            Assert.Equal("kW", fields["outputPower"]);
            Assert.Equal("banana", fields["silliness"]);
            Assert.Equal(Units.Text, fields["label"]);

            // Reachable by its Topic too, the same as any first-party payload.
            Assert.Equal(fields, maps.ByTopic["example.reactor"]);

            // And it does NOT pick up the first-party contract's types: the
            // assembly argument really is the scope.
            Assert.DoesNotContain("VesselFlight", maps.ByType.Keys);
        }

        [Fact]
        public void AnUplinkTokenOutsideEveryCatalogIsRejected()
        {
            // An Uplink is judged against core's catalog PLUS its own, so it can
            // declare whatever it models while a typo still fails. There is no
            // exemption for who wrote it: an undeclared token reaches the client
            // as an opaque symbol with no dimension and no ladder, which is the
            // same silent wrongness whoever shipped it. An Uplink that means to
            // introduce a unit says so in its own `Units` class.
            var ex = Assert.Throws<InvalidOperationException>(() =>
                UnitDescriptor.Collect(
                    validateVocabulary: true,
                    assembly: typeof(ExampleUplinkPayload).Assembly));

            Assert.Contains("banana", ex.Message);
        }

        [Fact]
        public void AnUplinkTokenIsCarriedWhenNobodyIsValidating()
        {
            // The RUNTIME pass, which deliberately does not throw: inside KSP a
            // stray token must not take the mod down, and the value still
            // renders, just without a dimension behind it.
            var maps = UnitDescriptor.Collect(
                validateVocabulary: false,
                assembly: typeof(ExampleUplinkPayload).Assembly);

            Assert.Equal("banana", maps.ByType[nameof(ExampleUplinkPayload)]["silliness"]);
            Assert.DoesNotContain("banana", maps.Vocabulary);
        }

        /// <summary>
        /// An Uplink's catalog under a SUFFIXED name, which is what an author
        /// writes once they have to put it in the same namespace as their
        /// payloads: a class named exactly <c>Units</c> shadows
        /// <see cref="Units"/> there and breaks every existing
        /// <c>[SitrepUnit(Units.Flag)]</c> beside it.
        /// </summary>
        public static class ExampleUnits
        {
            public const string Gizmos = "gizmos";
        }

        [Fact]
        public void ACatalogNamedForItsUplinkIsFound()
        {
            var maps = UnitDescriptor.Collect(
                validateVocabulary: false,
                assembly: typeof(ExampleUplinkPayload).Assembly);

            // Declared in ExampleUnits above, so the vocabulary carries it and a
            // property annotated with it would survive the validating pass.
            Assert.Contains("gizmos", maps.Vocabulary);
            // And the widening really is a widening: a token NOBODY declared is
            // still absent, so the check can still fail.
            Assert.DoesNotContain("banana", maps.Vocabulary);
        }

        [Fact]
        public void CollectsTheFieldsDeclaredStatic()
        {
            var maps = UnitDescriptor.Collect();

            Assert.Contains("radius", maps.StaticByType["BodyEntry"]);
            Assert.Contains("depth", maps.StaticByType["AtmosphereEntry"]);
            // A body's orbit moves along its elements, so the elements are live.
            Assert.DoesNotContain("OrbitEntry", maps.StaticByType.Keys);
            Assert.DoesNotContain("sphereOfInfluence", maps.StaticByType["BodyEntry"]);
        }

        private sealed class StaticAndReckonable
        {
            [SitrepStatic]
            [SitrepReckonable(ReckoningBases.RateIntegration, "rate")]
            public double Level { get; set; }
        }

        [Fact]
        public void AValueDeclaredBothStaticAndReckonableIsRejected()
        {
            var prop = typeof(StaticAndReckonable).GetProperty(nameof(StaticAndReckonable.Level))!;

            var ex = Assert.Throws<InvalidOperationException>(() =>
                UnitDescriptor.RequireStaticIsNotReckonable(prop));

            Assert.Contains("Level", ex.Message);
        }

        [Fact]
        public void CollectsTheFieldsDeterministicWhileAHorizonSaysSo()
        {
            var maps = UnitDescriptor.Collect();

            // A body's elements are exact while its own horizon is Unbounded and Analytic.
            Assert.Equal("horizon", maps.DeterministicWhileByType["BodyEntry"]["orbit"]);
            // The declaration is on the use site: the same shape under a rostered vessel is a craft's orbit, which drifts.
            Assert.DoesNotContain("VesselRosterEntry", maps.DeterministicWhileByType.Keys);
            Assert.DoesNotContain("OrbitEntry", maps.DeterministicWhileByType.Keys);
        }

        private sealed class GatedByNothing
        {
            [SitrepDeterministicWhile("Missing")]
            public OrbitEntry? Orbit { get; set; }
        }

        private sealed class GatedByANumber
        {
            [SitrepDeterministicWhile(nameof(Until))]
            public OrbitEntry? Orbit { get; set; }

            public double Until { get; set; }
        }

        private sealed class DeterministicAndStatic
        {
            [SitrepStatic]
            [SitrepDeterministicWhile(nameof(Horizon))]
            public double Level { get; set; }

            public PropagationHorizon Horizon { get; set; } = new();
        }

        [Theory]
        [InlineData(typeof(GatedByNothing), "Orbit", "Missing")]
        [InlineData(typeof(GatedByANumber), "Orbit", "Until")]
        [InlineData(typeof(DeterministicAndStatic), "Level", "SitrepStatic")]
        public void ADeterministicDeclarationThatCannotHoldIsRejected(Type holder, string property, string named)
        {
            var prop = holder.GetProperty(property)!;

            var ex = Assert.Throws<InvalidOperationException>(() =>
                UnitDescriptor.RequireDeterministicWhileIsSound(prop));

            Assert.Contains(named, ex.Message);
        }

        /// <summary>
        /// Every property of <see cref="UnitDescriptor.Maps"/> reaches the JSON.
        /// Each is filled with an entry keyed on its own name, so a map added to
        /// the type and not written by <c>ToJson</c> leaves its key out and fails
        /// here by name, with nothing to keep in step by hand.
        /// </summary>
        [Fact]
        public void WritesEveryMapTheTypeDeclares()
        {
            var maps = new UnitDescriptor.Maps();
            var properties = typeof(UnitDescriptor.Maps).GetProperties();
            foreach (var property in properties)
            {
                property.SetValue(maps, Probe(property.PropertyType, "Probe" + property.Name));
            }

            var json = UnitDescriptor.ToJson(maps);

            Assert.True(properties.Length >= 11, "Maps declares " + properties.Length + " properties; the probe found too few to mean anything");
            var missing = properties.Where(p => !json.Contains("\"Probe" + p.Name + "\"", StringComparison.Ordinal)).Select(p => p.Name).ToList();
            Assert.True(missing.Count == 0, "UnitDescriptor.ToJson does not write: " + string.Join(", ", missing));
        }

        /// <summary>
        /// A collection of <paramref name="type"/> holding one entry under
        /// <paramref name="key"/>, with one inner entry where the value is
        /// itself a collection.
        /// </summary>
        private static object Probe(Type type, string key)
        {
            var collection = Activator.CreateInstance(type)!;
            var add = type.GetMethods().Single(m => m.Name == "Add" && m.DeclaringType == type);
            var parameters = add.GetParameters();
            if (parameters.Length == 1)
            {
                add.Invoke(collection, new object[] { key });
                return collection;
            }

            add.Invoke(collection, new[] { key, InnerProbe(parameters[1].ParameterType) });
            return collection;
        }

        private static object InnerProbe(Type valueType)
        {
            if (valueType == typeof(SortedSet<string>))
            {
                return new SortedSet<string> { "probeField" };
            }
            if (valueType == typeof(SortedDictionary<string, string>))
            {
                return new SortedDictionary<string, string> { ["probeField"] = "probeValue" };
            }
            if (valueType == typeof(SortedDictionary<long, string>))
            {
                return new SortedDictionary<long, string> { [1] = "probeMember" };
            }
            throw new InvalidOperationException("No probe for a map of " + valueType.Name + ": teach this test the new shape");
        }

        [Fact]
        public void IsStableAcrossCalls()
        {
            // Every collection is sorted, so re-running produces identical
            // bytes and a diff in the committed file means the contract
            // actually changed.
            Assert.Equal(UnitDescriptor.ToJson(), UnitDescriptor.ToJson());
        }
    }
}
