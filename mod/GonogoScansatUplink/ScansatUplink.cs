using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using SCANsat;

namespace Gonogo.ScansatUplink
{
    /// <summary>
    /// The GonogoScansatUplink reference implementation — the FIRST
    /// separate (non-bundled) Uplink, establishing the packaging pattern
    /// U2-U4 reuse (see <c>.superpowers/sdd/uplink-packaging-pattern.md</c>).
    /// Reads SCANsat's public API in-process (zero Harmony,
    /// scansat-migration-spec.md §4).
    ///
    /// SCOPE NOTE (be honest about what shipped in U1): this wires the
    /// version-guard (§3) and the two STATIC-topic channels
    /// (<c>scansat.available</c>, <c>scansat.scanningVessels</c>), mirroring
    /// <c>SystemUplink</c>'s shape exactly. The poll-hash change signal and
    /// keyframe-on-change plane packing the spec's <c>scansat.mask.{body}.
    /// {type}</c>/<c>coverage.{body}.{type}</c> channels need (§2.1-§2.3)
    /// are implemented and unit-tested as pure logic
    /// (<see cref="CoverageHash"/>/<see cref="CoveragePlane"/>) but are NOT
    /// wired to live per-body/per-type channels here: <c>IUplinkHost</c> as
    /// it exists today (<c>Sitrep.Contract/UplinkContract.cs</c>) takes a
    /// single fixed <c>topic</c> string per <see cref="IUplinkHost.AddChannelSource"/>/
    /// <see cref="IUplinkHost.Publisher"/> call, declared ahead of time in
    /// the static <see cref="Manifest"/> — there is no dynamic/parametrized
    /// topic registration for a topic set that depends on which body a
    /// vessel is orbiting. Closing that gap (a per-instance topic factory,
    /// or a small fixed enumeration of "the active body's" mask/coverage
    /// channels re-pointed on subject-epoch change, mirroring
    /// <c>VesselEpochSampler</c>) is real, tracked follow-up work — see the
    /// U1 report's gaps section — not invented here to make this look more
    /// complete than it is. The mask/height/biome/anomalies grid channels
    /// (spec §2.2 table) are P2/P3 scope and are not implemented at all.
    /// </summary>
    [SitrepUplink("scansat")]
    public sealed class ScansatUplink : ISitrepUplink
    {
        public const string AvailableTopic = "scansat.available";
        public const string ScanningVesselsTopic = "scansat.scanningVessels";

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "scansat",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                // Ground-side fact (mod/sensor presence) - true-now, per
                // spec §2.2 the ONE channel that bypasses the delay clock.
                new ChannelDeclaration
                {
                    Topic = AvailableTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
                // Vessel-derived (discover-by-scanning fiction, spec §2.2) -
                // rides the delay clock alongside every other vessel-sourced
                // channel, same as VesselUplink's channels.
                new ChannelDeclaration
                {
                    Topic = ScanningVesselsTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
            },
        };

        public void Register(IUplinkHost host)
        {
            VersionGuardResult guard;
            try
            {
                guard = VersionGuard.Probe(typeof(SCANUtil).Assembly);
            }
            catch (Exception ex)
            {
                // Fail-soft per the contract: a probe exception must never
                // crash the engine or take down other registered uplinks.
                guard = VersionGuardResult.Fail($"version-guard probe threw: {ex.Message}");
            }

            if (!guard.IsAvailable)
            {
                host.SetAvailability(Availability.Unavailable(guard.Reason ?? "SCANsat unavailable"));
                host.AddChannelSource(AvailableTopic, _ => false);
                host.AddChannelSource(ScanningVesselsTopic, _ => new List<object>());
                return;
            }

            host.AddChannelSource(AvailableTopic, _ => true);
            host.AddChannelSource(ScanningVesselsTopic, _ => BuildScanningVessels());
        }

        private static List<object> BuildScanningVessels()
        {
            // SCANcontroller.Known_Vessels is public (SCANcontroller.cs:555)
            // and allocates fresh per call (spec §0C cost caveat) - fine at
            // a coarse cadence, not per frame. Cast<object> because the
            // wire-typed SCANScanningVessel mapping (SCANvessel -> the
            // [SitrepContract] payload type) is P2 scope, not implemented
            // here - see this class's scope note.
            var controller = SCANcontroller.controller;
            if (controller == null) return new List<object>();
            return controller.Known_Vessels.Cast<object>().ToList();
        }
    }
}
