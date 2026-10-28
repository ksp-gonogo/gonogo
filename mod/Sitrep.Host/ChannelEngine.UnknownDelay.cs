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
        /// is known: a row written for the pair, for the vantage, or for the node where
        /// the node rows answer this vantage, or the vantage's own site. Every other
        /// node is timed by a rule of its own.
        /// </summary>
        internal bool DelayKnown(string vantage, string node)
        {
            if (node == UnplacedLensNode)
            {
                return false;
            }
            if (_awaitingFirstMeasuredPath && node == NodeId && vantage != MetaVantage)
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
            node != UnplacedLensNode
            && !(_awaitingFirstMeasuredPath && node == NodeId)
            && (!IsSubjectNode(node) || _ledger.HasFiniteDelayTo(node, MetaVantage));

        private static bool IsSubjectNode(string node) =>
            node.StartsWith(FleetNodePrefix, StringComparison.Ordinal)
            || node.StartsWith(CentreNodePrefix, StringComparison.Ordinal);

        private string? _fallbackHome;
        private bool _fallbackSet;
        private bool _fallbackForNoCentres;

        /// <summary>
        /// Courier thread: names the vantages the node rows answer, the home centre
        /// and a connection standing at no centre. Every node row is a figure seen
        /// from home (the active craft's delay home, a craft's downlink, the ledger's
        /// ground network), so any other centre reads a node unknown until a row of
        /// its own is written. With no centre active there is no other place to
        /// stand, so the rows answer every vantage.
        /// </summary>
        private void RefreshFallbackVantages()
        {
            var noCentres = _activeCentreIds.Count == 0;
            var home = noCentres ? null : HomeCentre();
            if (_fallbackSet && noCentres == _fallbackForNoCentres && home == _fallbackHome)
            {
                return;
            }
            _fallbackSet = true;
            _fallbackForNoCentres = noCentres;
            _fallbackHome = home;
            if (noCentres)
            {
                _ledger.SetFallbackVantages(null);
                return;
            }
            _ledger.SetFallbackVantages(home == null
                ? new[] { CommandCentres.FreshConnectionVantage.None }
                : new[] { CommandCentres.FreshConnectionVantage.None, home });
        }

        // The centre set the own-site rows were last pinned for, and the rows. Courier-thread-only.
        private HashSet<string>? _ownSitesPinnedFor;
        private readonly HashSet<(string Vantage, string Node)> _ownSiteRows = new HashSet<(string, string)>();

        /// <summary>
        /// Courier thread: writes a zero row from each active centre to its own
        /// site, its ground station's node and, for a crewed centre, its own craft's,
        /// and lets go of the rows of a centre that is no longer active.
        /// </summary>
        private void PinOwnSites()
        {
            var centres = _activeCentreIds;
            if (ReferenceEquals(centres, _ownSitesPinnedFor))
            {
                return;
            }
            _ownSitesPinnedFor = centres;

            var next = new HashSet<(string Vantage, string Node)>();
            foreach (var centre in centres)
            {
                next.Add((centre, CentreNodePrefix + centre));
                if (centre.StartsWith(VesselCentrePrefix, StringComparison.Ordinal))
                {
                    next.Add((centre, FleetNodePrefix + centre.Substring(VesselCentrePrefix.Length)));
                }
            }
            foreach (var row in _ownSiteRows)
            {
                if (!next.Contains(row))
                {
                    _network.ClearDelay(row.Vantage, row.Node);
                }
            }
            _ownSiteRows.Clear();
            foreach (var row in next)
            {
                _network.SetDelay(row.Vantage, row.Node, 0.0);
                _ownSiteRows.Add(row);
            }
        }

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
