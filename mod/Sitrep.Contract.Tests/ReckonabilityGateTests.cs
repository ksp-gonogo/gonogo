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
        /// <summary>
        /// Every class in the shipped contract assembly, with no attribute filter:
        /// the universe <c>RtConfig.EmitReckonability</c> sweeps, exactly.
        ///
        /// <para>It was <c>UnitCoverageAssertion.ContractTypes</c>, which keeps only
        /// <c>[SitrepContract]</c> carriers, and codegen has no such filter. One
        /// shipped type sits in that gap: <c>ControlFrame</c> carries
        /// <c>[SitrepTopic("system.frame")]</c> and no <c>[SitrepContract]</c>, so the
        /// narrower sweep was wrong in both directions at once. A mark on it reached
        /// the published artifact with the gate green, and a cross-topic input naming
        /// <c>@system.frame</c> was refused as a topic no <c>[SitrepTopic]</c> type
        /// publishes, which is false. <see cref="TheSweptUniverseCoversEveryTopic"/>
        /// is what stops the two diverging again.</para>
        /// </summary>
        private static IReadOnlyList<Type> ContractTypes() =>
            typeof(VesselTarget).Assembly.GetTypes()
                .Where(t => t.IsClass && !t.IsAbstract)
                .ToList();

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
        /// The gate looks at every type carrying <c>[SitrepTopic]</c>, which is the
        /// fact that keeps its sweep and codegen's from drifting apart.
        ///
        /// <para>A count floor cannot see this. The narrow sweep was one type short of
        /// 74 and every floor here passed, because a floor answers "did discovery
        /// collapse" and the question is "does it reach the same population the
        /// emitter does". Named against the ATTRIBUTE rather than against
        /// <c>ControlFrame</c>, so the next payload declared without
        /// <c>[SitrepContract]</c> is covered without anyone remembering to add it.</para>
        /// </summary>
        [Fact]
        public void TheSweptUniverseCoversEveryTopic()
        {
            var swept = new HashSet<Type>(ContractTypes());
            var topicTypes = typeof(VesselTarget).Assembly.GetTypes()
                .Where(t => t.IsDefined(typeof(SitrepTopicAttribute), false))
                .ToList();

            Assert.True(
                topicTypes.Count >= 60,
                "Only " + topicTypes.Count + " [SitrepTopic] types found, so this "
                    + "comparison is between two collapsed sets and proves nothing.");

            var missed = topicTypes.Where(t => !swept.Contains(t)).Select(t => t.Name).ToList();
            Assert.True(
                missed.Count == 0,
                "The reckonability gate does not look at these published Topic payloads:\n  "
                    + string.Join("\n  ", missed)
                    + "\n\nRtConfig.EmitReckonability sweeps the whole assembly, so a mark on one "
                    + "of these would be emitted into the published SDK ungated, and a cross-topic "
                    + "input naming its topic would be refused as unpublished.");
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
                typeof(ReckonabilityFakes.TopicWithoutContractAttribute), "noSuchField", payloads, bases);
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
