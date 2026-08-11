using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.IntegrationTests
{
    /// <summary>
    /// KSP-free test vehicle for the source-attributed currency events, mirroring
    /// the production <c>Gonogo.KSP.CurrencyEventUplink</c> the same way
    /// <see cref="FleetDelayTestUplink"/> mirrors the real fleet uplink.
    ///
    /// <para>Registers the <c>currency.</c> dynamic namespace with the production
    /// declaration (Delayed + ReliableOrdered), arms each vessel's node delay off the
    /// snapshot roster exactly as the production uplink's <c>ArmSourceNode</c> does,
    /// and publishes a science credit when the snapshot carries one. That is enough
    /// to exercise the whole reveal path, because the delay is applied by the ledger
    /// on the per-vessel node <c>ChannelEngine.NodeForTopic</c> resolves from the
    /// topic, not by anything KSP-specific.</para>
    ///
    /// <para>A snapshot drives it through two keys: <c>vessels</c> (a list of
    /// per-vessel dicts carrying <c>id</c> + <c>delay</c>) and <c>credits</c> (a list
    /// of dicts carrying <c>vesselId</c> + <c>amount</c>).</para>
    /// </summary>
    public sealed class CurrencyEventTestUplink : ISitrepUplink
    {
        public const string Prefix = ChannelEngine.CurrencyEventPrefix;

        private IDynamicChannelSource? _events;
        private IUplinkHost? _host;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "currency-event-test",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>(),
        };

        public void Register(IUplinkHost host)
        {
            _host = host;
            _events = host.RegisterDynamicNamespace(Prefix, new ChannelDeclaration
            {
                Delivery = Delivery.ReliableOrdered,
                Delay = DelayRole.Delayed,
                Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
            });
            host.AddSampledSource(CaptureOnMain, HandleOnCourier, Prefix);
        }

        internal object? CaptureOnMain(KspSnapshot? snapshot)
        {
            if (snapshot == null)
            {
                return null;
            }

            var delays = new List<(string Id, double Delay)>();
            if (snapshot.Values.TryGetValue("vessels", out var rawRoster)
                && rawRoster is IEnumerable<object?> roster)
            {
                foreach (var entryObj in roster)
                {
                    if (entryObj is not IDictionary<string, object?> entry) { continue; }
                    if (entry.TryGetValue("id", out var idObj) && idObj is string id
                        && entry.TryGetValue("delay", out var d) && d is double delay)
                    {
                        delays.Add((id, delay));
                    }
                }
            }

            var credits = new List<(string VesselId, double Amount)>();
            if (snapshot.Values.TryGetValue("credits", out var rawCredits)
                && rawCredits is IEnumerable<object?> creditList)
            {
                foreach (var entryObj in creditList)
                {
                    if (entryObj is not IDictionary<string, object?> entry) { continue; }
                    if (entry.TryGetValue("vesselId", out var idObj) && idObj is string vid
                        && entry.TryGetValue("amount", out var a) && a is double amount)
                    {
                        credits.Add((vid, amount));
                    }
                }
            }

            var losses = new List<(string VesselId, double Delta)>();
            if (snapshot.Values.TryGetValue("losses", out var rawLosses)
                && rawLosses is IEnumerable<object?> lossList)
            {
                foreach (var entryObj in lossList)
                {
                    if (entryObj is not IDictionary<string, object?> entry) { continue; }
                    if (entry.TryGetValue("vesselId", out var idObj) && idObj is string vid
                        && entry.TryGetValue("delta", out var d) && d is double delta)
                    {
                        losses.Add((vid, delta));
                    }
                }
            }

            return new Captured { Ut = snapshot.Ut, Delays = delays, Credits = credits, Losses = losses };
        }

        internal void HandleOnCourier(object? captured)
        {
            if (captured is not Captured cap || _events == null) { return; }

            // Mirror ArmSourceNode: the event's own source vessel gets its light-time
            // into the ledger before the event is recorded. Deliberately no
            // SetVesselConnectivity, matching production (see ArmSourceNode's comment).
            foreach (var (id, delay) in cap.Delays)
            {
                _host?.SetVesselDelay(id, delay);
            }

            foreach (var (vesselId, amount) in cap.Credits)
            {
                // Mirror the production CurrencyEventBuilder.BuildScienceCredit dict
                // (this test project cannot reference Gonogo.KSP), so the
                // currency.<guid>.science serialize path is exercised end-to-end.
                _events.Publisher(vesselId + "." + CurrencyEventTopics.ScienceField).Publish(
                    new Dictionary<string, object?>
                    {
                        ["vesselId"] = vesselId,
                        ["vesselName"] = "Probe " + vesselId,
                        ["amount"] = amount,
                        ["subjectId"] = "magScan@KerbinInSpaceHigh",
                        ["subjectTitle"] = "Magnetometer Scan of Kerbin",
                        ["ut"] = cap.Ut,
                    },
                    cap.Ut);
            }

            foreach (var (vesselId, delta) in cap.Losses)
            {
                // Mirror the production CurrencyEventBuilder.BuildReputationLoss dict.
                // Note there is no absolute reputation on this shape, by design: the
                // gating total stays on career.status.economy.reputation.
                _events.Publisher(vesselId + "." + CurrencyEventTopics.ReputationField).Publish(
                    new Dictionary<string, object?>
                    {
                        ["vesselId"] = vesselId,
                        ["vesselName"] = "Probe " + vesselId,
                        ["delta"] = delta,
                        ["cause"] = "crew-loss",
                        ["crewLost"] = new List<object?> { "Jebediah Kerman" },
                        ["ut"] = cap.Ut,
                    },
                    cap.Ut);
            }
        }

        public UplinkHealth Health() => UplinkHealth.Healthy;

        private sealed class Captured
        {
            public double Ut { get; set; }
            public List<(string Id, double Delay)> Delays { get; set; } = new List<(string, double)>();
            public List<(string VesselId, double Amount)> Credits { get; set; } = new List<(string, double)>();
            public List<(string VesselId, double Delta)> Losses { get; set; } = new List<(string, double)>();
        }
    }
}
