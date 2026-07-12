using System.Collections.Generic;

namespace Sitrep.Core
{
    /// <summary>
    /// Tracks which channels currently have at least one subscriber. This is
    /// the OUTER gate in the streaming-slice-1 sampling pipeline —
    /// <see cref="ChannelEmitter"/> is the INNER one. A channel with zero
    /// subscribers must never be sampled or have <see cref="ChannelEmitter.Decide"/>
    /// called for it at all: the intended call-site shape (future Track C,
    /// <c>Gonogo.KSP.GonogoBodiesServer</c>'s UT-cadence sampling loop) is
    ///
    /// <code>
    /// if (registry.Subscribe(channelId)) // true only on a genuine 0 -&gt; 1 transition
    /// {
    ///     emitter.NotifySubscribed(channelId);
    /// }
    /// // ...
    /// if (registry.IsSubscribed(channelId))
    /// {
    ///     var decision = emitter.Decide(channelId, ReadValue(channelId), ut);
    ///     if (decision.ShouldEmit) { /* record + broadcast */ }
    /// }
    /// </code>
    ///
    /// i.e. this registry decides WHETHER a channel is looked at all;
    /// <see cref="ChannelEmitter"/> decides, for a channel that IS looked at,
    /// whether that particular sample is worth emitting. Deliberately
    /// separate from <see cref="ChannelEmitter"/> itself (rather than one
    /// class owning both gates) so a caller that already has its own
    /// subscriber bookkeeping (e.g. Courier's per-(node,topic) subscriber
    /// sets) isn't forced to duplicate it here — this class exists for
    /// callers that don't.
    /// </summary>
    public sealed class SubscriptionRegistry
    {
        private readonly Dictionary<string, int> _subscriberCounts = new Dictionary<string, int>();

        /// <summary>
        /// Register one more subscriber for <paramref name="channelId"/>.
        /// Returns <c>true</c> only on a genuine 0 -&gt; 1 transition (the
        /// channel had no subscribers before this call) — the caller should
        /// treat that as the signal to force an immediate keyframe via
        /// <see cref="ChannelEmitter.NotifySubscribed"/>.
        /// </summary>
        public bool Subscribe(string channelId)
        {
            _subscriberCounts.TryGetValue(channelId, out var count);
            _subscriberCounts[channelId] = count + 1;
            return count == 0;
        }

        /// <summary>
        /// Remove one subscriber for <paramref name="channelId"/>. Returns
        /// <c>true</c> only on a genuine 1 -&gt; 0 transition (the channel has
        /// no subscribers left after this call). Unsubscribing a channel
        /// with no recorded subscribers is a no-op that returns <c>false</c>.
        /// </summary>
        public bool Unsubscribe(string channelId)
        {
            if (!_subscriberCounts.TryGetValue(channelId, out var count) || count <= 0)
            {
                return false;
            }

            var remaining = count - 1;
            if (remaining <= 0)
            {
                _subscriberCounts.Remove(channelId);
                return true;
            }

            _subscriberCounts[channelId] = remaining;
            return false;
        }

        /// <summary>Whether <paramref name="channelId"/> currently has at least one subscriber.</summary>
        public bool IsSubscribed(string channelId)
        {
            return _subscriberCounts.TryGetValue(channelId, out var count) && count > 0;
        }

        /// <summary>Current subscriber count for <paramref name="channelId"/> (0 if never subscribed, or fully unsubscribed).</summary>
        public int SubscriberCount(string channelId)
        {
            return _subscriberCounts.TryGetValue(channelId, out var count) ? count : 0;
        }
    }
}
