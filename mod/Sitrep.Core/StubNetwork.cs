using System;
using System.Collections.Generic;

namespace Sitrep.Core
{
    /// <summary>
    /// An immutable snapshot of every one-way delay that applied to ONE node at
    /// one instant: the vantage-independent base, plus whatever explicit
    /// per-(vantage, node) rows overrode it.
    ///
    /// <para>C#-ONLY, no TS reference, the same class of addition as
    /// <see cref="INetwork.SetNodeDelay"/>. It exists so a recorded sample can
    /// carry the delay its own journey was sent under. The ledger answers
    /// "what is the delay NOW, per node", which is the right question at
    /// record time and the wrong one when a backlog is replayed later: nothing
    /// else answered "what was it when this sample left".</para>
    ///
    /// <para>A stamp is per NODE and per VANTAGE, not one number per sample. A
    /// scalar cannot express the two-vantage case the golden fixtures already
    /// pin (KSC at 2 s and DSN at 5 s off the same node), so a late subscriber
    /// on one of them would be replayed the other one's light-time.</para>
    ///
    /// <para>Immutable, so it is shared BY REFERENCE across every sample
    /// recorded while the ledger held still (see
    /// <see cref="INetwork.StampFor"/>'s caching contract). The per-sample cost
    /// is therefore one reference, not a copy of the map.</para>
    /// </summary>
    public sealed class DelayStamp
    {
        /*
         * The per-vantage rows are two parallel arrays scanned linearly, not a
         * Dictionary. A stamp is RETAINED for as long as the oldest sample
         * holding it, so its own footprint is part of what an archived sample
         * costs: measured on a one-row stamp (the shape every node has, from
         * the meta vantage), a Dictionary is 312 B against 160 B for the
         * arrays. The scan is over the vantages with an EXPLICIT row on one
         * node, the meta vantage plus one per command centre, which is single
         * digits and where a linear scan beats a hash anyway.
         */
        private readonly double _baseSeconds;
        private readonly string[]? _vantages;
        private readonly double[]? _seconds;

        public DelayStamp(double baseSeconds, IReadOnlyDictionary<string, double>? byVantage = null)
        {
            _baseSeconds = baseSeconds;
            if (byVantage == null || byVantage.Count == 0)
            {
                return;
            }

            _vantages = new string[byVantage.Count];
            _seconds = new double[byVantage.Count];
            var at = 0;
            foreach (var pair in byVantage)
            {
                _vantages[at] = pair.Key;
                _seconds[at] = pair.Value;
                at++;
            }
        }

        /// <summary>The delay for a vantage with no explicit row of its own.</summary>
        public double BaseSeconds => _baseSeconds;

        /// <summary>
        /// The explicit per-vantage rows as a fresh map, or <c>null</c> when
        /// there were none. For <see cref="Archive.Snapshot"/>, which has to
        /// write the stamp out as plain BCL data rather than as a reference.
        /// </summary>
        public Dictionary<string, double>? ByVantage()
        {
            if (_vantages == null || _seconds == null)
            {
                return null;
            }

            var rows = new Dictionary<string, double>(_vantages.Length);
            for (var i = 0; i < _vantages.Length; i++)
            {
                rows[_vantages[i]] = _seconds[i];
            }
            return rows;
        }

        /// <summary>
        /// The one-way delay this node had to <paramref name="vantage"/> when
        /// the stamp was taken. Resolves the same two tiers, in the same order,
        /// as <see cref="INetwork.DelayTo"/>.
        /// </summary>
        public double For(string vantage)
        {
            if (_vantages != null && _seconds != null)
            {
                for (var i = 0; i < _vantages.Length; i++)
                {
                    if (string.Equals(_vantages[i], vantage, StringComparison.Ordinal))
                    {
                        return _seconds[i];
                    }
                }
            }
            return _baseSeconds;
        }

        /// <summary>
        /// This stamp with <paramref name="extraSeconds"/> added to every tier:
        /// the journey time of a sample that WAITED before it was sent. A
        /// blackout recording is the case (see <see cref="Courier.ReplayRecorded"/>):
        /// it describes an instant long before it travelled, so the interval
        /// from its ValidAt to its arrival is the wait plus the light-time, and
        /// a stamp carrying only the light-time would date its arrival to the
        /// middle of the outage.
        /// </summary>
        public DelayStamp Plus(double extraSeconds)
        {
            var rows = ByVantage();
            if (rows == null)
            {
                return new DelayStamp(_baseSeconds + extraSeconds);
            }

            var shifted = new Dictionary<string, double>(rows.Count);
            foreach (var pair in rows)
            {
                shifted[pair.Key] = pair.Value + extraSeconds;
            }
            return new DelayStamp(_baseSeconds + extraSeconds, shifted);
        }
    }

