using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Comms;
using Sitrep.Propagation.Visibility;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>
    /// How far a craft a centre has lost can be from where it is reckoned, worked
    /// by hand: a craft that burns flat out covers a t² / 2, and once its delta-v
    /// D is spent at a it coasts on, D t - D² / (2a), in a frame falling with it.
    /// </summary>
    public class PositionUncertaintyTests
    {
        private const double KerbinMu = 3.5316e12;
        private const string Probe = "vessel:probe";
        private const string Home = "ground:home";

        /// <summary>A circular orbit 100 000 km out: a minute is 0.0001 rad of it, so gravity adds nothing a test can see.</summary>
        private static readonly OrbitElements FarOrbit = new OrbitElements(1e8, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu);

        /// <summary>A circular orbit 100 km above Kerbin: n = sqrt(μ / a³) = 3.2088e-3 rad/s, one turn in 1958.1 s.</summary>
        private static readonly OrbitElements LowOrbit = new OrbitElements(700_000.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu);

        private static CraftState Orbiting(OrbitElements orbit, CraftCapability? capability, double capturedUt = 1000.0, double? validUntilUt = null) =>
            CraftState.Orbiting(Probe, capturedUt, 1, orbit, null, validUntilUt, true, new Dictionary<string, CraftLink>()).WithCapability(capability);

        private static CraftCapability Can(double? deltaV, double? acceleration, double? airspeed = null, bool driven = false, bool? thrusting = null) =>
            new CraftCapability(deltaV, acceleration, airspeed, driven, thrusting);

        [Fact]
        public void ACraftPushingTenMetresPerSecondSquaredIsWithinEighteenKilometresAMinuteLater()
        {
            // 2000 m/s at 10 m/s² lasts 200 s, so a minute in it is still burning: 10 × 60² / 2 = 18 000 m.
            var craft = Orbiting(FarOrbit, Can(2000.0, 10.0));

            Assert.Equal(18_000.0, PositionUncertainty.Bound(craft, 1000.0, 1060.0)!.Value, 1);
        }

        [Fact]
        public void ACraftThatSpendsItsDeltaVInsideTheGapCoastsOnAtWhatItGained()
        {
            // 300 m/s at 10 m/s² is spent in 30 s: 300 × 60 - 300² / 20 = 18 000 - 4 500 = 13 500 m.
            var craft = Orbiting(FarOrbit, Can(300.0, 10.0));

            Assert.Equal(13_500.0, PositionUncertainty.Bound(craft, 1000.0, 1060.0)!.Value, 1);
        }

        [Fact]
        public void ACoastingCraftIsBoundedFromTheInstantItWasLastKnownInContactOrNot()
        {
            var craft = Orbiting(FarOrbit, Can(50.0, null));

            Assert.Equal(0.0, new CraftFix(craft, false, 1000.0).UncertaintyMAt(1000.0));
            Assert.Equal(5_000.0, new CraftFix(craft, true, 1000.0).UncertaintyMAt(1100.0)!.Value, 1);
            // Its acceleration was not read, so its 50 m/s is taken as spent at once: 50 × 100 = 5 000 m.
            Assert.Equal(5_000.0, new CraftFix(craft, false, 1000.0).UncertaintyMAt(1100.0)!.Value, 1);
        }

        [Fact]
        public void ACraftWithNoDeltaVStaysOnItsOrbitForADay()
        {
            Assert.Equal(0.0, PositionUncertainty.Bound(Orbiting(LowOrbit, Can(0.0, 0.0)), 1000.0, 1000.0 + 86_400.0));
            Assert.Equal(0.0, PositionUncertainty.Bound(Orbiting(LowOrbit, Can(0.0, null)), 1000.0, 1000.0 + 86_400.0));
        }

        [Fact]
        public void ACraftReadFromItsPartsAsHavingNothingToPushWithIsBoundedByCoastingAlone()
        {
            Assert.Equal(0.0, PositionUncertainty.Bound(Orbiting(LowOrbit, Can(0.0, null)), 1000.0, 1060.0));
            Assert.Equal(2.0 * 100.0 * 60.0, PositionUncertainty.Bound(Orbiting(LowOrbit, Can(0.0, null, 100.0)), 1000.0, 1060.0)!.Value, 1);
        }

        [Fact]
        public void ACraftLastHeardCoastingIsBoundedByCoastingAloneHoweverMuchItCarries()
        {
            Assert.Equal(0.0, PositionUncertainty.Bound(Orbiting(LowOrbit, Can(2000.0, 10.0, thrusting: false)), 1000.0, 1000.0 + 86_400.0));
        }

        [Fact]
        public void ACraftNeverLoadedIsOnRailsSoItsDeltaVNeedNotBeKnownToBoundIt()
        {
            Assert.Equal(0.0, PositionUncertainty.Bound(Orbiting(FarOrbit, Can(null, null, thrusting: false)), 1000.0, 1060.0));
        }

        [Fact]
        public void ACraftLastHeardUnderThrustIsBoundedFlatOut()
        {
            Assert.Equal(18_000.0, PositionUncertainty.Bound(Orbiting(FarOrbit, Can(2000.0, 10.0, thrusting: true)), 1000.0, 1060.0)!.Value, 1);
        }

        [Fact]
        public void ACraftWhoseThrustWasNotReadKeepsTheFlatOutBound()
        {
            Assert.Equal(18_000.0, PositionUncertainty.Bound(Orbiting(FarOrbit, Can(2000.0, 10.0, thrusting: null)), 1000.0, 1060.0)!.Value, 1);
            Assert.Null(PositionUncertainty.Bound(Orbiting(FarOrbit, Can(null, 10.0, thrusting: null)), 1000.0, 1060.0));
        }

        [Fact]
        public void ACraftLastHeardCoastingStillDriftsOnTheGroundWithWheels()
        {
            var landed = CraftState.Landed(Probe, 1000.0, 1, new RotatingGroundStation(new Vector3d(1.0, 0.0, 0.0), 0.0, 21_549.425, 600_000.0, 0.0, new Vector3d(0.0, 0.0, 1.0)), new Dictionary<string, CraftLink>())
                .WithCapability(Can(0.0, null, driven: true, thrusting: false));

            Assert.Null(PositionUncertainty.Bound(landed, 1000.0, 1060.0));
        }

        [Fact]
        public void ACraftWithEnginesAndPropellantThatWasNeverLoadedIsNotAnsweredAsStill()
        {
            Assert.Null(PositionUncertainty.Bound(Orbiting(FarOrbit, null), 1000.0, 1060.0));
        }

        [Fact]
        public void ACraftWhoseDeltaVWasNeverReadIsUnknownRatherThanStill()
        {
            Assert.Null(PositionUncertainty.Bound(Orbiting(FarOrbit, null), 1000.0, 1060.0));
            Assert.Null(PositionUncertainty.Bound(Orbiting(FarOrbit, Can(null, 10.0)), 1000.0, 1060.0));
        }

        [Fact]
        public void OverManyTurnsALowOrbitDriftsUpToTheCircularCeilingTimesItsDeltaVTimesTheGap()
        {
            /*
             * Ten turns of a 100 km orbit is 19 581 s. 5 m/s spent at once is
             * 5 × 19 581 = 97 906 m in free fall, and the gravity gradient has
             * long since reached its ceiling of 3.9541: 387 130 m.
             */
            var turn = 2.0 * Math.PI / Math.Sqrt(KerbinMu / Math.Pow(700_000.0, 3));
            Assert.Equal(1958.1, turn, 1);
            var craft = Orbiting(LowOrbit, Can(5.0, null));

            var bound = PositionUncertainty.Bound(craft, 1000.0, 1000.0 + 10 * turn)!.Value;

            Assert.Equal(3.9541 * 5.0 * 10 * turn, bound, 387_130.0 * 1e-4);
        }

        [Fact]
        public void GravityAddsNothingAtFirstAndGrowsThroughTheFirstTurn()
        {
            Assert.Equal(1.0, PositionUncertainty.CircularGravityAt(0.0));
            Assert.Equal(1.0, PositionUncertainty.CircularGravityAt(0.001), 5);
            // A sixth of a turn: the largest singular value of M(π/3) / (π/3) is 1.37.
            Assert.Equal(1.37, PositionUncertainty.CircularGravityAt(Math.PI / 3), 2);
            Assert.Equal(3.9541, PositionUncertainty.CircularGravityAt(2.0 * Math.PI), 4);
            Assert.Equal(3.9541, PositionUncertainty.CircularGravityAt(100.0), 4);
        }

        [Fact]
        public void AnEccentricOrbitScalesTheGravityPartByItsPeriapsisSpeedRatio()
        {
            // e = 0.5 drifts (1 + 0.5) / (1 - 0.5) = 3 times as fast near periapsis: 1 + (3.9541 - 1) × 3 = 9.8623.
            var eccentric = new OrbitElements(1_000_000.0, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu);

            Assert.Equal(9.8623, PositionUncertainty.Gravity(eccentric, 1e6)!.Value, 3);
            Assert.Equal(1.0, PositionUncertainty.Gravity(eccentric, 0.0)!.Value);
        }

        [Fact]
        public void AParabolicOrbitHasNoBound()
        {
            var parabolic = new OrbitElements(1e9, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu);

            Assert.Null(PositionUncertainty.Bound(Orbiting(parabolic, Can(10.0, 1.0)), 1000.0, 1060.0));
            Assert.Equal(0.0, PositionUncertainty.Bound(Orbiting(parabolic, Can(0.0, 0.0)), 1000.0, 1060.0));
        }

        [Fact]
        public void InAnAtmosphereDragAndLiftCanTurnTheWholeAirspeedAround()
        {
            // No delta-v, 100 m/s through the air: 2 × 100 × 30 = 6 000 m.
            Assert.Equal(6_000.0, PositionUncertainty.Bound(Orbiting(LowOrbit, Can(0.0, 0.0, airspeed: 100.0)), 1000.0, 1030.0)!.Value, 6);
            Assert.Null(PositionUncertainty.Bound(Orbiting(LowOrbit, Can(0.0, 0.0, airspeed: 100.0, driven: true)), 1000.0, 1030.0));
        }

        [Fact]
        public void OnTheGroundOnlyItsOwnPushMovesItAndWheelsMakeItUnknown()
        {
            var surface = new RotatingGroundStation(new Vector3d(1.0, 0.0, 0.0), 0.0, 21_549.425, 600_000.0, 0.0, new Vector3d(0.0, 0.0, 1.0));
            var landed = CraftState.Landed(Probe, 1000.0, 1, surface, new Dictionary<string, CraftLink>());

            // 100 m/s at 5 m/s² is still burning after 10 s: 5 × 10² / 2 = 250 m.
            Assert.Equal(250.0, PositionUncertainty.Bound(landed.WithCapability(Can(100.0, 5.0)), 1000.0, 1010.0)!.Value, 6);
            Assert.Null(PositionUncertainty.Bound(landed.WithCapability(Can(0.0, 0.0, driven: true)), 1000.0, 1010.0));
        }

        [Fact]
        public void PastTheInstantItsOrbitCanBeTrustedTheCraftIsUnknown()
        {
            var craft = Orbiting(FarOrbit, Can(0.0, 0.0), validUntilUt: 2000.0);

            Assert.Equal(0.0, PositionUncertainty.Bound(craft, 1000.0, 2000.0));
            Assert.Null(PositionUncertainty.Bound(craft, 1000.0, 2000.5));
        }

        [Fact]
        public void AnAsteroidOnlyEverSeenHasNoEngines()
        {
            var asteroid = CraftState.WithoutARadio(Probe, 1000.0, new Dictionary<string, object?> { ["vesselType"] = (int)VesselType.SpaceObject });
            var debris = CraftState.WithoutARadio(Probe, 1000.0, new Dictionary<string, object?> { ["vesselType"] = (int)VesselType.Debris });

            Assert.Equal(0.0, PositionUncertainty.Bound(asteroid, 1000.0, 90_000.0));
            Assert.Null(PositionUncertainty.Bound(debris, 1000.0, 90_000.0));
        }

        [Fact]
        public void WhatACraftCouldDoIsHeardAndNeverSeen()
        {
            var heard = Orbiting(FarOrbit, Can(300.0, 10.0));
            var place = CraftState.Orbiting(Probe, 1500.0, 1, LowOrbit, null, null, true, new Dictionary<string, CraftLink>()).WithCapability(Can(9.0, 9.0));
            var seen = CraftSighting.Of(Probe, 1500.0, null, place.PlaceOnly());

            var known = CraftSighting.Known(heard, seen)!;

            Assert.Equal(1500.0, known.CapturedUt);
            Assert.Equal(300.0, known.Capability!.DeltaVMs);
            Assert.Null(place.PlaceOnly().Capability);
        }

        [Fact]
        public void EveryReadingAgainOfAStateKeepsWhatTheCraftCouldDo()
        {
            var state = Orbiting(FarOrbit, Can(300.0, 10.0));

            Assert.Equal(300.0, state.ReadAgain(1100.0, null, true, state.Links).Capability!.DeltaVMs);
            Assert.Equal(300.0, state.Unsettled().Capability!.DeltaVMs);
            Assert.Equal(300.0, state.Named("Probe").Listed(null).Capability!.DeltaVMs);
            Assert.Equal(300.0, state.AsCentre(null).WithRetarget(null).Capability!.DeltaVMs);
        }

        [Fact]
        public void WhatACraftCouldDoSurvivesTheSave()
        {
            var state = Orbiting(FarOrbit, Can(300.0, 10.0, airspeed: 42.0, driven: true));
            var bare = Orbiting(FarOrbit, Can(null, null));
            var encoded = HeardSnapshotCodec.Encode(new HeardSnapshot(new[]
            {
                new HeardAtCentre(Home, new[] { state, bare.WithCapability(null) }, new Dictionary<string, bool>()),
            }));

            var states = HeardSnapshotCodec.Decode(encoded)!.Centres.Single().States;

            var back = states[0].Capability!;
            Assert.Equal(300.0, back.DeltaVMs);
            Assert.Equal(10.0, back.MaxAccelerationMs2);
            Assert.Equal(42.0, back.AirspeedMs);
            Assert.True(back.DrivenWithoutPropellant);
            Assert.Null(states[1].Capability);
        }

        [Fact]
        public void ACentreThatHasLostACraftBoundsItFromTheLastInstantItKnewIt()
        {
            var hearing = new CentreHearing(new Telling());
            hearing.Restore(new HeardSnapshot(new[]
            {
                new HeardAtCentre(Home, new[] { Orbiting(FarOrbit, Can(2000.0, 10.0)) }, new Dictionary<string, bool> { [Probe] = false }),
            }));
            hearing.Listen(new[] { Home }, new[] { "probe" });

            var fix = hearing.FixAt(Home, Probe)!;

            Assert.False(fix.InContact);
            Assert.Equal(1000.0, fix.LastKnownUt);
            Assert.Equal(18_000.0, fix.UncertaintyMAt(1060.0)!.Value, 1);
            Assert.Null(hearing.FixAt(Home, "vessel:unheard"));
        }

        [Fact]
        public void SilenceOnALiveLinkFromACraftHoldingItsCourseIsWordItHasNotMoved()
        {
            var host = new Telling();
            var hearing = new CentreHearing(host);
            hearing.Listen(new[] { Home }, new[] { "probe" });
            var reached = new Dictionary<string, double> { [Home] = 1500.0 };

            host.State!(Orbiting(FarOrbit, Can(2000.0, 10.0)));
            host.Reach!(new CraftReach(Probe, 1500.0, reached));
            Assert.True(hearing.FixAt(Home, Probe)!.InContact);
            Assert.Equal(1500.0, hearing.FixAt(Home, Probe)!.LastKnownUt);
            Assert.True(hearing.FixAt(Home, Probe)!.UncertaintyMAt(1560.0) > 0.0);

            host.Reach!(new CraftReach(Probe, 1600.0, reached));
            var fix = hearing.FixAt(Home, Probe)!;
            Assert.False(fix.InContact);
            Assert.Equal(1500.0, fix.LastKnownUt);
            Assert.Equal(18_000.0, fix.UncertaintyMAt(1560.0)!.Value, 1);

            // Read mid-burn, it is read again only so often, so the link's silence says nothing of where it went.
            host.State!(Orbiting(FarOrbit, Can(2000.0, 10.0), capturedUt: 1100.0).Unsettled());
            Assert.Equal(1100.0, hearing.FixAt(Home, Probe)!.LastKnownUt);
        }

        [Fact]
        public void ACraftInContactIsBoundedFromTheCraftSideInstantOfItsNewestWord()
        {
            var host = new Telling();
            var hearing = new CentreHearing(host);
            hearing.Listen(new[] { Home }, new[] { "probe" });
            host.State!(Orbiting(FarOrbit, Can(2000.0, 10.0)));
            host.Reach!(new CraftReach(Probe, 1500.0, new Dictionary<string, double> { [Home] = 1500.0 }));

            var fix = hearing.FixAt(Home, Probe)!;

            // Word captured at 1500 reaches the centre one delay (say 2 s) later, so the centre's newest fix is 2 s old when it arrives.
            Assert.True(fix.InContact);
            Assert.Equal(1500.0, fix.LastKnownUt);
            // Burning for those 2 s at 10 m/s²: 10 × 2² / 2 = 20 m.
            Assert.Equal(20.0, fix.UncertaintyMAt(1502.0)!.Value, 1);
        }

        private sealed class Telling : ICraftStateHost
        {
            public bool TimelineResetChangedSave => false;

            public void RecordCraftState(string vesselId, CraftState state, double ut)
            {
            }

            public void NoteCraftPresent(string vesselId, double ut)
            {
            }

            public void RecordCraftGone(string vesselId, double ut, CraftEnd end, CrewAtEnd? crew = null)
            {
            }

            public void RecordCraftSighting(string vesselId, CraftSighting sighting, double ut, IReadOnlyDictionary<string, double> lightSeconds)
            {
            }

            public void KeepCraftUntil(string vesselId, double untilUt)
            {
            }

            public Action HearCraftSighting(string vesselId, string centre, Action<CraftSighting> seen) => () => { };

            public Action HearCraftLink(string vesselId, string centre, Action<bool> heard) => () => { };

            public Action<CraftReach>? Reach { get; private set; }

            public Action<CraftState>? State { get; private set; }

            public Action HearCraftReach(string vesselId, string centre, Action<CraftReach> heard)
            {
                Reach = heard;
                return () => { };
            }

            public void RecordCentreReport(string vesselId, CentreReport report, double ut)
            {
            }

            public Action HearCentreReport(string vesselId, string centre, Action<CentreReport> heard) => () => { };

            public Action HearCraftForecast(string vesselId, string centre, Action<CraftForecast> heard) => () => { };

            public void RecordHomeVerdict(string vesselId, HomeVerdict verdict, double ut)
            {
            }

            public Action HearHomeVerdict(string vesselId, string centre, Action<HomeVerdict> heard) => () => { };

            public void RecordCraftRadio(string vesselId, ContactRadio radio, double ut)
            {
            }

            public Action HearCraftRadio(string vesselId, string centre, Action<ContactRadio> heard) => () => { };

            public Action HearCraftState(string vesselId, string centre, Action<CraftState> heard)
            {
                State = heard;
                return () => { };
            }

            public void OnTimelineReset(Action reset)
            {
            }

            public void OnCraftReleased(Action<string> released)
            {
            }
        }
    }
}
