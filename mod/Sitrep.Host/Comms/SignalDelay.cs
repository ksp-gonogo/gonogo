using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// Config for the CORE SignalDelay capability (comms-uplink-design.md
    /// §3, revised: promoted from an opt-in Uplink to a config-flagged core
    /// capability). <see cref="Enabled"/> gates whether gonogo computes a
    /// light-time delay at all; <see cref="LightSpeedScale"/> scales the
    /// speed of light (1.0 = real light-speed, the "clean realism" default;
    /// a larger scale shortens delay for a gentler experience).
    /// </summary>
    public sealed class SignalDelayConfig
    {
        public bool Enabled { get; set; }
        public double LightSpeedScale { get; set; } = 1.0;

        public static SignalDelayConfig Off() => new SignalDelayConfig { Enabled = false };
    }

    /// <summary>
    /// gonogo's OWN light-time computation over backend-supplied hop geometry
    /// (comms-uplink-design.md §3.1). Composes identically over CommNet or
    /// RealAntennas: it reads only <see cref="CommsHop.DistanceMeters"/> from
    /// the elected backend's <see cref="CommsPath"/>, never any backend's own
    /// delay accessor. Pure and headlessly tested — the KSP-facing core
    /// registration calls <see cref="Compute"/> from a channel-source closure
    /// after resolving the backend via the Kernel.
    ///
    /// <para>R7 typed absence: <see cref="CommsDelaySource.None"/> covers TWO
    /// distinct cases, told apart by <c>OneWaySeconds</c>'s value (see
    /// <see cref="CommsDelay.OneWaySeconds"/>'s own doc comment) — the flag
    /// being off is a genuine "zero delay applied" while connected
    /// (<c>OneWaySeconds = 0</c>); no measurable path (no path home, a
    /// non-positive light-speed scale, or any hop missing geometry) has
    /// nothing to report at all (<c>OneWaySeconds = null</c>). Neither case
    /// is ever mistaken for a measured zero-distance delay.</para>
    /// </summary>
    public static class SignalDelay
    {
        /// <summary>Speed of light in vacuum, m/s.</summary>
        public const double SpeedOfLightMetersPerSecond = 299792458.0;

        /// <summary>
        /// Compute <c>comms.delay</c> from the elected backend's hop geometry.
        /// TRUE-NOW sim-meta (§1): the returned value drives the delay of every
        /// other channel and is itself never delay-gated.
        /// </summary>
        /// <param name="config">The SignalDelay config flag + light-speed scale.</param>
        /// <param name="path">The elected backend's ordered hops to KSC (may be null/empty).</param>
        /// <param name="source">Provenance for the payload meta (e.g. the vessel/game source id).</param>
        /// <param name="quality">On-rails vs loaded, carried through to the payload meta.</param>
        public static CommsDelay Compute(
            SignalDelayConfig? config,
            CommsPath? path,
            string source,
            Quality quality)
        {
            var meta = new PayloadMeta { Source = source ?? "", Quality = quality };

            // Flag off ⇒ delay-DISABLED-but-connected: a genuine "zero delay
            // applied", not an absence. The core ViewClock then releases
            // everything live (§3.1).
            if (config == null || !config.Enabled)
            {
                return Disabled(meta);
            }

            // A non-positive scale would divide by zero / go negative — treat
            // as "cannot compute" rather than emitting a garbage delay. This
            // is a no-measurable-path case (null), not the delay-disabled
            // case (0): the flag IS on, there's just nothing honest to report.
            if (config.LightSpeedScale <= 0.0)
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

            double effectiveC = SpeedOfLightMetersPerSecond * config.LightSpeedScale;
            double oneWaySeconds = totalMeters / effectiveC;

            return new CommsDelay
            {
                OneWaySeconds = oneWaySeconds,
                Source = CommsDelaySource.SignalDelay,
                Meta = meta,
            };
        }

        /// <summary>Delay feature is off but the vessel IS connected — a real "zero applied", so <c>OneWaySeconds = 0</c> (never null).</summary>
        private static CommsDelay Disabled(PayloadMeta meta) => new CommsDelay
        {
            OneWaySeconds = 0.0,
            Source = CommsDelaySource.None,
            Meta = meta,
        };

        /// <summary>No measurable path (no hops, incomplete hop geometry, or an unusable light-speed scale) — nothing to report, so <c>OneWaySeconds = null</c> (never 0).</summary>
        private static CommsDelay NoPath(PayloadMeta meta) => new CommsDelay
        {
            OneWaySeconds = null,
            Source = CommsDelaySource.None,
            Meta = meta,
        };
    }
}
