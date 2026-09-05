using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract.TestSupport;
using Xunit;

namespace Sitrep.Contract.Tests
{
    /// <summary>
    /// A value marked <c>[SitrepReckonable]</c> promises an API consumer that the
    /// wire carries everything its model needs. These are the facts that keep the
    /// promise honest.
    ///
    /// <para>There is deliberately NO baseline and no debt list. A shrink-only
    /// baseline records a legacy population that was already breaching; under
    /// positive declaration the tree starts at zero marks and every mark is added by
    /// someone who chose to add it, so there is nothing to record and adding one
    /// "for symmetry" would only make the first wrong mark cheap to keep.</para>
    /// </summary>
    public class ReckonabilityGateTests
    {
        /// <summary>Every <c>[SitrepContract]</c> class in the shipped contract assembly.</summary>
        private static IReadOnlyList<Type> ContractTypes() =>
            UnitCoverageAssertion.ContractTypes(typeof(VesselTarget).Assembly).ToList();

        private static IReadOnlyList<Type> FakeTypes() =>
            typeof(ReckonabilityFakes).GetNestedTypes().ToList();

        [Fact]
        public void EveryDeclaredReckonableValueResolvesItsInputs()
        {
            var types = ContractTypes();
            var problems = ReckonabilityAssertion.Problems(
                types,
                ReckonabilityAssertion.TopicPayloads(types),
                ReckonabilityAssertion.KnownBases());

            Assert.True(
                problems.Count == 0,
                "These reckonability declarations name inputs the contract does not publish:\n  "
                    + string.Join("\n  ", problems)
                    + "\n\nA mark is a promise about what the WIRE carries, not about what our client "
                    + "happens to implement: an API consumer holding only the stream has to be able to "
                    + "advance the value from the inputs named. Fix the input spelling, publish the "
                    + "missing input, or drop the mark.");
        }

        /// <summary>
        /// The discovery reaches the contract, so a clean gate means something.
        ///
        /// <para><see cref="EveryDeclaredReckonableValueResolvesItsInputs"/> finds
        /// nothing wrong when every mark resolves AND when the sweep narrows to
        /// nothing: <c>[SitrepContract]</c> renamed, the attribute moved, or the
        /// declared-only property filter losing its subject all empty the surface and
        /// report the same zero. Floors plus named spot-checks are what tell those
        /// apart.</para>
        /// </summary>
        [Fact]
        public void DiscoveryReachesTheContractSurface()
        {
            var types = ContractTypes();
            Assert.True(
                types.Count >= 60,
                "Contract type discovery collapsed to " + types.Count
                    + " types, so the reckonability gate is sweeping almost nothing and its clean "
                    + "result says only that it did not look.");

            var payloads = ReckonabilityAssertion.TopicPayloads(types);
            Assert.True(
                payloads.Count >= 30,
                "Topic discovery collapsed to " + payloads.Count
                    + " payloads, so every cross-topic input would fail to resolve, or (worse) a "
                    + "narrowed sweep would find no marks to resolve them for.");

            var marks = ReckonabilityAssertion.Marks(types);
            Assert.True(
                marks.Count >= 7,
                "Only " + marks.Count + " reckonability declarations found. The contract carried seven "
                    + "when the gate landed, and a gate over an empty surface reports the same zero "
                    + "problems as a fully declared one.");

            var found = marks.ToDictionary(m => m.Where, m => m.Declaration.Basis, StringComparer.Ordinal);

            // Spot-checks across both bases and all four marked Topics, so a discovery
            // change that drops a whole family is red here rather than a quiet loss of
            // coverage.
            var expected = new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["VesselTarget.RelativePosition"] = ReckoningBases.LinearDeadReckoning,
                ["DockAlignment.RelativePosition"] = ReckoningBases.LinearDeadReckoning,
                ["DockAlignment.Distance"] = ReckoningBases.LinearDeadReckoning,
                ["VesselFlight.AltitudeAsl"] = ReckoningBases.KeplerPropagation,
                ["VesselFlight.OrbitalSpeed"] = ReckoningBases.KeplerPropagation,
                ["VesselOrbitTruth.Position"] = ReckoningBases.KeplerPropagation,
                ["VesselOrbitTruth.Velocity"] = ReckoningBases.KeplerPropagation,
            };