    /// <summary>
    /// One break in the route carrying a node's signal: when it opened, where
    /// along the route it sat, and when (if ever) it closed again.
    ///
    /// <para>C#-ONLY, no TS reference. See <see cref="INetwork.DropPath"/> for
    /// why a break cannot be expressed as a delay value.</para>
    /// </summary>
    public readonly struct PathDrop
    {
        public PathDrop(double atUt, double lightSecondsOut, double restoredAtUt)
        {
            AtUt = atUt;
            LightSecondsOut = lightSecondsOut;
            RestoredAtUt = restoredAtUt;
        }

        /// <summary>The UT the route broke.</summary>
        public double AtUt { get; }

        /// <summary>How far out from the node the break sat, in light-seconds along the route.</summary>
        public double LightSecondsOut { get; }

        /// <summary>The UT the route was whole again, or <see cref="double.PositiveInfinity"/> for a break that never closes.</summary>
        public double RestoredAtUt { get; }

        /// <summary>
        /// Whether light that left the node at <paramref name="sentAtUt"/> ran
        /// into this break.
        ///
        /// <para>Three conditions, and each one is doing work. The light must
        /// have LEFT before the break opened, because anything sent afterwards
        /// rides whatever route the ledger holds now and never goes near this
        /// one. It must NOT already have crossed the break point, which is the
        /// whole of the per-hop question and is why the position is carried at
        /// all. And it must reach that point while the break is still open: an
        /// occultation that clears before the wavefront gets there never touched
        /// it.</para>
        ///
        /// <para>Light arriving at the break point at exactly
        /// <see cref="AtUt"/> is treated as having crossed, matching
        /// <c>ChordOcclusion</c>'s convention that zero clearance is a clear
        /// path. The choice is arbitrary at a measure-zero boundary; what
        /// matters is that only one convention exists.</para>
        /// </summary>
        public bool Caught(double sentAtUt)
        {
            if (sentAtUt > AtUt)
            {
                return false;
            }
            var reachesBreakAt = sentAtUt + LightSecondsOut;
            return reachesBreakAt > AtUt && reachesBreakAt < RestoredAtUt;
        }
    }

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
        /// C#-ONLY. Snapshot every delay that applies to <paramref name="node"/>
        /// right now, so a sample recorded at this instant can carry the delay
        /// its own journey rides (see <see cref="DelayStamp"/>).
        ///
        /// <para>Implementations MUST satisfy
        /// <c>StampFor(node).For(vantage) == DelayTo(vantage, node)</c> for
        /// every vantage at the instant the stamp is taken, and SHOULD return
        /// the same instance for repeated calls while nothing has changed: the
        /// Courier stamps every recorded sample, so a fresh allocation per
        /// record would put the cost on the hottest path there is.</para>
        /// </summary>
        DelayStamp StampFor(string node);

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

        /// <summary>
        /// Sets the one-way delay for an EXPLICIT (vantage, node) pair, the
        /// highest-precedence tier of <see cref="DelayTo"/>. Overrides the
        /// <see cref="SetNodeDelay"/> node-default for that specific observer.
        /// The per-(authority, subject) command primitive (Plan 3): a command
        /// centre's routed light-time to a fleet subject, applied only when an
        /// operator selects that centre as its vantage.
        /// </summary>
        void SetDelay(string vantage, string node, double seconds);

