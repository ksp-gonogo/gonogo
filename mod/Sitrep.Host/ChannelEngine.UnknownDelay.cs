using System;
using System.Collections.Generic;

namespace Sitrep.Host
{
    public sealed partial class ChannelEngine
    {
        /// <summary>
        /// The node a lens topic, or a per-vessel topic whose craft cannot be
        /// resolved, records under while its key cannot be placed. No delay to it is
        /// ever known, so a reading there is held and a command to it refused until
        /// the key is placed.
        /// </summary>
        public const string UnplacedLensNode = "unplaced-lens";

        /// <summary>The refusal an operator reads when an order's subject has no known delay from the centre it was sent from.</summary>
        internal const string SubjectDelayUnknownDetail = "Not sent: this target's place on the network is not known";

        // Topics a reading was held on because no delay to its subject was known.
        // Courier-thread-only.
        private readonly HashSet<string> _heldForUnknownDelay = new HashSet<string>(StringComparer.Ordinal);

        /// <summary>
        /// Whether any delay from <paramref name="vantage"/> to <paramref name="node"/>
        /// is known: a row written for the pair or for the node, or the vantage's own
        /// site. A craft's or a centre's node with none would otherwise be timed by the
        /// whole-network default, which is the active craft's delay and says nothing
        /// about this subject. Every other node is timed by a rule of its own.
        /// </summary>
        internal bool DelayKnown(string vantage, string node)
        {
            if (node == UnplacedLensNode)
            {
                return false;
            }
            if (!IsSubjectNode(node) || vantage == MetaVantage || IsOwnSite(vantage, node))
            {
                return true;
            }
            return _ledger.HasDelayFor(vantage, node);
        }

        /// <summary>Whether the node itself, or any centre, has a finite delay to <paramref name="node"/>. A reading on it is held while none has.</summary>
        private bool NodeDelayKnown(string node) =>
            node != UnplacedLensNode && (!IsSubjectNode(node) || _ledger.HasFiniteDelayTo(node, MetaVantage));

        private static bool IsSubjectNode(string node) =>
            node.StartsWith(FleetNodePrefix, StringComparison.Ordinal)
            || node.StartsWith(CentreNodePrefix, StringComparison.Ordinal);

        /// <summary>Whether <paramref name="node"/> is where <paramref name="vantage"/> itself stands: its own ground station, or its own craft.</summary>
        private static bool IsOwnSite(string vantage, string node)
        {
            if (node.Length == CentreNodePrefix.Length + vantage.Length
                && node.StartsWith(CentreNodePrefix, StringComparison.Ordinal)
                && node.EndsWith(vantage, StringComparison.Ordinal))
            {
                return true;
            }
            return vantage.StartsWith(VesselCentrePrefix, StringComparison.Ordinal)
                && node.Length == FleetNodePrefix.Length + vantage.Length - VesselCentrePrefix.Length
                && node.StartsWith(FleetNodePrefix, StringComparison.Ordinal)
                && string.CompareOrdinal(node, FleetNodePrefix.Length, vantage, VesselCentrePrefix.Length, vantage.Length - VesselCentrePrefix.Length) == 0;
        }

        /// <summary>
        /// Courier thread, after the tick's ledger is written: every reading held for
        /// want of a delay whose subject now has one is released, as a recording is
        /// when a link returns. A subject whose link is down stays held, and its own
        /// reacquisition releases it.
        /// </summary>
        private void ReleaseReadingsNowTimed(double ut)
        {
            if (_heldForUnknownDelay.Count == 0)
            {
                return;
            }
            var released = new HashSet<string>(StringComparer.Ordinal);
            foreach (var topic in new List<string>(_heldForUnknownDelay))
            {
                var node = NodeFor(topic);
                if (!NodeDelayKnown(node))
                {
                    continue;
                }
                _heldForUnknownDelay.Remove(topic);
                if (SubjectConnected(node) && released.Add(node))
                {
                    ReplayInBlackoutBacklog(node, ut);
                }
            }
        }
    }
}
