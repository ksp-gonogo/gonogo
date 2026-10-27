using System;
using System.Collections.Generic;
using Sitrep.Core;

namespace Sitrep.Host
{
    public sealed partial class ChannelEngine
    {
        // Prefixes of the dynamic namespaces that declared
        // ChannelDeclaration.PerLensNode. Written during Register() (before
        // Start()), then only read.
        private readonly List<string> _perLensNamespacePrefixes = new List<string>();

        private const string VesselCentrePrefix = "vessel:";

        /*
         * Lens bindings and the knowledge each scope holds. Bindings arrive from
         * Uplink threads and the frontiers advance on the Courier thread, so both
         * sit behind one lock.
         */
        private readonly object _lensLock = new object();
        private readonly Dictionary<string, UplinkScopeFrontier> _lensScopes = new Dictionary<string, UplinkScopeFrontier>(StringComparer.Ordinal);
        private readonly List<LensBinding> _lensBindings = new List<LensBinding>();

        private sealed class LensBinding
        {
            public string Scope = "";
            public string Site = "";
            public string Centre = "";
        }

        /// <summary>
        /// The node a lens topic records and delays under, or null when the topic is
        /// not under a lens namespace. A lens at a ground station is that centre's
        /// node; a lens on a craft is the craft's own node; a lens whose key cannot
        /// be placed is <see cref="UnplacedLensNode"/>, never the active craft's.
        /// </summary>
        private string? LensNodeFor(string topic)
        {
            foreach (var prefix in _perLensNamespacePrefixes)
            {
                if (!topic.StartsWith(prefix, StringComparison.Ordinal))
                {
                    continue;
                }
                var key = KeySegment(topic, prefix.Length);
                var node = key == null ? null : NodeForLensSite(ResolveLensSite(prefix, key));
                return node ?? UnplacedLensNode;
            }
            return null;
        }

        private string? ResolveLensSite(string prefix, string key)
        {
            if (!_dynamicNamespaces.TryGetValue(prefix, out var template) || template?.LensSiteForKey == null)
            {
                return null;
            }
            try
            {
                var site = template.LensSiteForKey(key);
                return string.IsNullOrEmpty(site) ? null : site;
            }
            catch (Exception ex)
            {
                FailSoftNamespaceResolver(prefix, ex);
                return null;
            }
        }

        private static string? NodeForLensSite(string? site)
        {
            if (site == null)
            {
                return null;
            }
            return site.StartsWith(VesselCentrePrefix, StringComparison.Ordinal)
                ? FleetNodePrefix + site.Substring(VesselCentrePrefix.Length)
                : CentreNodePrefix + site;
        }

        /// <summary>
        /// Starts delivering <paramref name="commandingCentre"/>'s knowledge to the lens at
        /// <paramref name="site"/> (a centre id, as <c>commandCentre.roster</c> lists it),
        /// counted into <paramref name="scope"/>. Sites bound to one scope are aged by the
        /// longest delay among them.
        /// </summary>
        public void BindLensSite(string scope, string site, string commandingCentre)
        {
            lock (_lensLock)
            {
                _lensBindings.RemoveAll(b => b.Scope == scope && b.Site == site);
                _lensBindings.Add(new LensBinding { Scope = scope, Site = site, Centre = commandingCentre });
                if (!_lensScopes.TryGetValue(scope, out var held))
                {
                    held = new UplinkScopeFrontier();
                    _lensScopes[scope] = held;
                }
                held.Join(site);
            }
        }

        /// <summary>Stops counting <paramref name="site"/> toward <paramref name="scope"/>.</summary>
        public void UnbindLensSite(string scope, string site)
        {
            lock (_lensLock)
            {
                _lensBindings.RemoveAll(b => b.Scope == scope && b.Site == site);
                if (_lensScopes.TryGetValue(scope, out var held))
                {
                    held.Remove(site);
                }
            }
        }

        /// <summary>
        /// The newest instant of its commanding centre's knowledge that has reached every
        /// lens in <paramref name="scope"/>, or null while none has. Never moves back, and
        /// holds still while a path to any lens is lost or unmeasured, and for one delay
        /// after a path is first seen or returns (see <see cref="UplinkFrontier"/>).
        /// </summary>
        public double? LensKnowledgeUt(string scope)
        {
            lock (_lensLock)
            {
                return _lensScopes.TryGetValue(scope, out var held) && held.HasDelivered ? held.DeliveredUt : (double?)null;
            }
        }

        /// <summary>Courier thread: one tick's view of every bound lens's path from its commanding centre.</summary>
        private void AdvanceLensDelivery(double nowUt)
        {
            lock (_lensLock)
            {
                foreach (var binding in _lensBindings)
                {
                    _lensScopes[binding.Scope].Advance(binding.Site, nowUt, LensPathSeconds(binding));
                }
            }
        }

        private void ResetLensDelivery()
        {
            lock (_lensLock)
            {
                var scopes = new List<string>(_lensScopes.Keys);
                foreach (var scope in scopes)
                {
                    var fresh = new UplinkScopeFrontier();
                    foreach (var binding in _lensBindings)
                    {
                        if (binding.Scope == scope)
                        {
                            fresh.Join(binding.Site);
                        }
                    }
                    _lensScopes[scope] = fresh;
                }
            }
        }

        /// <summary>
        /// The one-way seconds from the commanding centre to the lens's site, or null when
        /// no path exists or no delay along it has been measured. A centre commanding a
        /// lens at its own site has no delay.
        /// </summary>
        private double? LensPathSeconds(LensBinding binding)
        {
            if (binding.Centre == binding.Site)
            {
                return 0.0;
            }
            var node = NodeForLensSite(binding.Site)!;
            var routed = node.StartsWith(CentreNodePrefix, StringComparison.Ordinal)
                ? _centreRoutes.TryGetValue(binding.Centre, out var reached) && reached.Contains(binding.Site)
                : CanSend(binding.Centre, node);
            if (!routed || !DelayKnown(binding.Centre, node))
            {
                return null;
            }
            var seconds = UplinkDelayTo(binding.Centre, node);
            return double.IsInfinity(seconds) || double.IsNaN(seconds) ? (double?)null : seconds;
        }
    }
}
