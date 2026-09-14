using System;
using System.Collections.Generic;
using GonogoPrincipiaUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// How far this Uplink will vouch for a BODY's published elements, and the
    /// measurement that says a body needs bounding at all.
    ///
    /// <para><b>The question the ruling left open, answered with numbers.</b> A body
    /// is not a craft, and under stock it needs no horizon: a fixed conic about a
    /// fixed parent is a published fact at any UT. Under n-body physics the elements
    /// on the wire are the conic osculating an integrated ephemeris, and whether that
    /// matters was an open guess: a planet's drift might sit under a pixel at any
    /// scale anyone draws, while a moon under a nearby giant might not. It is not a
    /// guess now. Against the same rig geometry and the same law that bounds a craft,
    /// a moon is vouched for in MINUTES and a planet in HOURS, three orders of
    /// magnitude apart, so one number for the catalogue would have been the shortest
    /// of them applied to everything.</para>
    ///
    /// <para><b>The law is applied here, not re-derived.</b>
    /// <see cref="ConicDeparture"/> integrates the difference between a published
    /// conic and the path a neighbourhood bends it onto; nothing in it is about
    /// craft, and a moon about its planet is the same problem with different numbers.
    /// What is new is the CALLER, so the numbers below are checked against a
    /// different kind of instrument rather than against the law that produced them,
    /// per <see cref="DepartsAtTheRateAClosedFormTidalEstimateSays"/>.</para>
    ///
    /// <para><b>What is NOT measured here, stated plainly.</b> These are the stock
    /// system's geometry and the stock masses, run through the law. Nobody has yet
    /// stood a body's published conic next to the producer's OWN ephemeris on a rig
    /// running n-body physics and differenced them, which is what was done for craft
    /// on 2026-09-05. The seam publishes what the provider computes, so that
    /// measurement changes these numbers without changing any shape; until it is run,
    /// the span a body carries is this law's answer and is honest about being
    /// that.</para>
    /// </summary>
    public class BodyEphemerisHorizonTests
    {
        /// <summary>
        /// What the law publishes for each body: the span, in seconds past the sample
        /// instant, its elements are worth <see cref="PrincipiaHorizonBound.ToleranceMetres"/>.
        /// </summary>
        public static IEnumerable<object[]> EveryBody()
        {
            // name, span seconds
            yield return new object[] { "Mun about Kerbin", 2921.0 };
            yield return new object[] { "Minmus about Kerbin", 462.0 };
            yield return new object[] { "Laythe about Jool", 910.0 };
            yield return new object[] { "Vall about Jool", 189.0 };
            yield return new object[] { "Tylo about Jool", 187.0 };
            yield return new object[] { "Kerbin about Sun", 71386.0 };
            yield return new object[] { "Jool about Sun", 69064.0 };
        }

        [Theory]
        [MemberData(nameof(EveryBody))]
        public void EachBodyIsVouchedForExactlyAsFarAsTheLawComputes(string name, double expected)
        {
            var span = SpanOf(name);
            Assert.NotNull(span);
            Assert.Equal(expected, span!.Value, 0);
        }

        /// <summary>
        /// The operator's question, and the reason this is per body rather than per
        /// catalogue: is a body's drift negligible or not?
        ///
        /// <para>It depends entirely on which body. Tylo and Vall, deep in Jool's
        /// satellite system, are off by a hundred metres inside five minutes; Kerbin,
        /// out on its own about the star, holds for most of a day. Publishing the
        /// shortest of those for every body would withdraw the planets on a window
        /// they are good for, and publishing the longest would draw the moons where
        /// nobody said they would be.</para>
        /// </summary>
        [Fact]
        public void AMoonUnderAGiantIsBoundedInMinutesAndAPlanetInHours()
        {
            var tylo = SpanOf("Tylo about Jool")!.Value;
            var vall = SpanOf("Vall about Jool")!.Value;
            var kerbin = SpanOf("Kerbin about Sun")!.Value;

            Assert.InRange(tylo, 60.0, 600.0);
            Assert.InRange(vall, 60.0, 600.0);
            Assert.InRange(kerbin, 4.0 * 3600.0, 48.0 * 3600.0);
            Assert.True(
                kerbin / tylo > 300.0,
                $"a planet should outlast a giant's moon by orders of magnitude, got {kerbin / tylo:F0}x");
        }

        /// <summary>
        /// A DIFFERENT KIND of instrument, because a span checked against the law that
        /// produced it checks nothing.
        ///
        /// <para>Where a body's orbit is small against the perturber's distance, the
        /// departure starts as a free fall under a constant differential pull, so
        /// <c>100 m = a t^2 / 2</c> with <c>a = 2 mu r / d^3</c> names the crossing in
        /// closed form, with no integration anywhere in it. Measured: the Mun's
        /// integrated crossing is <b>1.052</b> times that estimate and Kerbin's is
        /// <b>1.155</b>, the second further out because a window of thirty hours is
        /// long enough for the tide's own direction to have turned, which a free fall
        /// under a fixed pull cannot know about. Both are the integration coming in
        /// slightly LATER, which is the direction a constant-pull estimate should
        /// err.</para>
        ///
        /// <para><b>Minmus is deliberately not in this check, and the reason is worth
        /// keeping.</b> It orbits FOUR times further from Kerbin than the Mun does, so
        /// <c>r/d</c> is 4 and the tidal expression above, which assumes the opposite,
        /// is not an estimate of anything there. The integrated answer is still the
        /// one published: it forms the difference of two real pulls rather than
        /// expanding in <c>r/d</c>. What it does mean is that Minmus sits just past
        /// the <c>r/d</c> of 3.1 the law was measured over, and is the body here whose
        /// span has the least independent support.</para>
        /// </summary>
        [Theory]
        [InlineData("Mun about Kerbin", 4382.0, 0.08)]
        [InlineData("Kerbin about Sun", 107079.0, 0.20)]
        public void DepartsAtTheRateAClosedFormTidalEstimateSays(
            string name, double integratedCrossing, double tolerance)
        {
            var body = Bodies[name];
            var closedForm = Math.Sqrt(
                2.0 * PrincipiaHorizonBound.ToleranceMetres / body.DominantTidalAcceleration);
            var ratio = integratedCrossing / closedForm;
            Assert.True(
                Math.Abs(ratio - 1.0) <= tolerance,
                $"{name}: integrated {integratedCrossing:F0}s against closed-form " +
                $"{closedForm:F0}s is {ratio:F3}x, past {tolerance:F2}");
        }

        /// <summary>
        /// The integrated crossing each span is three halves of, so a change to
        /// <see cref="PrincipiaHorizonBound.SafetyFactor"/> moves the published spans
        /// and leaves these where they are.
        /// </summary>
        [Theory]
        [InlineData("Mun about Kerbin", 4382.0)]
        [InlineData("Minmus about Kerbin", 693.0)]
        [InlineData("Laythe about Jool", 1364.0)]
        [InlineData("Vall about Jool", 283.0)]
        [InlineData("Tylo about Jool", 281.0)]
        [InlineData("Kerbin about Sun", 107079.0)]
        [InlineData("Jool about Sun", 103596.0)]
        public void ReachesAHundredMetresOffThePathWhenTheIntegrationSaysItDoes(
            string name, double expected)
        {
            var body = Bodies[name];
            var cycle = body.Orbit.CycleSeconds;
            var crossing = body.Departure().FirstCrossingSeconds(
                cycle * PrincipiaHorizonBound.SearchCycles,
                PrincipiaHorizonBound.ToleranceMetres,
                (int)(PrincipiaHorizonBound.SearchCycles
                      * PrincipiaHorizonBound.StepsPerRevolution));
            Assert.NotNull(crossing);
            Assert.Equal(expected, crossing!.Value, 0);
        }

        /// <summary>
        /// A body nothing measurable pulls on is as good as a stock one for as far as
        /// the search went, and that is what gets said. Same arm a calm craft takes:
        /// the point is that no arm here invents a number.
        /// </summary>
        [Fact]
        public void ABodyWithNoNeighbourhoodIsVouchedForAsFarAsTheSearchWentAndNoFurther()
        {
            var orbit = RigGeometry.MunAboutKerbin;
            var alone = new ConicDeparture(
                RigGeometry.KerbinMu, RigGeometry.SampleUt, orbit.At);
            var span = PrincipiaHorizonBound.SpanSeconds(alone, orbit.CycleSeconds);
            Assert.Equal(
                orbit.CycleSeconds * PrincipiaHorizonBound.SearchCycles
                    / PrincipiaHorizonBound.SafetyFactor,
                span!.Value,
                6);
        }

        private static double? SpanOf(string name)
        {
            var body = Bodies[name];
            return PrincipiaHorizonBound.SpanSeconds(
                body.Departure(), body.Orbit.CycleSeconds);
        }

        /// <summary>
        /// One body as the bound needs it: its own conic about its primary, and every
        /// neighbour that pulls on it, expressed in the primary's frame.
        /// </summary>
        private sealed class OrbitingBody
        {
            private readonly Tuple<double, Func<double, Sitrep.Contract.Vector3d>>[] _perturbers;

            public OrbitingBody(
                Conic orbit,
                double primaryMu,
                params Tuple<double, Func<double, Sitrep.Contract.Vector3d>>[] perturbers)
            {
                Orbit = orbit;
                PrimaryMu = primaryMu;
                _perturbers = perturbers;
            }

            public Conic Orbit { get; }

            public double PrimaryMu { get; }

            /// <summary>
            /// The largest single differential pull across this body's orbit, which is
            /// what the closed-form check falls freely under. Not used by the law.
            /// </summary>
            public double DominantTidalAcceleration { get; set; }

            public ConicDeparture Departure()
            {
                var departure = new ConicDeparture(
                    PrimaryMu, RigGeometry.SampleUt, Orbit.At);
                foreach (var p in _perturbers) departure.Add(p.Item1, p.Item2);
                return departure;
            }
        }

        private static Tuple<double, Func<double, Sitrep.Contract.Vector3d>> At(
            double mu, Func<double, Sitrep.Contract.Vector3d> where) => Tuple.Create(mu, where);

        private static readonly Dictionary<string, OrbitingBody> Bodies =
            new Dictionary<string, OrbitingBody>
            {
                ["Mun about Kerbin"] = new OrbitingBody(
                    RigGeometry.MunAboutKerbin, RigGeometry.KerbinMu,
                    At(RigGeometry.SunMu, RigGeometry.KerbinAboutSun.Inverted),
                    At(RigGeometry.MinmusMu, RigGeometry.MinmusAboutKerbin.At))
                {
                    // The Sun's, across the Mun's own orbit radius.
                    DominantTidalAcceleration = PrincipiaHorizonBound.PerturbingAcceleration(
                        RigGeometry.MunAboutKerbin.Sma,
                        RigGeometry.SunMu,
                        RigGeometry.KerbinAboutSun.Sma),
                },
                ["Minmus about Kerbin"] = new OrbitingBody(
                    RigGeometry.MinmusAboutKerbin, RigGeometry.KerbinMu,
                    At(RigGeometry.SunMu, RigGeometry.KerbinAboutSun.Inverted),
                    At(RigGeometry.MunMu, RigGeometry.MunAboutKerbin.At)),
                ["Laythe about Jool"] = new OrbitingBody(
                    RigGeometry.LaytheAboutJool, RigGeometry.JoolMu,
                    At(RigGeometry.SunMu, RigGeometry.JoolAboutSun.Inverted),
                    At(RigGeometry.VallMu, RigGeometry.VallAboutJool.At),
                    At(RigGeometry.TyloMu, RigGeometry.TyloAboutJool.At),
                    At(RigGeometry.BopMu, RigGeometry.BopAboutJool.At),
                    At(RigGeometry.PolMu, RigGeometry.PolAboutJool.At)),
                ["Vall about Jool"] = new OrbitingBody(
                    RigGeometry.VallAboutJool, RigGeometry.JoolMu,
                    At(RigGeometry.SunMu, RigGeometry.JoolAboutSun.Inverted),
                    At(RigGeometry.LaytheMu, RigGeometry.LaytheAboutJool.At),
                    At(RigGeometry.TyloMu, RigGeometry.TyloAboutJool.At),
                    At(RigGeometry.BopMu, RigGeometry.BopAboutJool.At),
                    At(RigGeometry.PolMu, RigGeometry.PolAboutJool.At)),
                ["Tylo about Jool"] = new OrbitingBody(
                    RigGeometry.TyloAboutJool, RigGeometry.JoolMu,
                    At(RigGeometry.SunMu, RigGeometry.JoolAboutSun.Inverted),
                    At(RigGeometry.LaytheMu, RigGeometry.LaytheAboutJool.At),
                    At(RigGeometry.VallMu, RigGeometry.VallAboutJool.At),
                    At(RigGeometry.BopMu, RigGeometry.BopAboutJool.At),
                    At(RigGeometry.PolMu, RigGeometry.PolAboutJool.At)),
                ["Kerbin about Sun"] = new OrbitingBody(
                    RigGeometry.KerbinAboutSun, RigGeometry.SunMu,
                    At(RigGeometry.JoolMu, RigGeometry.JoolAboutSun.At))
                {
                    // Jool's, across Kerbin's own orbit radius.
                    DominantTidalAcceleration = PrincipiaHorizonBound.PerturbingAcceleration(
                        RigGeometry.KerbinAboutSun.Sma,
                        RigGeometry.JoolMu,
                        RigGeometry.JoolAboutSun.Sma),
                },
                ["Jool about Sun"] = new OrbitingBody(
                    RigGeometry.JoolAboutSun, RigGeometry.SunMu,
                    At(RigGeometry.KerbinMu, RigGeometry.KerbinAboutSun.At)),
            };
    }

    /// <summary>
    /// The seam the measurement above reaches the wire through: the provider member
    /// a catalogue asks, and every arm of it that refuses rather than inventing.
    ///
    /// <para>Separate from the measurement because they fail for different reasons. A
    /// number that moves means the physics changed; a refusal that stops refusing
    /// means the plumbing did.</para>
    /// </summary>
    public class BodyEphemerisHorizonSeamTests
    {
        /// <summary>
        /// The provider assembles the same problem the law was measured on: the right
        /// primary, that primary's mass out of the force model, the right
        /// neighbourhood, and the body itself left out of its own perturbation.
        /// </summary>
        [Fact]
        public void ReachesTheSameSpanThroughTheProviderAsTheLawComputesDirectly()
        {
            var span = Provider().BodySpanSeconds(RigGeometry.Mun, RigGeometry.SampleUt);

            Assert.NotNull(span);
            Assert.Equal(2921.0, span!.Value, 0);
        }

        /// <summary>
        /// The root is the frame everything else is measured in. It has no primary to
        /// depart from, so there is no departure, and null is the answer rather than
        /// an unbounded claim.
        /// </summary>
        [Fact]
        public void TheRootHasNoPrimaryToDepartFromAndIsRefused()
        {
            Assert.Null(Provider().BodySpanSeconds(RigGeometry.Sun, RigGeometry.SampleUt));
        }

        [Fact]
        public void AnInstallWithNoReadableForceModelVouchesForNothing()
        {
            var provider = new PrincipiaPropagationProvider(
                new StockConics(), () => null, PerturbersAround, StockParents);

            Assert.Null(provider.BodySpanSeconds(RigGeometry.Mun, RigGeometry.SampleUt));
        }

        /// <summary>
        /// A primary the gravity model does not name leaves no mass to bend the two
        /// curves apart, and substituting the game's own would answer with a bound
        /// that agrees with nothing while looking exactly like one that does.
        /// </summary>
        [Fact]
        public void APrimaryTheForceModelDoesNotNameIsRefusedRatherThanSubstituted()
        {
            var provider = new PrincipiaPropagationProvider(
                new StockConics(),
                () => new GravityModel("no-kerbin", new[]
                {
                    new GravityModelBody("Sun", RigGeometry.SunMu),
                }),
                PerturbersAround,
                StockParents);

            Assert.Null(provider.BodySpanSeconds(RigGeometry.Mun, RigGeometry.SampleUt));
        }

        /// <summary>
        /// The cached answer is an absolute instant and what comes back is what is
        /// LEFT of it, so a horizon published from a later sample never reaches past
        /// one that was measured from a real one. It shrinks between measurements,
        /// which is the safe direction for a bound to be wrong in.
        /// </summary>
        [Fact]
        public void ShrinksBetweenMeasurementsRatherThanExtendingPastTheMeasuredInstant()
        {
            var provider = Provider();
            var first = provider.BodySpanSeconds(RigGeometry.Mun, RigGeometry.SampleUt)!.Value;
            var later = provider.BodySpanSeconds(
                RigGeometry.Mun, RigGeometry.SampleUt + 1000.0)!.Value;

            Assert.Equal(first - 1000.0, later, 6);
        }

        /// <summary>
        /// A revert or a load moves the clock backwards, and a measurement taken at a
        /// later sample handed to an earlier one would be a span covering everything
        /// between them. That is the one way this cache could over-vouch, so a held
        /// answer is dropped rather than stretched.
        ///
        /// <para>What comes back is a fresh measurement at a different phase of the
        /// Mun's own orbit, so it is a DIFFERENT number rather than the same one:
        /// 3296 s against 2921 s. What it is not is 12 921 s, which is what stretching
        /// the held instant across the ten thousand reverted seconds would have
        /// produced, and that gap is what this asserts on.</para>
        /// </summary>
        [Fact]
        public void DropsAHeldAnswerWhenTheClockGoesBackwards()
        {
            const double reverted = 10_000.0;
            var provider = Provider();
            var atSample = provider.BodySpanSeconds(
                RigGeometry.Mun, RigGeometry.SampleUt)!.Value;
            var earlier = provider.BodySpanSeconds(
                RigGeometry.Mun, RigGeometry.SampleUt - reverted)!.Value;

            Assert.True(
                earlier < 2.0 * atSample,
                $"a reverted clock got {earlier:F0}s against {atSample:F0}s at the sample, "
                + $"and a stretched hold would have given {atSample + reverted:F0}s");
            Assert.Equal(3296.0, earlier, 0);
        }

        [Fact]
        public void ReMeasuresOnceTheCachedAnswerHasExpired()
        {
            var provider = Provider();
            var first = provider.BodySpanSeconds(RigGeometry.Mun, RigGeometry.SampleUt)!.Value;
            var fresh = provider.BodySpanSeconds(
                RigGeometry.Mun, RigGeometry.SampleUt + first + 1.0);

            Assert.NotNull(fresh);
            // A fresh measurement, not the remains of the expired one, which by then
            // is negative.
            Assert.True(fresh!.Value > 0.0);
        }

        /// <summary>
        /// The existing pass-through stays exactly as it was, and this is the reason
        /// the body horizon is a separate question. The acceleration walk that
        /// computes ANY bound places each perturbing body through
        /// <c>CanPropagate</c>, so bounding a body there would refuse the walk the
        /// bound is made of.
        /// </summary>
        [Fact]
        public void BoundingABodyDoesNotStartRefusingTheWalkTheBoundIsMadeOf()
        {
            var provider = Provider();

            Assert.True(provider.CanPropagate(
                PropagationTarget.Body(RigGeometry.Mun),
                PropagationFrame.CentredOn(RigGeometry.Kerbin),
                RigGeometry.SampleUt,
                RigGeometry.SampleUt + 86_400.0));
        }

        private static PrincipiaPropagationProvider Provider() =>
            new PrincipiaPropagationProvider(
                new StockConics(), StockMasses, PerturbersAround, StockParents);

        private static GravityModel StockMasses() =>
            new GravityModel("rig-2026-09-05", new[]
            {
                new GravityModelBody("Sun", RigGeometry.SunMu),
                new GravityModelBody("Kerbin", RigGeometry.KerbinMu),
                new GravityModelBody("Mun", RigGeometry.MunMu),
                new GravityModelBody("Minmus", RigGeometry.MinmusMu),
            });

        private static int? StockParents(int bodyIndex) => bodyIndex switch
        {
            RigGeometry.Kerbin => RigGeometry.Sun,
            RigGeometry.Mun => RigGeometry.Kerbin,
            RigGeometry.Minmus => RigGeometry.Kerbin,
            _ => null,
        };

        /// <summary>
        /// The neighbourhood of a body: its own parent, its siblings and its
        /// satellites, which is the rule <c>PrincipiaPerturbers.Around</c> walks.
        ///
        /// <para>Every arm is filled rather than just the one the bound sums, because
        /// the primary's MASS is joined through the child's own walk: that walk is the
        /// only table pairing a propagation index with the string the gravity model is
        /// keyed on, and a body always lists its parent. A stub that answered for the
        /// primary alone would have returned null for every body and looked like a
        /// refusing provider.</para>
        /// </summary>
        private static IReadOnlyList<PrincipiaPerturber> PerturbersAround(int primaryIndex) =>
            primaryIndex switch
            {
                RigGeometry.Sun => new[] { Body("Kerbin", RigGeometry.Kerbin) },
                RigGeometry.Kerbin => new[]
                {
                    Body("Sun", RigGeometry.Sun),
                    Body("Mun", RigGeometry.Mun),
                    Body("Minmus", RigGeometry.Minmus),
                },
                RigGeometry.Mun => new[]
                {
                    Body("Kerbin", RigGeometry.Kerbin),
                    Body("Minmus", RigGeometry.Minmus),
                },
                RigGeometry.Minmus => new[]
                {
                    Body("Kerbin", RigGeometry.Kerbin),
                    Body("Mun", RigGeometry.Mun),
                },
                _ => new PrincipiaPerturber[0],
            };

        private static PrincipiaPerturber Body(string name, int index) =>
            new PrincipiaPerturber(name, index);

        /// <summary>
        /// The displaced solver, answering the save's own geometry: where any body is
        /// in any frame it can reach by summing the conics between them.
        /// </summary>
        private sealed class StockConics : IPropagationProvider
        {
            public string ProviderId => "stock-conics";

            public StateVector Solve(PropagationTarget target, PropagationFrame frame, double ut) =>
                new StateVector(
                    Where(target.BodyIndex, frame.CentreBodyIndex)(ut),
                    new Sitrep.Contract.Vector3d(0, 0, 0));

            public void SolveMany(
                PropagationTarget target,
                PropagationFrame frame,
                IReadOnlyList<double> uts,
                StateVector[] into)
            {
                for (var i = 0; i < uts.Count; i++) into[i] = Solve(target, frame, uts[i]);
            }

            public double? CharacteristicCycleSeconds(PropagationTarget target) =>
                target.BodyIndex switch
                {
                    RigGeometry.Kerbin => RigGeometry.KerbinAboutSun.CycleSeconds,
                    RigGeometry.Mun => RigGeometry.MunAboutKerbin.CycleSeconds,
                    RigGeometry.Minmus => RigGeometry.MinmusAboutKerbin.CycleSeconds,
                    _ => (double?)null,
                };

            public RadiusExtremes? RadiusExtremesOf(PropagationTarget target) => null;

            public bool CanPropagate(
                PropagationTarget target, PropagationFrame frame, double fromUt, double toUt) =>
                target.Kind == PropagationTargetKind.Body
                && target.BodyIndex != frame.CentreBodyIndex;

            public ClosestApproach? SolveClosestApproach(
                PropagationTarget subject,
                PropagationTarget other,
                PropagationFrame frame,
                double fromUt,
                double toUt) => null;

            private static Func<double, Sitrep.Contract.Vector3d> Where(int body, int centre)
            {
                if (centre == RigGeometry.Kerbin)
                {
                    if (body == RigGeometry.Sun) return RigGeometry.KerbinAboutSun.Inverted;
                    if (body == RigGeometry.Mun) return RigGeometry.MunAboutKerbin.At;
                    if (body == RigGeometry.Minmus) return RigGeometry.MinmusAboutKerbin.At;
                }
                if (centre == RigGeometry.Sun && body == RigGeometry.Kerbin)
                {
                    return RigGeometry.KerbinAboutSun.At;
                }
                return _ => new Sitrep.Contract.Vector3d(0, 0, 0);
            }
        }
    }
}
