using System;
using System.Collections.Generic;
using System.IO;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Covers the periodic-flush behaviour <c>GonogoAddon</c> now relies on:
    /// <see cref="Recorder.Save"/> called repeatedly against the SAME fixed
    /// path does a full re-write each time (not an append), so reading the
    /// file back after the Nth flush always reflects the FULL session
    /// recorded so far - and <see cref="Recorder.SnapshotCount"/>/
    /// <see cref="Recorder.EventCount"/> track entries as they're recorded,
    /// for <c>GonogoAddon</c>'s per-flush log line.
    /// </summary>
    public class RecorderPeriodicFlushTests
    {
        [Fact]
        public void RepeatedSaveToSamePathOverwritesWithFullSessionSoFar()
        {
            var fakeHost = new ScriptedFakeKspHost();
            var recorder = new Recorder(fakeHost);

            var path = Path.Combine(Path.GetTempPath(), $"sitrep-host-periodic-flush-{Guid.NewGuid():N}.json");
            try
            {
                fakeHost.SetUt(0.0);
                fakeHost.SetValues(new Dictionary<string, object?> { ["a"] = 0.0 });
                recorder.Tick();

                // First flush: one snapshot only.
                recorder.Save(path);
                var firstParse = RecordedSessionCodec.Parse(File.ReadAllText(path));
                Assert.Single(firstParse.Entries);

                fakeHost.SetUt(1.0);
                fakeHost.SetValues(new Dictionary<string, object?> { ["a"] = 1.0 });
                recorder.Tick();

                fakeHost.FireLifecycle(new KspLifecycleEvent
                {
                    Ut = 1.5,
                    Kind = "scene-load",
                    Args = new Dictionary<string, object?> { ["scene"] = "flight" },
                });

                // Second flush to the SAME path: must reflect the FULL
                // session (all 3 entries), not append duplicates of the
                // first flush's content and not lose it either.
                recorder.Save(path);
                var secondParse = RecordedSessionCodec.Parse(File.ReadAllText(path));
                Assert.Equal(3, secondParse.Entries.Count);
                Assert.Equal("snapshot", secondParse.Entries[0].Kind);
                Assert.Equal("snapshot", secondParse.Entries[1].Kind);
                Assert.Equal("event", secondParse.Entries[2].Kind);
            }
            finally
            {
                if (File.Exists(path))
                {
                    File.Delete(path);
                }
            }
        }

        [Fact]
        public void SnapshotAndEventCountsTrackEntriesAsTheyAreRecorded()
        {
            var fakeHost = new ScriptedFakeKspHost();
            var recorder = new Recorder(fakeHost);

            Assert.Equal(0, recorder.SnapshotCount);
            Assert.Equal(0, recorder.EventCount);

            fakeHost.SetUt(0.0);
            fakeHost.SetValues(new Dictionary<string, object?> { ["a"] = 0.0 });
            recorder.Tick();

            Assert.Equal(1, recorder.SnapshotCount);
            Assert.Equal(0, recorder.EventCount);

            fakeHost.FireLifecycle(new KspLifecycleEvent
            {
                Ut = 0.5,
                Kind = "scene-load",
                Args = new Dictionary<string, object?> { ["scene"] = "flight" },
            });

            Assert.Equal(1, recorder.SnapshotCount);
            Assert.Equal(1, recorder.EventCount);

            fakeHost.SetUt(1.0);
            fakeHost.SetValues(new Dictionary<string, object?> { ["a"] = 1.0 });
            recorder.Tick();

            Assert.Equal(2, recorder.SnapshotCount);
            Assert.Equal(1, recorder.EventCount);
        }

        private sealed class ScriptedFakeKspHost : IKspHost
        {
            private double _ut;
            private Dictionary<string, object?> _values = new Dictionary<string, object?>();

            public void SetUt(double ut) => _ut = ut;

            public void SetValues(Dictionary<string, object?> values) => _values = values;

            public void FireLifecycle(KspLifecycleEvent evt) => Lifecycle.Invoke(evt);

            public double NowUt() => _ut;

            public KspSnapshot Sample() => new KspSnapshot { Ut = _ut, Values = new Dictionary<string, object?>(_values) };

            public event Action<KspLifecycleEvent> Lifecycle = delegate { };
        }
    }
}
