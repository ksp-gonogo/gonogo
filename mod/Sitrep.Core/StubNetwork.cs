using System;
using System.Collections.Generic;

namespace Sitrep.Core
{
    /// <summary>
    /// Network is the seam the Courier queries for point-to-point delay and
    /// reachability between a Vantage (observer, e.g. "KSC") and a node (e.g.
    /// a vessel id). Point-to-point only (D2): a scalar delay + a boolean
    /// reachability per (vantage, node) pair. No contact-plan / routing /
    /// moving relays: that's M3b.
    /// </summary>
    public interface INetwork
    {
        /// <summary>One-way light-time seconds from <paramref name="vantage"/> to <paramref name="node"/>.</summary>
        double DelayTo(string vantage, string node);

        /// <summary>Whether <paramref name="node"/> is currently reachable from <paramref name="vantage"/>.</summary>
        bool Reachable(string vantage, string node);

        /// <summary>
        /// Sets the fallback one-way delay for any (vantage, node) pair without
        /// an explicit override. The host drives the whole-network signal delay
        /// through this (Plan 1 ledger migration).
        /// </summary>
        void SetDefaultDelay(double seconds);

        /// <summary>
        /// Sets the one-way delay for a NODE, applied for that node from any
        /// vantage without a per-(vantage, node) override. The per-vessel
        /// downlink primitive (Plan 2): each vessel node carries its own routed
        /// light-time for the single KSC observer.
        /// </summary>
        void SetNodeDelay(string node, double seconds);
    }

    /// <summary>
    /// C# port of <c>mod/sitrep-server/src/stub-network.ts</c>. Semantics MUST
    /// stay byte-for-byte identical to the TS reference, conformance is
    /// asserted by <c>Sitrep.Core.Tests</c> against the shared golden fixtures
    /// in <c>mod/golden-fixtures/stub-network.json</c>, not by re-deriving
    /// semantics here. If you touch this file, regenerate the fixture from
    /// the TS side (`pnpm --filter @ksp-gonogo/sitrep-server gen:golden-fixtures`)
    /// and re-run `dotnet test` to confirm the two still agree.
    ///
    /// Scriptable point-to-point network model for tests and the reference
    /// delay engine. Every (vantage, node) pair defaults to a fixed delay and
    /// reachability (0 / true unless overridden via the constructor);
    /// individual pairs can be pinned to specific values with
    /// <see cref="SetDelay"/> / <see cref="SetReachable"/>.
    ///
    /// Pairs are keyed with a nested <see cref="Dictionary{TKey,TValue}"/>
    /// (vantage -&gt; node -&gt; value) rather than naive string
    /// concatenation, so there's no collision between e.g. ("ab", "c") and
    /// ("a", "bc").
    ///
    /// A global <c>scale</c> (light-speed / delay-scale config) multiplies
    /// every <see cref="DelayTo"/> result: the per-pair value is the *base*
    /// delay, scaled on read. <c>scale = 1</c> (the default) is unscaled.
    /// <c>scale = 0</c> zeroes every pair's delay regardless of base (light
    /// is instant). <see cref="Reachable"/> is never scaled, it's a
    /// separate, binary axis.
    /// </summary>
    public sealed class StubNetwork : INetwork
    {
        private double _defaultDelay;
        private readonly bool _defaultReachable;
        private readonly Dictionary<string, Dictionary<string, double>> _delays =
            new Dictionary<string, Dictionary<string, double>>();
        private readonly Dictionary<string, double> _nodeDelays =
            new Dictionary<string, double>();
        private readonly Dictionary<string, Dictionary<string, bool>> _reachability =
            new Dictionary<string, Dictionary<string, bool>>();
        private double _scale;

        public StubNetwork(double? delay = null, bool? reachable = null, double scale = 1)
        {
            _defaultDelay = delay ?? 0;
            _defaultReachable = reachable ?? true;
            _scale = Math.Max(0, scale);
        }

        public double DelayTo(string vantage, string node)
        {
            // Resolution order: an explicit (vantage, node) pair overrides a
            // node-level default (SetNodeDelay), which overrides the global
            // default (SetDefaultDelay). Plan 2 uses the node-default for
            // per-vessel downlink delay -- one KSC observer, so the delay
            // depends on the subject node, not the observer vantage. Plan 3
            // layers per-(vantage, node) overrides on top for multiple command
            // authorities: both paths are kept intact.
            double baseDelay;
            if (_delays.TryGetValue(vantage, out var byNode) && byNode.TryGetValue(node, out var pair))
            {
                baseDelay = pair;
            }
            else if (_nodeDelays.TryGetValue(node, out var nodeDefault))
            {
                baseDelay = nodeDefault;
            }
            else
            {
                baseDelay = _defaultDelay;
            }
            return baseDelay * _scale;
        }

        /// <summary>
        /// Set the global delay-scale multiplier applied to every
        /// <see cref="DelayTo"/> pair (0 = instant, 1 = unscaled, N = N times
        /// base delay). Negative values clamp to 0, a negative scale would
        /// schedule deliveries in the past.
        /// </summary>
        public void SetScale(double scale)
        {
            _scale = Math.Max(0, scale);
        }

        /// <summary>
        /// Set the fallback one-way delay returned by <see cref="DelayTo"/> for
        /// any (vantage, node) pair that has no explicit <see cref="SetDelay"/>
        /// override. The host drives the whole-network signal delay from a
        /// single scalar through this while keeping per-pair overrides (e.g. the
        /// 0-delay meta-vantage). NaN / infinite / negative values clamp to 0
        /// (a negative delay would schedule deliveries in the past, matching
        /// <see cref="SetScale"/>'s clamp intent).
        /// </summary>
        public void SetDefaultDelay(double seconds)
        {
            _defaultDelay = double.IsNaN(seconds) || double.IsInfinity(seconds) || seconds < 0
                ? 0
                : seconds;
        }

        /// <summary>
        /// Set the one-way delay for a NODE, applied to <see cref="DelayTo"/> for
        /// that node from ANY vantage that has no explicit per-(vantage, node)
        /// <see cref="SetDelay"/> override. This is the per-vessel downlink
        /// primitive (Plan 2): the fleet capture sets each vessel node's own
        /// routed light-time, and every KSC-observer connection reads it. NaN /
        /// infinite / negative values clamp to 0 (matching
        /// <see cref="SetDefaultDelay"/>). Plan 3 layers per-(vantage, node)
        /// <see cref="SetDelay"/> overrides ON TOP of this node-default for
        /// multiple command authorities -- keep both.
        /// </summary>
        public void SetNodeDelay(string node, double seconds)
        {
            _nodeDelays[node] = double.IsNaN(seconds) || double.IsInfinity(seconds) || seconds < 0
                ? 0
                : seconds;
        }

        public bool Reachable(string vantage, string node)
        {
            return _reachability.TryGetValue(vantage, out var byNode) && byNode.TryGetValue(node, out var value)
                ? value
                : _defaultReachable;
        }

        public void SetDelay(string vantage, string node, double seconds)
        {
            Set(_delays, vantage, node, seconds);
        }

        public void SetReachable(string vantage, string node, bool ok)
        {
            Set(_reachability, vantage, node, ok);
        }

        private static void Set<TValue>(
            Dictionary<string, Dictionary<string, TValue>> map,
            string vantage,
            string node,
            TValue value)
        {
            if (!map.TryGetValue(vantage, out var byNode))
            {
                byNode = new Dictionary<string, TValue>();
                map[vantage] = byNode;
            }
            byNode[node] = value;
        }
    }
}
