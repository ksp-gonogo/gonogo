using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
using Xunit;
using Xunit.Sdk;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The shipped <see cref="GateItemsConformance"/> assertion passes a per-item
    /// evaluator built the way the contract asks, and fails the two mistakes it
    /// exists to catch.
    /// </summary>
    public class GateItemsConformanceTests
    {
        private static readonly CommandRequirement Requirement = new CommandRequirement
        {
            Kind = PriceGate.PriceKind,
            Needs = new[] { "itemId" },
        };

        [Fact]
        public void AnEvaluatorThatAnswersEveryItemItNamesConforms()
        {
            var asked = GateItemsConformance.AssertItemsAreAskable(new PriceGate(), Requirement);

            Assert.Equal(new[] { "cheap", "dear" }, asked);
        }

        [Fact]
        public void AnEvaluatorThatAbstainsOnASuppliedItemDoesNot()
        {
            Assert.ThrowsAny<XunitException>(
                () => GateItemsConformance.AssertItemsAreAskable(new PriceGate { Abstains = true }, Requirement));
        }

        [Fact]
        public void ARequirementNeedingTwoArgumentsCannotBeSampledPerItem()
        {
            var twoNeeds = new CommandRequirement { Kind = PriceGate.PriceKind, Needs = new[] { "itemId", "factor" } };

            Assert.ThrowsAny<XunitException>(
                () => GateItemsConformance.AssertItemsAreAskable(new PriceGate(), twoNeeds));
        }

        private sealed class PriceGate : ICommandGateEvaluator, ICommandGateItems
        {
            public const string PriceKind = "probe-price";

            public bool Abstains { get; set; }

            public string Kind => PriceKind;

            public IEnumerable<string> Items(CommandRequirement requirement) => new[] { "cheap", "dear" };

            public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
            {
                if (Abstains) return new GateVerdict { Outcome = GateOutcome.Abstain };
                arguments.TryGet("itemId", out var item);
                return (item as string) == "dear"
                    ? GateVerdict.Fail(CommandErrorCode.InsufficientFunds, "costs more than the career holds")
                    : GateVerdict.Pass();
            }
        }
    }
}