        /// <summary>
        /// C#-ONLY. Record that the route carrying <paramref name="node"/>'s
        /// signal broke at <paramref name="atUt"/>,
        /// <paramref name="lightSecondsOut"/> of light-time out from the node,
        /// and was whole again at <paramref name="restoredAtUt"/> (omit for a
        /// break that never closes: a destroyed relay).
        ///
        /// <para>THE DROP EVENT, and it is an event rather than a value on
        /// purpose. Every other write on this ledger sets a DELAY, which can say
        /// "further away" and "nearer" and has no honest way to say GONE. Forced
        /// through that channel, gone has to be smuggled as a zero, a null or an
        /// infinity, and an overloaded sentinel is what produced the
        /// <c>overdue</c>/<c>lost</c> confusion elsewhere in this system. So a
        /// break gets its own vocabulary, sitting beside the delay tiers rather
        /// than inside them.</para>
        ///
        /// <para>A destroyed vessel is the edge case of a reroute where the new
        /// path does not exist. A reroute is already expressible: the delay
        /// changes, the tail in flight keeps arriving on its own record-time
        /// <see cref="DelayStamp"/>, and the new route governs what is sent
        /// after. What a reroute could never express is that the tail is not
        /// arriving at all, because the relay that would have retransmitted it
        /// is the relay that died. That is what this records.</para>
        ///
        /// <para>The POSITION is the part that could not be inferred. A delay
        /// stamp fixes WHEN a sample arrives; where the break sat along the
        /// route is what decides WHETHER it arrives, and it is the one quantity
        /// nothing else in the stack carries. Light already past the break point
        /// when the break opened is unaffected: it is a wavefront on the far
        /// leg and the break is behind it.</para>
        ///
        /// <para>INTERNAL to the delay machinery. Nothing about a drop reaches
        /// the wire: a client sees only the silence it produces, which is the
        /// same silence it would see from a sample that had genuinely not
        /// arrived yet.</para>
        ///
        /// <para>Deliberately orthogonal to <see cref="Reachable"/> and to every
        /// delay tier. Reachability answers whether a NEW message can be sent;
        /// this answers what happens to the light already on the wire, and the
        /// two have different answers during exactly the window that matters.
        /// Recording a drop therefore changes no delay and invalidates no
        /// <see cref="StampFor"/> cache.</para>
        ///
        /// <para>NO PRODUCTION CALLER YET, said plainly because an unfed seam
        /// that does not admit it is worse than no seam. Raising one needs a
        /// break's POSITION, and the ordered hop list that carries it
        /// (<c>CommsBackendBase.Path</c>) is summed into a single scalar by
        /// <c>SignalDelay.Compute</c> before anything downstream can see it.
        /// Retaining that list per subject per tick is a real cost and a
        /// separate decision, and it is bounded by warp: at a rate where one
        /// physics tick spans more UT than the whole one-way light-time, there
        /// is no ordering between "sent", "crossed" and "broke" to be had, and
        /// the honest behaviour is today's, which is to deliver, because we do
        /// not know it did not cross.</para>
        /// </summary>
        void DropPath(
            string node,
            double atUt,
            double lightSecondsOut,
            double restoredAtUt = double.PositiveInfinity);

        /// <summary>
        /// C#-ONLY. Whether light that left <paramref name="node"/> at
        /// <paramref name="sentAtUt"/> ran into a break recorded by
        /// <see cref="DropPath"/>, and so can never arrive anywhere.
        ///
        /// <para>Asked at DELIVERY time rather than stamped at record time, and
        /// that is the opposite of what <see cref="DelayStamp"/> exists to
        /// enforce, for a reason worth stating. A delay is a property of the
        /// journey and is fixed the instant the light leaves, so re-reading it
        /// later answers for a route the sample never took. Whether a break
        /// caught it is a fact about an instant DURING that journey, which the
        /// record could not have known. The stamp must be early and this must be
        /// late.</para>
        ///
        /// <para>Node-scalar, where a delay is per-vantage. A break sits on the
        /// node's route home, and while two vantages can legitimately be at
        /// different light-times off one node, nothing here can yet express a
        /// break on one vantage's branch and not the other's. Say so rather than
        /// pretending: a branch-point break wants the per-vantage shape
        /// <see cref="DelayStamp"/> already has.</para>
        /// </summary>
        bool Lost(string node, double sentAtUt);

        /// <summary>
        /// C#-ONLY. Forget every recorded break, called by
        /// <see cref="Courier.ResetTimeline"/> on a quickload.
        ///
        /// <para>A drop is a statement about one timeline, unlike a delay tier,
        /// which the live capture overwrites every tick and which is therefore
        /// self-correcting across a rewind. Left in place, a break recorded in
        /// the abandoned future would go on dooming light sent before it on a
        /// timeline where the relay is still alive. Dropped whole rather than
        /// pruned by UT, the same treatment the Courier's gap bookkeeping
        /// gets.</para>
        /// </summary>
        void ForgetDrops();
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

        /*
         * Stamp cache (C#-ONLY, see INetwork.StampFor). Every recorded sample
         * asks for a stamp, and the delay ledger changes at most once a tick
         * while a channel records many times within it, so a stamp is built
         * once per node per ledger change and handed out by reference after
         * that. _revision is bumped by every mutation rather than compared
         * value by value: a counter cannot miss a change, and a comparison
         * over the pair map would cost more than the allocation it saves.
         */
        private readonly Dictionary<string, DelayStamp> _stamps =
            new Dictionary<string, DelayStamp>();
        private int _revision;
        private int _stampedRevision = -1;

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

