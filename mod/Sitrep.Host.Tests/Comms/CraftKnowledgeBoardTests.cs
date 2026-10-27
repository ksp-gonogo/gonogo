using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
using Sitrep.Host.Comms;
using Sitrep.Propagation.Visibility;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    public class CraftKnowledgeBoardTests
    {
        private const double KerbinMu = 3.5316e12;
        private const string Probe = "vessel:probe";
        private const string Home = "ground:home";

        private static readonly OrbitElements FarOrbit = new OrbitElements(1e8, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu);

        private static readonly IReadOnlyDictionary<string, IReadOnlyDictionary<string, double>> InView =
            new Dictionary<string, IReadOnlyDictionary<string, double>> { [Probe] = new Dictionary<string, double> { [Home] = 0.3 } };

        private static readonly IReadOnlyDictionary<string, IReadOnlyDictionary<string, double>> OutOfView =
            new Dictionary<string, IReadOnlyDictionary<string, double>> { [Probe] = new Dictionary<string, double>() };

        private static readonly Dictionary<string, double> Reached = new Dictionary<string, double> { [Home] = 1000.0 };

        private static CraftState Orbiting(double capturedUt = 1000.0, double? airspeed = null) =>
            CraftState.Orbiting(Probe, capturedUt, 1, FarOrbit, null, null, true, new Dictionary<string, CraftLink>())
                .WithCapability(new CraftCapability(2000.0, 10.0, airspeed, false));

        private static (CraftKnowledgeBoard Board, CentreHearing Hearing, Telling Host) Listening()
        {
            var host = new Telling();
            var hearing = new CentreHearing(host);
            hearing.Listen(new[] { Home }, new[] { "probe" });
            return (new CraftKnowledgeBoard(), hearing, host);
        }

        private static CraftKnowledgeReading Read(CraftKnowledgeBoard board, double ut) =>
            CraftKnowledgeConformance.AssertKnowledgeContract(board, Home, "probe", ut);

        [Fact]
        public void ACraftWhoseLinkReachesTheCentreIsHeardWhereItSaysItIs()
        {
            var (board, hearing, host) = Listening();
            host.State!(Orbiting());
            host.Reach!(new CraftReach(Probe, 1000.0, Reached));

            board.Note(new[] { Home }, hearing, 1100.0, OutOfView);
            var reading = Read(board, 1060.0);

            Assert.Equal(CraftKnowledgeState.Heard, reading.State);
            Assert.Equal(1000.0, reading.LastKnownUt);
            Assert.Equal(18_000.0, reading.UncertaintyM!.Value, 1);
        }

        [Fact]
        public void ACraftLostWhileCoastingIsModelledAndItsUncertaintyGrowsFromTheLastInstantKnown()
        {
            var (board, hearing, host) = Listening();
            host.State!(Orbiting());
            host.Reach!(new CraftReach(Probe, 1000.0, Reached));
            host.Reach!(new CraftReach(Probe, 1100.0, Reached));

            board.Note(new[] { Home }, hearing, 1100.0, OutOfView);
            var reading = Read(board, 1060.0);

            Assert.Equal(CraftKnowledgeState.Modelled, reading.State);
            Assert.Null(reading.HeldGrade);
            Assert.Equal(1000.0, reading.LastKnownUt);
            // 2000 m/s at 10 m/s² is still burning a minute in: 10 × 60² / 2.
            Assert.Equal(18_000.0, reading.UncertaintyM!.Value, 1);
        }

        [Fact]
        public void ACraftLostMidBurnIsHeldAtItsLastPlaceBeforeTheBlackout()
        {
            var (board, hearing, host) = Listening();
            host.State!(Orbiting().Unsettled());
            host.Reach!(new CraftReach(Probe, 1000.0, Reached));
            host.Reach!(new CraftReach(Probe, 1100.0, Reached));

            board.Note(new[] { Home }, hearing, 1100.0, OutOfView);
            var reading = Read(board, 1200.0);

            Assert.Equal(CraftKnowledgeState.Held, reading.State);
            Assert.Equal(HeldGrade.LastBeforeBlackout, reading.HeldGrade);
        }

        [Fact]
        public void ACraftLostInsideAnAtmosphereIsHeldRatherThanModelled()
        {
            var (board, hearing, host) = Listening();
            host.State!(Orbiting(airspeed: 1800.0));

            board.Note(new[] { Home }, hearing, 1100.0, OutOfView);
            var reading = Read(board, 1200.0);

            Assert.Equal(CraftKnowledgeState.Held, reading.State);
            Assert.Equal(HeldGrade.Held, reading.HeldGrade);
        }

        [Fact]
        public void ACraftOnTheGroundIsModelledWhereItStandsEvenUnderAnAtmosphere()
        {
            var (board, hearing, host) = Listening();
            var surface = new RotatingGroundStation(new Vector3d(1.0, 0.0, 0.0), 0.0, 21_549.425, 600_000.0, 0.0, new Vector3d(0.0, 0.0, 1.0));
            host.State!(CraftState.Landed(Probe, 1000.0, 1, surface, new Dictionary<string, CraftLink>())
                .WithCapability(new CraftCapability(500.0, 5.0, 0.0, false)));

            board.Note(new[] { Home }, hearing, 1100.0, OutOfView);

            Assert.Equal(CraftKnowledgeState.Modelled, Read(board, 1200.0).State);
        }

        [Fact]
        public void ACraftNoLinkReachesIsSeenWhileItsNewestPlaceIsASightingThatHasReachedTheCentre()
        {
            var (board, hearing, host) = Listening();
            host.State!(Orbiting().Unsettled());
            host.Sighting!(CraftSighting.Of(Probe, 1500.0, null, Orbiting(1500.0).PlaceOnly()));

            board.Note(new[] { Home }, hearing, 1500.0, InView);

            var seen = Read(board, 1500.0);
            Assert.Equal(CraftKnowledgeState.Seen, seen.State);
            Assert.Equal(1500.0, seen.LastKnownUt);
            Assert.True(seen.LineOfSight);
        }

        [Fact]
        public void ACraftThatWentBehindABodyIsStillSeenUntilTheLightOfItsGoingHasReachedTheCentre()
        {
            var (board, hearing, host) = Listening();
            host.State!(Orbiting().Unsettled());
            host.Sighting!(CraftSighting.Of(Probe, 1500.0, null, Orbiting(1500.0).PlaceOnly()));
            board.Note(new[] { Home }, hearing, 1500.0, InView);

            // It passes behind a body at 1600; its 0.3 s of light reaches the centre at 1600.3.
            board.Note(new[] { Home }, hearing, 1600.0, OutOfView);
            board.Note(new[] { Home }, hearing, 1600.5, OutOfView);

            Assert.Equal(CraftKnowledgeState.Seen, Read(board, 1600.0).State);
            Assert.True(Read(board, 1600.2).LineOfSight);
            Assert.Equal(CraftKnowledgeState.Seen, Read(board, 1600.2).State);
            var lost = Read(board, 1600.4);
            Assert.Equal(CraftKnowledgeState.Modelled, lost.State);
            Assert.False(lost.LineOfSight);
        }

        [Fact]
        public void AskedAheadOfTheLastLookTheSightAnswerIsWhatTheLightThatHadReachedTheCentreByThatLookShowed()
        {
            var (board, hearing, host) = Listening();
            host.State!(Orbiting().Unsettled());
            host.Sighting!(CraftSighting.Of(Probe, 1500.0, null, Orbiting(1500.0).PlaceOnly()));
            board.Note(new[] { Home }, hearing, 1500.0, InView);
            board.Note(new[] { Home }, hearing, 1600.0, OutOfView);

            // The look at 1600 is the newest light the board has; asked later, it must not count that light as arrived.
            var ahead = Read(board, 1700.0);

            Assert.Equal(CraftKnowledgeState.Seen, ahead.State);
            Assert.True(ahead.LineOfSight);
        }

        [Fact]
        public void TheVersionMovesOnEveryNoteAndNotWithTheInstantAsked()
        {
            var (board, hearing, host) = Listening();
            host.State!(Orbiting());
            host.Reach!(new CraftReach(Probe, 1000.0, Reached));
            var start = board.Version;

            board.Note(new[] { Home }, hearing, 1100.0, OutOfView);
            var first = board.Version;
            board.KnowledgeAt(Home, "probe", 5000.0);
            board.Note(new[] { Home }, hearing, 1200.0, OutOfView);

            Assert.Equal(start + 1, first);
            Assert.Equal(first + 1, board.Version);
        }

        [Fact]
        public void TheBulkReadFillsTheBufferWithWhatEachSingleReadAnswers()
        {
            var (board, hearing, host) = Listening();
            host.State!(Orbiting());
            host.Reach!(new CraftReach(Probe, 1000.0, Reached));
            board.Note(new[] { Home }, hearing, 1100.0, OutOfView);
            var buffer = new CraftKnowledgeSample[4];

            var count = board.ReadCentre(Home, 1160.0, buffer, out var version);

            var single = board.KnowledgeAt(Home, "probe", 1160.0);
            Assert.Equal(1, count);
            Assert.Equal(board.Version, version);
            Assert.Equal("probe", buffer[0].VesselId);
            Assert.Equal(single.State, buffer[0].State);
            Assert.Equal(single.LastKnownUt, buffer[0].LastKnownUt);
            Assert.Equal(single.UncertaintyM, buffer[0].UncertaintyM);
            Assert.Equal(single.LineOfSight, buffer[0].LineOfSight);
            Assert.Equal(0, board.ReadCentre("ground:elsewhere", 1160.0, buffer, out _));
            Assert.Equal(1, board.ReadCentre(Home, 1160.0, new CraftKnowledgeSample[0], out _));
        }

        [Fact]
        public void TheBulkReadAllocatesNothingOnceWarm()
        {
            var (board, hearing, host) = Listening();
            host.State!(Orbiting());
            host.Reach!(new CraftReach(Probe, 1000.0, Reached));
            board.Note(new[] { Home }, hearing, 1100.0, OutOfView);
            var buffer = new CraftKnowledgeSample[4];
            board.ReadCentre(Home, 1160.0, buffer, out _);

            var before = GC.GetAllocatedBytesForCurrentThread();
            board.ReadCentre(Home, 1160.0, buffer, out _);

            Assert.Equal(0L, GC.GetAllocatedBytesForCurrentThread() - before);
        }

        [Fact]
        public void ACentreThatKnowsNothingOfACraftReadsUnknownEvenWhenALineToItExists()
        {
            var (board, hearing, _) = Listening();

            board.Note(new[] { Home }, hearing, 1000.0, InView);

            Assert.Same(CraftKnowledgeReading.Unknown, Read(board, 1000.0));
            Assert.Same(CraftKnowledgeReading.Unknown, board.KnowledgeAt("ground:elsewhere", "probe", 1000.0));
        }

        private sealed class Telling : ICraftStateHost
        {
            public bool TimelineResetChangedSave => false;

            public Action<CraftReach>? Reach { get; private set; }

            public Action<CraftState>? State { get; private set; }

            public Action<CraftSighting>? Sighting { get; private set; }

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

            public Action HearCraftSighting(string vesselId, string centre, Action<CraftSighting> seen)
            {
                Sighting = seen;
                return () => { };
            }

            public Action HearCraftLink(string vesselId, string centre, Action<bool> heard) => () => { };

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
