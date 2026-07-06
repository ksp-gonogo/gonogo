using System;
using System.Collections.Generic;

namespace Sitrep.Core
{
    /// <summary>
    /// Network is the seam the Courier queries for point-to-point delay and
    /// reachability between a Vantage (observer, e.g. "KSC") and a node (e.g.
    /// a vessel id). Point-to-point only (D2): a scalar delay + a boolean
    /// reachability per (vantage, node) pair. No contact-plan / routing /
    /// moving relays — that's M3b.
    /// </summary>
    public interface INetwork
    {
        /// <summary>One-way light-time seconds from <paramref name="vantage"/> to <paramref name="node"/>.</summary>
        double DelayTo(string vantage, string node);

        /// <summary>Whether <paramref name="node"/> is currently reachable from <paramref name="vantage"/>.</summary>
        bool Reachable(string vantage, string node);
    }

    /// <summary>
    /// C# port of <c>mod/sitrep-server/src/stub-network.ts</c>. Semantics MUST
    /// stay byte-for-byte identical to the TS reference — conformance is
    /// asserted by <c>Sitrep.Core.Tests</c> against the shared golden fixtures
    /// in <c>mod/golden-fixtures/stub-network.json</c>, not by re-deriving
    /// semantics here. If you touch this file, regenerate the fixture from
    /// the TS side (`pnpm --filter @gonogo/sitrep-server gen:golden-fixtures`)
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
    /// every <see cref="DelayTo"/> result — the per-pair value is the *base*
    /// delay, scaled on read. <c>scale = 1</c> (the default) is unscaled.
    /// <c>scale = 0</c> zeroes every pair's delay regardless of base (light
    /// is instant). <see cref="Reachable"/> is never scaled — it's a
    /// separate, binary axis.
    /// </summary>
    public sealed class StubNetwork : INetwork
    {
        private readonly double _defaultDelay;
        private readonly bool _defaultReachable;
        private readonly Dictionary<string, Dictionary<string, double>> _delays =
            new Dictionary<string, Dictionary<string, double>>();
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
            var baseDelay = _delays.TryGetValue(vantage, out var byNode) && byNode.TryGetValue(node, out var value)
                ? value
                : _defaultDelay;
            return baseDelay * _scale;
        }

        /// <summary>
        /// Set the global delay-scale multiplier applied to every
        /// <see cref="DelayTo"/> pair (0 = instant, 1 = unscaled, N = N times
        /// base delay). Negative values clamp to 0 — a negative scale would
        /// schedule deliveries in the past.
        /// </summary>
        public void SetScale(double scale)
        {
            _scale = Math.Max(0, scale);
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
