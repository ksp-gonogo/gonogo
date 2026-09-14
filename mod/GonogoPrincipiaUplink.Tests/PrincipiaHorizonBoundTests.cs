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
    /// <para><b>Every element below was measured on the rig on 2026-09-05</b>, off the
    /// running game's own <c>system.bodies</c> and <c>system.vessels</c> frames: each
    /// craft's conic about its primary and each perturber's conic in the same frame.
    /// Nothing here is invented geometry, and the conic evaluator at the bottom is
    /// checked against the game's own published trajectory arc rather than assumed:
    /// fed the active craft's elements it lands on the arc's first point to a
    /// nanometre.</para>
    ///
    /// <para><b>The crossing each case names is what the rig measured</b>, by
    /// integrating the FULL perturbed path at a step seventy-five times finer than
    /// this law takes and differencing it against the conic in closed form. That is
    /// separate machinery from the law, which integrates the difference directly;
    /// grading the law against a restatement of itself would grade nothing.</para>
    ///
    /// <para><b>Why not against the mod's own published arc.</b> That arc is velocity
    /// Verlet at 300 steps a revolution, and with no perturbers in the model at all it
    /// walks 106 m off the conic it started on inside 700 s. A crossing measured
    /// against it is mostly its truncation, which is how this file came to carry a
    /// constant of four.</para>
    /// </summary>
    public class PrincipiaHorizonBoundTests
    {
        // The masses, indices, sample instant and body conics all come from
        // RigGeometry, which is the one declaration of what the rig measured. Named
        // here so every expression below still reads as it did.
        private const double SunMu = RigGeometry.SunMu;
        private const double KerbinMu = RigGeometry.KerbinMu;
        private const double MunMu = RigGeometry.MunMu;
        private const double MinmusMu = RigGeometry.MinmusMu;
        private const double JoolMu = RigGeometry.JoolMu;

        private const int Sun = RigGeometry.Sun;
        private const int Kerbin = RigGeometry.Kerbin;
        private const int Mun = RigGeometry.Mun;
        private const int Minmus = RigGeometry.Minmus;
        private const int Jool = RigGeometry.Jool;
        private const int Laythe = RigGeometry.Laythe;
        private const int Vall = RigGeometry.Vall;
        private const int Bop = RigGeometry.Bop;
        private const int Tylo = RigGeometry.Tylo;
        private const int Pol = RigGeometry.Pol;

        /// <summary>The instant every craft below was sampled at.</summary>
        private const double SampleUt = RigGeometry.SampleUt;

        private static readonly Conic KerbinAboutSun = RigGeometry.KerbinAboutSun;
        private static readonly Conic MunAboutKerbin = RigGeometry.MunAboutKerbin;
        private static readonly Conic MinmusAboutKerbin = RigGeometry.MinmusAboutKerbin;
        private static readonly Conic JoolAboutSun = RigGeometry.JoolAboutSun;
        private static readonly Conic LaytheAboutJool = RigGeometry.LaytheAboutJool;
        private static readonly Conic VallAboutJool = RigGeometry.VallAboutJool;
        private static readonly Conic BopAboutJool = RigGeometry.BopAboutJool;
        private static readonly Conic TyloAboutJool = RigGeometry.TyloAboutJool;
        private static readonly Conic PolAboutJool = RigGeometry.PolAboutJool;

        /// <summary>
        /// Every orbiting craft in the save at its worst of eight phases, with the
        /// span this law publishes for it and the instant the rig measured its conic
        /// 100 m off the path.
        /// </summary>
        public static IEnumerable<object[]> EveryCraft()
        {
            yield return new object[] { "kerbin-relay-2599km" };
            yield return new object[] { "kerbin-relay-2600km" };
            yield return new object[] { "mun-orbiter-230km" };
            yield return new object[] { "jool-craft-6200km" };
            yield return new object[] { "kerbin-relay-850km-a" };
            yield return new object[] { "kerbin-relay-850km-b" };
            yield return new object[] { "kerbin-relay-850km-c" };
            yield return new object[] { "kerbin-relay-850km-d" };
            yield return new object[] { "kerbin-relay-850km-e" };
            yield return new object[] { "kerbin-relay-687km" };
        }

        private sealed class Craft
        {
            public Craft(string name, Conic conic, double cycle, double span, double measured,
                int primary, params int[] perturbers)
            {
                Name = name;
                Orbit = conic;
                Cycle = cycle;
                Span = span;
                Measured = measured;
                Primary = primary;
                Perturbers = perturbers;
            }

            public string Name { get; }

            public Conic Orbit { get; }

            public double Cycle { get; }

            /// <summary>What this law publishes.</summary>
            public double Span { get; }

            /// <summary>What the rig measured the conic to be 100 m off at.</summary>
            public double Measured { get; }

            public int Primary { get; }

            public int[] Perturbers { get; }
        }

        private static readonly Dictionary<string, Craft> Fleet = new Dictionary<string, Craft>
        {
            ["kerbin-relay-2599km"] = new Craft(
                "kerbin-relay-2599km",
                new Conic(2598604.0585173, 0.000458485750484473, 8.31412564244247e-06,
                    317.427133505609, 122.3730260052, 3.074567877911057, 161619.050122945,
                    KerbinMu),
                14005.682691572385, 578.965099921, 868.448484330,
                Kerbin, Sun, Mun, Minmus),
            ["kerbin-relay-2600km"] = new Craft(
                "kerbin-relay-2600km",
                new Conic(2600057.8552369, 0.000408807947476149, 8.62812527221669e-06,
                    317.33636413547, 152.893138381028, 2.393469512306825, 161619.050122945,
                    KerbinMu),
                14017.437616125473, 563.002309300, 844.502793945,
                Kerbin, Sun, Mun, Minmus),
            ["mun-orbiter-230km"] = new Craft(
                "mun-orbiter-230km",
                new Conic(230235.2708912, 0.0015713640120561, 1.84347425334662e-05,
                    12.3222366995712, 51.7408385283329, 6.04683054815175, 161619.050122945,
                    MunMu),
                2719.6882029054477, 289.986308883, 434.978360663,
                Mun, Kerbin, Minmus),
            ["jool-craft-6200km"] = new Craft(
                "jool-craft-6200km",
                new Conic(6199741.68665824, 0.000656416999809348, 1.74970486379097e-06,
                    246.728015475484, 186.19233499881, 3.7861234595060167, 161619.050122945,
                    JoolMu),
                5770.447709882756, 221.223053066, 331.834522845,
                Jool, Sun, Laythe, Vall, Bop, Tylo, Pol),
            ["kerbin-relay-850km-a"] = new Craft(
                "kerbin-relay-850km-a",
                new Conic(850012.544951426, 4.79543046927923e-05, 1.57397178137404e-06,
                    316.347252265179, 184.692496994714, 6.799857535101366, 161619.030122945,
                    KerbinMu),
                2620.185972505524, 962.944745866, 1444.415538244,
                Kerbin, Sun, Mun, Minmus),
            ["kerbin-relay-850km-b"] = new Craft(
                "kerbin-relay-850km-b",
                new Conic(849984.480983169, 2.95453647583449e-05, 1.56208176405927e-06,
                    316.342573212443, 141.683651352267, 0.877977703052186, 161619.050122945,
                    KerbinMu),
                2620.0562116988376, 1106.278130572, 1659.416244181,
                Kerbin, Sun, Mun, Minmus),
            ["kerbin-relay-850km-c"] = new Craft(
                "kerbin-relay-850km-c",
                new Conic(849999.520194218, 3.72864023321515e-05, 1.56885466064414e-06,
                    316.499675036966, 153.818742411589, 7.037133594203452, 161619.050122945,
                    KerbinMu),
                2620.1257490024695, 1054.684030400, 1582.024965986,
                Kerbin, Sun, Mun, Minmus),
            ["kerbin-relay-850km-d"] = new Craft(
                "kerbin-relay-850km-d",
                new Conic(849984.186854544, 2.96856685691636e-05, 1.56208026803209e-06,
                    316.308044803691, 140.456929933308, 0.982489976570581, 161619.050122945,
                    KerbinMu),
                2620.0548517325997, 1058.726009296, 1588.087963671,
                Kerbin, Sun, Mun, Minmus),
            ["kerbin-relay-850km-e"] = new Craft(
                "kerbin-relay-850km-e",
                new Conic(850015.101772869, 2.96674752784589e-05, 1.57504658342958e-06,
                    316.287892063233, 164.171341761939, 6.978007522325086, 161619.050122945,
                    KerbinMu),
                2620.1977947181904, 1005.394732638, 1508.090857221,
                Kerbin, Sun, Mun, Minmus),
            ["kerbin-relay-687km"] = new Craft(
                "kerbin-relay-687km",
                new Conic(686747.134868253, 2.83780827475356e-05, 1.14194458894219e-06,
                    316.299474866582, 152.15669736852, 7.478587827690451, 161619.050122945,
                    KerbinMu),
                1902.783595582952, 3055.194240363, 4582.582300706,
                Kerbin, Sun, Mun, Minmus),
        };

        /// <summary>
        /// The whole safety claim, on every craft in the save at the worst phase each
        /// of them presented.
        ///
        /// <para>A horizon longer than the instant the conic is actually 100 m off is
        /// the failure this seam exists to prevent, and it is the one thing here that
        /// may never regress. The margin is uniform because the law LANDS on the
        /// crossing rather than bounding it: what separates the two columns is
        /// <see cref="PrincipiaHorizonBound.SafetyFactor"/> and nothing else.</para>
        /// </summary>
        [Theory]
        [MemberData(nameof(EveryCraft))]
        public void NoCraftIsVouchedForPastTheInstantItsConicIsAHundredMetresOff(string name)
        {
            var craft = Fleet[name];
            var span = SpanOf(craft);

            Assert.NotNull(span);
            Assert.True(
                span!.Value < craft.Measured,
                $"{name}: published {span.Value} but the rig measured {craft.Measured}");
            Assert.Equal(craft.Span, span.Value, 6);
        }

        /// <summary>
        /// The 687 km relay is the craft the quarter-cycle ceiling cost most, and the
        /// reason this file was rewritten.
        ///
        /// <para>Its cycle is 1903 s, so the ceiling vouched for 476 and the rig
        /// measures its conic still inside a hundred metres at 4583. Nothing about the
        /// craft changed; what changed is that the departure is now integrated to its
        /// own answer instead of being cut off where holding the neighbourhood still
        /// stopped being defensible.</para>
        /// </summary>
        [Fact]
        public void TheRelayTheCeilingCostMostGetsSixTimesTheArc()
        {
            var craft = Fleet["kerbin-relay-687km"];
            var span = SpanOf(craft)!.Value;
            var oldCeiling = craft.Cycle * 0.25;

            Assert.Equal(475.695898895738, oldCeiling, 9);
            Assert.True(span > 6.0 * oldCeiling, $"{span} against a ceiling of {oldCeiling}");
            Assert.True(span < craft.Measured);
        }

        /// <summary>
        /// The pair no fraction of a cycle can order: the relay with the longer
        /// revolution gets the shorter horizon, because it sits five times further out
        /// in the same neighbourhood.
        /// </summary>
        [Fact]
        public void TwoRelaysInOneSaveGetHorizonsNoFractionOfACycleCouldProduce()
        {
            var high = Fleet["kerbin-relay-2599km"];
            var low = Fleet["kerbin-relay-850km-a"];

            Assert.True(high.Cycle > 5.0 * low.Cycle);
            Assert.True(SpanOf(high)!.Value < SpanOf(low)!.Value);
        }

        /// <summary>
        /// The check that catches the whole class of error this file has now made
        /// twice: an instrument asked for a number that is known independently.
        ///
        /// <para>With nothing in the force model the conic IS the path, so the
        /// departure is zero at every instant, exactly. The mod's own arc integrator
        /// asked the same question answers 106 m over 700 s, and that difference is
        /// the truncation which two earlier sets of constants here were mostly
        /// measuring. Nothing about this law is believable if it cannot report a zero
        /// it is entitled to.</para>
        /// </summary>
        [Fact]
        public void AnEmptyForceModelDepartsByExactlyNothing()
        {
            var craft = Fleet["kerbin-relay-850km-a"];
            var departure = new ConicDeparture(KerbinMu, SampleUt, craft.Orbit.At);

            Assert.False(departure.Any);
            for (var revolution = 1; revolution <= 4; revolution++)
            {
                Assert.Equal(
                    0.0,
                    departure.MetresAt(
                        revolution * craft.Cycle,
                        craft.Cycle / PrincipiaHorizonBound.StepsPerRevolution));
            }
        }

        /// <summary>
        /// A craft nothing measurable pulls on is vouched for as far as we looked, and
        /// the span says exactly how far that was.
        /// </summary>
        [Fact]
        public void ACalmNeighbourhoodIsVouchedForAsFarAsTheSearchWentAndNoFurther()
        {
            var craft = Fleet["kerbin-relay-850km-a"];
            var departure = new ConicDeparture(KerbinMu, SampleUt, craft.Orbit.At);

            var span = PrincipiaHorizonBound.SpanSeconds(departure, craft.Cycle);

            Assert.Equal(
                craft.Cycle * PrincipiaHorizonBound.SearchCycles
                / PrincipiaHorizonBound.SafetyFactor,
                span!.Value,
                9);
        }

        /// <summary>
        /// A 2600 km Kerbin orbit at seven tenths eccentricity: past the domain the
        /// previous law stated for itself, and now simply computed.
        ///
        /// <para>That law took the mean motion for the craft's actual angular rate,
        /// which near periapsis it is not, so it handed anything above half an
        /// eccentricity to a direction-blind fallback and published 370 s. The conic
        /// is now asked where the craft is instead of assumed to be a circle, and the
        /// answer is 907 against a measured 1361.</para>
        /// </summary>
        [Fact]
        public void AnEccentricCraftIsComputedRatherThanHandedToAFallback()
        {
            var cycle = 14016.969754807906;
            var craft = new Conic(2600000.0, 0.7, 0.0, 0.0, 0.0, 0.7, SampleUt, KerbinMu);
            var span = PrincipiaHorizonBound.SpanSeconds(KerbinNeighbourhood(craft), cycle);

            Assert.Equal(907.294750793, span!.Value, 6);
            Assert.True(span.Value < 1360.939466983);
        }

        /// <summary>
        /// An 8000 km Kerbin orbit at seven tenths eccentricity, apoapsis level with
        /// the Mun: past the other domain the previous law stated, where the
        /// <c>(r/d)</c> expansion it was built on has stopped describing anything.
        ///
        /// <para>Nothing is expanded now, so there is nothing to leave the domain of.
        /// The craft's radius reaches 1.1 times the Mun's own distance and the law
        /// still lands on the crossing.</para>
        /// </summary>
        [Fact]
        public void ACraftOutLevelWithAPerturberIsComputedToo()
        {
            var cycle = 75653.51218362067;
            var craft = new Conic(8000000.0, 0.7, 0.0, 0.0, 0.0, 0.7, SampleUt, KerbinMu);
            var span = PrincipiaHorizonBound.SpanSeconds(KerbinNeighbourhood(craft), cycle);

            Assert.Equal(594.434480822, span!.Value, 6);
            Assert.True(span.Value < 891.647737137);
        }

        /// <summary>
        /// One body, one mass, one distance, three places to put it, and three
        /// different answers.
        ///
        /// <para>The scalar a bound used to be computed from is <c>2 mu r / d^3</c>,
        /// identical in all three cases below; the instant the conic parts company is
        /// not, because a pull along the track changes the craft's energy and
        /// therefore its period while one straight up largely does not. A bound blind
        /// to that has to be safe for the worst of them, which is what a global
        /// constant was.</para>
        /// </summary>
        [Fact]
        public void TheSameMassAtTheSameDistanceInThreeDirectionsIsThreeDifferentHorizons()
        {
            const double radius = 230000.0;
            const double distance = 12073467.225419;
            var cycle = 2.0 * Math.PI * Math.Sqrt(radius * radius * radius / MunMu);
            var craft = new Conic(radius, 0.0, 0.0, 0.0, 0.0, 0.0, SampleUt, MunMu);

            var radial = Fixed(craft, new Sitrep.Contract.Vector3d(distance, 0.0, 0.0));
            var alongTrack = Fixed(craft, new Sitrep.Contract.Vector3d(0.0, distance, 0.0));
            var polar = Fixed(craft, new Sitrep.Contract.Vector3d(0.0, 0.0, distance));

            Assert.Equal(
                radial.WorstCaseAcceleration, alongTrack.WorstCaseAcceleration, 15);
            Assert.Equal(radial.WorstCaseAcceleration, polar.WorstCaseAcceleration, 15);

            var one = PrincipiaHorizonBound.SpanSeconds(radial, cycle)!.Value;
            var two = PrincipiaHorizonBound.SpanSeconds(alongTrack, cycle)!.Value;
            var three = PrincipiaHorizonBound.SpanSeconds(polar, cycle)!.Value;

            Assert.True(one < two);
            Assert.True(three < two);
            Assert.True(one < three);
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

            var craft = Fleet["kerbin-relay-850km-a"];
            var departure = KerbinNeighbourhood(craft.Orbit);
            var before = departure.WorstCaseAcceleration;

            departure.Add(MunMu, _ => new Sitrep.Contract.Vector3d(0, 0, 0));
            departure.Add(double.PositiveInfinity, MunAboutKerbin.At);
            departure.Add(MunMu, null);
            departure.Add(
                MunMu, _ => new Sitrep.Contract.Vector3d(double.NaN, 0.0, 0.0));

            Assert.Equal(before, departure.WorstCaseAcceleration, 15);
            Assert.Equal(SpanOf(craft)!.Value, PrincipiaHorizonBound.SpanSeconds(
                departure, craft.Cycle)!.Value, 9);
        }

        /// <summary>
        /// A solver that cannot put the craft anywhere leaves nothing to depart from,
        /// and that is a refusal rather than a span computed from an origin.
        /// </summary>
        [Fact]
        public void AConicThatPutsTheCraftNowhereIsARefusal()
        {
            var nowhere = new ConicDeparture(
                KerbinMu, SampleUt, _ => new Sitrep.Contract.Vector3d(0, 0, 0));
            var notFinite = new ConicDeparture(
                KerbinMu, SampleUt,
                _ => new Sitrep.Contract.Vector3d(double.NaN, 0.0, 0.0));

            Assert.False(nowhere.HasCraft);
            Assert.False(notFinite.HasCraft);
            nowhere.Add(MunMu, MunAboutKerbin.At);
            Assert.False(nowhere.Any);

            // A cycle does not rescue it: without a conic there is nothing to measure
            // a departure from, and the search window would be a span invented out of
            // the craft's period, which is what this whole seam replaced.
            Assert.Null(PrincipiaHorizonBound.SpanSeconds(nowhere, null));
            Assert.Null(PrincipiaHorizonBound.SpanSeconds(nowhere, 2620.0));
            Assert.Null(PrincipiaHorizonBound.SpanSeconds(notFinite, 2620.0));
            Assert.Null(PrincipiaHorizonBound.SpanSeconds(null, null));

            // A craft nothing pulls on and with no repeat is the other half of the
            // refusal: no rate to divide the tolerance by and no scale to search over.
            var unpulled = new ConicDeparture(
                KerbinMu, SampleUt, Fleet["kerbin-relay-850km-a"].Orbit.At);
            Assert.True(unpulled.HasCraft);
            Assert.Null(PrincipiaHorizonBound.SpanSeconds(unpulled, null));
        }

        /// <summary>
        /// A craft with no repeat takes the direction-blind arm, because the window
        /// and the step are both fractions of a revolution and it has none.
        /// </summary>
        [Fact]
        public void ACraftWithNoCycleIsStillBoundedByWhatPullsOnIt()
        {
            var departure = KerbinNeighbourhood(Fleet["kerbin-relay-2599km"].Orbit);

            var span = PrincipiaHorizonBound.SpanSeconds(departure, null);

            Assert.Equal(
                Math.Sqrt(2.0 * PrincipiaHorizonBound.ToleranceMetres
                          / departure.WorstCaseAcceleration)
                / PrincipiaHorizonBound.FarFieldAmplification,
                span!.Value,
                9);
        }

        /// <summary>
        /// The cancellation-free difference is the same number the subtraction would
        /// have given, and it is exactly zero for no offset at all.
        /// </summary>
        [Fact]
        public void TheInverseCubeDifferenceIsTheSubtractionItAvoids()
        {
            var origin = new Sitrep.Contract.Vector3d(850000.0, 120000.0, -3000.0);
            var offset = new Sitrep.Contract.Vector3d(31.0, -17.0, 4.0);

            var got = PrincipiaHorizonBound.InverseCubeDifference(origin, offset);
            var far = origin + offset;
            var naive = far * (1.0 / Math.Pow(far.Magnitude(), 3.0))
                        - origin * (1.0 / Math.Pow(origin.Magnitude(), 3.0));

            Assert.True(Math.Abs(got.X - naive.X) <= 1e-9 * Math.Abs(naive.X), $"{got.X} {naive.X}");
            Assert.True(Math.Abs(got.Y - naive.Y) <= 1e-9 * Math.Abs(naive.Y), $"{got.Y} {naive.Y}");
            Assert.True(Math.Abs(got.Z - naive.Z) <= 1e-9 * Math.Abs(naive.Z), $"{got.Z} {naive.Z}");

            var none = PrincipiaHorizonBound.InverseCubeDifference(
                origin, new Sitrep.Contract.Vector3d(0, 0, 0));
            Assert.Equal(0.0, none.X);
            Assert.Equal(0.0, none.Y);
            Assert.Equal(0.0, none.Z);
        }

        // === The provider, computing the same bound from the pieces it can reach ==

        [Fact]
        public void TheProviderRefusesTheWindowPastItsOwnBoundAndAllowsTheOneInside()
        {
            var craft = Fleet["kerbin-relay-2599km"];
            var provider = ProviderFor(craft);
            var target = Target(craft);
            var frame = PropagationFrame.CentredOn(Kerbin);

            Assert.True(provider.CanPropagate(target, frame, SampleUt, SampleUt + 578.0));
            Assert.False(provider.CanPropagate(target, frame, SampleUt, SampleUt + 580.0));
        }

        [Fact]
        public void TheProviderBoundsTheHigherRelayShorterDespiteItsLongerCycle()
        {
            var high = Fleet["kerbin-relay-2599km"];
            var low = Fleet["kerbin-relay-850km-a"];
            var frame = PropagationFrame.CentredOn(Kerbin);

            // 900 seconds is inside the 850 km relay's bound of 963 and outside the
            // 2599 km relay's of 579, though the latter's cycle is five times longer.
            Assert.True(ProviderFor(low).CanPropagate(
                Target(low), frame, SampleUt, SampleUt + 900.0));
            Assert.False(ProviderFor(high).CanPropagate(
                Target(high), frame, SampleUt, SampleUt + 900.0));
        }

        [Fact]
        public void TheInstantItselfIsAnsweredHoweverPerturbedTheCraftIs()
        {
            // Every visibility and encounter caller asks a zero-length window, which
            // is asking where something IS. The osculating elements answer that
            // exactly, so a horizon has nothing to say about it.
            var craft = Fleet["kerbin-relay-2599km"];
            Assert.True(ProviderFor(craft).CanPropagate(
                Target(craft), PropagationFrame.CentredOn(Kerbin), SampleUt, SampleUt));
        }

        [Fact]
        public void WithNoForceModelTheProviderVouchesForNoWindowAtAll()
        {
            // An install whose gravity model could not be read has no way to bound a
            // craft. Refusing is what turns that into an Unspecified horizon, which a
            // client reads as unpropagatable; substituting stock's masses would answer
            // with a bound that agrees with nothing.
            var craft = Fleet["kerbin-relay-2599km"];
            var provider = new PrincipiaPropagationProvider(
                new StubConics(craft), () => null, _ => KerbinPerturbers, StockParents);
            var frame = PropagationFrame.CentredOn(Kerbin);

            Assert.True(provider.CanPropagate(Target(craft), frame, SampleUt, SampleUt));
            Assert.False(provider.CanPropagate(Target(craft), frame, SampleUt, SampleUt + 1.0));
        }

        [Fact]
        public void ABodyIsNeverBoundedBecauseTheHorizonIsAboutACraftsOwnElements()
        {
            // The acceleration walk that computes a bound asks this same question
            // about each perturber it wants to place, so bounding a body here would
            // refuse the walk the bound is made of.
            var craft = Fleet["kerbin-relay-2599km"];
            Assert.True(ProviderFor(craft).CanPropagate(
                PropagationTarget.Body(Mun), PropagationFrame.CentredOn(Kerbin),
                SampleUt, SampleUt + 86_400.0));
        }

        [Fact]
        public void APerturberTheForceModelDoesNotNameLengthensTheBoundInsteadOfStoppingIt()
        {
            // A term that cannot be matched is a term that cannot be summed, so the
            // bound comes out LONGER than the truth: the model is degraded and the
            // arc says so separately. What must not happen is the whole answer going
            // away, because a craft with one unknown neighbour is still bounded by the
            // ones we do know.
            var craft = Fleet["kerbin-relay-850km-a"];
            var provider = new PrincipiaPropagationProvider(
                new StubConics(craft),
                () => new GravityModel("partial", new[] { new GravityModelBody("Sun", SunMu) }),
                _ => KerbinPerturbers,
                StockParents);
            var frame = PropagationFrame.CentredOn(Kerbin);
            var whole = ProviderFor(craft);

            // The Sun alone is a hundredth of the Mun across this orbit, so the
            // departure never reaches the tolerance and the window is the answer.
            var window = craft.Cycle * PrincipiaHorizonBound.SearchCycles
                         / PrincipiaHorizonBound.SafetyFactor;
            Assert.True(provider.CanPropagate(Target(craft), frame, SampleUt, SampleUt + window - 1.0));
            Assert.False(provider.CanPropagate(Target(craft), frame, SampleUt, SampleUt + window + 1.0));
            Assert.True(window > craft.Span);
            Assert.False(whole.CanPropagate(Target(craft), frame, SampleUt, SampleUt + window - 1.0));
        }

        private static readonly IReadOnlyList<PrincipiaPerturber> KerbinPerturbers =
            new[]
            {
                new PrincipiaPerturber("Sun", Sun),
                new PrincipiaPerturber("Mun", Mun),
                new PrincipiaPerturber("Minmus", Minmus),
            };

        /// <summary>The stock hierarchy, for the body-ephemeris half of the provider.</summary>
        private static int? StockParents(int bodyIndex) => bodyIndex switch
        {
            Sun => null,
            Kerbin => Sun,
            Mun => Kerbin,
            Minmus => Kerbin,
            Jool => Sun,
            Laythe => Jool,
            Vall => Jool,
            Bop => Jool,
            Tylo => Jool,
            Pol => Jool,
            _ => null,
        };

        private static double? SpanOf(Craft craft) =>
            PrincipiaHorizonBound.SpanSeconds(NeighbourhoodOf(craft), craft.Cycle);

        private static ConicDeparture NeighbourhoodOf(Craft craft)
        {
            var departure = new ConicDeparture(
                MuOf(craft.Primary), SampleUt, craft.Orbit.At);
            foreach (var body in craft.Perturbers)
            {
                departure.Add(MuOf(body), Where(body, craft.Primary));
            }
            return departure;
        }

        private static ConicDeparture KerbinNeighbourhood(Conic craft)
        {
            var departure = new ConicDeparture(KerbinMu, SampleUt, craft.At);
            departure.Add(SunMu, Where(Sun, Kerbin));
            departure.Add(MunMu, Where(Mun, Kerbin));
            departure.Add(MinmusMu, Where(Minmus, Kerbin));
            return departure;
        }

        private static ConicDeparture Fixed(Conic craft, Sitrep.Contract.Vector3d at)
        {
            var departure = new ConicDeparture(MunMu, SampleUt, craft.At);
            departure.Add(KerbinMu, _ => at);
            return departure;
        }

        private static double MuOf(int body) => body switch
        {
            Sun => SunMu,
            Kerbin => KerbinMu,
            Mun => MunMu,
            Minmus => MinmusMu,
            Jool => JoolMu,
            Laythe => 1962000029236.08,
            Vall => 207481499473.751,
            Bop => 2486834944.41491,
            Tylo => 2825280042099.95,
            Pol => 721702080.0,
            _ => throw new ArgumentOutOfRangeException(nameof(body)),
        };

        /// <summary>
        /// Where a body is in another body's frame: the signed sum of the conics
        /// between them, which is the same walk the displaced solver does in the game.
        /// </summary>
        private static Func<double, Sitrep.Contract.Vector3d> Where(int body, int primary)
        {
            if (primary == Kerbin)
            {
                if (body == Sun) return ut => Negate(KerbinAboutSun.At(ut));
                if (body == Mun) return MunAboutKerbin.At;
                if (body == Minmus) return MinmusAboutKerbin.At;
            }
            if (primary == Mun)
            {
                if (body == Kerbin) return ut => Negate(MunAboutKerbin.At(ut));
                if (body == Minmus)
                {
                    return ut => MinmusAboutKerbin.At(ut) - MunAboutKerbin.At(ut);
                }
            }
            if (primary == Jool)
            {
                if (body == Sun) return ut => Negate(JoolAboutSun.At(ut));
                if (body == Laythe) return LaytheAboutJool.At;
                if (body == Vall) return VallAboutJool.At;
                if (body == Bop) return BopAboutJool.At;
                if (body == Tylo) return TyloAboutJool.At;
                if (body == Pol) return PolAboutJool.At;
            }
            throw new ArgumentOutOfRangeException(nameof(body));
        }

        private static Sitrep.Contract.Vector3d Negate(Sitrep.Contract.Vector3d v) =>
            new Sitrep.Contract.Vector3d(-v.X, -v.Y, -v.Z);

        /// <summary>
        /// A craft about its primary. Only the id, the parent, the mu and the presence
        /// of elements matter to the bound: the geometry comes from the solver, which
        /// is the whole point of asking one rather than reading the conic here.
        /// </summary>
        private static PropagationTarget Target(Craft craft) =>
            PropagationTarget.Vessel(
                craft.Name,
                craft.Primary,
                new OrbitElements(
                    craft.Orbit.Sma, craft.Orbit.Ecc, 0.0, 0.0, 0.0, 0.0, 0.0,
                    MuOf(craft.Primary)));

        private static PrincipiaPropagationProvider ProviderFor(Craft craft) =>
            new PrincipiaPropagationProvider(
                new StubConics(craft), StockMasses, _ => KerbinPerturbers, StockParents);

        private static GravityModel StockMasses() =>
            new GravityModel(
                "rig-2026-09-05",
                new[]
                {
                    new GravityModelBody("Sun", SunMu),
                    new GravityModelBody("Mun", MunMu),
                    new GravityModelBody("Minmus", MinmusMu),
                });

        /// <summary>
        /// The displaced solver, answering the save's own geometry at any instant:
        /// the craft's conic about its primary, and each body's place in the same
        /// frame.
        /// </summary>
        private sealed class StubConics : IPropagationProvider
        {
            private readonly Craft _craft;

            public StubConics(Craft craft)
            {
                _craft = craft;
            }

            public string ProviderId => "stub-conics";

            public StateVector Solve(PropagationTarget target, PropagationFrame frame, double ut)
            {
                var position = target.Kind == PropagationTargetKind.Vessel
                    ? _craft.Orbit.At(ut)
                    : Where(target.BodyIndex, _craft.Primary)(ut);
                return new StateVector(position, new Sitrep.Contract.Vector3d(0, 0, 0));
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
                target.Kind == PropagationTargetKind.Vessel ? _craft.Cycle : (double?)null;

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