        public DelayStamp StampFor(string node)
        {
            if (_stampedRevision != _revision)
            {
                _stamps.Clear();
                _stampedRevision = _revision;
            }
            if (_stamps.TryGetValue(node, out var cached))
            {
                return cached;
            }

            // Same two tiers, same order, same scaling as DelayTo: the explicit
            // (vantage, node) rows over a node default over the global one.
            var baseDelay = _nodeDelays.TryGetValue(node, out var nodeDefault) ? nodeDefault : _defaultDelay;
            Dictionary<string, double>? byVantage = null;
            foreach (var byNode in _delays)
            {
                if (!byNode.Value.TryGetValue(node, out var pinned))
                {
                    continue;
                }
                byVantage ??= new Dictionary<string, double>();
                byVantage[byNode.Key] = pinned * _scale;
            }

            var stamp = new DelayStamp(baseDelay * _scale, byVantage);
            _stamps[node] = stamp;
            return stamp;
        }

        /// <summary>
        /// Set the global delay-scale multiplier applied to every
        /// <see cref="DelayTo"/> pair (0 = instant, 1 = unscaled, N = N times
        /// base delay). Negative values clamp to 0, a negative scale would
        /// schedule deliveries in the past.
        /// </summary>
        public void SetScale(double scale)
        {
            var clamped = Math.Max(0, scale);
            if (clamped == _scale)
            {
                return;
            }
            _scale = clamped;
            _revision++;
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
            var clamped = double.IsNaN(seconds) || double.IsInfinity(seconds) || seconds < 0
                ? 0
                : seconds;
            if (clamped == _defaultDelay)
            {
                return;
            }
            _defaultDelay = clamped;
            _revision++;
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
            var clamped = double.IsNaN(seconds) || double.IsInfinity(seconds) || seconds < 0
                ? 0
                : seconds;
            if (_nodeDelays.TryGetValue(node, out var held) && held == clamped)
            {
                return;
            }
            _nodeDelays[node] = clamped;
            _revision++;
        }

        public bool Reachable(string vantage, string node)
        {
            return _reachability.TryGetValue(vantage, out var byNode) && byNode.TryGetValue(node, out var value)
                ? value
                : _defaultReachable;
        }

        public void SetDelay(string vantage, string node, double seconds)
        {
            if (_delays.TryGetValue(vantage, out var byNode)
                && byNode.TryGetValue(node, out var held)
                && held == seconds)
            {
                return;
            }
            Set(_delays, vantage, node, seconds);
            _revision++;
        }

        public void SetReachable(string vantage, string node, bool ok)
        {
            Set(_reachability, vantage, node, ok);
        }

        /*
         * The recorded breaks, per node, in the order they were recorded. See
         * INetwork.DropPath.
         *
         * A list rather than one entry because a route can break more than once
         * over a session, and an occultation every orbit is the ordinary case
         * rather than the exotic one. It is unbounded, which is a real cost
         * stated rather than hidden: three doubles per break, against a break
         * rate measured in orbits and a sample rate measured in seconds.
         * Pruning wants to know the oldest sample still in flight, which is the
         * Courier's _owedScenes and not the ledger's to see, so it is
         * deliberately not attempted from here.
         *
         * No _revision bump on write: a break changes no delay, so every cached
         * DelayStamp stays valid (INetwork.DropPath).
         */
        private readonly Dictionary<string, List<PathDrop>> _drops =
            new Dictionary<string, List<PathDrop>>();

        public void DropPath(
            string node,
            double atUt,
            double lightSecondsOut,
            double restoredAtUt = double.PositiveInfinity)
        {
            // A NaN position would make every comparison in PathDrop.Caught
            // false, i.e. silently record a break that catches nothing. Clamped
            // to a break at the node itself, which catches nothing either but
            // says so, and matches the NaN clamps on every delay setter above.
            var outSeconds = double.IsNaN(lightSecondsOut) || lightSecondsOut < 0
                ? 0
                : lightSecondsOut;
            if (!_drops.TryGetValue(node, out var held))
            {
                held = new List<PathDrop>();
                _drops[node] = held;
            }
            held.Add(new PathDrop(atUt, outSeconds, restoredAtUt));
        }

        public bool Lost(string node, double sentAtUt)
        {
            if (!_drops.TryGetValue(node, out var held))
            {
                return false;
            }
            for (var i = 0; i < held.Count; i++)
            {
                if (held[i].Caught(sentAtUt))
                {
                    return true;
                }
            }
            return false;
        }

        public void ForgetDrops()
        {
            _drops.Clear();
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
