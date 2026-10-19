using System;
using System.Collections.Generic;
using System.IO;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    public class RecorderStreamingTests
    {
        private static string TempPath() =>
            Path.Combine(Path.GetTempPath(), $"sitrep-host-streaming-{Guid.NewGuid():N}.jsonl");

        private static void Tick(ScriptedFakeKspHost host, Recorder recorder, double ut)
        {
            host.SetUt(ut);
            host.SetValues(new Dictionary<string, object?> { ["a"] = ut, ["b"] = "x" });
            recorder.Tick();
        }

        [Fact]
        public void AStreamedSessionRoundTripsThroughTheReader()
        {
            var host = new ScriptedFakeKspHost();
            var recorder = new Recorder(host);
            var path = TempPath();
            try
            {
                Tick(host, recorder, 0.0);
                host.FireLifecycle(new KspLifecycleEvent
                {
                    Ut = 0.5,
                    Kind = "scene-load",
                    Args = new Dictionary<string, object?> { ["scene"] = "flight" },
                });

                recorder.StartStreaming(path, TimeSpan.FromHours(1));
                Tick(host, recorder, 1.0);
                recorder.Dispose();

                var parsed = RecordedSessionCodec.Parse(File.ReadAllText(path));
                Assert.Equal(3, parsed.Entries.Count);
                Assert.Equal("snapshot", parsed.Entries[0].Kind);
                Assert.Equal("event", parsed.Entries[1].Kind);
                Assert.Equal("scene-load", parsed.Entries[1].Event!.EventKind);
                Assert.Equal(1.0, parsed.Entries[2].T);
                Assert.Equal(new long[] { 0, 1, 2 }, new[] { parsed.Entries[0].Seq, parsed.Entries[1].Seq, parsed.Entries[2].Seq });
                Assert.Empty(recorder.Session.Entries);
            }
            finally
            {
                File.Delete(path);
            }
        }

        [Fact]
        public void AFlushWritesOnlyWhatIsNewHoweverLongTheSession()
        {
            var host = new ScriptedFakeKspHost();
            var recorder = new Recorder(host);
            var path = TempPath();
            try
            {
                recorder.StartStreaming(path, TimeSpan.FromHours(1));

                var ut = 0.0;
                long previousBytes = 0;
                var deltas = new List<long>();
                for (var flush = 0; flush < 5; flush++)
                {
                    for (var i = 0; i < 200; i++)
                    {
                        Tick(host, recorder, ut++);
                    }
                    recorder.FlushStream();
                    Assert.Equal(200, recorder.LastDrainCount);
                    deltas.Add(recorder.StreamedBytes - previousBytes);
                    previousBytes = recorder.StreamedBytes;
                }

                // Every flush appended the same amount of work, so the last one cost no more than the first.
                Assert.InRange(deltas[4], deltas[1] - 64, deltas[1] + 64);
                Assert.Equal(new FileInfo(path).Length, recorder.StreamedBytes);
                recorder.Dispose();
            }
            finally
            {
                File.Delete(path);
            }
        }

        [Fact]
        public void ATornLastLineIsIgnoredAndTheRestStillReads()
        {
            var host = new ScriptedFakeKspHost();
            var recorder = new Recorder(host);
            var path = TempPath();
            try
            {
                recorder.StartStreaming(path, TimeSpan.FromHours(1));
                Tick(host, recorder, 0.0);
                Tick(host, recorder, 1.0);
                recorder.Dispose();

                File.AppendAllText(path, "{\"t\":2,\"kind\":\"snap");
                Assert.Equal(2, RecordedSessionCodec.Parse(File.ReadAllText(path)).Entries.Count);
            }
            finally
            {
                File.Delete(path);
            }
        }

        [Fact]
        public void AWholeDocumentSessionStillReads()
        {
            var host = new ScriptedFakeKspHost();
            var recorder = new Recorder(host);
            Tick(host, recorder, 0.0);
            Tick(host, recorder, 1.0);

            var parsed = RecordedSessionCodec.Parse(RecordedSessionCodec.Write(recorder.Session));
            Assert.Equal(2, parsed.Entries.Count);
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
