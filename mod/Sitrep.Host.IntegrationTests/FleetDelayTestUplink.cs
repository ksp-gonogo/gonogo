using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// KSP-free test vehicle for the fleet-delay feature (Plan 2), mirroring the
    /// production <c>Gonogo.KSP.FleetChannels</c> the same way
    /// <see cref="FreezeGateTestUplink"/> mirrors the real comms uplink. It reads
    /// the roster from <c>snapshot.Values["vessels"]</c> (a list of per-vessel
    /// dictionaries carrying <c>id</c> + an <c>orbit</c> element dict) and emits
    /// each vessel's orbit on <c>fleet.&lt;id&gt;.orbit</c> under the
    /// <c>fleet.</c> dynamic namespace. Per-vessel node routing (Task 2),
    /// per-vessel delay (Task 4) and the freeze-exempt per-vessel contact
    /// channel are exercised through this uplink.
    /// </summary>
    public sealed class FleetDelayTestUplink : ISitrepUplink
    {
        public const string Prefix = ChannelEngine.FleetNodePrefix;

        private IDynamicChannelSource? _orbitSource;
        private IDynamicChannelSource? _silenceSource;
        private IUplinkHost? _host;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "fleet-delay-test",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>(),
        };

        public void Register(IUplinkHost host)
        {
            _host = host;
            _orbitSource = host.RegisterDynamicNamespace(Prefix, new ChannelDeclaration
            {
                Delivery = Delivery.LossyLatest,
                Delay = DelayRole.Delayed,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
            });
            // Mirrors the production split (Gonogo.KSP.FleetChannels owns
            // fleet.<id>.contact for core connected/lastContactUt; a
            // comms-owned publisher owns silence.<id>.state for the
            // SilenceTracker's reckoning): a DISJOINT prefix, same as
            // ChannelEngine.CurrencyEventPrefix, that NodeForTopic still maps
            // back onto this vessel's own fleet.<id> node.
            _silenceSource = host.RegisterDynamicNamespace(ChannelEngine.SilenceEventPrefix, new ChannelDeclaration
            {
                Delivery = Delivery.LossyLatest,
                Delay = DelayRole.Delayed,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
            });
            // Per-subject freeze (Plan 2b): each roster entry carries its own
            // "connected" flag (default true), set via SetVesselConnectivity in
            // the gated capture -- so each fleet vessel freezes on ITS OWN link.
            // The active vessel ("system") is not driven here (stays connected).
            // Subscription-gated: skip the whole fleet capture when no fleet.* topic is subscribed.
            host.AddSampledSource(CaptureOnMain, HandleOnCourier, Prefix);
        }

        internal object? CaptureOnMain(KspSnapshot? snapshot)
        {
            if (snapshot == null || !snapshot.Values.TryGetValue("vessels", out var raw)
                || raw is not IEnumerable<object?> roster)
            {
                return null;
            }
            var captures = new List<(string Id, object? Orbit, double? Delay, bool Connected)>();
            foreach (var entryObj in roster)
            {
                if (entryObj is not IDictionary<string, object?> entry) { continue; }
                if (entry.TryGetValue("id", out var idObj) && idObj is string id
                    && entry.TryGetValue("orbit", out var orbit) && orbit != null)
                {
                    double? delay = entry.TryGetValue("delay", out var d) && d is double dd ? dd : (double?)null;
                    var connected = !(entry.TryGetValue("connected", out var cObj) && cObj is bool cb) || cb;
                    captures.Add((id, orbit, delay, connected));
                }
            }
            return new Captured { Ut = snapshot.Ut, Vessels = captures };
        }

        internal void HandleOnCourier(object? captured)
        {
            if (captured is not Captured cap || _orbitSource == null) { return; }
            foreach (var (id, orbit, delay, connected) in cap.Vessels)
            {
                if (delay.HasValue)
                {
                    _host?.SetVesselDelay(id, delay.Value);
                }
                _host?.SetVesselConnectivity(id, connected);
                _orbitSource.Publisher(id + ".orbit").Publish(orbit, cap.Ut);
                // The SilenceTracker's per-vessel contact report (mirroring the
                // production FleetChannels publisher): the ONE field under a
                // fleet subject that the engine treats as freeze-exempt, because
                // it describes the blackout rather than being telemetry through
                // it. Published on EVERY tick, including while the vessel is
                // dark, which is precisely when it matters.
                _orbitSource.Publisher(id + ChannelEngine.ContactMetaSuffix).Publish(
                    new Dictionary<string, object?>
                    {
                        ["connected"] = connected,
                        ["lastContactUt"] = connected ? cap.Ut : (double?)null,
                    },
                    cap.Ut);
                // The SilenceTracker's reckoning, comms-owned in production:
                // published under the disjoint silence.<id> namespace so it can
                // carry its own availability, but freeze-exempt for the same
                // reason as fleet.<id>.contact above -- everything it says is
                // said while the vessel is dark.
                _silenceSource?.Publisher(id + ".state").Publish(
                    new Dictionary<string, object?>
                    {
                        ["state"] = connected ? "Nominal" : "Silent",
                    },
                    cap.Ut);
                // Plan 2c: mirror the production FleetVesselLinkBuilder.Build dict
                // (this test project can't reference Gonogo.KSP), so the
                // fleet.<id>.delay serialize path is exercised end-to-end.
                _orbitSource.Publisher(id + ".delay").Publish(
                    new Dictionary<string, object?>
                    {
                        ["oneWaySeconds"] = delay,
                        ["connected"] = connected,
                    },
                    cap.Ut);
            }
        }

        public UplinkHealth Health() => UplinkHealth.Healthy;

        private sealed class Captured
        {
            public double Ut { get; set; }
            public List<(string Id, object? Orbit, double? Delay, bool Connected)> Vessels { get; set; }
                = new List<(string, object?, double?, bool)>();
        }
    }
}
