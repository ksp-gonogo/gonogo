using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// Config for the core SignalDelay capability (comms-uplink-design.md
    /// §3, revised: promoted from an opt-in Uplink to a config-flagged core
    /// capability). <see cref="Enabled"/> gates whether gonogo computes a
    /// signal delay delay at all; <see cref="LightSpeedScale"/> scales the
    /// speed of light (1.0 = real light-speed, the "clean realism" default;
    /// a larger scale shortens delay for a gentler experience).
    /// </summary>
    public sealed class SignalDelayConfig
    {
        public bool Enabled { get; set; }
        public double LightSpeedScale { get; set; } = 1.0;

        /// <summary>
        /// How long a currency event with no route home waits before KSC stops
        /// waiting and reconciles the books anyway. Default one Kerbin day.
        ///
        /// <para>Honestly a policy, not a pretend measurement: there is no
        /// signal delay to a craft nothing can reach. It exists so the
        /// never-regains-contact case terminates at all, rather than leaving a
        /// penalty pending forever. The event is released at the deadline and
        /// at no other time: regaining contact does not bring it forward.</para>
        /// </summary>
        public double SilenceDeclarationSeconds { get; set; } =
            GameDayDefaults.StockDaySeconds;

        /// <summary>
        /// Set only on the derived config <see cref="CommsModelPolicy"/> hands
        /// out while this save models no comms network at all (the stock
        /// CommNet difficulty option is off), never on an authored one. It is
        /// what lets <see cref="SignalDelay.Compute"/> report
        /// <see cref="CommsDelaySource.NoCommsModel"/> rather than a bare
        /// <see cref="CommsDelaySource.None"/>, so an operator can tell a save
        /// with no comms model from one whose delay was simply never turned on.
        /// </summary>
        public bool CutForNoCommsModel { get; set; }

        public static SignalDelayConfig Off() => new SignalDelayConfig { Enabled = false };
    }

    /// <summary>
    /// gonogo's own signal delay computation over backend-supplied hop geometry
    /// (comms-uplink-design.md §3.1). Composes identically over CommNet or
    /// RealAntennas: it reads only <see cref="CommsHop.DistanceMeters"/> from
    /// the elected backend's <see cref="CommsPath"/>, never any backend's own
    /// delay accessor. Pure and headlessly tested: the KSP-facing core
    /// registration calls <see cref="Compute"/> from a channel-source closure
    /// after resolving the backend via the Kernel.
    ///
    /// <para>R7 typed absence: <see cref="CommsDelaySource.None"/> covers two
    /// distinct cases, told apart by <c>OneWaySeconds</c>'s value (see
    /// <see cref="CommsDelay.OneWaySeconds"/>'s own doc comment): the flag
    /// being off is a genuine "zero delay applied" while connected
    /// (<c>OneWaySeconds = 0</c>); no measurable path (no path home, a
    /// non-positive light-speed scale, or any hop missing geometry) has
    /// nothing to report at all (<c>OneWaySeconds = null</c>). Neither case
    /// is ever mistaken for a measured zero-distance delay.</para>
    ///
    /// <para>One way to reach that zero names itself rather than sharing
    /// <c>None</c>, because the operator's next move differs:
    /// <see cref="CommsDelaySource.NoCommsModel"/> (this save models no network
    /// at all).</para>
    /// </summary>
    public static class SignalDelay
    {
        /// <summary>Speed of light in vacuum, m/s.</summary>
        public const double SpeedOfLightMetersPerSecond = 299792458.0;

        /// <summary>
        /// The speed light travels at under <paramref name="config"/>, m/s, or
        /// null when nothing usable says: no config at all, or a scale that is
        /// not a positive number and so would divide by zero or run time
        /// backwards.
        ///
        /// <para>The one place the scale is applied. <see cref="Compute"/> sums
        /// a route against it and <see cref="PathBreakWatch"/> builds its
        /// per-hop ladder against it, and the two must agree exactly or a break
        /// position lands on a route whose total the delay disagrees with.</para>
        /// </summary>
        public static double? EffectiveC(SignalDelayConfig? config) =>
            config == null ? (double?)null : EffectiveC(config.LightSpeedScale);

        /// <summary>
        /// <see cref="EffectiveC(SignalDelayConfig)"/> for a caller holding the
        /// bare scale, which <see cref="PathBreakWatch"/> is: the drop event is
        /// handed a scale rather than a config, because everything else on the
        /// config decides whether there is a delay and only this decides how
        /// long the route is.
        /// </summary>
        public static double? EffectiveC(double lightSpeedScale)
        {
            if (!(lightSpeedScale > 0.0))
            {
                return null;
            }
            return SpeedOfLightMetersPerSecond * lightSpeedScale;
        }

        /// <summary>Whether <paramref name="path"/> has hops and every one of them a length, which is what delay on needs to state a delay at all.</summary>
        private static bool HasMeasurableRoute(CommsPath? path)
        {
            var hops = path?.Hops;
            if (hops == null || hops.Count == 0)
            {
                return false;
            }

            foreach (var hop in hops)
            {
                if (hop == null || hop.DistanceMeters == null)
                {
                    return false;
                }
            }

            return true;
        }

        /// <summary>
        /// <see cref="Compute"/> for a craft's own route home: a craft with no
        /// route reads as no path whether delay is on or switched off, so a dark
        /// craft is never reported as a delay of zero. The one case that stays a
        /// known zero without a route is a save with no comms network, where
        /// every craft is connected.
        /// </summary>
        public static CommsDelay ComputeForCraft(SignalDelayConfig? config, CommsPath? path, string source)
        {
            var switchedOff = config != null && !config.Enabled && !config.CutForNoCommsModel;
            if (switchedOff && !HasMeasurableRoute(path))
            {
                return NoPath(new PayloadMeta { Source = source ?? "" });
            }

            return Compute(config, path, source);
        }

        /// <summary>
        /// Compute <c>comms.delay</c> from the elected backend's hop geometry.
        /// TRUE-NOW sim-meta (§1): the returned value drives the delay of every
        /// other channel and is itself never delay-gated.
        /// </summary>
        /// <param name="config">The SignalDelay config flag + light-speed scale.</param>
        /// <param name="path">The elected backend's ordered hops to KSC (may be null/empty).</param>
        /// <param name="source">Provenance for the payload meta (e.g. the vessel/game source id).</param>
        public static CommsDelay Compute(
            SignalDelayConfig? config,
            CommsPath? path,
            string source)
        {
            var meta = new PayloadMeta { Source = source ?? "" };
            var effectiveC = EffectiveC(config);

            // Flag off ⇒ delay-DISABLED-but-connected: a genuine "zero delay
            // applied", not an absence. The core ViewClock then releases
            // everything live (§3.1).
            if (config == null || !config.Enabled)
            {
                return Disabled(config, meta);
            }

            // A non-positive scale would divide by zero / go negative; treat
            // as "cannot compute" rather than emitting a garbage delay. This
            // is a no-measurable-path case (null), not the delay-disabled
            // case (0): the flag IS on, there's just nothing honest to report.
            if (effectiveC == null)
            {
                return NoPath(meta);
            }

            IReadOnlyList<CommsHop>? hops = path?.Hops;
            if (hops == null || hops.Count == 0)
            {
                // No path home ⇒ no geometry ⇒ no computable delay. (The link
                // being down is reported by comms.connectivity/path; delay
                // simply has nothing to measure.)
                return NoPath(meta);
            }

            double totalMeters = 0.0;
            foreach (var hop in hops)
            {
                if (hop == null || hop.DistanceMeters == null)
                {
                    // Typed absence on any hop ⇒ incomplete geometry ⇒ cannot
                    // honestly compute a total light-time. Do NOT treat a
                    // missing hop distance as 0.
                    return NoPath(meta);
                }
                totalMeters += hop.DistanceMeters.Value;
            }

            double oneWaySeconds = totalMeters / effectiveC.Value;

            return new CommsDelay
            {
                OneWaySeconds = oneWaySeconds,
                Source = CommsDelaySource.SignalDelay,
                Meta = meta,
            };
        }

        /// <summary>
        /// Delay feature is off but the vessel is connected, a real "zero
        /// applied", so <c>OneWaySeconds = 0</c> (never null).
        ///
        /// <para>Two ways to be off, told apart by <see cref="Source"/>: delay
        /// is switched off, or this save models no comms network at all. The
        /// magnitude is the same zero and the reason is not, and an operator
        /// looking at a live board deserves the reason.</para>
        /// </summary>
        private static CommsDelay Disabled(SignalDelayConfig? config, PayloadMeta meta) => new CommsDelay
        {
            OneWaySeconds = 0.0,
            Source = SourceOfZero(config),
            Meta = meta,
        };

        private static CommsDelaySource SourceOfZero(SignalDelayConfig? config) =>
            config != null && config.CutForNoCommsModel ? CommsDelaySource.NoCommsModel : CommsDelaySource.None;

        /// <summary>No measurable path (no hops, incomplete hop geometry, or an unusable light-speed scale), nothing to report, so <c>OneWaySeconds = null</c> (never 0).</summary>
        private static CommsDelay NoPath(PayloadMeta meta) => new CommsDelay
        {
            OneWaySeconds = null,
            Source = CommsDelaySource.None,
            Meta = meta,
        };

        /// <summary>
        /// The same route as <see cref="Compute"/>, broken into its ordered
        /// legs rather than summed to a scalar. Null under exactly the
        /// conditions <see cref="Compute"/> reports <c>OneWaySeconds = null</c>
        /// for over an equivalent hop list (no hops, or an unusable
        /// light-speed scale); the flag being off returns a single
        /// zero-second leg, the same "delay disabled but connected" zero
        /// <see cref="Compute"/> reports.
        ///
        /// <para><see cref="Journey.TotalSeconds"/> is guaranteed
        /// bit-for-bit equal to what <see cref="Compute"/> would return for
        /// the same hops: both divide the same running total of metres by
        /// the same <see cref="EffectiveC(SignalDelayConfig)"/>, at every
        /// step here rather than once at the end, so the last leg's
        /// cumulative always lands exactly on the one-shot total. Each leg's
        /// own seconds is that running total's step, a derived breakdown for
        /// positional reasoning (a future break's distance along the route),
        /// never a fresh division of its own distance summed up afterwards:
        /// that path is the one that drifts a few ULPs from the total.</para>
        /// </summary>
        public static Journey? ComputeJourney(SignalDelayConfig? config, IReadOnlyList<CommsRouteHop>? hops)
        {
            // Unroutable outranks the flag, matching RoutedPathDelay's own
            // null-hops short-circuit ahead of Compute: a null list means no
            // route exists at all, not that this connection is idle.
            if (hops == null)
            {
                return null;
            }

            if (config == null || !config.Enabled)
            {
                return new Journey(new[] { new Hop(0.0) });
            }

            var effectiveC = EffectiveC(config);
            if (effectiveC == null || hops.Count == 0)
            {
                return null;
            }

            var timedHops = new Hop[hops.Count];
            double cumulativeMeters = 0.0;
            double cumulativeSeconds = 0.0;
            for (var i = 0; i < hops.Count; i++)
            {
                var hop = hops[i];
                var previousSeconds = cumulativeSeconds;
                cumulativeMeters += hop.DistanceMeters;
                cumulativeSeconds = cumulativeMeters / effectiveC.Value;
                timedHops[i] = new Hop(
                    cumulativeSeconds - previousSeconds,
                    hop.DistanceMeters,
                    hop.TouchesHome,
                    hop.FromHandle,
                    hop.ToHandle);
            }

            return new Journey(timedHops);
        }
    }
}
