using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using SCANsat;
using UnityEngine;

namespace Gonogo.ScansatUplink
{
    /// <summary>
    /// The GonogoScansatUplink reference implementation — the FIRST
    /// separate (non-bundled) Uplink, establishing the packaging pattern
    /// U2-U4 reuse (see <c>.superpowers/sdd/uplink-packaging-pattern.md</c>).
    /// Reads SCANsat's public API in-process (zero Harmony,
    /// scansat-migration-spec.md §4).
    ///
    /// SCOPE NOTE (the dynamic-topic gap U1 flagged is CLOSED): U1 wired the
    /// version-guard (§3) and the two STATIC-topic channels
    /// (<c>scansat.available</c>, <c>scansat.scanningVessels</c>) only,
    /// because <c>IUplinkHost</c> had no way to register a topic set
    /// parametrized by which body a vessel is orbiting.
    /// <see cref="IUplinkHost.RegisterDynamicNamespace"/> (Minor bump — see
    /// <c>.superpowers/sdd/contract-dynamic-delay-report.md</c>) closed that,
    /// and <see cref="Sample"/> now publishes, per the ACTIVE vessel's main
    /// body, the FULL set of dynamic channels the client consumes:
    /// <c>scansat.coverage.&lt;body&gt;.&lt;typeBit&gt;</c> (scalar %),
    /// <c>scansat.mask.&lt;body&gt;.&lt;typeBit&gt;</c> (packed
    /// <c>SCANCoverageBitmap</c>) for every client SCANtype
    /// (<see cref="ScanChannels.ClientScanTypes"/> — 1/2/8/16/128/256),
    /// <c>scansat.height.&lt;body&gt;</c> (<c>SCANHeightGrid</c>, stock PQS
    /// §0E), and <c>scansat.biome.&lt;body&gt;</c> (<c>SCANBiomeGrid</c>,
    /// stock BiomeMap §0E). Sub-topic type components are the NUMERIC
    /// SCANtype bit (matching the client), coverage carries the GetCoverage
    /// PERCENTAGE (not the plane), all keyframe-on-change per concrete
    /// (body,type); height/biome once per body visit.
    ///
    /// Known gaps, disclosed not invented away:
    /// (1) THREADING — the KSP/stock reads run on the Courier thread, not
    ///     the Unity main thread (see <see cref="Sample"/>'s THREADING note);
    ///     the proper fix is a main-thread sampler hook, out of scope here.
    /// (2) No live-KSP validation (no launch/scan capture available).
    /// (3) <c>scansat.anomalies.&lt;body&gt;</c> is still only consumed
    ///     client-side, not yet published here — it needs a SCANanomaly ->
    ///     wire-payload mapping (P2, not blocking coverage/mask/height/biome).
    /// See the report for the full status and follow-ups.
    /// </summary>
    [SitrepUplink("scansat")]
    public sealed class ScansatUplink : ISitrepUplink, ISnapshotSampler
    {
        public const string AvailableTopic = "scansat.available";
        public const string ScanningVesselsTopic = "scansat.scanningVessels";

        private IDynamicChannelSource? _coverageSource;
        private IDynamicChannelSource? _maskSource;
        private IDynamicChannelSource? _heightSource;
        private IDynamicChannelSource? _biomeSource;

        // "<body>|<typeBit>" -> last-emitted packed plane, the per-(body,type)
        // keyframe-on-change gate (CoveragePlane — R7, spec §2.1/§2.3). One
        // entry per (body,type) this uplink has ever published; a
        // (body,type) whose plane never changes never re-emits after its
        // first keyframe.
        private readonly Dictionary<string, byte[]> _lastPackedByBodyType = new Dictionary<string, byte[]>();

        // "<body>" whose coarse coverage-grid hash last poll (any type's bits)
        // — the cheap body-level gate that avoids re-packing every type's
        // plane every tick when nothing changed at all.
        private readonly Dictionary<string, ulong> _lastHashByBody = new Dictionary<string, ulong>();

        // Bodies whose height/biome grids have already been published.
        // Height/biome are stock-PQS/BiomeMap derived and near-static
        // (spec §2.2: "keyframe (near-static)"), so one keyframe per body
        // visit is the model — re-emitting an identical ~130 KB grid every
        // tick would be pure waste.
        private readonly HashSet<string> _heightBiomeEmittedBodies = new HashSet<string>();

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

            // Every dynamic grid namespace is Delayed — per
            // delay-architecture-resolution.md §3: "EVERYTHING scansat.* is
            // DELAYED except available" (a big keyframed asset can still be
            // delayed; ASSET-class and delay-role are orthogonal). Height and
            // biome ride the delay clock too even though their SOURCE is stock
            // PQS/BiomeMap (SCANsat-independent): they're released under the
            // discover-by-scanning fiction alongside the delayed coverage
            // that reveals them (spec §2.2).
            var template = new ChannelDeclaration
            {
                Delivery = Delivery.LossyLatest,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                Delay = DelayRole.Delayed,
            };
            _coverageSource = host.RegisterDynamicNamespace(ScanChannels.CoveragePrefix, template);
            _maskSource = host.RegisterDynamicNamespace(ScanChannels.MaskPrefix, template);
            _heightSource = host.RegisterDynamicNamespace(ScanChannels.HeightPrefix, template);
            _biomeSource = host.RegisterDynamicNamespace(ScanChannels.BiomePrefix, template);

