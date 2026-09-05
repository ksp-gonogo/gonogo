using System;
using System.Collections.Generic;
using GonogoPrincipiaUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// How far this Uplink will vouch for a craft's published elements, driven
    /// against the geometry real craft in a live save actually presented.
    ///
    /// <para><b>Every vector below was measured on the rig on 2026-09-05</b>, out of
    /// the running game's own <c>system.bodies</c> and <c>system.vessels</c> frames:
    /// each craft's position and velocity about its primary, and each perturber's
    /// position in the same frame. Nothing here is invented geometry. The crossing
    /// each case names is the instant the two-body extrapolation was 100 m off the
    /// integrated path, measured by integrating the DIFFERENCE between the two
    /// curves with the conic in closed form.</para>
    ///
    /// <para><b>Why not against the mod's own published arc.</b> That arc is velocity
    /// Verlet at 300 steps a revolution, and with no perturbers in the model at all
    /// it walks 106 m off the conic it started on inside 700 s. A crossing measured
    /// against it is mostly its truncation, which is how the constant this file used
    /// to carry came to be four.</para>
    /// </summary>
    public class PrincipiaHorizonBoundTests
    {
        private const double KerbinMu = 3.531600000e12;
        private const double MunMu = 6.513839752e10;
        private const double SunMu = 1.172332795e18;
        private const double MinmusMu = 1.765800026e09;

        // === The 2600 km Kerbin relay, at the worst of its eight phases ===========
        private const double HighRelayCycle = 14012.112025446;
        private const double HighRelayCrossing = 913.946063;
        private static readonly StateVector HighRelay = new StateVector(
            new Vector3d(-2058527.629275, -1586268.828799, -0.263893),
            new Vector3d(710.516039, -924.343247, -0.000024));
        private static readonly Vector3d HighRelaySun =
            new Vector3d(-1494604768.414187, 13517332293.491650, 1931.916672);
        private static readonly Vector3d HighRelayMun =
            new Vector3d(-3961686.728595, -11440710.243837, -40.728213);
        private static readonly Vector3d HighRelayMinmus =
            new Vector3d(31770974.885652, -35709451.575688, 2865804.133975);

        // === The 250 km Kerbin relay, the same design five times lower ============
        private const double LowRelayCycle = 2620.124957479;
        private const double LowRelayCrossing = 1927.020809;
        private static readonly StateVector LowRelay = new StateVector(
            new Vector3d(-313423.498277, 790105.828003, 0.006963),
            new Vector3d(-1894.686390, -751.648292, -0.000040));
        private static readonly Vector3d LowRelaySun =
            new Vector3d(-1381485715.545664, 13529461609.700806, 2026.523922);
        private static readonly Vector3d LowRelayMun =
            new Vector3d(-9356335.123159, -7631118.061433, -85.645422);
        private static readonly Vector3d LowRelayMinmus =
            new Vector3d(29102807.208485, -37690822.593587, 3146349.570547);

        // === The Mun orbiter, and the Jool-system craft ===========================
        private const double MunOrbiterCycle = 2715.311383234;
        private const double MunOrbiterCrossing = 456.728295;
        private static readonly StateVector MunOrbiter = new StateVector(
            new Vector3d(169059.298353, 155675.364874, 0.037386),
            new Vector3d(-360.395409, 392.124980, 0.000109));
        private static readonly Vector3d MunOrbiterKerbin =
            new Vector3d(8615884.654564, 8459676.583551, 79.646452);
        private static readonly Vector3d MunOrbiterMinmus =
            new Vector3d(38172037.959853, -28914484.662886, 3100854.239430);

        private const double JoolCraftCycle = 5770.817133864;
        private const double JoolCraftCrossing = 333.327050;
        private static readonly StateVector JoolCraft = new StateVector(
            new Vector3d(-3531694.071729, -5099241.213855, -0.028059),
            new Vector3d(5545.087117, -3844.408734, 0.000177));

        [Fact]
        public void TheHighRelayIsBoundedByWhatItsOwnNeighbourhoodDoesToIt()
        {
            var span = PrincipiaHorizonBound.SpanSeconds(
                HighRelayForcing(), 0.001222, HighRelayCycle);

            Assert.Equal(618.984182587, span!.Value, 6);
            Assert.True(span.Value < HighRelayCrossing);
        }

        /// <summary>
        /// The low relay's departure never reaches the tolerance inside its own
        /// ceiling, so the ceiling is the whole of the answer.
        ///
        /// <para>This is the craft the rig measured at 1927 s, more than seven tenths
        /// of a revolution: the Mun's tide on a 250 km orbit turns over faster than
        /// it can build a hundred metres of offset. The flat rule this file used to
        /// carry gave it 443 s, and the reason was not caution, it was that the
        /// quantity being divided by four was never the right one.</para>
        /// </summary>
        [Fact]
        public void TheLowRelayIsHeldAtItsCeilingBecauseItsDepartureNeverReachesTheTolerance()
        {
            var forcing = LowRelayForcing();

            Assert.Equal(
                7.326443120,
                forcing.DepartureMetres(
                    2.0 * Math.PI / LowRelayCycle,
                    LowRelayCycle * PrincipiaHorizonBound.CycleCeilingFraction),
                6);

            var span = PrincipiaHorizonBound.SpanSeconds(forcing, 0.0000245, LowRelayCycle);
            Assert.Equal(
                LowRelayCycle * PrincipiaHorizonBound.CycleCeilingFraction, span!.Value, 6);
            Assert.True(span.Value < LowRelayCrossing);
        }

        /// <summary>
        /// The pair no fraction of a cycle can order, still true and now the other
        /// way up from the way the flat rule had it.
        /// </summary>
        [Fact]
        public void TwoRelaysInOneSaveGetHorizonsNoFractionOfACycleCouldProduce()
        {
            var high = PrincipiaHorizonBound.SpanSeconds(
                HighRelayForcing(), 0.001222, HighRelayCycle);
            var low = PrincipiaHorizonBound.SpanSeconds(
                LowRelayForcing(), 0.0000245, LowRelayCycle);

            Assert.True(HighRelayCycle > 5.0 * LowRelayCycle);
            Assert.True(high!.Value < low!.Value);
        }

        [Fact]
        public void TheMunOrbiterAndTheJoolCraftAreBothHeldUnderWhatTheRigMeasured()
        {
            var mun = PrincipiaHorizonBound.SpanSeconds(
                MunOrbiterForcing(), 0.001210, MunOrbiterCycle);
            var jool = PrincipiaHorizonBound.SpanSeconds(
                JoolCraftForcing(), 0.000660, JoolCraftCycle);

            Assert.Equal(304.734302715, mun!.Value, 6);
            Assert.Equal(224.033621072, jool!.Value, 6);
            Assert.True(mun.Value < MunOrbiterCrossing);
            Assert.True(jool.Value < JoolCraftCrossing);
        }

        /// <summary>
        /// One body, one mass, one distance, three places to put it, and three
        /// different answers.
        ///
        /// <para>This is the whole change in one assertion. The scalar the bound used
        /// to be computed from is <c>2 mu r / d^3</c>, which is identical in all three
        /// cases below; the instant the conic parts company is not, because a pull
        /// along the track changes the craft's energy and therefore its period while
        /// one straight up largely does not. A bound blind to that has to be safe for
        /// the worst of them, which is what the constant was.</para>
        /// </summary>
        [Fact]
        public void TheSameMassAtTheSameDistanceInThreeDirectionsIsThreeDifferentHorizons()
        {
            const double radius = 230000.0;
            const double distance = 12073467.225419;
            var craft = new StateVector(
                new Vector3d(radius, 0.0, 0.0),
                new Vector3d(0.0, Math.Sqrt(MunMu / radius), 0.0));

            var radial = new TidalForcing(craft);
            radial.Add(new Vector3d(distance, 0.0, 0.0), KerbinMu);
            var alongTrack = new TidalForcing(craft);
            alongTrack.Add(new Vector3d(0.0, distance, 0.0), KerbinMu);
            var polar = new TidalForcing(craft);
            polar.Add(new Vector3d(0.0, 0.0, distance), KerbinMu);

            // Identical to the last bit, because the scalar cannot see the difference.
            Assert.Equal(radial.WorstCaseAcceleration, alongTrack.WorstCaseAcceleration, 15);
            Assert.Equal(radial.WorstCaseAcceleration, polar.WorstCaseAcceleration, 15);

            var cycle = 2715.311383;
            Assert.Equal(
                461.882455 / PrincipiaHorizonBound.SafetyFactor,
                PrincipiaHorizonBound.SpanSeconds(radial, 0.0, cycle)!.Value, 4);
            Assert.Equal(
                634.113183 / PrincipiaHorizonBound.SafetyFactor,
                PrincipiaHorizonBound.SpanSeconds(alongTrack, 0.0, cycle)!.Value, 4);
            Assert.Equal(
                602.034585 / PrincipiaHorizonBound.SafetyFactor,
                PrincipiaHorizonBound.SpanSeconds(polar, 0.0, cycle)!.Value, 4);
        }

        /// <summary>
        /// An eccentric craft takes the fallback, and the case that says why.
        ///
        /// <para>A 2600 km Kerbin orbit at seven tenths eccentricity, measured on the
        /// same real Mun and Sun geometry: the conic is 100 m out after 1636 s, and
        /// the departure law would have vouched for 1645. It is not far wrong, it is
        /// wrong in the direction that draws a curve nothing flies, and the reason is
        /// that the relative-motion equations behind it take the mean motion for the
        /// craft's actual angular rate, which near periapsis it is not.</para>
        /// </summary>
        [Fact]
        public void AnEccentricCraftTakesTheFallbackBecauseTheLawAssumesACircularOrbit()
        {
            const double cycle = 14016.969754808;
            const double measured = 1636.354203;
            var forcing = EccentricRelayForcing();

            // What the departure law says, which is past what the craft can stand.
            Assert.True(FirstCrossingOf(forcing, cycle) > measured);

            var span = PrincipiaHorizonBound.SpanSeconds(forcing, 0.7, cycle);
            Assert.Equal(369.840727635, span!.Value, 6);
            Assert.True(span.Value < measured);
        }

        /// <summary>
        /// A craft out level with a perturber takes the fallback too, and the
        /// fallback's own divisor had to move.
        ///
        /// <para>An 8000 km Kerbin orbit at seven tenths eccentricity passes within a
        /// tenth of the Mun's own distance, which is not a neighbourhood the
        /// <c>(r/d)</c> expansion describes at all. Measured, its conic is 100 m out
        /// after 107 s. The flat <c>/4</c> this file used to carry vouches for 124,
        /// so the constant was not merely conservative, it was unsafe out here as
        /// well.</para>
        /// </summary>
        [Fact]
        public void ACraftOutLevelWithAPerturberTakesTheFallbackAndTheOldDivisorWasNotEnough()
        {
            const double cycle = 75653.512183621;
            const double measured = 106.702226;
            var forcing = FarFieldCraftForcing();

            Assert.True(forcing.NearestRatio > PrincipiaHorizonBound.NearFieldRatio);

            var span = PrincipiaHorizonBound.SpanSeconds(forcing, 0.7, cycle);
            Assert.Equal(99.015086897, span!.Value, 6);
            Assert.True(span.Value < measured);

            // The same kinematic span over the constant this file used to carry.
            var wasPublished =
                Math.Sqrt(2.0 * PrincipiaHorizonBound.ToleranceMetres
                          / forcing.WorstCaseAcceleration) / 4.0;
            Assert.True(wasPublished > measured);
        }

        [Fact]
        public void TheTidalTermMatchesTheMoonTheRigMeasured()
        {
            // The Mun's worst-case differential pull across a 250 km Kerbin orbit.
            Assert.Equal(
                6.292071116e-05,
                PrincipiaHorizonBound.PerturbingAcceleration(
                    850007.150699, MunMu, 12073467.225419),
                12);
        }

        [Fact]
        public void ABodyWithNoUsableMassOrDistanceDropsOutOfTheSumInsteadOfPoisoningIt()
        {
            Assert.Equal(
                0.0, PrincipiaHorizonBound.PerturbingAcceleration(850007.0, MunMu, 0.0));
            Assert.Equal(
                0.0, PrincipiaHorizonBound.PerturbingAcceleration(850007.0, 0.0, 1.2e7));
            Assert.Equal(
                0.0,
                PrincipiaHorizonBound.PerturbingAcceleration(
                    850007.0, MunMu, double.PositiveInfinity));

            var forcing = LowRelayForcing();
            var before = forcing.WorstCaseAcceleration;
            forcing.Add(new Vector3d(0.0, 0.0, 0.0), MunMu);
            forcing.Add(LowRelayMun, double.PositiveInfinity);
            Assert.Equal(before, forcing.WorstCaseAcceleration, 15);
        }

        [Fact]
        public void ACalmNeighbourhoodIsHeldAtTheCycleCeilingRatherThanRunningAway()
        {
            // A thousandth of what the Mun does to a Kerbin relay. The departure alone
            // would vouch for hours; the ceiling is what stops it, because every
            // perturber is held still while only the craft's own phase is carried
            // forward.
            var craft = new StateVector(
                new Vector3d(850007.150699, 0.0, 0.0),
                new Vector3d(0.0, Math.Sqrt(KerbinMu / 850007.150699), 0.0));
            var forcing = new TidalForcing(craft);
            forcing.Add(new Vector3d(1.2e9, 0.0, 0.0), MunMu);

            var span = PrincipiaHorizonBound.SpanSeconds(forcing, 0.0, LowRelayCycle);

            Assert.Equal(
                LowRelayCycle * PrincipiaHorizonBound.CycleCeilingFraction, span!.Value, 6);
        }

        [Fact]
        public void NothingPullingAndNoCycleIsARefusalRatherThanAGuess()
        {
            var empty = new TidalForcing(LowRelay);

            Assert.Null(PrincipiaHorizonBound.SpanSeconds(empty, 0.0, null));
            Assert.Null(PrincipiaHorizonBound.SpanSeconds(null, 0.0, null));
            Assert.Null(PrincipiaHorizonBound.SpanSeconds(empty, 0.0, double.NaN));
        }

        /// <summary>
        /// A craft with no rate has no along-track direction, so the law has nothing
        /// to resolve against and says so instead of resolving against an axis it
        /// picked.
        /// </summary>
        [Fact]
        public void ACraftWithNoRateHasNoFrameAndTakesTheFallback()
        {
            var stationary = new TidalForcing(
                new StateVector(new Vector3d(850007.150699, 0.0, 0.0), new Vector3d(0, 0, 0)));
            stationary.Add(LowRelayMun, MunMu);

            Assert.False(stationary.HasFrame);
            Assert.False(stationary.Any);
            Assert.Equal(
                LowRelayCycle * PrincipiaHorizonBound.CycleCeilingFraction,
                PrincipiaHorizonBound.SpanSeconds(stationary, 0.0, LowRelayCycle)!.Value,
                6);
        }

        [Fact]
        public void ACraftWithNoCycleIsStillBoundedByWhatPullsOnIt()
        {
            // No repeat to take a ceiling from, and no mean motion to run the
            // departure law against either, so the direction-blind arm answers.
            var span = PrincipiaHorizonBound.SpanSeconds(HighRelayForcing(), 0.0, null);

            Assert.Equal(
                Math.Sqrt(2.0 * PrincipiaHorizonBound.ToleranceMetres
                          / HighRelayForcing().WorstCaseAcceleration)
                / PrincipiaHorizonBound.FarFieldAmplification,
                span!.Value,
                9);
        }

        // === The provider, computing the same bound from the pieces it can reach ==

        [Fact]
        public void TheProviderRefusesTheWindowPastItsOwnBoundAndAllowsTheOneInside()
        {
            var provider = HighRelayProvider();
            var target = Craft(HighRelayCycle);
            var frame = PropagationFrame.CentredOn(Kerbin);

            Assert.True(provider.CanPropagate(target, frame, 100.0, 100.0 + 618.0));
            Assert.False(provider.CanPropagate(target, frame, 100.0, 100.0 + 620.0));
        }

        [Fact]
        public void TheProviderBoundsTheHigherRelayShorterDespiteItsLongerCycle()
        {
            var frame = PropagationFrame.CentredOn(Kerbin);

            // 640 seconds is inside the low relay's ceiling of 655 and outside the
            // high relay's bound of 619, though the high relay's cycle is five times
            // longer.
            Assert.True(LowRelayProvider().CanPropagate(
                Craft(LowRelayCycle), frame, 0.0, 640.0));
            Assert.False(HighRelayProvider().CanPropagate(
                Craft(HighRelayCycle), frame, 0.0, 640.0));
        }

        [Fact]
        public void TheInstantItselfIsAnsweredHoweverPerturbedTheCraftIs()
        {
            // Every visibility and encounter caller asks a zero-length window, which
            // is asking where something IS. The osculating elements answer that
            // exactly, so a horizon has nothing to say about it.
            Assert.True(HighRelayProvider().CanPropagate(
                Craft(HighRelayCycle), PropagationFrame.CentredOn(Kerbin), 500.0, 500.0));
        }

        [Fact]
        public void WithNoForceModelTheProviderVouchesForNoWindowAtAll()
        {
            // An install whose gravity model could not be read has no way to bound a
            // craft. Refusing is what turns that into an Unspecified horizon, which a
            // client reads as unpropagatable; substituting stock's masses would answer
            // with a bound that agrees with nothing.
            var provider = new PrincipiaPropagationProvider(
                HighRelayConics(), () => null, _ => KerbinNeighbourhood);
            var frame = PropagationFrame.CentredOn(Kerbin);

            Assert.True(provider.CanPropagate(Craft(HighRelayCycle), frame, 0.0, 0.0));
            Assert.False(provider.CanPropagate(Craft(HighRelayCycle), frame, 0.0, 1.0));
        }

        [Fact]
        public void ABodyIsNeverBoundedBecauseTheHorizonIsAboutACraftsOwnElements()
        {
            // The acceleration walk that computes a bound asks this same question
            // about each perturber it wants to place, so bounding a body here would
            // refuse the walk the bound is made of.
            Assert.True(HighRelayProvider().CanPropagate(
                PropagationTarget.Body(Mun), PropagationFrame.CentredOn(Kerbin), 0.0, 86_400.0));
        }

        [Fact]
        public void APerturberTheForceModelDoesNotNameLengthensTheBoundInsteadOfStoppingIt()
        {
            // A term that cannot be matched is a term that cannot be summed, so the
            // bound comes out LONGER than the truth: the model is degraded and the
            // arc says so separately. What must not happen is the whole answer going
            // away, because a craft with one unknown neighbour is still bounded by the
            // ones we do know.
            var provider = new PrincipiaPropagationProvider(
                LowRelayConics(),
                () => new GravityModel("partial", new[] { new GravityModelBody("Sun", SunMu) }),
                _ => KerbinNeighbourhood);
            var frame = PropagationFrame.CentredOn(Kerbin);

            // The Sun alone is a hundredth of the Mun across this orbit, so the
            // departure never reaches the tolerance and the ceiling is all that is
            // left.
            Assert.True(provider.CanPropagate(Craft(LowRelayCycle), frame, 0.0, 655.0));
            Assert.False(provider.CanPropagate(Craft(LowRelayCycle), frame, 0.0, 656.0));
        }

        private const int Kerbin = 1;
        private const int Mun = 2;
        private const int Minmus = 3;
        private const int Sun = 0;

        /// <summary>
        /// Kerbin's neighbourhood as the rig walked it, minus the six planets whose
        /// terms are below 1e-9 m/s^2 and cannot move any assertion here.
        /// </summary>
        private static readonly IReadOnlyList<PrincipiaPerturber> KerbinNeighbourhood =
            new[]
            {
                new PrincipiaPerturber("Sun", Sun),
                new PrincipiaPerturber("Mun", Mun),
                new PrincipiaPerturber("Minmus", Minmus),
            };

        private static TidalForcing HighRelayForcing()
        {
            var forcing = new TidalForcing(HighRelay);
            forcing.Add(HighRelaySun, SunMu);
            forcing.Add(HighRelayMun, MunMu);
            forcing.Add(HighRelayMinmus, MinmusMu);
            return forcing;
        }

        private static TidalForcing LowRelayForcing()
        {
            var forcing = new TidalForcing(LowRelay);
            forcing.Add(LowRelaySun, SunMu);
            forcing.Add(LowRelayMun, MunMu);
            forcing.Add(LowRelayMinmus, MinmusMu);
            return forcing;
        }

        private static TidalForcing MunOrbiterForcing()
        {
            var forcing = new TidalForcing(MunOrbiter);
            forcing.Add(MunOrbiterKerbin, KerbinMu);
            forcing.Add(MunOrbiterMinmus, MinmusMu);
            return forcing;
        }

        /// <summary>Jool's neighbourhood, the five bodies above 1e-9 m/s^2 for this craft.</summary>
        private static TidalForcing JoolCraftForcing()
        {
            var forcing = new TidalForcing(JoolCraft);
            forcing.Add(
                new Vector3d(55987324006.664253, -33729513558.839901, -179587012.575099), SunMu);
            forcing.Add(
                new Vector3d(-7719854.835753, -26119308.666344, 44.619914), 1.962000029e12);
            forcing.Add(
                new Vector3d(-42879287.744487, -23874490.522582, 358.879452), 2.074814995e11);
            forcing.Add(
                new Vector3d(30773983.076803, -167359659.721808, -295372.013944), 2.486834944e09);
            forcing.Add(
                new Vector3d(9487085.720159, 90576736.790391, -3651.175803), 2.825280042e12);
            return forcing;
        }

        /// <summary>A 2600 km Kerbin orbit at 0.7 eccentricity, on the rig's own Mun and Sun.</summary>
        private static TidalForcing EccentricRelayForcing()
        {
            var forcing = new TidalForcing(new StateVector(
                new Vector3d(-135445.578580, 768150.047350, 0.0),
                new Vector3d(-2732.211861, -481.762668, 0.0)));
            forcing.Add(LowRelaySun, SunMu);
            forcing.Add(LowRelayMun, MunMu);
            forcing.Add(LowRelayMinmus, MinmusMu);
            return forcing;
        }

        /// <summary>An 8000 km Kerbin orbit at 0.7 eccentricity, level with the Mun.</summary>
        private static TidalForcing FarFieldCraftForcing()
        {
            var forcing = new TidalForcing(new StateVector(
                new Vector3d(-2955526.688813, -10686422.101448, 0.0),
                new Vector3d(255.342324, -361.090809, 0.0)));
            forcing.Add(
                new Vector3d(-1555941218.365442, 13510354362.418919, 1880.524560), SunMu);
            forcing.Add(new Vector3d(-428167.054963, -12142598.955284, -10.332055), MunMu);
            forcing.Add(
                new Vector3d(33155183.671976, -34561333.510416, 2707680.282206), MinmusMu);
            return forcing;
        }

        /// <summary>
        /// The first instant the departure law itself names, with no domain guard and
        /// no margin: what the bound WOULD have been had the guard not fired.
        /// </summary>
        private static double FirstCrossingOf(TidalForcing forcing, double cycle)
        {
            var meanMotion = 2.0 * Math.PI / cycle;
            var ceiling = cycle * PrincipiaHorizonBound.CycleCeilingFraction;
            for (var i = 1; i <= 4096; i++)
            {
                var t = ceiling * PrincipiaHorizonBound.SafetyFactor * i / 4096;
                if (forcing.DepartureMetres(meanMotion, t)
                    >= PrincipiaHorizonBound.ToleranceMetres)
                {
                    return t;
                }
            }
            return double.PositiveInfinity;
        }

        private static PrincipiaPropagationProvider HighRelayProvider() =>
            new PrincipiaPropagationProvider(
                HighRelayConics(), StockMasses, _ => KerbinNeighbourhood);

        private static PrincipiaPropagationProvider LowRelayProvider() =>
            new PrincipiaPropagationProvider(
                LowRelayConics(), StockMasses, _ => KerbinNeighbourhood);

        private static GravityModel StockMasses() =>
            new GravityModel(
                "rig-2026-09-05",
                new[]
                {
                    new GravityModelBody("Sun", SunMu),
                    new GravityModelBody("Mun", MunMu),
                    new GravityModelBody("Minmus", MinmusMu),
                });

        private static StubConics HighRelayConics() =>
            new StubConics(HighRelay, HighRelayCycle, HighRelaySun, HighRelayMun,
                HighRelayMinmus);

        private static StubConics LowRelayConics() =>
            new StubConics(LowRelay, LowRelayCycle, LowRelaySun, LowRelayMun,
                LowRelayMinmus);

        /// <summary>
        /// A craft about Kerbin. Only the id, the parent, the eccentricity and the
        /// presence of elements matter to the bound: the geometry comes from the
        /// solver, which is the whole point of asking one rather than reading the
        /// conic here.
        /// </summary>
        private static PropagationTarget Craft(double cycle) =>
            PropagationTarget.Vessel(
                "craft-" + cycle.ToString("R"),
                Kerbin,
                new OrbitElements(cycle * 100.0, 0.001, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu));

        /// <summary>
        /// The displaced solver, answering the rig's own geometry: the craft's state
        /// about its primary, and each body's position in the same frame.
        /// </summary>
        private sealed class StubConics : IPropagationProvider
        {
            private readonly StateVector _craft;
            private readonly double _cycle;
            private readonly Vector3d _sun;
            private readonly Vector3d _mun;
            private readonly Vector3d _minmus;

            public StubConics(
                StateVector craft, double cycle, Vector3d sun, Vector3d mun, Vector3d minmus)
            {
                _craft = craft;
                _cycle = cycle;
                _sun = sun;
                _mun = mun;
                _minmus = minmus;
            }

            public string ProviderId => "stub-conics";

            public StateVector Solve(PropagationTarget target, PropagationFrame frame, double ut)
            {
                if (target.Kind == PropagationTargetKind.Vessel) return _craft;
                var position = target.BodyIndex == Mun ? _mun
                    : target.BodyIndex == Minmus ? _minmus
                    : _sun;
                return new StateVector(position, new Vector3d(0, 0, 0));
            }

            public void SolveMany(
                PropagationTarget target,
                PropagationFrame frame,
                IReadOnlyList<double> uts,
                StateVector[] into)
            {
                for (var i = 0; i < uts.Count; i++) into[i] = Solve(target, frame, uts[i]);
            }

            public double? CharacteristicCycleSeconds(PropagationTarget target) =>
                target.Kind == PropagationTargetKind.Vessel ? _cycle : (double?)null;

            public RadiusExtremes? RadiusExtremesOf(PropagationTarget target) => null;

            public bool CanPropagate(
                PropagationTarget target, PropagationFrame frame, double fromUt, double toUt) => true;

            public ClosestApproach? SolveClosestApproach(
                PropagationTarget subject,
                PropagationTarget other,
                PropagationFrame frame,
                double fromUt,
                double toUt) => null;
        }
    }
}
