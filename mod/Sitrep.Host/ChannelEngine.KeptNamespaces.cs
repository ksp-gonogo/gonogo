using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Text;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using StreamData = Sitrep.Contract.StreamData<object?>;

namespace Sitrep.Host
{
    /// <summary>
    /// A dynamic namespace whose topics each hold one value that never changes
    /// once known, sent to each connection once per subscription from the
    /// source's own copy. Obtained from <see cref="ChannelEngine.RegisterKeptNamespace"/>.
    /// </summary>
    public interface IKeptChannelSource
    {
        /// <summary>
        /// Keeps <paramref name="payload"/> as the value of <c>prefix +
        /// subTopic</c> and sends it to every connection subscribed to that
        /// topic now. Call it on the Courier thread, from the off-main-thread
        /// half of a sampled source.
        /// </summary>
        void Keep(string subTopic, object payload);

        /// <summary>
        /// As <see cref="Keep"/>, from any thread: the value is handed to the
        /// Courier thread and kept there. For a source driven by the game's
        /// frames rather than by a sampled tick, which runs only in a game scene
        /// and at the sampling rate.
        /// </summary>
        void KeepFromAnyThread(string subTopic, object payload);

        /// <summary>
        /// Registers <paramref name="callback"/> to run, on the Courier thread,
        /// every time a connection subscribes to a topic under the prefix, with
        /// the full topic. The engine sends that connection the topic's kept
        /// value itself, after its subscribe is acknowledged.
        /// </summary>
        void OnSubscribed(Action<string> callback);
    }

    public sealed partial class ChannelEngine
    {
        /*
         * A kept value travels past the Courier and its archive on purpose. The
         * archive's copy is dropped by a quickload (Archive.ResetTimeline keeps
         * nothing newer than the rewind) and by a topic trim, and a client
         * already holding the value marks it cold once the timeline epoch moves
         * on. So the source's own copy is the one every connection is sent: once
         * when it subscribes, once to every subscriber when the value is first
         * kept, and once to every subscriber after a timeline reset. Nothing is
         * recorded, so the archive has no copy to replay on top of these.
         */
        private readonly ConcurrentDictionary<string, KeptNamespace> _keptNamespaces = new ConcurrentDictionary<string, KeptNamespace>(StringComparer.Ordinal);

        /// <summary>
        /// Declares a dynamic namespace whose values are each kept by the engine
        /// and sent to each connection once per subscription, rather than
        /// recorded and replayed: for values that never change once known and
        /// must reach a late subscriber whatever happened to the timeline. The
        /// template is used as <see cref="RegisterDynamicNamespace"/> uses it, and
        /// may not declare a viewer filter, which a kept value is never passed
        /// through. A template declaring <see cref="ChannelDeclaration.OpaquePayload"/>
        /// keeps byte segments and sends each copy as a binary-lane frame.
        /// </summary>
        public IKeptChannelSource RegisterKeptNamespace(string prefix, ChannelDeclaration template)
        {
            if (template.ViewerFilter != null)
            {
                throw new ArgumentException(
                    "kept namespace \"" + prefix + "\" declares a viewer filter, which a kept value is never passed through",
                    nameof(template));
            }
            var dynamicSource = RegisterDynamicNamespace(prefix, template);
            var kept = new KeptNamespace(this, prefix, dynamicSource, template.OpaquePayload);
            _keptNamespaces[prefix] = kept;
            return kept;
        }

        /// <summary>Courier-thread only: drops everything the Courier holds for <paramref name="topic"/>, as a trim of a topic nobody reads does.</summary>
        internal void TrimTopicForTests(string topic)
        {
            _courier.TrimTopic(NodeFor(topic), topic, double.PositiveInfinity);
            _courier.ForgetTopic(NodeFor(topic), topic);
        }

        /// <summary>Courier-thread only: the kept value of <paramref name="topic"/>, if it is under a kept namespace and has one.</summary>
        private bool TryKeptValue(string topic, out object value, out bool opaque)
        {
            foreach (var kept in _keptNamespaces.Values)
            {
                if (topic.StartsWith(kept.Prefix, StringComparison.Ordinal) && kept.Values.TryGetValue(topic, out value!))
                {
                    opaque = kept.Opaque;
                    return true;
                }
            }
            value = null!;
            opaque = false;
            return false;
        }