            host.AddSampler(this);
        }

        /// <summary>
        /// Poll-hash + keyframe-on-change, scoped to the CURRENT active
        /// vessel's main body (mirrors <see cref="Sitrep.Host.VesselEpochSampler"/>'s
        /// "active subject" scoping — not a per-tick sweep of every body
        /// SCANsat ever touched). For a body whose coarse coverage-grid hash
        /// moved this poll, every client-consumed SCANtype's plane is
        /// re-packed and, per (body,type), published to
        /// <c>scansat.coverage.&lt;body&gt;.&lt;typeBit&gt;</c> (the coverage
        /// PERCENTAGE, a scalar) and <c>scansat.mask.&lt;body&gt;.&lt;typeBit&gt;</c>
        /// (the packed <c>SCANCoverageBitmap</c>) — ONLY when THAT type's
        /// plane actually changed. Height/biome are published once per body
        /// visit (near-static, stock-sourced).
        ///
        /// <para><b>THREADING (known gap — read before "fixing"):</b> this
        /// runs on the engine's Courier thread (see
        /// <see cref="Sitrep.Host.ChannelEngine"/>'s ProcessTick sampler
        /// loop), NOT the Unity main thread. The SCANsat/stock reads below
        /// (<c>SCANUtil.getData</c>, <c>GetSurfaceHeight</c>,
        /// <c>BiomeMap.GetAtt</c>, <c>SCANUtil.GetCoverage</c>) are therefore
        /// off-main-thread — the same latent cross-thread read U1 already
        /// shipped for <c>scansat.scanningVessels</c>. The clean fix is a
        /// MAIN-thread sampler hook so KSP is read where the rest of the mod
        /// reads it (<c>KspHost.Sample</c>), which is a Sitrep.Contract/
        /// GonogoAddon change out of this milestone's scope — tracked in
        /// <c>.superpowers/sdd/contract-dynamic-delay-report.md</c>. Kept
        /// consistent with U1's existing pattern rather than introducing a
        /// divergent one; all the grid math is isolated in the headlessly-
        /// tested <see cref="ScanGrids"/>/<see cref="CoveragePlane"/> helpers
        /// regardless.</para>
        /// </summary>
        public void Sample(KspSnapshot snapshot)
        {
            if (_coverageSource == null || _maskSource == null || _heightSource == null || _biomeSource == null)
            {
                return; // Register hasn't wired the dynamic sources (unavailable uplink) — nothing to sample.
            }

            if (!TryGetActiveBody(out var bodyName, out var body))
            {
                return;
            }

            var ut = snapshot.Ut;

            // Height/biome first — they don't depend on SCANsat coverage at
            // all (stock PQS/BiomeMap), so they publish once per body even if
            // that body has no SCANdata yet.
            PublishHeightBiomeOnce(bodyName, body, ut);

            if (!TryGetBodyCoverage(body, out var coverage))
            {
                return; // no SCANdata for this body yet (never scanned) — no coverage/mask.
            }

            // Cheap body-level gate: skip the per-type re-pack entirely when
            // the whole coverage grid's hash is unchanged since last poll.
            var bodyChanged = CoverageHash.HasChanged(
                coverage, _lastHashByBody.TryGetValue(bodyName, out var h) ? h : (ulong?)null, out var newHash);
            if (!bodyChanged)
            {
                return;
            }
            _lastHashByBody[bodyName] = newHash;

            foreach (var typeBit in ScanChannels.ClientScanTypes)
            {
                var packed = CoveragePlane.Pack(coverage, typeBit);
                var key = bodyName + "|" + typeBit;
                var lastPacked = _lastPackedByBodyType.TryGetValue(key, out var lp) ? lp : null;
                if (!CoveragePlane.PlaneChanged(lastPacked, packed))
                {
                    continue; // this specific type's plane didn't move — another type's bits changed the body hash.
                }
                _lastPackedByBodyType[key] = packed;

                var subTopic = ScanChannels.BodyTypeSubTopic(bodyName, typeBit);

                // coverage.<body>.<type> is the SCALAR percentage [0,100]
                // (SCANUtil.GetCoverage), NOT the packed plane — the client's
                // CoverageRow reads it as a number.
                _coverageSource.Publisher(subTopic).Publish(GetCoveragePercent(typeBit, body), ut);

                // mask.<body>.<type> is the full SCANCoverageBitmap keyframe.
                _maskSource.Publisher(subTopic)
                    .Publish(ScanGrids.BuildMaskPayload(ScanGrids.Width, ScanGrids.Height, typeBit, packed), ut);
            }
        }

