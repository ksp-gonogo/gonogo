using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>
    /// The strength of the path a command centre believes in: each hop from the
    /// backend's model for the pair as the centre last heard it, the whole
    /// path by the backend's rule, and which of the measured and the worked-out
    /// strength the centre is told.
    /// </summary>
    public class PathStrengthTests
    {
        private const int Kerbin = 0;
        private const double KerbinMu = 3.5316e12;

        private static readonly OrbitElements Orbit = new OrbitElements(700_000.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu);

        /// <summary>A model that says a fixed strength whatever the separation, and remembers the separation it was asked at.</summary>
        private sealed class Fixed : IContactLinkStrength
        {
            private readonly double _strength;
            private readonly Dictionary<string, object?>? _extensions;

            public Fixed(double strength, Dictionary<string, object?>? extensions = null)
            {
                _strength = strength;
                _extensions = extensions;
            }

            public double AskedAtMeters { get; private set; } = double.NaN;

            public ContactHopFacts FactsAt(double ut, double separationMeters)
            {
                AskedAtMeters = separationMeters;
                return new ContactHopFacts(_strength, _extensions);
            }
        }

        private static CraftState Craft(string id, params (string To, IContactLinkStrength? Strength)[] links) =>
            CraftState.Orbiting(
                id, 0.0, Kerbin, Orbit, null, null, true,
                links.ToDictionary(l => l.To, l => new CraftLink(1e9, null, l.Strength)));

        [Theory]
        [InlineData(0.0, 1.0)]
        [InlineData(250.0, 0.84375)]
        [InlineData(500.0, 0.5)]
        [InlineData(1000.0, 0.0)]
        [InlineData(2000.0, 0.0)]
        public void StockStrengthIsTheSmoothStepOfHowFarInsideItsRangeThePairIs(double separation, double strength)
        {
            Assert.Equal(strength, new RangeCurveStrength(1000.0).FactsAt(0.0, separation).Strength, 9);
        }

        [Fact]
        public void StockStrengthKeepsTheLinkStrengthContract()
        {
            Sitrep.Contract.TestSupport.PathStrengthConformance.AssertLinkStrengthContract(new RangeCurveStrength(1000.0), 0.0, 3000.0);
        }

        [Fact]
        public void APairWithNoRangeHasNoStrength()
        {
            Assert.Equal(0.0, new RangeCurveStrength(0.0).FactsAt(0.0, 10.0).Strength);
            Assert.Equal(0.0, new RangeCurveStrength(double.NaN).FactsAt(0.0, 10.0).Strength);
        }

        [Fact]
        public void AHopIsWorthWhatTheModelHeardWithEitherEndSaysAtTheSeparationThePlanGivesIt()
        {
            var model = new Fixed(0.7, new Dictionary<string, object?> { ["x"] = new Dictionary<string, object?> { ["band"] = "S" } });
            var strengths = new PathStrengths(new[] { Craft("vessel:probe", ("ground:ksc", model)) }, null);

            var outward = strengths.FactsOf("vessel:probe", "ground:ksc", 5.0, 123.0);
            Assert.Equal(0.7, outward!.Value.Strength);
            Assert.Equal(123.0, model.AskedAtMeters);
            Assert.NotNull(outward.Value.Extensions);

            // A ground station says nothing of its own, so the hop is read from the craft's end whichever way it is asked.
            Assert.Equal(0.7, strengths.FactsOf("ground:ksc", "vessel:probe", 5.0, 9.0)!.Value.Strength);
        }

        [Fact]
        public void AHopTheCentreHasHeardNoModelForHasNoStrength()
        {
            var strengths = new PathStrengths(new[] { Craft("vessel:probe", ("ground:ksc", null)) }, null);

            Assert.Null(strengths.FactsOf("vessel:probe", "ground:ksc", 5.0, 123.0));
            Assert.Null(strengths.FactsOf("vessel:other", "ground:ksc", 5.0, 123.0));
        }

        [Fact]
        public void APathIsWorthTheLeastOfItsHopsUnlessTheBackendSaysOtherwise()
        {
            var weakest = new PathStrengths(new CraftState[0], null);
            Assert.Equal(0.4, weakest.Of(new double?[] { 0.9, 0.4, 0.8 })!.Value, 9);

            var product = new PathStrengths(new CraftState[0], hops => hops.Aggregate(1.0, (a, b) => a * b));
            Assert.Equal(0.5 * 0.5, product.Of(new double?[] { 0.5, 0.5 })!.Value, 9);
        }

        [Fact]
        public void APathWithAHopOfNoKnownStrengthHasNone()
        {
            var strengths = new PathStrengths(new CraftState[0], null);

            Assert.Null(strengths.Of(new double?[] { 0.9, null }));
            Assert.Null(strengths.Of(new double?[0]));
        }

        private static CommsPath Believed(params (string From, string To)[] hops) => new CommsPath
        {
            Hops = hops.Select(h => new CommsHop { From = h.From, To = h.To }).ToList(),
        };

        private static ContactRadio Heard(double strength, bool connected, params (string From, string To)[] hops) => new ContactRadio(
            "vessel:probe",
            connected,
            strength,
            new CommsDegrade { ModelId = "m", ModelName = "M", Level = connected ? 1.0 - strength : 1.0 },
            hops.Select(h => new RadioHop(h.From, h.To, false)).ToArray());

        [Fact]
        public void WhereTheRadioReportedOnTheVeryPathTheCentreBelievesInTheCentreIsToldTheMeasuredStrength()
        {
            var told = CentreSignal.For(Believed(("probe", "KSC")), 0.6, Heard(0.9, true, ("probe", "KSC")));

            Assert.Equal(0.9, told!.Value.Strength);
            Assert.False(told.Value.Modelled);
            Assert.Equal(0.1, told.Value.Degrade!.Level!.Value, 9);
        }

        [Fact]
        public void WhereTheRadioReportedOnAnotherPathTheCentreIsToldWhatItsOwnPathIsWorthAndThatItIsWorkedOut()
        {
            var told = CentreSignal.For(Believed(("probe", "Crater Rim")), 0.6, Heard(0.9, true, ("probe", "KSC")));

            Assert.Equal(0.6, told!.Value.Strength);
            Assert.True(told.Value.Modelled);
            // Graded by the rule the centre heard the radio graded by, at the strength of its own path.
            Assert.Equal("m", told.Value.Degrade!.ModelId);
            Assert.Equal(0.4, told.Value.Degrade.Level!.Value, 9);
        }

        [Fact]
        public void TheRadiosOwnWordThatTheLinkHasGoneStandsOverWhatThePlanBelieves()
        {
            var told = CentreSignal.For(Believed(("probe", "KSC")), 0.6, Heard(0.0, false));

            Assert.Equal(0.0, told!.Value.Strength);
            Assert.False(told.Value.Modelled);
            Assert.Equal(1.0, told.Value.Degrade!.Level!.Value);
        }

        /// <summary>A figure measured on another path is not this path's figure. With nothing to work out it is still told, as what it is.</summary>
        [Fact]
        public void WithNoStrengthToWorkOutAReportOfAnotherPathIsToldAsBeingOfAnotherPath()
        {
            var told = CentreSignal.For(Believed(("probe", "Crater Rim")), null, Heard(0.9, true, ("probe", "KSC")));

            Assert.Equal(0.9, told!.Value.Strength);
            Assert.False(told.Value.Modelled);
            Assert.True(told.Value.OtherPath);
            Assert.True(CentreSignal.For(Believed(), null, Heard(0.9, true, ("probe", "KSC")))!.Value.OtherPath);
        }

        [Fact]
        public void AFigureOfTheCentresOwnPathIsNeverMarkedAsBeingOfAnother()
        {
            Assert.False(CentreSignal.For(Believed(("probe", "KSC")), 0.6, Heard(0.9, true, ("probe", "KSC")))!.Value.OtherPath);
            Assert.False(CentreSignal.For(Believed(("probe", "Crater Rim")), 0.6, Heard(0.9, true, ("probe", "KSC")))!.Value.OtherPath);
            Assert.False(CentreSignal.For(Believed(("probe", "KSC")), 0.6, Heard(0.0, false))!.Value.OtherPath);
        }

        [Fact]
        public void AHopStrengthThatIsNotANumberOrIsInfiniteIsNoStrengthAndOneOutOfRangeIsHeldToIt()
        {
            PathStrengths With(double strength) => new PathStrengths(new[] { Craft("vessel:probe", ("ground:ksc", new Fixed(strength))) }, null);

            Assert.Null(With(double.NaN).FactsOf("vessel:probe", "ground:ksc", 0.0, 1.0));
            Assert.Null(With(double.PositiveInfinity).FactsOf("vessel:probe", "ground:ksc", 0.0, 1.0));
            Assert.Null(With(double.NegativeInfinity).FactsOf("vessel:probe", "ground:ksc", 0.0, 1.0));
            Assert.Equal(1.0, With(1.7).FactsOf("vessel:probe", "ground:ksc", 0.0, 1.0)!.Value.Strength);
            Assert.Equal(0.0, With(-0.2).FactsOf("vessel:probe", "ground:ksc", 0.0, 1.0)!.Value.Strength);
        }

        [Fact]
        public void ABackendThatStatesNoStrengthLeavesNothingToWeighRoutesBy()
        {
            Assert.Null(PathStrengths.For(new CraftState[0], null));
            Assert.NotNull(PathStrengths.For(new CraftState[0], PathStrengths.Weakest));
        }

        [Fact]
        public void BeforeAnyReportArrivesTheCentreIsToldTheWorkedOutStrengthWithNoGrading()
        {
            var told = CentreSignal.For(Believed(("probe", "KSC")), 0.6, null);

            Assert.Equal(0.6, told!.Value.Strength);
            Assert.True(told.Value.Modelled);
            Assert.Null(told.Value.Degrade);
        }

        [Fact]
        public void WithNothingHeardAndNothingToWorkOutTheCentreIsToldNothing()
        {
            Assert.Null(CentreSignal.For(Believed(), null, null));
        }
    }
}
