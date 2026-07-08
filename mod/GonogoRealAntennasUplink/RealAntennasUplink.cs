using System;
using System.Collections.Generic;
using CommNet;
using Sitrep.Contract;

namespace Gonogo.RealAntennasUplink
{
    /// <summary>
    /// The GonogoRealAntennasUplink (comms-uplink-design.md §2.2, §4). A
    /// SEPARATE (non-bundled) uplink, discovered by the same
    /// <c>[SitrepUplink]</c> assembly scan as every other. It does two things:
    ///
    /// <list type="number">
    /// <item>When RealAntennas is loaded (the <see cref="RaReflection"/> probe,
    /// §4.2), it registers a higher-priority <c>"comms"</c> provider on the
    /// engine Kernel so <see cref="RaCommsBackend"/> WINS the exclusive comms
    /// election — geometry/connectivity via stock CommNet, hops enriched with RA
    /// data rate. Registering the provider IS the gate (§2.2): absent RA, no
    /// provider is registered and CommNet vanilla stays elected.</item>
    /// <item>It declares + sources the RA-ONLY channels
    /// (<c>comms.linkQuality</c>/<c>comms.dataRate</c>/<c>comms.linkMargin</c>)
    /// in its OWN manifest, bypassing the election entirely (§2.2). Data rate is
    /// read live off the RACommLink; margin/quality are RE-DERIVED by
    /// <see cref="RaLinkBudget"/> from RA's public antenna props (§4.3), never
    /// reflected off a live field.</item>
    /// </list>
    ///
    /// <para>NO compile-time reference to RA's CC-BY-SA-4.0 assembly — every RA
    /// member is reached by reflection (§4.1/§4.2). Compile surface is
    /// <c>Sitrep.Contract</c> + stock KSP only.</para>
    /// </summary>
    [SitrepUplink("realantennas")]
    public sealed class RealAntennasUplink : ISitrepUplink
    {
        public const string LinkQualityTopic = "comms.linkQuality";
        public const string DataRateTopic = "comms.dataRate";
        public const string LinkMarginTopic = "comms.linkMargin";

        // Best-effort link-budget inputs RA does not expose publicly on the live
        // graph (§4.3 — margin is computed in RA's internal Precompute job). These
        // are documented display estimates, NOT RA's negotiated values.
        private const double DefaultReceiverNoiseTempKelvin = 200.0;
        private const double DefaultRequiredEbN0Db = 2.5;

        private RaReflection? _ra;

        private IChannelPublisher? _linkQuality;
        private IChannelPublisher? _dataRate;
        private IChannelPublisher? _linkMargin;

