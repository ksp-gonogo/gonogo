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
    /// (1) THREADING — FIXED (F1): the KSP/stock reads now run on the Unity
    ///     main thread via the capture-on-main / handle-on-Courier seam
    ///     (<see cref="IUplinkHost.AddSampledSource"/>) — see
    ///     <see cref="CaptureOnMain"/>/<see cref="HandleOnCourier"/> and
    ///     <c>.superpowers/sdd/f1-main-thread-sampler-report.md</c>. (The
    ///     one remaining Courier-thread KSP read is <c>scansat.scanningVessels</c>'
    ///     <see cref="BuildScanningVessels"/>, still on the old
    ///     AddChannelSource path — a separate follow-up.)
    /// (2) No live-KSP validation (no launch/scan capture available).
    /// (3) <c>scansat.anomalies.&lt;body&gt;</c> is still only consumed
    ///     client-side, not yet published here — it needs a SCANanomaly ->
    ///     wire-payload mapping (P2, not blocking coverage/mask/height/biome).
    /// See the report for the full status and follow-ups.
    /// </summary>
    [SitrepUplink("scansat")]
    public sealed class ScansatUplink : ISitrepUplink
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
        // first keyframe. COURIER-thread-owned: read/written only by
        // HandleOnCourier (via ScanPublications.Compute).
        private readonly Dictionary<string, byte[]> _lastPackedByBodyType = new Dictionary<string, byte[]>();

        // "<body>" whose coarse coverage-grid hash last poll (any type's bits)
        // — the cheap body-level gate that avoids re-packing every type's
        // plane every tick when nothing changed at all. COURIER-thread-owned,
        // same as _lastPackedByBodyType.
        private readonly Dictionary<string, ulong> _lastHashByBody = new Dictionary<string, ulong>();

        // Bodies whose (expensive) height/biome grids have already been BUILT
        // and captured. Height/biome are stock-PQS/BiomeMap derived and
        // near-static (spec §2.2: "keyframe (near-static)"), so one keyframe
        // per body visit is the model — rebuilding an identical ~64800-point
        // grid every tick would be pure waste. MAIN-thread-owned: read/written
        // only by CaptureOnMain (which is the only place the grids are built),
        // so the once-per-body decision gates the expensive build itself, not
        // just the publish.
        private readonly HashSet<string> _heightBiomeCapturedBodies = new HashSet<string>();

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
                // Make the fail-soft VISIBLE: before this, a guard failure took
                // every scansat.* channel silently inert (client subscribes,
                // never gets stream-data) with no trace of WHY. Log the reason so
                // a future API-drift / probe bug is never invisible again.
                Debug.LogWarning("[Gonogo.ScansatUplink] SCANsat uplink UNAVAILABLE — "
                    + (guard.Reason ?? "SCANsat unavailable")
                    + " (all scansat.* channels disabled)");
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

            // Capture-on-main / handle-on-Courier (see
            // IUplinkHost.AddSampledSource): EVERY KSP/SCANsat/stock read now
            // happens in CaptureOnMain, which the engine runs on the Unity
            // main thread (where KspSnapshot is built); HandleOnCourier does
            // the hashing/packing/publishing off-thread from the plain
            // ScanCapture payload alone. This replaces the previous
            // AddSampler(this) path, whose Sample() read KSP APIs on the
            // Courier thread (the F1 fix — see
            // .superpowers/sdd/f1-main-thread-sampler-report.md).
            // Subscription-gated (F1-hardening Fix #3): the coverage-grid copy,
            // per-type GetCoverage calls, and once-per-body stock PQS/BiomeMap
            // grid builds in CaptureOnMain are ALL skipped on the main thread
            // when no client is subscribed to any topic this source produces.
            // The prefixes cover every dynamic namespace it publishes to; the
            // wire shape when subscribed is unchanged.
            host.AddSampledSource(
                CaptureOnMain,
                HandleOnCourier,
                ScanChannels.CoveragePrefix,
                ScanChannels.MaskPrefix,
                ScanChannels.HeightPrefix,
                ScanChannels.BiomePrefix);
        }

        /// <summary>
        /// MAIN-THREAD capture (see
        /// <see cref="IUplinkHost.AddSampledSource"/>): the engine runs this on
        /// the Unity main thread during the sample tick, where every KSP/
        /// SCANsat/stock read below is safe. Scoped to the CURRENT active
        /// vessel's main body (mirrors <see cref="Sitrep.Host.VesselEpochSampler"/>'s
        /// "active subject" scoping — not a per-tick sweep of every body
        /// SCANsat ever touched). Reads the coverage grid + per-type coverage
        /// percentages, and — ONCE per body visit — builds the (expensive)
        /// stock PQS height and BiomeMap grids. Everything is packed into a
        /// plain <see cref="ScanCapture"/> (no live KSP handles) so the
        /// Courier-side <see cref="HandleOnCourier"/> can do the
        /// hashing/keyframe/packing/publishing entirely off that data. Returns
        /// null when there is no active vessel/body (nothing to sample).
        ///
        /// <para><b>THREADING:</b> this is the F1 fix — the SCANsat/stock reads
        /// (<c>FlightGlobals.ActiveVessel</c>, <c>SCANUtil.getData</c>/
        /// <c>GetCoverage</c>, <c>pqs.GetSurfaceHeight</c>, <c>BiomeMap.GetAtt</c>)
        /// now run on the Unity main thread, where the rest of the mod reads
        /// KSP (<c>KspHost.Sample</c>), instead of the Courier thread they ran
        /// on before. See
        /// <c>.superpowers/sdd/f1-main-thread-sampler-report.md</c>.</para>
        /// </summary>
        internal object? CaptureOnMain(KspSnapshot? snapshot)
        {
            if (!TryGetActiveBody(out var bodyName, out var body))
            {
                return null;
            }

            var capture = new ScanCapture
            {
                Ut = snapshot?.Ut ?? 0.0,
                BodyName = bodyName,
            };

            // Height/biome first — they don't depend on SCANsat coverage at
            // all (stock PQS/BiomeMap), so they're captured once per body even
            // if that body has no SCANdata yet. The once-per-body gate lives
            // HERE (main thread) so the expensive grid build itself is skipped
            // on revisits, not merely the publish.
            if (!_heightBiomeCapturedBodies.Contains(bodyName))
            {
                _heightBiomeCapturedBodies.Add(bodyName);
                capture.IncludeHeightBiome = true;
                capture.HeightGrid = ScanGrids.BuildHeights(
                    ScanGrids.Width, ScanGrids.Height, (lon, lat) => SampleElevation(body, lon, lat));
                capture.BiomeEntries = BuildBiomeEntries(body);
                capture.BiomeIndices = ScanGrids.BuildBiomeIndices(
                    ScanGrids.Width, ScanGrids.Height, (lon, lat) => SampleBiomeIndex(body, lon, lat));
            }

            if (TryGetBodyCoverage(body, out var coverage))
            {
                capture.Coverage = coverage;
                var percents = new Dictionary<short, double>();
                foreach (var typeBit in ScanChannels.ClientScanTypes)
                {
                    percents[typeBit] = GetCoveragePercent(typeBit, body);
                }
                capture.CoveragePercents = percents;
            }

            return capture;
        }

        /// <summary>
        /// COURIER-THREAD handle (see
        /// <see cref="IUplinkHost.AddSampledSource"/>): runs off the main
        /// thread with the plain <see cref="ScanCapture"/> the capture
        /// produced, applies the coarse-hash + per-(body,type) plane-changed
        /// gates via <see cref="ScanPublications.Compute"/>, and publishes each
        /// resulting keyframe to its dynamic channel. Touches NO KSP/Unity API
        /// — all KSP reads already happened in <see cref="CaptureOnMain"/>.
        /// </summary>
        internal void HandleOnCourier(object? captured)
        {
            if (captured is not ScanCapture capture)
            {
                return;
            }
            if (_coverageSource == null || _maskSource == null || _heightSource == null || _biomeSource == null)
            {
                return; // Register hasn't wired the dynamic sources (unavailable uplink) — nothing to publish.
            }

            foreach (var publication in ScanPublications.Compute(capture, _lastHashByBody, _lastPackedByBodyType))
            {
                var source = publication.Kind switch
                {
                    ScanChannelKind.Coverage => _coverageSource,
                    ScanChannelKind.Mask => _maskSource,
                    ScanChannelKind.Height => _heightSource,
                    ScanChannelKind.Biome => _biomeSource,
                    _ => null,
                };
                source?.Publisher(publication.SubTopic).Publish(publication.Payload, publication.Ut);
            }
        }

        // ----------------------------------------------------------------
        // KSP/stock reads — invoked ONLY from CaptureOnMain (main thread).
        // Kept as thin wrappers so ScanGrids/CoveragePlane stay pure +
        // headlessly tested.
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