            foreach (var pair in expected)
            {
                Assert.True(
                    found.TryGetValue(pair.Key, out var basis),
                    pair.Key + " is no longer declared reckonable. If the mark was removed on purpose, "
                        + "remove it here too and say why in the commit; if it vanished, the sweep has "
                        + "stopped reaching it.");
                Assert.Equal(pair.Value, basis);
            }
        }

        /// <summary>
        /// The marked set is ordered and each value is marked once, so the generated
        /// artifact's row order never depends on reflection order.
        /// </summary>
        [Fact]
        public void MarkedValuesAreSortedAndFreeOfDuplicates()
        {
            var keys = ReckonabilityAssertion.Marks(ContractTypes())
                .Select(m => m.Topic + "/" + m.Field)
                .ToList();

            Assert.Equal(keys.OrderBy(k => k, StringComparer.Ordinal).ToList(), keys);
            Assert.Equal(keys.Distinct(StringComparer.Ordinal).Count(), keys.Count);
        }

        /// <summary>
        /// The gate can see BOTH answers, on planted fixtures.
        ///
        /// <para>The clean arm is not optional. A detector stuck on "clean" reports a
        /// green tree it never looked at; a detector stuck on "broken" reports the
        /// whole tree as debt forever, and neither failure is visible from the other
        /// side. Each planted arm also asserts the OFFENDING TOKEN appears in the
        /// message, because a count that moved says the gate fired, not that it fired
        /// for the right reason.</para>
        /// </summary>
        [Fact]
        public void TheGateCanSeeBothAnswers()
        {
            var fakes = FakeTypes();
            Assert.True(
                fakes.Count >= 10,
                "The planted fixtures are gone or unreachable (" + fakes.Count + " found). With no "
                    + "fixture to fail on, this test proves nothing about the gate.");

            var payloads = ReckonabilityAssertion.TopicPayloads(fakes);
            var bases = ReckonabilityAssertion.KnownBases();
            Assert.Contains(ReckoningBases.KeplerPropagation, bases);

            Assert.Empty(ProblemsFor(typeof(ReckonabilityFakes.Resolvable), payloads, bases));

            AssertOneProblemMentioning(
                typeof(ReckonabilityFakes.DanglingSameTopicInput), "noSuchField", payloads, bases);
            AssertOneProblemMentioning(
                typeof(ReckonabilityFakes.DanglingCrossTopicInput), "no.such.topic", payloads, bases);
            AssertOneProblemMentioning(
                typeof(ReckonabilityFakes.DanglingCrossTopicField), "noSuchField", payloads, bases);
            AssertOneProblemMentioning(
                typeof(ReckonabilityFakes.SelfReferentialInput), "implicit", payloads, bases);
            AssertOneProblemMentioning(
                typeof(ReckonabilityFakes.ArrayTopicMark), "array Topic", payloads, bases);
            AssertOneProblemMentioning(
                typeof(ReckonabilityFakes.UntopickedMark), "no [SitrepTopic]", payloads, bases);
            AssertOneProblemMentioning(
                typeof(ReckonabilityFakes.UnknownBasis), "vibes", payloads, bases);
            AssertOneProblemMentioning(
                typeof(ReckonabilityFakes.NoInputs), "no declared inputs", payloads, bases);
            AssertOneProblemMentioning(
                typeof(ReckonabilityFakes.DuplicateInput), "declared 2 times", payloads, bases);
        }

        private static IReadOnlyList<string> ProblemsFor(
            Type fixture,
            IReadOnlyDictionary<string, Type> payloads,
            IReadOnlyCollection<string> bases) =>
            ReckonabilityAssertion.Problems(new[] { fixture }, payloads, bases);

        private static void AssertOneProblemMentioning(
            Type fixture,
            string token,
            IReadOnlyDictionary<string, Type> payloads,
            IReadOnlyCollection<string> bases)
        {
            var problems = ProblemsFor(fixture, payloads, bases);

            Assert.True(
                problems.Count == 1,
                fixture.Name + " should produce exactly one problem, produced " + problems.Count
                    + ": " + string.Join(" | ", problems));
            Assert.Contains(token, problems[0], StringComparison.Ordinal);
        }
    }
}
