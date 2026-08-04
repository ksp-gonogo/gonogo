using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// KSP-free test vehicle for the fleet-delay feature (Plan 2), mirroring the
    /// production <c>Gonogo.KSP.FleetDelayUplink</c> the same way
    /// <see cref="FreezeGateTestUplink"/> mirrors the real comms uplink. It reads
    /// the roster from <c>snapshot.Values["vessels"]</c> (a list of per-vessel
    /// dictionaries carrying <c>id</c> + an <c>orbit</c> element dict) and emits
    /// each vessel's orbit on <c>fleet.&lt;id&gt;.orbit</c> under the
    /// <c>fleet.</c> dynamic namespace. Per-vessel node routing (Task 2) and
    /// per-vessel delay (Task 4) are exercised through this uplink.
    /// </summary>
    public sealed class FleetDelayTestUplink : ISitrepUplink
    {
        public const string Prefix = "fleet.";

        private IDynamicChannelSource? _orbitSource;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "fleet-delay-test",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>(),
        };

        public void Register(IUplinkHost host)
        {
            _orbitSource = host.RegisterDynamicNamespace(Prefix, new ChannelDeclaration
            {
                Delivery = Delivery.LossyLatest,
                Delay = DelayRole.Delayed,
                Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
            });
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
            var captures = new List<(string Id, object? Orbit)>();
            foreach (var entryObj in roster)
            {
                if (entryObj is not IDictionary<string, object?> entry) { continue; }
                if (entry.TryGetValue("id", out var idObj) && idObj is string id
                    && entry.TryGetValue("orbit", out var orbit) && orbit != null)
                {
                    captures.Add((id, orbit));
                }
            }
            return new Captured { Ut = snapshot.Ut, Vessels = captures };
        }

        internal void HandleOnCourier(object? captured)
        {
            if (captured is not Captured cap || _orbitSource == null) { return; }
            foreach (var (id, orbit) in cap.Vessels)
            {
                _orbitSource.Publisher(id + ".orbit").Publish(orbit, cap.Ut);
            }
        }

        public UplinkHealth Health() => UplinkHealth.Healthy;

        private sealed class Captured
        {
            public double Ut { get; set; }
            public List<(string Id, object? Orbit)> Vessels { get; set; } = new List<(string, object?)>();
        }
    }
}
