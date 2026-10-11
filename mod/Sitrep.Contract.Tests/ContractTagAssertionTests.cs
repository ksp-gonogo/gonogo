using System;
using System.Linq;
using Sitrep.Contract.TestSupport;
using Xunit;

namespace Sitrep.Contract.Tests
{
    /// <summary>
    /// A value's own sample kind and a list's entry key are tags a reader acts on,
    /// so a misplaced one is caught here rather than drawn wrong.
    /// </summary>
    public class ContractTagAssertionTests
    {
        [Fact]
        public void TheContractsValueTagsAreSound()
        {
            var problems = ContractTagAssertion.Problems(typeof(VesselTarget).Assembly.GetTypes());
            Assert.True(problems.Count == 0, string.Join("\n", problems));
        }

        [Fact]
        public void TheContractDeclaresValueKinds()
        {
            var kinds = typeof(VesselTarget).Assembly.GetTypes()
                .SelectMany(t => t.GetProperties())
                .Count(p => p.IsDefined(typeof(SitrepSampleKindAttribute), false));
            Assert.True(kinds >= 8, "only " + kinds + " values declare a kind, so the clean result above says little");
        }

        [Fact]
        public void TheGateCanSeeBothAnswers()
        {
            Assert.Empty(ContractTagAssertion.Problems(new[] { typeof(Fakes.Clean) }));
            AssertOneProblemMentioning(typeof(Fakes.EventOnAValue), "SampleKind.Event");
            AssertOneProblemMentioning(typeof(Fakes.ContinuousFlag), "'flag'");
            Assert.Contains(
                ContractTagAssertion.Problems(new[] { typeof(Fakes.TwoKeys) }),
                p => p.Contains("2 entry keys", StringComparison.Ordinal));
        }

        private static void AssertOneProblemMentioning(Type fixture, string token)
        {
            var problems = ContractTagAssertion.Problems(new[] { fixture });
            Assert.True(problems.Count == 1, fixture.Name + ": " + string.Join(" | ", problems));
            Assert.Contains(token, problems[0], StringComparison.Ordinal);
        }

        public static class Fakes
        {
            [SitrepTopic("fake.tags.clean")]
            public class Clean
            {
                [SitrepEntryKey]
                [SitrepUnit(Units.Id)]
                public string? Id { get; set; }

                [SitrepSampleKind(SampleKind.Discrete)]
                [SitrepUnit(Units.Tonnes)]
                public double DryMass { get; set; }

                [SitrepSampleKind(SampleKind.Continuous)]
                [SitrepUnit(Units.Tonnes)]
                public double TotalMass { get; set; }
            }

            [SitrepTopic("fake.tags.event")]
            public class EventOnAValue
            {
                [SitrepSampleKind(SampleKind.Event)]
                [SitrepUnit(Units.UniversalTime)]
                public double LastUt { get; set; }
            }

            [SitrepTopic("fake.tags.flag")]
            public class ContinuousFlag
            {
                [SitrepSampleKind(SampleKind.Continuous)]
                [SitrepUnit(Units.Flag)]
                public bool Open { get; set; }
            }

            [SitrepTopic("fake.tags.two-keys", isArray: true)]
            public class TwoKeys
            {
                [SitrepEntryKey]
                public string? Name { get; set; }

                [SitrepEntryKey]
                public string? Id { get; set; }
            }
        }
    }
}
