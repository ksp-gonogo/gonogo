using System.Collections.Concurrent;
using System.Collections.Generic;

namespace Sitrep.Host
{
    /// <summary>
    /// The change-gate for the <c>vessel.partActions.&lt;flightId&gt;</c> namespace:
    /// remembers the last signature published per sub-topic and lets through only
    /// the parts whose action list actually moved.
    ///
    /// <para><b>Why the producer owns this.</b> It predates the emitter's own
    /// value comparison: <c>Sitrep.Core.ChannelEmitter</c>'s gate used to compare
    /// a freshly-built <c>Dictionary&lt;string, object?&gt;</c> by REFERENCE, so a
    /// per-tick rebuild of an identical payload read as changed every tick, and a
    /// channel whose whole justification is "the action set only moves on
    /// deploy/stage/dock" emitted at sample cadence for as long as an operator
    /// kept a part open. The emitter would now catch that on its own.
    ///
    /// This still earns its place ahead of it, for two reasons the emitter cannot
    /// cover: it filters a BATCH down to the sub-topics worth publishing at all,
    /// before any of them reach the engine, and its per-sub-topic pruning is what
    /// makes a re-open republish (see below). A cheap string signature, computed
    /// once where the batch is built, is also the right instrument here.
    /// See <see cref="PartActionsViewProvider.Signature"/>.</para>
    ///
    /// <para><b>Pruning is what makes a re-open work.</b> <see cref="Changed"/>
    /// retains only the sub-topics in the batch it was handed, and the caller hands
    /// it exactly the currently-subscribed set, so closing a part's popover drops
    /// its entry and re-opening re-publishes from scratch instead of being gated
    /// out by a signature from the previous session. <see cref="Invalidate"/> covers
    /// the tighter race (a re-subscribe inside one tick, where the part never leaves
    /// the subscribed set) and is wired to
    /// <see cref="IDynamicChannelSource.OnSubscribed"/>.</para>
    ///
    /// <para>Thread-safe by construction: <see cref="Changed"/> runs on the Unity
    /// main thread (inside the capture half of
    /// <see cref="IUplinkHost.AddSampledSource"/>) while <see cref="Invalidate"/>
    /// runs on the Courier thread (where <c>OnSubscribed</c> fires), so the store is
    /// a <see cref="ConcurrentDictionary{TKey,TValue}"/> rather than a plain one.</para>
    /// </summary>
    public sealed class PartActionsPublicationCache
    {
        private readonly ConcurrentDictionary<string, string> _lastSignatureBySubTopic =
            new ConcurrentDictionary<string, string>();

        /// <summary>
        /// Filters <paramref name="publications"/> down to the ones worth putting on
        /// the wire, and prunes every remembered sub-topic NOT in this batch (see
        /// the class doc). Records each returned publication's signature as the new
        /// last-published state, so calling this twice with unchanged input yields
        /// the batch once and then nothing.
        /// </summary>
        public List<PartActionsViewProvider.Publication> Changed(
            List<PartActionsViewProvider.Publication> publications)
        {
            var present = new HashSet<string>();
            var changed = new List<PartActionsViewProvider.Publication>();

            foreach (var publication in publications)
            {
                present.Add(publication.SubTopic);

                if (_lastSignatureBySubTopic.TryGetValue(publication.SubTopic, out var last)
                    && last == publication.Signature)
                {
                    continue;
                }

                _lastSignatureBySubTopic[publication.SubTopic] = publication.Signature;
                changed.Add(publication);
            }

            foreach (var known in new List<string>(_lastSignatureBySubTopic.Keys))
            {
                if (!present.Contains(known))
                {
                    _lastSignatureBySubTopic.TryRemove(known, out _);
                }
            }

            return changed;
        }

        /// <summary>
        /// Forget one sub-topic's last signature, so the next
        /// <see cref="Changed"/> republishes it even if its content is identical.
        /// Wired to a fresh subscribe: a new viewer needs the current value, and
        /// "nothing changed since the last viewer" is not a reason to leave them
        /// with an empty popover.
        /// </summary>
        public void Invalidate(string subTopic)
        {
            _lastSignatureBySubTopic.TryRemove(subTopic, out _);
        }
    }
}
