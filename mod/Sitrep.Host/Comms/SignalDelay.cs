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
    /// <para>R7 typed absence: when delay cannot be computed (flag off, no
    /// path, or any hop missing geometry), the result is
    /// <see cref="CommsDelaySource.None"/> with <c>OneWaySeconds = 0</c> — a
    /// consumer reads that as "no delay authority", never mistaking 0 for a
    /// measured zero-distance delay.</para>
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

            // Flag off ⇒ delay is 0 / source:none. The core ViewClock then
            // releases everything live (§3.1).
            if (config == null || !config.Enabled)
            {
                return None(meta);
            }

            // A non-positive scale would divide by zero / go negative — treat
            // as "cannot compute" rather than emitting a garbage delay.
            if (config.LightSpeedScale <= 0.0)
            {
                return None(meta);
            }

            IReadOnlyList<CommsHop>? hops = path?.Hops;
            if (hops == null || hops.Count == 0)
            {
                // No path home ⇒ no geometry ⇒ no computable delay. (The link
                // being down is reported by comms.connectivity/path; delay
                // simply has nothing to measure.)
                return None(meta);
            }

            double totalMeters = 0.0;
            foreach (var hop in hops)
            {
                if (hop == null || hop.DistanceMeters == null)
                {
                    // Typed absence on any hop ⇒ incomplete geometry ⇒ cannot
                    // honestly compute a total light-time. Do NOT treat a
                    // missing hop distance as 0.
                    return None(meta);
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

        private static CommsDelay None(PayloadMeta meta) => new CommsDelay
        {
            OneWaySeconds = 0.0,
            Source = CommsDelaySource.None,
            Meta = meta,
        };
    }
}
