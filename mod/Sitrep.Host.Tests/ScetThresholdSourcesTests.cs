using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Alarms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Resolving a SCET threshold's <c>{ topic, fieldPath }</c> to a number off
    /// one tick's snapshot: the half of the arm that reads the craft's TRUE
    /// state, upstream of the reveal gate.
    ///
    /// <para>Every fixture here is a plain dictionary shaped like
    /// <c>Gonogo.KSP.KspHost.Sample</c>'s raw capture, which is the point: the
    /// reading path touches no KSP API, so the thing that decides whether an
    /// operator's warp stops is testable without a game.</para>
    /// </summary>
    public class ScetThresholdSourcesTests
    {
        private const string VesselGuid = "11111111-2222-3333-4444-555555555555";
        private const string Subject = "vessel:" + VesselGuid;

        private static KspSnapshot Snapshot(
            string vesselId = VesselGuid,
            double altitudeAsl = 80_000,
            IEnumerable<string>? roster = null,
            bool rosterKeyPresent = true)
        {
            var values = new Dictionary<string, object?>
            {
                ["vessel"] = new Dictionary<string, object?>
                {
                    ["identity"] = new Dictionary<string, object?>
                    {
                        ["id"] = vesselId,
                        ["name"] = "Kerbal X",
                        ["vesselType"] = "Ship",
                        ["situation"] = "ORBITING",
                    },
                    // Every key VesselViewProvider.BuildFlight requires: it
                    // answers null rather than a part-filled payload when one is
                    // missing, and a part-filled reading is exactly what must
                    // never reach a threshold comparison.
                    ["flight"] = new Dictionary<string, object?>
                    {
                        ["latitude"] = 0.5,
                        ["longitude"] = 1.5,
                        ["altitudeAsl"] = altitudeAsl,
                        ["altitudeTerrain"] = altitudeAsl - 10,
                        ["verticalSpeed"] = 120.0,
                        ["surfaceSpeed"] = 2200.0,
                        ["orbitalSpeed"] = 2300.0,
                        ["gForce"] = 1.2,
                        ["dynamicPressure"] = 0.0,
                        ["mach"] = 3.4,
                        ["atmDensity"] = 0.0,
                        ["externalTemperature"] = 250.0,
                        ["atmosphericTemperature"] = 251.0,
                    },
                },
            };
            if (rosterKeyPresent)
            {
                var ids = roster ?? new[] { vesselId };
                values["vessels"] = ids
                    .Select(id => (object?)new Dictionary<string, object?> { ["id"] = id })
                    .ToList();
            }
            return new KspSnapshot { Ut = 1000, Values = values };
        }

        [Fact]
        public void ReadsTheNumberTheSimulationActuallyHolds()
        {
            var reader = new SnapshotScetStateReader(Snapshot(altitudeAsl: 101_234.5));

            var reading = reader.Read(Subject, "vessel.flight", "altitudeAsl");

            Assert.Equal(ScetReadingStatus.Observed, reading.Status);
            Assert.Equal(101_234.5, reading.Value);
        }

        [Fact]
        public void AReadingAboutAnotherCraftIsNotAnAnswerToThisAlarm()
        {
            // The player switched vessels. The alarm named a craft and the
            // payload is about a different one, so the honest answer is "not
            // now" rather than a number about somebody else's ship.
            var other = "99999999-9999-9999-9999-999999999999";
            var reader = new SnapshotScetStateReader(
                Snapshot(vesselId: other, roster: new[] { other, VesselGuid }));

            Assert.Equal(
                ScetReadingStatus.NotObservable,
                reader.Read(Subject, "vessel.flight", "altitudeAsl").Status);
        }

        [Fact]
        public void ACraftMissingFromTheRosterIsGoneRatherThanMerelyUnwatched()
        {
            var other = "99999999-9999-9999-9999-999999999999";
            var reader = new SnapshotScetStateReader(
                Snapshot(vesselId: other, roster: new[] { other }));

            Assert.Equal(
                ScetReadingStatus.SubjectGone,
                reader.Read(Subject, "vessel.flight", "altitudeAsl").Status);
        }

        [Fact]
        public void AnAbsentRosterNeverDeclaresACraftGone()
        {
            // The scene has not loaded. Calling an alarm dead because the main
            // menu is up is the one wrong answer that cannot be taken back.
            var other = "99999999-9999-9999-9999-999999999999";
            var reader = new SnapshotScetStateReader(
                Snapshot(vesselId: other, rosterKeyPresent: false));

            Assert.Equal(
                ScetReadingStatus.NotObservable,
                reader.Read(Subject, "vessel.flight", "altitudeAsl").Status);
        }

        [Fact]
        public void NoVesselAtAllReadsAsNotObservable()
        {
            var reader = new SnapshotScetStateReader(
                new KspSnapshot { Ut = 1000, Values = new Dictionary<string, object?>() });

            Assert.Equal(
                ScetReadingStatus.NotObservable,
                reader.Read(Subject, "vessel.flight", "altitudeAsl").Status);
        }

        [Fact]
        public void NoSnapshotAtAllReadsAsNotObservable()
        {
            var reader = new SnapshotScetStateReader(null);

            Assert.Equal(
                ScetReadingStatus.NotObservable,
                reader.Read(Subject, "vessel.flight", "altitudeAsl").Status);
        }

        [Theory]
        // A Topic no threshold may be armed against.
        [InlineData("vessel.parts", "count")]
        // A path that names nothing on a Topic that does exist.
        [InlineData("vessel.flight", "altitudeAboveSeaLevel")]
        // The payload itself, which is never a number.
        [InlineData("vessel.flight", "")]
        // A path that runs off the end of a number.
        [InlineData("vessel.flight", "altitudeAsl.magnitude")]
        public void AnAddressThatResolvesToNoNumberReadsAsNotObservable(string topic, string path)
        {
            var reader = new SnapshotScetStateReader(Snapshot());

            Assert.Equal(ScetReadingStatus.NotObservable, reader.Read(Subject, topic, path).Status);
        }

        [Fact]
        public void ANestedPathResolves()
        {
            var reader = new SnapshotScetStateReader(Snapshot());

            // meta.quality is an enum, which reaches the wire as its integer:
            // a threshold on one is a legitimate way to ask whether a reading's
            // standing changed.
            var reading = reader.Read(Subject, "vessel.flight", "meta.quality");

            Assert.Equal(ScetReadingStatus.Observed, reading.Status);
        }

        [Fact]
        public void OneTopicIsBuiltOncePerReaderHoweverManyAlarmsAskForIt()
        {
            // Two alarms on one Topic is the ordinary case, and rebuilding the
            // payload per alarm would put the cost on the main thread every tick.
            var reader = new SnapshotScetStateReader(Snapshot(altitudeAsl: 50_000));

            var first = reader.Read(Subject, "vessel.flight", "altitudeAsl");
            var second = reader.Read(Subject, "vessel.flight", "verticalSpeed");

            Assert.Equal(50_000, first.Value);
            Assert.Equal(120.0, second.Value);
        }

        [Fact]
        public void EveryAddressableTopicIsOneTheSimulationCanActuallyResolve()
        {
            // The table is hand-written, so this is what stops an entry naming a
            // Topic whose payload is not a dictionary tree: a threshold armed
            // against one of those would be accepted and then never fire, which
            // is the silent failure the whole arm exists to avoid.
            foreach (var topic in ScetThresholdSources.Topics)
            {
                Assert.True(ScetThresholdSources.Knows(topic), topic);
            }
            Assert.False(ScetThresholdSources.Knows("vessel.parts"));
            Assert.False(ScetThresholdSources.Knows(null));
            Assert.False(ScetThresholdSources.Knows(""));
        }
    }
}
