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
        public void ARequirementNamingNoNeedCannotBeSampledPerItem()
        {
            var noNeeds = new CommandRequirement { Kind = PriceGate.PriceKind, Needs = new string[0] };

            Assert.ThrowsAny<XunitException>(
                () => GateItemsConformance.AssertItemsAreAskable(new PriceGate(), noNeeds));
        }

        [Fact]
        public void AnItemNamedByTwoArgumentsIsAskedWithBothSupplied()
        {
            var pair = new CommandRequirement { Kind = PairGate.PairKind, Needs = new[] { "partId", "experimentId" } };

            var asked = GateItemsConformance.AssertItemsAreAskable(new PairGate(), pair);

            Assert.Equal(new[] { GateItemKey.ValueOf("part-1", "first"), GateItemKey.ValueOf("part-1", "second") }, asked);
        }

        [Fact]
        public void AGateThatNeedsBothArgumentsAbstainsWhenOnlyOneIsSuppliedSoItsItemsMustBeWrittenWithBoth()
        {
            var pair = new CommandRequirement { Kind = PairGate.PairKind, Needs = new[] { "partId", "experimentId" } };

            Assert.ThrowsAny<XunitException>(
                () => GateItemsConformance.AssertItemsAreAskable(new PairGate { NameOnlyTheParts = true }, pair));
        }

        [Fact]
        public void TheKeyOfAnItemRoundTripsThroughTheArgumentsACallWouldCarry()
        {
            var argument = GateItemKey.ArgumentOf(new[] { "partId", "experimentId" });
            var bag = GateItemKey.Arguments(argument, GateItemKey.ValueOf("77", "barometerScan"));

            Assert.Equal("partId+experimentId", argument);
            Assert.Equal("77", bag["partId"]);
            Assert.Equal("barometerScan", bag["experimentId"]);
            Assert.Equal("itemId", GateItemKey.ArgumentOf(new[] { "itemId" }));
            Assert.Equal("dear", GateItemKey.Arguments("itemId", "dear")["itemId"]);
        }

        [Fact]
        public void InputsThatReadTheSameTwiceConform()
        {
            var names = GateItemsConformance.AssertInputsAreReadable(new Inputs(new GateInput("funds", () => 5)));

            Assert.Equal(new[] { "funds" }, names);
        }

        [Fact]
        public void AnInputThatReadsDifferentlyEachTimeDoesNot()
        {
            var next = 0;
            Assert.ThrowsAny<XunitException>(
                () => GateItemsConformance.AssertInputsAreReadable(new Inputs(new GateInput("tick", () => next++))));
        }

        [Fact]
        public void NoInputsAtAllDoesNot()
        {
            Assert.ThrowsAny<XunitException>(() => GateItemsConformance.AssertInputsAreReadable(new Inputs()));
        }

        [Fact]
        public void TwoInputsWithOneNameDoNot()
        {
            Assert.ThrowsAny<XunitException>(
                () => GateItemsConformance.AssertInputsAreReadable(
                    new Inputs(new GateInput("funds", () => 1), new GateInput("funds", () => 2))));
        }

        private sealed class Inputs : ICommandGateInputs
        {
            public Inputs(params GateInput[] inputs) => Declared = inputs;

            public GateInput[] Declared { get; }

            IReadOnlyList<GateInput> ICommandGateInputs.Inputs => Declared;
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

        private sealed class PairGate : ICommandGateEvaluator, ICommandGateItems
        {
            public const string PairKind = "probe-pair";

            /// <summary>Names an item by the part alone, which a gate keyed on a part and an experiment cannot judge.</summary>
            public bool NameOnlyTheParts { get; set; }

            public string Kind => PairKind;

            public IEnumerable<string> Items(CommandRequirement requirement) => NameOnlyTheParts
                ? new[] { "part-1" }
                : new[] { GateItemKey.ValueOf("part-1", "first"), GateItemKey.ValueOf("part-1", "second") };

            public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
            {
                if (!arguments.TryGet("partId", out _) || !arguments.TryGet("experimentId", out _))
                {
                    return new GateVerdict { Outcome = GateOutcome.Abstain };
                }
                return GateVerdict.Pass();
            }
        }
    }
}
