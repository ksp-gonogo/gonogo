using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

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

        /// <summary>Captures one <see cref="IKspHost.Sample"/> as a snapshot entry, stamped with the host's current <see cref="IKspHost.NowUt"/>.</summary>
        public void Tick()
        {
            var ut = _host.NowUt();
            var snapshot = _host.Sample();
            _session.Entries.Add(new RecordedEntry
            {
                T = ut,
                Kind = "snapshot",
                Snapshot = new RecordedSnapshotPayload
                {
                    Values = new Dictionary<string, object?>(snapshot.Values),
                },
            });
        }

        private void OnLifecycle(KspLifecycleEvent evt)
        {
            _session.Entries.Add(new RecordedEntry
            {
                T = evt.Ut,
                Kind = "event",
                Event = new RecordedEventPayload
                {
                    EventKind = evt.Kind,
                    Args = new Dictionary<string, object?>(evt.Args),
                },
            });
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
