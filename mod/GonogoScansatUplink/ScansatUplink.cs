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
    /// SCOPE NOTE (U2 status — the dynamic-topic gap U1 flagged is now
    /// CLOSED): U1 wired the version-guard (§3) and the two STATIC-topic
    /// channels (<c>scansat.available</c>, <c>scansat.scanningVessels</c>)
    /// only, because <c>IUplinkHost</c> had no way to register a topic set
    /// parametrized by which body a vessel is orbiting. This milestone adds
    /// <see cref="IUplinkHost.RegisterDynamicNamespace"/> to the contract
    /// (Minor bump — see <c>.superpowers/sdd/contract-dynamic-delay-report.md</c>)
    /// and wires it here: <see cref="Sample"/> (an <see cref="ISnapshotSampler"/>)
    /// poll-hashes the ACTIVE vessel's main body's coverage grid each tick
    /// (<see cref="CoverageHash"/>/<see cref="CoveragePlane"/>, unchanged
    /// from U1) and publishes <c>scansat.coverage.&lt;body&gt;.AltimetryLoRes</c>/
    /// <c>scansat.mask.&lt;body&gt;.AltimetryLoRes</c> only when that body's
    /// plane actually changed — real keyframe-on-change, not just unit-tested
    /// pure logic.
    ///
    /// Still deliberately NOT done (disclosed, not invented away): the full
    /// per-resource-SCANtype matrix (only <c>AltimetryLoRes</c> is wired;
    /// see <see cref="DynamicScanType"/>'s doc comment), a genuinely distinct
    /// mask-vs-coverage semantic (both publish the same packed plane today),
    /// and the height/biome grid channels (spec §2.2 table) — all P2/P3
    /// scope. See <c>.superpowers/sdd/contract-dynamic-delay-report.md</c>
    /// for the full status and follow-ups.
    /// </summary>
    [SitrepUplink("scansat")]
    public sealed class ScansatUplink : ISitrepUplink, ISnapshotSampler
    {
        public const string AvailableTopic = "scansat.available";
        public const string ScanningVesselsTopic = "scansat.scanningVessels";

        /// <summary>
        /// The dynamic-namespace prefixes this Uplink owns (Minor-bump
        /// <c>IUplinkHost.RegisterDynamicNamespace</c> — see
        /// <c>.superpowers/sdd/contract-dynamic-delay-report.md</c>), one per
        /// grid class. Concrete sub-topics are <c>&lt;prefix&gt;&lt;body&gt;.&lt;SCANtype name&gt;</c>,
        /// e.g. <c>scansat.coverage.Kerbin.AltimetryLoRes</c> — closing the
        /// exact gap U1's report flagged ("no dynamic/parametrized topic
        /// registration mechanism visible in Sitrep.Contract today").
        /// </summary>
        public const string CoveragePrefix = "scansat.coverage.";
        public const string MaskPrefix = "scansat.mask.";

        /// <summary>
        /// The representative SCANtype this milestone wires live (matches
        /// <see cref="VersionGuard"/>'s pinned <c>AltimetryLoRes=1</c>
        /// assertion). The full per-resource-type matrix (spec §2.2's whole
        /// table) is real follow-up work, same disclosed-not-invented
        /// posture as U1's original scope note below — height/biome grid
        /// channels are P2/P3 scope and are NOT wired here either.
        /// </summary>
        private const short DynamicScanType = 1; // SCANtype.AltimetryLoRes

        private IDynamicChannelSource? _coverageSource;
        private IDynamicChannelSource? _maskSource;

        // (body name, type) -> last-seen hash/packed-plane, for the
        // per-(body,type) keyframe-on-change gate (CoverageHash/CoveragePlane
        // — R7, spec §2.1/§2.3). One entry per body this uplink has ever
        // published for; a body never scanned never gets an entry (and so
        // never emits) until its coverage plane actually changes.
        private readonly Dictionary<string, ulong> _lastHashByBody = new Dictionary<string, ulong>();
        private readonly Dictionary<string, byte[]> _lastPackedByBody = new Dictionary<string, byte[]>();

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
                    Delay = DelayRole.TrueNow,
                },
                // Vessel-derived (discover-by-scanning fiction, spec §2.2) -
                // rides the delay clock alongside every other vessel-sourced
                // channel, same as VesselUplink's channels.
                new ChannelDeclaration
                {
                    Topic = ScanningVesselsTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.Delayed,
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

            // Both dynamic grid namespaces are Delayed — per
            // delay-architecture-resolution.md §3: "EVERYTHING scansat.* is
            // DELAYED except available" (a big keyframed asset can still be
            // delayed; ASSET-class and delay-role are orthogonal).
            var template = new ChannelDeclaration
            {
                Delivery = Delivery.LossyLatest,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                Delay = DelayRole.Delayed,
            };
            _coverageSource = host.RegisterDynamicNamespace(CoveragePrefix, template);
            _maskSource = host.RegisterDynamicNamespace(MaskPrefix, template);

            host.AddSampler(this);
        }

        /// <summary>
        /// Poll-hash + keyframe-on-change (CoverageHash/CoveragePlane),
        /// scoped to the CURRENT active vessel's main body only — mirrors
        /// <see cref="Sitrep.Host.VesselEpochSampler"/>'s "active subject"
        /// scoping precedent rather than sweeping every body SCANsat has
        /// ever touched every tick. A body with no SCANsat data (never
        /// scanned) is a no-op: <see cref="TryGetActiveBodyCoverage"/>
        /// returns false and nothing is published for it.
        /// </summary>
        public void Sample(KspSnapshot snapshot)
        {
            if (_coverageSource == null || _maskSource == null)
            {
                return; // Register hasn't wired the dynamic sources (unavailable uplink) — nothing to sample.
            }

            if (!TryGetActiveBodyCoverage(out var bodyName, out var coverage))
            {
                return;
            }

            var packed = CoveragePlane.Pack(coverage, DynamicScanType);
            var bodyChanged = CoverageHash.HasChanged(coverage, _lastHashByBody.TryGetValue(bodyName, out var h) ? h : (ulong?)null, out var newHash);
            if (!bodyChanged)
            {
                return;
            }
            _lastHashByBody[bodyName] = newHash;

            var lastPacked = _lastPackedByBody.TryGetValue(bodyName, out var lp) ? lp : null;
            if (!CoveragePlane.PlaneChanged(lastPacked, packed))
            {
                return; // body-level hash moved (a different SCANtype's bits), but THIS type's plane is unchanged.
            }
            _lastPackedByBody[bodyName] = packed;

            var subTopic = bodyName + ".AltimetryLoRes";
            var ut = snapshot.Ut;
            // scansat.coverage.<body>.<type> and scansat.mask.<body>.<type>
            // publish the SAME packed plane today (both describe "has this
            // cell been covered by this SCANtype" — a genuine distinct MASK
            // semantic, e.g. resource-map-specific masking, is P2/P3 scope,
            // same disclosed-not-invented posture as height/biome above).
            _coverageSource.Publisher(subTopic).Publish(packed, ut);
            _maskSource.Publisher(subTopic).Publish(packed, ut);
        }

        /// <summary>
        /// Snapshots the active vessel's main body's <c>SCANdata.Coverage</c>
        /// grid (spec §0C: "returns the LIVE array; snapshot per read"), or
        /// returns false when there's no active vessel or SCANsat has no
        /// data for its body yet (never scanned).
        /// </summary>
        private static bool TryGetActiveBodyCoverage(out string bodyName, out short[,] coverage)
        {
            bodyName = "";
            coverage = null!;

            var vessel = FlightGlobals.ActiveVessel;
            var body = vessel?.mainBody;
            if (body == null)
            {
                return false;
            }

            var data = SCANUtil.getData(body);
            if (data == null)
            {
                return false;
            }

            var live = data.Coverage;
            if (live == null)
            {
                return false;
            }

            var snapshot = new short[live.GetLength(0), live.GetLength(1)];
            Array.Copy(live, snapshot, live.Length);

            bodyName = body.name;
            coverage = snapshot;
            return true;
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