        /// <summary>Courier-thread only: sends a just-subscribed connection the topic's kept value, when there is one.</summary>
        private void SendKeptOnSubscribe(ClientSession session, string topic)
        {
            if (TryKeptValue(topic, out var value, out var opaque))
            {
                SendKept(session, topic, value, opaque);
            }
        }

        /// <summary>Courier-thread only: sends every subscribed connection each kept value it subscribes to, on the timeline now current.</summary>
        private void SendKeptAfterTimelineReset()
        {
            if (_keptNamespaces.IsEmpty)
            {
                return;
            }
            foreach (var session in _sessions.Values)
            {
                foreach (var topic in session.Unsubscribers.Keys)
                {
                    if (TryKeptValue(topic, out var value, out var opaque))
                    {
                        SendKept(session, topic, value, opaque);
                    }
                }
            }
        }

        /*
         * A kept value sent after a timeline reset reaches the wire after the
         * reset event: JSON values go on the same reliable lane, and byte values
         * on the bulk lane, which the outbox drains only after the reliable one
         * and which the reset clears of the topic's earlier copy. Byte values are
         * large (a body's map is megabytes), so they go one at a time as the
         * socket writes them rather than all at once into its queue.
         */
        private void SendKept(ClientSession session, string topic, object value, bool opaque, Staleness staleness = Staleness.Fresh)
        {
            var now = _clock.Now();
            var meta = new Meta
            {
                Source = NodeFor(topic),
                Vantage = ObservationVantageFor(topic, VantageOf(session)),
                ValidAt = now,
                DeliveredAt = now,
                Seq = ++_ackSeq,
                Active = true,
                Staleness = staleness,
                TimelineEpoch = _courier.CurrentEpoch,
            };
            byte[] bytes;
            try
            {
                bytes = opaque
                    ? BinaryFrameCodec.WriteStreamBinary(new StreamBinary { Topic = topic, Meta = meta }, OpaqueSegments(topic, value))
                    : Encoding.UTF8.GetBytes(EnvelopeCodec.WriteStreamData(new StreamData { Topic = topic, Payload = value, Meta = meta }));
            }
            catch (Exception ex)
            {
                FailSoftChannel(topic, ex, "payload could not be serialized");
                return;
            }
            if (opaque)
            {
                session.Outbox.PublishBulk(topic, bytes);
            }
            else
            {
                session.Outbox.PublishReliable(bytes);
            }
        }

        private sealed class KeptNamespace : IKeptChannelSource
        {
            private readonly ChannelEngine _engine;
            private readonly IDynamicChannelSource _dynamic;

            public KeptNamespace(ChannelEngine engine, string prefix, IDynamicChannelSource dynamic, bool opaque)
            {
                _engine = engine;
                Prefix = prefix;
                _dynamic = dynamic;
                Opaque = opaque;
            }

            public string Prefix { get; }

            /// <summary>Whether each kept value is byte segments, sent on the binary lane.</summary>
            public bool Opaque { get; }

            /* Full topic to kept value. Written and read on the Courier thread. */
            public ConcurrentDictionary<string, object> Values { get; } = new ConcurrentDictionary<string, object>(StringComparer.Ordinal);

            public void Keep(string subTopic, object payload)
            {
                var topic = Prefix + subTopic;
                Values[topic] = payload;
                foreach (var session in _engine._sessions.Values)
                {
                    if (session.Unsubscribers.ContainsKey(topic))
                    {
                        _engine.SendKept(session, topic, payload, Opaque);
                    }
                }
            }

            public void KeepFromAnyThread(string subTopic, object payload) => _engine.EnqueueJob(new KeepJob(this, subTopic, payload));

            public void OnSubscribed(Action<string> callback) => _dynamic.OnSubscribed(callback);
        }

        /// <summary>Queued by <see cref="IKeptChannelSource.KeepFromAnyThread"/>, kept on the Courier thread.</summary>
        private sealed class KeepJob : IEngineJob
        {
            public KeepJob(IKeptChannelSource kept, string subTopic, object payload)
            {
                Kept = kept;
                SubTopic = subTopic;
                Payload = payload;
            }

            public IKeptChannelSource Kept { get; }

            public string SubTopic { get; }

            public object Payload { get; }
        }
    }
}
