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
        /// may not declare an opaque payload or a viewer filter, which a kept
        /// value is never passed through.
        /// </summary>
        public IKeptChannelSource RegisterKeptNamespace(string prefix, ChannelDeclaration template)
        {
            if (template.OpaquePayload || template.ViewerFilter != null)
            {
                throw new ArgumentException(
                    "kept namespace \"" + prefix + "\" declares an opaque payload or a viewer filter, which a kept value is never passed through",
                    nameof(template));
            }
            var dynamicSource = RegisterDynamicNamespace(prefix, template);
            var kept = new KeptNamespace(this, prefix, dynamicSource);
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
        private bool TryKeptValue(string topic, out object value)
        {
            foreach (var kept in _keptNamespaces.Values)
            {
                if (topic.StartsWith(kept.Prefix, StringComparison.Ordinal) && kept.Values.TryGetValue(topic, out value!))
                {
                    return true;
                }
            }
            value = null!;
            return false;
        }

        /// <summary>Courier-thread only: sends a just-subscribed connection the topic's kept value, when there is one.</summary>
        private void SendKeptOnSubscribe(ClientSession session, string topic)
        {
            if (TryKeptValue(topic, out var value))
            {
                SendKept(session, topic, value);
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
                    if (TryKeptValue(topic, out var value))
                    {
                        SendKept(session, topic, value);
                    }
                }
            }
        }

        /*
         * The reliable lane, so a kept value sent after a timeline reset reaches
         * the wire after the reset event queued on the same lane, never before it.
         */
        private void SendKept(ClientSession session, string topic, object value)
        {
            var now = _clock.Now();
            var frame = new StreamData
            {
                Topic = topic,
                Payload = value,
                Meta = new Meta
                {
                    Source = NodeFor(topic),
                    Vantage = ObservationVantageFor(topic, VantageOf(session)),
                    ValidAt = now,
                    DeliveredAt = now,
                    Seq = ++_ackSeq,
                    Active = true,
                    Staleness = Staleness.Fresh,
                    TimelineEpoch = _courier.CurrentEpoch,
                },
            };
            byte[] bytes;
            try
            {
                bytes = Encoding.UTF8.GetBytes(EnvelopeCodec.WriteStreamData(frame));
            }
            catch (Exception ex)
            {
                FailSoftChannel(topic, ex, "payload could not be serialized");
                return;
            }
            session.Outbox.PublishReliable(bytes);
        }

        private sealed class KeptNamespace : IKeptChannelSource
        {
            private readonly ChannelEngine _engine;
            private readonly IDynamicChannelSource _dynamic;

            public KeptNamespace(ChannelEngine engine, string prefix, IDynamicChannelSource dynamic)
            {
                _engine = engine;
                Prefix = prefix;
                _dynamic = dynamic;
            }

            public string Prefix { get; }

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
                        _engine.SendKept(session, topic, payload);
                    }
                }
            }

            public void OnSubscribed(Action<string> callback) => _dynamic.OnSubscribed(callback);
        }
    }
}
