using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// Wraps an <see cref="IKspHost"/> and builds up a <see cref="RecordedSession"/>
    /// timeline from it: <see cref="Tick"/> captures <see cref="IKspHost.Sample"/>
    /// as a snapshot entry (stamped with <see cref="IKspHost.NowUt"/>), and a
    /// subscription to <see cref="IKspHost.Lifecycle"/> captures every event as
    /// it fires — both appended to <see cref="Session"/> in the exact order
    /// they occur, matching <see cref="RecordedSession"/>'s "interleaved
    /// exactly as captured" contract. <see cref="ToBytes"/>/<see cref="Save"/>
    /// serialize the session via <see cref="RecordedSessionCodec"/> for a
    /// <see cref="ReplayKspHost"/> to load back headlessly.
    /// </summary>
    public sealed class Recorder : IDisposable
    {
        private readonly IKspHost _host;
        private readonly RecordedSession _session;
        private bool _disposed;

        /// <summary>
        /// Backs <see cref="RecordedEntry.Seq"/> - one shared counter across
        /// BOTH snapshots and events, incremented once per entry appended,
        /// so it reflects true capture order regardless of kind.
        /// </summary>
        private long _nextSeq;

        /// <summary>
        /// Small additive counters for <c>GonogoAddon</c>'s per-flush log
        /// line ("N snapshots, M events") - tracked alongside
        /// <see cref="Session"/> rather than counted by kind on every flush,
        /// and deliberately NOT part of the record format itself.
        /// </summary>
        private int _snapshotCount;
        private int _eventCount;

        public Recorder(IKspHost host, int schemaVersion = RecordedSessionCodec.CurrentSchemaVersion)
        {
            _host = host ?? throw new ArgumentNullException(nameof(host));
            _session = new RecordedSession
            {
                SchemaVersion = schemaVersion,
                StartUt = host.NowUt(),
            };
            _host.Lifecycle += OnLifecycle;
        }

        /// <summary>The timeline captured so far. Grows in place as <see cref="Tick"/> is called and <see cref="IKspHost.Lifecycle"/> events fire.</summary>
        public RecordedSession Session => _session;

        /// <summary>Count of snapshot entries recorded so far (see <see cref="Record"/>).</summary>
        public int SnapshotCount => _snapshotCount;

        /// <summary>Count of lifecycle-event entries recorded so far (see <see cref="OnLifecycle"/>).</summary>
        public int EventCount => _eventCount;

        /// <summary>Captures one <see cref="IKspHost.Sample"/> as a snapshot entry, stamped with that same sample's own <see cref="KspSnapshot.Ut"/>.</summary>
        public void Tick()
        {
            var snapshot = _host.Sample();
            Record(snapshot.Ut, snapshot);
        }

        /// <summary>
        /// Captures an ALREADY-SAMPLED <paramref name="snapshot"/> as a
        /// snapshot entry stamped at <paramref name="ut"/>, without calling
        /// <see cref="IKspHost.Sample"/> itself. This is the Track C fix:
        /// the recorder is a dev-capture tool and must record every
        /// UT-cadence tick UNCONDITIONALLY, regardless of whether any client
        /// is subscribed to the live stream — subscription-gating applies
        /// only to that stream (see <c>Gonogo.KSP.GonogoBodiesServer</c>),
        /// never to this method. The caller (<c>GonogoAddon.FixedUpdate</c>)
        /// samples the host exactly ONCE per cadence tick and hands the same
        /// snapshot to both this method and the emit path, rather than each
        /// side calling <see cref="IKspHost.Sample"/>/<see cref="IKspHost.NowUt"/>
        /// separately.
        /// </summary>
        public void Record(double ut, KspSnapshot snapshot)
        {
            _session.Entries.Add(new RecordedEntry
            {
                T = ut,
                Kind = "snapshot",
                WallClockUtc = DateTime.UtcNow,
                Seq = _nextSeq++,
                Snapshot = new RecordedSnapshotPayload
                {
                    Values = new Dictionary<string, object?>(snapshot.Values),
                },
            });
            _snapshotCount++;
        }

        private void OnLifecycle(KspLifecycleEvent evt)
        {
            _session.Entries.Add(new RecordedEntry
            {
                T = evt.Ut,
                Kind = "event",
                WallClockUtc = DateTime.UtcNow,
                Seq = _nextSeq++,
                Event = new RecordedEventPayload
                {
                    EventKind = evt.Kind,
                    Args = new Dictionary<string, object?>(evt.Args),
                },
            });
            _eventCount++;
        }

        /// <summary>Serializes <see cref="Session"/> to UTF-8 JSON bytes via <see cref="RecordedSessionCodec"/>.</summary>
        public byte[] ToBytes()
        {
            var json = RecordedSessionCodec.Write(_session);
            return Encoding.UTF8.GetBytes(json);
        }

        /// <summary>Writes <see cref="Session"/> to <paramref name="path"/> as UTF-8 JSON — the file a <see cref="ReplayKspHost"/> loads back.</summary>
        public void Save(string path)
        {
            File.WriteAllBytes(path, ToBytes());
        }

        /// <summary>Unsubscribes from <see cref="IKspHost.Lifecycle"/>. Safe to call multiple times.</summary>
        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }
            _disposed = true;
            _host.Lifecycle -= OnLifecycle;
        }
    }
}
