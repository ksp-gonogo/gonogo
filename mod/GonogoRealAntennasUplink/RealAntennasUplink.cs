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
            // core uplink OWNS the "comms" capability descriptor and declares it
            // in the two-pass discovery's capability pass (see
            // CommsCoreUplink.DeclareCapabilities / IUplinkCapabilityDeclarer),
            // which runs before ANY uplink's Register — so by the time this line
            // executes the capability is guaranteed present regardless of the
            // order the assembly scan discovered RA vs. the comms core. The
            // try/catch is now pure defence-in-depth (a genuinely absent comms
            // core, which cannot happen in a correctly bundled install): a throw
            // is surfaced, not swallowed, and RA still emits its own private
            // channels rather than taking itself down.
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

            var capture = new RaCapture { Ut = snapshot?.Ut ?? 0.0, Source = Source() };

            // Authoritative link state comes from CommNet connectivity, NOT from
            // the geometry-only budget below. A geometric margin ignores occlusion
            // and out-of-cone relays, so it can read a healthy positive margin for
            // a link that is actually DOWN (bug: comms.linkMargin reported
            // closesLink:true, 49 dB, while comms.connectivity correctly reported
            // connected:false). Because these channels are LossyLatest, returning
            // null on a down link would leave the last-good positive margin stale
            // on the wire — which is exactly the observed failure. So when the link
            // is not actually connected we PUBLISH a definitive link-down state
            // (closesLink:false, zero throughput) rather than emit nothing.
            var link = PrimaryControlLink();
            if (!IsConnected() || link == null)
            {
                capture.LinkMargin = RaLinkDown.LinkMargin(capture.Source);
                capture.LinkQuality = RaLinkDown.LinkQuality(capture.Source);
                capture.DataRate = RaLinkDown.DataRate(capture.Source);
                return capture;
            }

            var fwd = _ra.ForwardDataRate(link);
            var rev = _ra.ReverseDataRate(link);
            // Typed absence over a sentinel: only publish comms.dataRate when
            // BOTH directions read. CommsDataRate's Up/DownBitsPerSec are
            // non-nullable doubles (a per-field null would be a wire-shape change
            // and a contract Major/Minor bump), so a half-read used to fill the
            // missing side with `?? 0.0` — a false "no throughput" reading
            // indistinguishable from a genuinely idle link. Emitting nothing
            // (payload-level typed absence) when either side is missing is the
            // honest choice: the channel simply reports no value that tick rather
            // than a fabricated zero.
            //
            // LOG-ONLY (needs live RA to validate): the up/down direction mapping
            // below (UpBitsPerSec = REVERSE rate, DownBitsPerSec = FORWARD rate)
            // is assumed from the RA node identity but not yet confirmed against a
            // live link — it may be swapped. Verify on a real RA install before
            // relying on the per-direction figures.
            if (fwd != null && rev != null)
            {
                capture.DataRate = new CommsDataRate
                {
                    UpBitsPerSec = rev.Value,
                    DownBitsPerSec = fwd.Value,
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

                // LOG-ONLY (needs live RA to validate): DefaultReceiverNoiseTempKelvin
                // (200 K) and DefaultRequiredEbN0Db (2.5 dB) are hardcoded display
                // estimates. RA exposes more accurate per-link figures via
                // reachable public members (RealAntenna.RequiredCI →
                // Encoder.RequiredEbN0, Physics.NoiseTemperature per the RA
                // playbook); wiring those in would sharpen the margin. Acceptable
                // as-is pending live validation — left as constants for now.
                if (txPower != null && txGain != null && rxGain != null && freq != null && symbolRate != null)
                {
                    double pr = RaLinkBudget.ReceivedPowerDbm(txPower.Value, txGain.Value, rxGain.Value, distance, freq.Value);
                    double margin = RaLinkBudget.LinkMarginDb(pr, DefaultReceiverNoiseTempKelvin, symbolRate.Value, DefaultRequiredEbN0Db);

                    // Typed absence over a non-finite sentinel: LinkMarginDb
                    // returns double.NegativeInfinity for a non-positive symbol
                    // rate (and NaN is possible from degenerate inputs). A
                    // non-finite double is not valid JSON on the wire, so instead
                    // of publishing it we leave BOTH margin and quality unset
                    // (payload-level typed absence — the derived quality is
                    // meaningless when the margin it comes from is invalid). net48
                    // has no double.IsFinite, hence the explicit NaN/Infinity test.
                    if (!double.IsNaN(margin) && !double.IsInfinity(margin))
                    {
                        var meta = new PayloadMeta { Source = capture.Source, Quality = Quality.Loaded };
                        capture.LinkMargin = new CommsLinkMargin
                        {
                            DecibelMargin = margin,
                            // We only reach this branch when CommNet reports the
                            // link connected, so the link DOES close — the
                            // authoritative state wins over the geometry-only
                            // margin sign (which can disagree, e.g. a marginal but
                            // negotiated link).
                            ClosesLink = true,
                            Meta = meta,
                        };
                        capture.LinkQuality = new CommsLinkQuality
                        {
                            Value = RaLinkBudget.NormaliseQuality(margin),
                            Meta = meta,
                        };
                    }
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

        /// <summary>Whether the active vessel currently has a working comms link (CommNet authority).</summary>
        private static bool IsConnected()
        {
            var conn = FlightGlobals.ActiveVessel?.connection;
            return conn != null && conn.IsConnected;
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