        private void PublishHeightBiomeOnce(string bodyName, CelestialBody body, double ut)
        {
            if (_heightBiomeEmittedBodies.Contains(bodyName))
            {
                return;
            }
            _heightBiomeEmittedBodies.Add(bodyName);

            var heightGrid = ScanGrids.BuildHeights(
                ScanGrids.Width, ScanGrids.Height, (lon, lat) => SampleElevation(body, lon, lat));
            _heightSource!.Publisher(ScanChannels.BodySubTopic(bodyName))
                .Publish(ScanGrids.BuildHeightPayload(ScanGrids.Width, ScanGrids.Height, heightGrid), ut);

            var biomes = BuildBiomeEntries(body);
            var indices = ScanGrids.BuildBiomeIndices(
                ScanGrids.Width, ScanGrids.Height, (lon, lat) => SampleBiomeIndex(body, lon, lat));
            _biomeSource!.Publisher(ScanChannels.BodySubTopic(bodyName))
                .Publish(ScanGrids.BuildBiomePayload(ScanGrids.Width, ScanGrids.Height, biomes, indices), ut);
        }

        // ----------------------------------------------------------------
        // KSP/stock reads — see Sample's THREADING note. Kept as thin
        // wrappers so ScanGrids/CoveragePlane stay pure + headlessly tested.
        // ----------------------------------------------------------------

        private static bool TryGetActiveBody(out string bodyName, out CelestialBody body)
        {
            bodyName = "";
            body = null!;
            var b = FlightGlobals.ActiveVessel?.mainBody;
            if (b == null)
            {
                return false;
            }
            bodyName = b.name;
            body = b;
            return true;
        }

        /// <summary>
        /// Snapshots the body's <c>SCANdata.Coverage</c> grid (spec §0C:
        /// "returns the LIVE array; snapshot per read"), or false when
        /// SCANsat has no data for it yet (never scanned).
        /// </summary>
        private static bool TryGetBodyCoverage(CelestialBody body, out short[,] coverage)
        {
            coverage = null!;
            var data = SCANUtil.getData(body);
            var live = data?.Coverage;
            if (live == null)
            {
                return false;
            }
            var snapshot = new short[live.GetLength(0), live.GetLength(1)];
            Array.Copy(live, snapshot, live.Length);
            coverage = snapshot;
            return true;
        }

        private static double GetCoveragePercent(short scanTypeBit, CelestialBody body)
        {
            // SCANUtil.GetCoverage(int SCANtype, CelestialBody) -> double [0,100]
            // (SCANUtil.cs:163). Fail-soft to 0 if SCANsat throws on an odd type.
            try
            {
                return SCANUtil.GetCoverage(scanTypeBit, body);
            }
            catch
            {
                return 0.0;
            }
        }

        /// <summary>
        /// Stock PQS elevation per the exact §0E convention (verbatim from
        /// SCANUtil.getElevation, SCANUtil.cs:774-784): axis order
        /// x=cos(lat)cos(lon), y=sin(lat), z=cos(lat)sin(lon); subtract
        /// <c>pqsController.radius</c>; round to 0.1 m. SCANsat-independent.
        /// </summary>
        private static double SampleElevation(CelestialBody body, int lon, int lat)
        {
            var pqs = body.pqsController;
            if (pqs == null)
            {
                return 0.0;
            }
            double rlon = Mathf.Deg2Rad * lon;
            double rlat = Mathf.Deg2Rad * lat;
            var rad = new Vector3d(
                Math.Cos(rlat) * Math.Cos(rlon),
                Math.Sin(rlat),
                Math.Cos(rlat) * Math.Sin(rlon));
            return Math.Round(pqs.GetSurfaceHeight(rad) - pqs.radius, 1);
        }

        /// <summary>
        /// Stock BiomeMap index per the exact §0E convention (verbatim from
        /// SCANUtil.getBiomeIndex, SCANUtil.cs:837-860): note the argument
        /// order is <c>GetAtt(Deg2Rad*lat, Deg2Rad*lon)</c>, then linear-scan
        /// <c>Attributes[]</c>; -1 when no BiomeMap or no match.
        /// SCANsat-independent.
        /// </summary>
        private static int SampleBiomeIndex(CelestialBody body, int lon, int lat)
        {
            var map = body.BiomeMap;
            if (map == null)
            {
                return -1;
            }
            var att = map.GetAtt(Mathf.Deg2Rad * lat, Mathf.Deg2Rad * lon);
            for (int i = 0; i < map.Attributes.Length; i++)
            {
                if (map.Attributes[i] == att)
                {
                    return i;
                }
            }
            return -1;
        }

        private static List<object?> BuildBiomeEntries(CelestialBody body)
        {
            var entries = new List<object?>();
            var map = body.BiomeMap;
            if (map?.Attributes == null)
            {
                return entries;
            }
            foreach (var att in map.Attributes)
            {
                if (att == null)
                {
                    continue;
                }
                // colour: pack the stock mapColor RGB into 0xRRGGBB, matching
                // the client's SCANBiomeEntry.colour contract.
                var c = att.mapColor;
                int rgb = ((int)Math.Round(c.r * 255) << 16)
                          | ((int)Math.Round(c.g * 255) << 8)
                          | (int)Math.Round(c.b * 255);
                entries.Add(ScanGrids.BuildBiomeEntry(att.name, att.name, rgb));
            }
            return entries;
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
