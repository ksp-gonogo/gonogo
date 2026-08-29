using System;
using System.Collections.Generic;
using System.Linq;
using GonogoPrincipiaUplink;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// The orbit-analysis reading, driven against a plugin double that faults
    /// wherever the real one aborts and structs carrying the producer's own field
    /// names.
    ///
    /// <para>Two things are worth being explicit about, because both are the
    /// reason this reading was left unbuilt for so long. The reading must never
    /// REQUEST an analysis, and the calls below prove it by their absence from the
    /// recorded call list. And the units the producer carries are not the units an
    /// operator reads: radians, radians per second, and distances from a planet's
    /// centre. Every one of those conversions is asserted, because each of them
    /// produces a plausible wrong number rather than an obvious one.</para>
    /// </summary>
    public class AnalysisReaderTests
    {
        private const string Guid = "vessel-1";

        private static (FakePrincipiaPlugin Plugin, AnalysisObservation? Observation) Read(
            Action<FakePrincipiaPlugin> arrange)
        {
            var plugin = new FakePrincipiaPlugin();
            arrange(plugin);
            var handle = new FakePluginHandle(plugin);
            Assert.True(
                PrincipiaSession.TryBind(plugin, handle, out var session, out var reason), reason);
            Assert.True(session!.TryBeginFrame(out var frame));
            using (frame)
            {
                var observation = new AnalysisReader().ReadInFrame(
                    frame!, new FakeCelestialNames(), Guid, 1000.0);
                return (plugin, observation);
            }
        }

        private static List<string> Named(FakePrincipiaPlugin plugin, string name) =>
            plugin.Calls
                .Where(c => c == name || c.StartsWith(name + "(", StringComparison.Ordinal))
                .ToList();

        /// <summary>
        /// A vessel the producer has forgotten answers nothing at all, which is a
        /// different fact from a vessel it knows and is not analysing. The second
        /// arrives as a sample with an absent orbit; this one arrives as no sample.
        /// </summary>
        [Fact]
        public void AVesselThePluginDoesNotKnowReadsNothing()
        {
            var (plugin, observation) = Read(_ => { });

            Assert.Null(observation);
            Assert.Empty(Named(plugin, "VesselGetAnalysis"));
        }

        /// <summary>
        /// Reading the analysis must not ask for one. Requesting for a vessel other
        /// than the one the producer is already analysing destroys that vessel's
        /// analyser outright, and the player watching it loses their elements and
        /// restarts from zero.
        /// </summary>
        [Fact]
        public void ReadsAnAnalysisAndNeverRequestsOne()
        {
            var (plugin, observation) = Read(p =>
            {
                p.Add(Guid);
                p.VesselAnalysis = new FakeOrbitAnalysis();
            });

            Assert.NotNull(observation!.Orbit);
            Assert.Single(Named(plugin, "VesselGetAnalysis"));
            Assert.DoesNotContain(
                plugin.Calls, c => c.StartsWith("VesselRequestAnalysis", StringComparison.Ordinal));
        }

        /// <summary>
        /// The producer answers null for a vessel it is not analysing, which is the
        /// ordinary state outside its own main window. Publishing that as an
        /// analysis of zeros would tell an operator their craft's orbit was
        /// degenerate.
        /// </summary>
        [Fact]
        public void NoAnalysisIsAbsentRatherThanEmpty()
        {
            var (_, observation) = Read(p =>
            {
                p.Add(Guid);
                p.VesselAnalysis = null;
            });

            Assert.NotNull(observation);
            Assert.Null(observation!.Orbit);
        }

        [Fact]
        public void CarriesThePeriodsAndConvertsThePrecessionToDegreesPerHour()
        {
            var (_, observation) = Read(p =>
            {
                p.Add(Guid);
                p.VesselAnalysis = new FakeOrbitAnalysis();
            });

            var orbit = observation!.Orbit!;
            Assert.Equal(5400.0, orbit.SiderealPeriodSeconds);
            Assert.Equal(5390.0, orbit.NodalPeriodSeconds);
            Assert.Equal(5410.0, orbit.AnomalisticPeriodSeconds);
            // In rad/s this is a number an operator cannot read and, worse, one
            // core's unit model would render as a radiation dose rate.
            Assert.Equal(
                1.0e-6 * (180.0 / Math.PI) * 3600.0,
                orbit.NodalPrecessionDegreesPerHour!.Value,
                6);
        }

        [Fact]
        public void CarriesEveryMeanElementAsABandInTheUnitsAReaderUses()
        {
            var (_, observation) = Read(p =>
            {
                p.Add(Guid);
                p.VesselAnalysis = new FakeOrbitAnalysis();
            });

            var orbit = observation!.Orbit!;
            Assert.Equal(6_700_000, orbit.MeanSemimajorAxisMetres!.Min);
            Assert.Equal(6_710_000, orbit.MeanSemimajorAxisMetres!.Max);
            Assert.Equal(0.001, orbit.MeanEccentricity!.Min);
            Assert.Equal(0.004, orbit.MeanEccentricity!.Max);
            Assert.Equal(45.0, orbit.MeanInclinationDegrees!.Min!.Value, 9);
            Assert.Equal(45.0, orbit.MeanInclinationDegrees!.Max!.Value, 9);
            Assert.NotNull(orbit.MeanLongitudeOfAscendingNodeDegrees);
            Assert.NotNull(orbit.MeanArgumentOfPeriapsisDegrees);
        }

        /// <summary>
        /// The producer reports apsides as distances from the primary's centre and
        /// applies the radius in its own formatter. A distance published under an
        /// altitude's name is wrong by a planet and looks entirely plausible.
        /// </summary>
        [Fact]
        public void TurnsApsisDistancesIntoAltitudes()
        {
            var (_, observation) = Read(p =>
            {
                p.Add(Guid);
                p.VesselAnalysis = new FakeOrbitAnalysis();
            });

            var orbit = observation!.Orbit!;
            Assert.Equal(6_650_000 - 600_000, orbit.MeanPeriapsisAltitudeMetres!.Min);
            Assert.Equal(6_760_000 - 600_000, orbit.MeanApoapsisAltitudeMetres!.Max);
            // The MINIMUM end of the radial distance alone: the closest the craft
            // ever comes to the surface, which is a different claim from the mean
            // periapsis and the one a safety check reads.
            Assert.Equal(6_640_000 - 600_000, orbit.LowestAltitudeMetres);
        }

        /// <summary>
        /// With no primary there is no radius, so there is no altitude either. The
        /// pair goes out absent rather than as centre distances wearing an
        /// altitude's label.
        /// </summary>
        [Fact]
        public void WithoutAPrimaryTheAltitudesAreAbsentRatherThanDistances()
        {
            var (_, observation) = Read(p =>
            {
                p.Add(Guid);
                p.VesselAnalysis = new FakeOrbitAnalysis { primary_index = null };
            });

            var orbit = observation!.Orbit!;
            Assert.False(orbit.GravitationallyBound);
            Assert.Null(orbit.MeanPeriapsisAltitudeMetres);
            Assert.Null(orbit.MeanApoapsisAltitudeMetres);
            Assert.Null(orbit.LowestAltitudeMetres);
            // The bands that need no radius still travel: an unbound trajectory
            // still has a shape.
            Assert.NotNull(orbit.MeanEccentricity);
        }

        /// <summary>
        /// An analysis that ran and could not determine elements is a state of its
        /// own, and the interesting cause is a trajectory shorter than one sidereal
        /// period. Reporting it as "no analysis" would send an operator looking for
        /// a fault that is not there.
        /// </summary>
        [Fact]
        public void AnAnalysisWithNoElementsIsItsOwnState()
        {
            var (_, observation) = Read(p =>
            {
                p.Add(Guid);
                p.VesselAnalysis = new FakeOrbitAnalysis { elements = null };
            });

            var orbit = observation!.Orbit!;
            Assert.False(orbit.ElementsPresent);
            Assert.Equal(604800.0, orbit.MissionDurationSeconds);
            Assert.Null(orbit.MeanSemimajorAxisMetres);
        }

        /// <summary>
        /// The vessel's own analysis is anchored wherever the craft's history ended
        /// when the producer last requested one, and the producer publishes no
        /// instant for it. Null says so; a substituted "now" would make a reading
        /// of unknown age look current.
        /// </summary>
        [Fact]
        public void TheVesselAnalysisIsPublishedWithNoEpochBecauseItHasNone()
        {
            var (_, observation) = Read(p =>
            {
                p.Add(Guid);
                p.VesselAnalysis = new FakeOrbitAnalysis();
            });

            Assert.Null(observation!.Orbit!.ElementsEpochUt);
        }

        /// <summary>
        /// The element time series is freed rather than left to a finaliser. The
        /// producer's marshaller cleanup for it is empty and the producer never
        /// disposes one, so a second reader on the same cadence would double the
        /// finaliser pressure for a payload it does not read.
        /// </summary>
        [Fact]
        public void FreesTheElementSeriesItDoesNotRead()
        {
            var analysis = new FakeOrbitAnalysis();
            Read(p =>
            {
                p.Add(Guid);
                p.VesselAnalysis = analysis;
            });

            Assert.Equal(1, analysis.elements!.plottable_elements.Disposals);
        }

        /// <summary>
        /// A shape change must not read as an escape trajectory. With nothing on the
        /// struct resolving, "is it bound" is unanswerable, and unanswerable is not
        /// "no".
        /// </summary>
        [Fact]
        public void AnUnrecognisedShapeCannotClaimTheCraftIsUnbound()
        {
            var (_, observation) = Read(p =>
            {
                p.Add(Guid);
                p.VesselAnalysis = new object();
            });

            Assert.Null(observation!.Orbit!.GravitationallyBound);
        }

        /// <summary>
        /// A plan with n burns has n + 1 coasts: one before each burn and one after
        /// the last. The last is the orbit the plan ENDS in, which is the one an
        /// operator is usually asking about, and dropping it would lose exactly
        /// that.
        /// </summary>
        [Fact]
        public void ReadsOneCoastPerGapIncludingTheOneAfterTheLastBurn()
        {
            var (plugin, observation) = Read(p =>
            {
                p.Add(Guid, hasFlightPlan: true, manoeuvres: 2);
                p.CoastAnalysis = new FakeOrbitAnalysis();
            });

            Assert.Equal(3, observation!.Coasts.Count);
            Assert.Equal(new[] { 0, 1, 2 }, observation.Coasts.Select(c => c.Index));
            Assert.All(observation.Coasts, c => Assert.NotNull(c.Analysis));
            Assert.Equal(3, Named(plugin, "FlightPlanGetCoastAnalysis").Count);
        }

        /// <summary>
        /// A coast's analysis begins where the coast begins, and that instant is
        /// readable: the plan's own start for the first, the previous burn's cutoff
        /// for the rest. This is the difference between a coast reading an operator
        /// can date and one they cannot.
        /// </summary>
        [Fact]
        public void DatesEachCoastFromItsOwnBoundaries()
        {
            var (_, observation) = Read(p =>
            {
                p.Add(Guid, hasFlightPlan: true, manoeuvres: 1);
                p.CoastAnalysis = new FakeOrbitAnalysis();
                p.Manoeuvres[0] = new FakeManoeuvre { final_time = 5000.0 }.WithIgnition(4000.0);
            });

            // The plan's own initial time, from the plugin.
            Assert.Equal(2000.0, observation!.Coasts[0].StartsAtUt);
            Assert.Equal(4000.0, observation.Coasts[0].EndsAtUt);
            Assert.Equal(5000.0, observation.Coasts[1].StartsAtUt);
            Assert.Equal(9000.0, observation.Coasts[1].EndsAtUt);
            // The epoch travels onto the analysis itself, which is what a widget
            // reads to say how old the elements are.
            Assert.Equal(2000.0, observation.Coasts[0].Analysis!.ElementsEpochUt);
            Assert.Equal(5000.0, observation.Coasts[1].Analysis!.ElementsEpochUt);
        }

        /// <summary>
        /// A coast following a burn the integrator could not compute has no valid
        /// initial state to analyse from, so the producer answers null. The coast
        /// still exists and is still dated; only its analysis is absent.
        /// </summary>
        [Fact]
        public void ACoastWithNoAnalysisKeepsItsPlaceAndItsDates()
        {
            var (_, observation) = Read(p =>
            {
                p.Add(Guid, hasFlightPlan: true, manoeuvres: 1);
                p.CoastAnalysis = null;
            });

            Assert.Equal(2, observation!.Coasts.Count);
            Assert.All(observation.Coasts, c => Assert.Null(c.Analysis));
            Assert.Equal(2000.0, observation.Coasts[0].StartsAtUt);
        }

        /// <summary>A vessel with no plan has no coasts, and that is silence about
        /// coasts rather than about the vessel: its own orbit analysis still
        /// travels.</summary>
        [Fact]
        public void AVesselWithNoPlanStillPublishesItsOwnAnalysis()
        {
            var (plugin, observation) = Read(p =>
            {
                p.Add(Guid);
                p.VesselAnalysis = new FakeOrbitAnalysis();
            });

            Assert.NotNull(observation!.Orbit);
            Assert.Empty(observation.Coasts);
            Assert.Empty(Named(plugin, "FlightPlanGetCoastAnalysis"));
        }

        /// <summary>
        /// The recurrence arrives on the analysis this Uplink already asks for.
        ///
        /// <para>This Uplink spent its whole life believing the opposite, in six
        /// separate comments: that withholding the recurrence hypothesis "forfeits
        /// the recurrence and the equatorial crossings". It does not. The producer
        /// fits a closest recurrence during the analysis, and its null-hypothesis
        /// path falls BACK to that one rather than clearing it, deriving the
        /// crossings on the way. Verified in the producer's own source at the tag
        /// matching the installed build.</para>
        /// </summary>
        [Fact]
        public void TheRecurrenceArrivesWithoutBeingAskedFor()
        {
            var (_, observation) = Read(p =>
            {
                p.Add(Guid);
                p.VesselAnalysis = new FakeOrbitAnalysis();
            });

            var orbit = observation!.Orbit;
            Assert.NotNull(orbit);
            Assert.Equal(7, orbit!.RecurrenceCycleRotations);
            Assert.Equal(111, orbit.RecurrenceRevolutions);
            Assert.Equal(3, orbit.RecurrenceSubcycleRotations);
        }

        /// <summary>
        /// The equatorial crossings arrive on the same call, in degrees.
        ///
        /// <para>They are the second half of what the recurrence is FOR: the
        /// producer's own three synchronicity adjectives are decided by how far
        /// the crossing longitudes drift, and none of them can be said from the
        /// recurrence alone.</para>
        /// </summary>
        [Fact]
        public void TheEquatorialCrossingsArriveInDegrees()
        {
            var (_, observation) = Read(p =>
            {
                p.Add(Guid);
                p.VesselAnalysis = new FakeOrbitAnalysis();
            });

            var orbit = observation!.Orbit;
            Assert.NotNull(orbit);
            // Radians on the wire from the producer, degrees to a reader, like
            // every other angle this reader carries across.
            Assert.Equal(0.10 * (180.0 / Math.PI), orbit!.AscendingCrossingDegrees!.Min!.Value, 9);
            Assert.Equal(0.14 * (180.0 / Math.PI), orbit.AscendingCrossingDegrees!.Max!.Value, 9);
            Assert.Equal(3.24 * (180.0 / Math.PI), orbit.DescendingCrossingDegrees!.Min!.Value, 9);
        }

        /// <summary>
        /// The nodes' local mean solar times arrive as angles in degrees, 180 at
        /// noon, which is the producer's own representation.
        /// </summary>
        [Fact]
        public void TheSolarTimesOfTheNodesArriveAsAngles()
        {
            var (_, observation) = Read(p =>
            {
                p.Add(Guid);
                p.VesselAnalysis = new FakeOrbitAnalysis();
            });

            var orbit = observation!.Orbit;
            Assert.NotNull(orbit);
            Assert.Equal(
                2.7480 * (180.0 / Math.PI),
                orbit!.AscendingNodeSolarTimeDegrees!.Min!.Value,
                9);
            Assert.Equal(
                5.8900 * (180.0 / Math.PI),
                orbit.DescendingNodeSolarTimeDegrees!.Max!.Value,
                9);
        }

        /// <summary>
        /// A body with no modelled mean sun has no solar times, and that is the
        /// ordinary state rather than a fault. Absent, not midnight.
        /// </summary>
        [Fact]
        public void WithoutAMeanSunTheSolarTimesAreAbsent()
        {
            var (_, observation) = Read(p =>
            {
                p.Add(Guid);
                p.VesselAnalysis = new FakeOrbitAnalysis { solar_times_of_nodes = null };
            });

            Assert.Null(observation!.Orbit!.AscendingNodeSolarTimeDegrees);
            Assert.Null(observation.Orbit.DescendingNodeSolarTimeDegrees);
        }

        /// <summary>Crossings the producer could not compute are absent rather
        /// than a zero-width band sitting at longitude nought.</summary>
        [Fact]
        public void AbsentCrossingsAreAbsentRatherThanAZeroBand()
        {
            var (_, observation) = Read(p =>
            {
                p.Add(Guid);
                p.VesselAnalysis =
                    new FakeOrbitAnalysis { ground_track_equatorial_crossings = null };
            });

            Assert.Null(observation!.Orbit!.AscendingCrossingDegrees);
            Assert.Null(observation.Orbit.DescendingCrossingDegrees);
        }

        /// <summary>
        /// An analysis whose recurrence the producer could NOT fit publishes
        /// silence, not a zero. A craft on an escape trajectory has no repeating
        /// ground track, and a 0-day cycle would read as a real, wrong answer.
        /// </summary>
        [Fact]
        public void AnAnalysisWithNoRecurrenceSaysNothingRatherThanZero()
        {
            var (_, observation) = Read(p =>
            {
                p.Add(Guid);
                p.VesselAnalysis = new FakeOrbitAnalysis { recurrence = null };
            });

            var orbit = observation!.Orbit;
            Assert.NotNull(orbit);
            Assert.Null(orbit!.RecurrenceCycleRotations);
            Assert.Null(orbit.RecurrenceRevolutions);
            Assert.Null(orbit.RecurrenceSubcycleRotations);
        }
    }
}