        private static ChannelDeclaration TrueNow(string topic) => new ChannelDeclaration
        {
            Topic = topic,
            Delivery = Delivery.LossyLatest,
            Delay = DelayRole.TrueNow,
            Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
        };

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "realantennas",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                TrueNow(LinkQualityTopic),
                TrueNow(DataRateTopic),
                TrueNow(LinkMarginTopic),
            },
        };

        public void Register(IUplinkHost host)
        {
            _ra = RaReflection.Probe();
            if (_ra == null || !_ra.IsAvailable)
            {
                // RA not installed — go inert. The exclusive comms capability
                // keeps CommNet vanilla; the RA-only channels simply never emit.
                host.SetAvailability(Availability.Unavailable("RealAntennas assembly not loaded"));
                return;
            }

            // Register the RA comms provider directly on the Kernel (Kernel lives
            // in Sitrep.Contract — no engine reference needed). The bundled comms
            // core uplink owns the "comms" capability descriptor; if for some
            // reason it did not load, RegisterProvider throws — caught here so RA
            // still emits its own private channels rather than taking itself down.
            try
            {
                host.Kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = "comms",
                    Id = "realantennas",
                    Priority = 100.0,
                    Factory = _ => new RaCommsBackend(_ra),
                });
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[RealAntennasUplink] could not register comms provider: " + ex.Message);
            }

            _linkQuality = host.Publisher(LinkQualityTopic);
            _dataRate = host.Publisher(DataRateTopic);
            _linkMargin = host.Publisher(LinkMarginTopic);

            host.AddSampledSource(CaptureOnMain, HandleOnCourier, LinkQualityTopic, DataRateTopic, LinkMarginTopic);
        }

        /// <summary>MAIN-THREAD capture: reads the RA link off the live control path.</summary>
        internal object? CaptureOnMain(KspSnapshot? snapshot)
        {
            if (_ra == null)
            {
                return null;
            }
            var link = PrimaryControlLink();
            if (link == null)
            {
                return null; // no path home — RA-only channels have nothing to report
            }

            var capture = new RaCapture { Ut = snapshot?.Ut ?? 0.0, Source = Source() };

            var fwd = _ra.ForwardDataRate(link);
            var rev = _ra.ReverseDataRate(link);
            if (fwd != null || rev != null)
            {
                capture.DataRate = new CommsDataRate
                {
                    UpBitsPerSec = rev ?? 0.0,
                    DownBitsPerSec = fwd ?? 0.0,
                    Meta = new PayloadMeta { Source = capture.Source, Quality = Quality.Loaded },
                };
            }

            // Re-derive margin/quality from RA's public antenna props (§4.3).
            var tx = _ra.ForwardTxAntenna(link);
            var rx = _ra.ForwardRxAntenna(link);
            if (link.a != null && link.b != null && tx != null && rx != null)
            {
                double distance = (link.a.precisePosition - link.b.precisePosition).magnitude;
                double? txPower = _ra.TxPower(tx);
                double? txGain = _ra.Gain(tx);
                double? rxGain = _ra.Gain(rx);
                double? freq = _ra.Frequency(tx);
                double? symbolRate = _ra.SymbolRate(tx);

                if (txPower != null && txGain != null && rxGain != null && freq != null && symbolRate != null)
                {
                    double pr = RaLinkBudget.ReceivedPowerDbm(txPower.Value, txGain.Value, rxGain.Value, distance, freq.Value);
                    double margin = RaLinkBudget.LinkMarginDb(pr, DefaultReceiverNoiseTempKelvin, symbolRate.Value, DefaultRequiredEbN0Db);
                    var meta = new PayloadMeta { Source = capture.Source, Quality = Quality.Loaded };
                    capture.LinkMargin = new CommsLinkMargin
                    {
                        DecibelMargin = margin,
                        ClosesLink = RaLinkBudget.ClosesLink(margin),
                        Meta = meta,
                    };
                    capture.LinkQuality = new CommsLinkQuality
                    {
                        Value = RaLinkBudget.NormaliseQuality(margin),
                        Meta = meta,
                    };
                }
            }

            return capture;
        }

        /// <summary>COURIER-THREAD handle: publish only the payloads we could compute (typed absence otherwise).</summary>
        internal void HandleOnCourier(object? captured)
        {
            if (captured is not RaCapture capture)
            {
                return;
            }
            if (capture.DataRate != null) _dataRate?.Publish(capture.DataRate, capture.Ut);
            if (capture.LinkMargin != null) _linkMargin?.Publish(capture.LinkMargin, capture.Ut);
            if (capture.LinkQuality != null) _linkQuality?.Publish(capture.LinkQuality, capture.Ut);
        }

        /// <summary>The first hop of the active vessel's control path (the vessel's own link), or null.</summary>
        private static CommLink? PrimaryControlLink()
        {
            var path = FlightGlobals.ActiveVessel?.connection?.ControlPath;
            if (path == null)
            {
                return null;
            }
            foreach (var link in path)
            {
                return link; // first hop
            }
            return null;
        }

        private static string Source()
        {
            var vessel = FlightGlobals.ActiveVessel;
            return vessel != null ? "vessel:" + vessel.id : "game";
        }

        private sealed class RaCapture
        {
            public double Ut;
            public string Source = "";
            public CommsDataRate? DataRate;
            public CommsLinkMargin? LinkMargin;
            public CommsLinkQuality? LinkQuality;
        }
    }
}
