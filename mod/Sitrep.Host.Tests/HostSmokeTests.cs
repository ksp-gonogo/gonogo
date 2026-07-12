using System;
using System.Collections.Generic;
using Sitrep.Host;
using Xunit;
using Sitrep.Contract;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Task-1 scaffolding smoke tests: proves the assembly builds/loads
    /// (<see cref="HostInfo.HOST_VERSION"/>), the seam
    /// (<see cref="IKspHost"/>) is implementable with zero KSP/Unity types,
    /// and the record-format POCOs (<see cref="RecordedSession"/> et al.) are
    /// plain, constructible, serialization-shaped data — no delegates or
    /// other non-serializable members. Task 2 builds the real Recorder /
    /// ReplayKspHost round-trip on top of these types.
    /// </summary>
    public class HostSmokeTests
    {
        [Fact]
        public void HostVersionIsSet()
        {
            Assert.Equal("0.0.0", HostInfo.HOST_VERSION);
        }

        [Fact]
        public void KspSnapshotIsPlainSerializableConstructible()
        {
            var snapshot = new KspSnapshot
            {
                Ut = 123.5,
                Values = new Dictionary<string, object?>
                {
                    ["vessel.altitude"] = 71000.25,
                    ["vessel.name"] = "Kerbal X",
                    ["vessel.landed"] = false,
                    ["vessel.stage"] = null,
                },
            };

            Assert.Equal(123.5, snapshot.Ut);
            Assert.Equal(71000.25, snapshot.Values["vessel.altitude"]);
            Assert.Equal("Kerbal X", snapshot.Values["vessel.name"]);
            Assert.Equal(false, snapshot.Values["vessel.landed"]);
            Assert.Null(snapshot.Values["vessel.stage"]);
        }

        [Fact]
        public void KspLifecycleEventIsPlainSerializableConstructible()
        {
            var evt = new KspLifecycleEvent
            {
                Ut = 42.0,
                Kind = "vessel-change",
                Args = new Dictionary<string, object?> { ["vesselId"] = "abc-123" },
            };

            Assert.Equal(42.0, evt.Ut);
            Assert.Equal("vessel-change", evt.Kind);
            Assert.Equal("abc-123", evt.Args["vesselId"]);
        }

        [Fact]
        public void RecordedSessionHoldsAnOrderedMixedTimeline()
        {
            var session = new RecordedSession
            {
                SchemaVersion = 1,
                StartUt = 100.0,
                Entries =
                {
                    new RecordedEntry
                    {
                        T = 100.0,
                        Kind = "event",
                        Event = new RecordedEventPayload
                        {
                            EventKind = "scene-load",
                            Args = new Dictionary<string, object?> { ["scene"] = "flight" },
                        },
                    },
                    new RecordedEntry
                    {
                        T = 100.25,
                        Kind = "snapshot",
                        Snapshot = new RecordedSnapshotPayload
                        {
                            Values = new Dictionary<string, object?> { ["vessel.altitude"] = 500.0 },
                        },
                    },
                },
            };

            Assert.Equal(1, session.SchemaVersion);
            Assert.Equal(100.0, session.StartUt);
            Assert.Equal(2, session.Entries.Count);

            var first = session.Entries[0];
            Assert.Equal("event", first.Kind);
            Assert.Null(first.Snapshot);
            Assert.NotNull(first.Event);
            Assert.Equal("scene-load", first.Event!.EventKind);
            Assert.Equal("flight", first.Event.Args["scene"]);

            var second = session.Entries[1];
            Assert.Equal("snapshot", second.Kind);
            Assert.Null(second.Event);
            Assert.NotNull(second.Snapshot);
            Assert.Equal(500.0, second.Snapshot!.Values["vessel.altitude"]);
        }

        [Fact]
        public void IKspHostIsImplementableWithNoKspOrUnityTypes()
        {
            IKspHost fake = new FakeKspHost();

            Assert.Equal(0.0, fake.NowUt());
            var snapshot = fake.Sample();
            Assert.NotNull(snapshot.Values);
        }

        private sealed class FakeKspHost : IKspHost
        {
            public double NowUt() => 0.0;

            public KspSnapshot Sample() => new KspSnapshot();

            public event Action<KspLifecycleEvent> Lifecycle = delegate { };
        }
    }
}
