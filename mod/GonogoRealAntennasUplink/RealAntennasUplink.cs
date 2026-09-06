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
    /// election: geometry/connectivity via stock CommNet, hops enriched with RA
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
    /// <para>NO compile-time reference to RA's CC-BY-SA-4.0 assembly, every RA
    /// member is reached by reflection (§4.1/§4.2). Compile surface is
    /// <c>Sitrep.Contract</c> + stock KSP only.</para>
    /// </summary>
    [SitrepUplink("realantennas")]
    public sealed class RealAntennasUplink : ISitrepUplink
    {
        public const string LinkQualityTopic = "comms.linkQuality";
        public const string DataRateTopic = "comms.dataRate";
        public const string LinkMarginTopic = "comms.linkMargin";

        /// <summary>
        /// The per-hop forward-rate annotation channel: a bare ARRAY of
        /// <see cref="RealAntennasHopRate"/>, one per hop that has a readable rate,
        /// keyed by the same node ids <c>comms.path</c> carries. RA's relay graph
        /// subclasses stock CommNet's, so this only embellishes each existing hop
        /// with its bitrate: it never republishes the topology. The client joins it
        /// onto the route the core CommSignal schedule already renders.
        /// </summary>
        public const string HopRatesTopic = "realantennas.hopRates";

        /// <summary>
        /// The Domain presence gate: a bare-boolean TrueNow channel emitting
        /// <c>true</c> whenever RealAntennas is loaded. The RA client augments bind
        /// this via <c>requires: "realantennas"</c>, so its detail composes into
        /// CommSignal only on an install that actually runs RA.
        /// </summary>
        public const string AvailableTopic = "realantennas.available";

        /// <summary>
        /// The per-antenna targeting channel: a bare ARRAY of
        /// <see cref="RealAntennasAntennaState"/>, one entry per antenna on the
        /// scoped craft, carrying what each antenna is, what modes its tech level
        /// has earned, and where it is currently pointed.
        ///
        /// <para>Per-ANTENNA because that is the granularity RealAntennas stores:
        /// there is no vessel-level target and no primary antenna, and the link
        /// solver considers every compatible antenna pair, so two dishes aimed
        /// two ways are two candidate links rather than a conflict to resolve.</para>
        ///
        /// <para>DELAYED, unlike this Uplink's other four channels. They describe
        /// the link as KSC computes it ground-side; this describes the craft, and
        /// the two commands that write to it are delayed too.</para>
        /// </summary>
        public const string AntennasTopic = "realantennas.antennas";

        /// <summary>Point one antenna at one thing. Args: <see cref="RealAntennasTargetArgs"/>.</summary>
        public const string TargetCommand = "realantennas.antenna.target";

        /// <summary>
        /// Point one antenna at the home BODY'S CENTRE, RealAntennas' own default
        /// aim point. See <see cref="RaTargeting.TargetHome"/> for what that does
        /// and does not mean. Args: <see cref="RealAntennasAntennaArgs"/>.
        /// </summary>
        public const string TargetHomeCommand = "realantennas.antenna.targetHome";

        // Fallback link-budget inputs, used only when the live per-link read
        // returns null. RA exposes both per antenna: the receiver noise
        // temperature via RealAntenna.AMWTemp (tech-level driven, TL0 ~27000 K, TL9
        // ~200 K) and the required Eb/N0 via RealAntenna.RequiredCI
        // (= Encoder.RequiredEbN0). CaptureOnMain wires those in below and only
        // falls back to these constants (the pre-wiring display estimates) when a
        // read fails, the existing fail-soft posture.
        private const double DefaultReceiverNoiseTempKelvin = 200.0;
        private const double DefaultRequiredEbN0Db = 2.5;

        private RaReflection? _ra;

        /// <summary>
        /// Core's capability registry, held from <see cref="Register"/> so
        /// <see cref="CaptureOnMain"/> can ask which craft these channels are
        /// about. See <see cref="ScopedVessel"/> for why it is not KSP's answer.
        /// </summary>
        private Kernel? _kernel;

        private IChannelPublisher? _linkQuality;
        private IChannelPublisher? _dataRate;
        private IChannelPublisher? _linkMargin;
        private IChannelPublisher? _hopRates;
        private IChannelPublisher? _antennas;

        /// <summary>Targeting's reflection + KSP half, built at Register once RA is confirmed present.</summary>
        private RaTargeting? _targeting;

        private static ChannelDeclaration TrueNow(string topic) => new ChannelDeclaration
        {
            Topic = topic,
            Delivery = Delivery.LossyLatest,
            Delay = DelayRole.TrueNow,
            Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
        };

        /// <summary>
        /// Same delivery as <see cref="TrueNow"/>, opposite delay disposition: a
        /// flight-side fact ground learns at light-time. See
        /// <see cref="AntennasTopic"/> for why this Uplink has one of each.
        /// </summary>
        private static ChannelDeclaration Delayed(string topic) => new ChannelDeclaration
        {
            Topic = topic,
            Delivery = Delivery.LossyLatest,
            Delay = DelayRole.Delayed,
            Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
        };

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "realantennas",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                TrueNow(AvailableTopic),
                TrueNow(LinkQualityTopic),
                TrueNow(DataRateTopic),
                TrueNow(LinkMarginTopic),
                TrueNow(HopRatesTopic),
                Delayed(AntennasTopic),
            },
            Commands = new List<CommandDeclaration>
            {
                // Both Delayed: slewing a dish is a signal to the craft, the same
                // classification every other vessel-actuation command carries.
                // That is also why the channel beside them is delayed, and why an
                // antenna is addressed by a stable id rather than by its position
                // in a list that can change while the command is in flight.
                new CommandDeclaration { Command = TargetCommand, Delayed = true },
                new CommandDeclaration { Command = TargetHomeCommand, Delayed = true },
            },
        };

        /// <summary>Mandatory health self-report (see <see cref="ISitrepUplink.Health"/>):
        /// Unavailable when the RealAntennas assembly is absent (the uplink went inert at
        /// Register: <see cref="_ra"/> stays null/unavailable), else Healthy.</summary>
        public UplinkHealth Health() =>
            _ra != null && _ra.IsAvailable
                ? UplinkHealth.Healthy
                : new UplinkHealth(UplinkHealthState.Unavailable, "RealAntennas assembly not loaded");

        public void Register(IUplinkHost host)
        {
            _kernel = host.Kernel;
            _ra = RaReflection.Probe();
            if (_ra == null || !_ra.IsAvailable)
            {
                // RA not installed: go inert. The exclusive comms capability
                // keeps CommNet vanilla; the RA-only channels simply never emit.
                host.SetAvailability(Availability.Unavailable("RealAntennas assembly not loaded"));
                return;
            }

            // Register the RA comms provider directly on the Kernel (Kernel lives
            // in Sitrep.Contract: no engine reference needed). The bundled comms
            // core uplink OWNS the "comms" capability descriptor and declares it
            // in the two-pass discovery's capability pass (see
            // CommsCoreUplink.DeclareCapabilities / IUplinkCapabilityDeclarer),
            // which runs before ANY uplink's Register, so by the time this line
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
                    Factory = _ => new RaCommsBackend(_ra, host.Kernel),
                });
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[RealAntennasUplink] could not register comms provider: " + ex.Message);
            }

            // Bare-boolean presence gate: true while RA is loaded. Same shape as
            // any Uplink's <domain>.available, and what the RA client augments'
            // `requires` resolves against.
            host.AddChannelSource(AvailableTopic, _ => _ra != null && _ra.IsAvailable);

            _linkQuality = host.Publisher(LinkQualityTopic);
            _dataRate = host.Publisher(DataRateTopic);
            _linkMargin = host.Publisher(LinkMarginTopic);
            _hopRates = host.Publisher(HopRatesTopic);
            _antennas = host.Publisher(AntennasTopic);

            host.AddSampledSource(CaptureOnMain, HandleOnCourier, LinkQualityTopic, DataRateTopic, LinkMarginTopic, HopRatesTopic);

            // Its own sampled source rather than a sixth topic on the one above:
            // the antenna walk reads every antenna on the craft and the mode
            // table beside it, and there is no reason to pay for that on a tick
            // where only a data rate was subscribed.
            _targeting = new RaTargeting(_ra);
            host.AddSampledSource(CaptureAntennasOnMain, HandleAntennasOnCourier, AntennasTopic);

            host.AddCommandHandler<RealAntennasTargetArgs, CommandResult>(
                TargetCommand, args => _targeting.Target(ScopedVessel(), args));
            host.AddCommandHandler<RealAntennasAntennaArgs, CommandResult>(
                TargetHomeCommand, args => _targeting.TargetHome(ScopedVessel(), args));
        }

        /// <summary>
        /// MAIN-THREAD capture for <c>realantennas.antennas</c>. The vessel is
        /// resolved once and the whole list is read from it, so no two entries can
        /// describe different craft.
        /// </summary>
        internal object? CaptureAntennasOnMain(KspSnapshot? snapshot)
        {
            if (_targeting == null)
            {
                return null;
            }
            return new RaAntennaCapture
            {
                Ut = snapshot?.Ut ?? 0.0,
                Antennas = _targeting.ReadAntennas(ScopedVessel()),
            };
        }

        /// <summary>
        /// COURIER-THREAD handle for <c>realantennas.antennas</c>: the flattened
        /// array. An empty array is PUBLISHED rather than withheld, because the
        /// channel is LossyLatest: withholding it on a craft with no antennas
        /// would leave the previous craft's list standing on the wire.
        /// </summary>
        internal void HandleAntennasOnCourier(object? captured)
        {
            if (captured is not RaAntennaCapture capture)
            {
                return;
            }
            _antennas?.Publish(RaWire.Antennas(capture.Antennas), capture.Ut);
        }

        /// <summary>
        /// The craft these channels are about, from core's <c>activeVessel</c>
        /// capability rather than from KSP.
        ///
        /// <para>While a kerbal is outside, KSP's answer is the kerbal: one part,
        /// no antenna, and a <c>connection</c> whose control path is the EVA
        /// suit's. Every RA channel would then describe the suit while
        /// <c>comms.path</c> beside it, which core scopes, describes the ship.
        /// Null when core does not publish the capability, so the channels report
        /// a link they could not see rather than the wrong craft's.</para>
        /// </summary>
        private Vessel? ScopedVessel() => _kernel.ReportedVessel() as Vessel;

        /// <summary>
        /// MAIN-THREAD capture: reads the RA link off the live control path.
        ///
        /// <para>The vessel is resolved ONCE here and threaded through every
        /// helper below. Five separate resolutions on one tick could disagree
        /// with each other across a vessel switch, and would give the hop rates a
        /// different subject from the margin computed beside them.</para>
        /// </summary>
        internal object? CaptureOnMain(KspSnapshot? snapshot)
        {
            if (_ra == null)
            {
                return null;
            }

            var vessel = ScopedVessel();
            var capture = new RaCapture { Ut = snapshot?.Ut ?? 0.0, Source = Source(vessel) };

            // Per-hop forward rates for realantennas.hopRates: built from the FULL
            // ControlPath (not just the primary link), keyed by the same node ids
            // comms.path carries so the client can join a rate onto every hop the
            // core schedule renders. Independent of the link-budget block below, so
            // it is computed unconditionally: an empty list on a down link clears
            // any stale rates rather than leaving the last-good ones on the wire.
            capture.HopRates = BuildHopRates(vessel);

            // Authoritative link state comes from CommNet connectivity, NOT from
            // the geometry-only budget below. A geometric margin ignores occlusion
            // and out-of-cone relays, so it can read a healthy positive margin for
            // a link that is actually DOWN (bug: comms.linkMargin reported
            // closesLink:true, 49 dB, while comms.connectivity correctly reported
            // connected:false). Because these channels are LossyLatest, returning
            // null on a down link would leave the last-good positive margin stale
            // on the wire, which is exactly the observed failure. So when the link
            // is not actually connected we PUBLISH a definitive link-down state
            // (closesLink:false, zero throughput) rather than emit nothing.
            var link = PrimaryControlLink(vessel);
            if (!IsConnected(vessel) || link == null)
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
            // and a contract Major/Minor bump), so a half-read has no way to say
            // "this side is missing" in the payload: filling it with `?? 0.0`
            // gives a false "no throughput" reading indistinguishable from a
            // genuinely idle link. Emitting nothing
            // (payload-level typed absence) when either side is missing is the
            // honest choice: the channel simply reports no value that tick rather
            // than a fabricated zero.
            //
            // Orientation-aware up/down. RA's FwdDataRate is the rate in the link's
            // stored a->b direction, and RA assigns a/b by NODE INDEX, not by
            // vessel-vs-home role (Precompute's MakeLink is called with a=Nodes[x],
            // b=Nodes[y], x<=y). So a fixed "Down = Fwd" is a coin-flip per link,
            // so it is swapped for roughly half of them. RaLinkDirection resolves
            // it the way RA's own MaxDataRateToHome does: Fwd is the downlink
            // (vessel->home) only when link.a is the active vessel's own comm
            // node. Falls back to the Down=Fwd mapping when the vessel node
            // cannot be identified, which is the coin-flip again but only for
            // the cases nothing can resolve.
            if (fwd != null && rev != null)
            {
                var (up, down) = RaLinkDirection.Resolve(ForwardIsDownlink(vessel, link), fwd.Value, rev.Value);
                capture.DataRate = new CommsDataRate
                {
                    UpBitsPerSec = up,
                    DownBitsPerSec = down,
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

                // RA's own per-link numbers, replacing the hardcoded estimates:
                // the receiver noise temperature off the RX antenna's AMWTemp, and
                // the required Eb/N0 off its RequiredCI
                // (= Encoder.RequiredEbN0). Both fail soft to the constants when a
                // read returns null, so a moved RA surface degrades the margin's
                // FIDELITY rather than breaking it. The re-derivation is still
                // best-effort (it does not reproduce RA's negotiated-modulation
                // tie-break), and the absolute margin wants live-RA confirmation
                // before the fallbacks are removed.
                if (txPower != null && txGain != null && rxGain != null && freq != null && symbolRate != null)
                {
                    double noiseTempKelvin = _ra.NoiseTemperatureKelvin(rx) ?? DefaultReceiverNoiseTempKelvin;
                    double requiredEbN0Db = _ra.RequiredEbN0Db(rx) ?? DefaultRequiredEbN0Db;
                    double pr = RaLinkBudget.ReceivedPowerDbm(txPower.Value, txGain.Value, rxGain.Value, distance, freq.Value);
                    double margin = RaLinkBudget.LinkMarginDb(pr, noiseTempKelvin, symbolRate.Value, requiredEbN0Db);

                    // Typed absence over a non-finite sentinel: LinkMarginDb
                    // returns double.NegativeInfinity for a non-positive symbol
                    // rate (and NaN is possible from degenerate inputs). A
                    // non-finite double is not valid JSON on the wire, so instead
                    // of publishing it we leave BOTH margin and quality unset
                    // (payload-level typed absence: the derived quality is
                    // meaningless when the margin it comes from is invalid). net48
                    // has no double.IsFinite, hence the explicit NaN/Infinity test.
                    if (!double.IsNaN(margin) && !double.IsInfinity(margin))
                    {
                        var meta = new PayloadMeta { Source = capture.Source, Quality = Quality.Loaded };
                        capture.LinkMargin = new CommsLinkMargin
                        {
                            DecibelMargin = margin,
                            // We only reach this branch when CommNet reports the
                            // link connected, so the link DOES close, the
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

        /// <summary>
        /// COURIER-THREAD handle: publish only the payloads we could compute (typed
        /// absence otherwise), each flattened to its wire dictionary on the way out.
        ///
        /// <para>The flatten is what lets these three types live in this Uplink's own
        /// contract slice rather than in core. Core's serializer carries no case per
        /// type, so <see cref="RaWire"/> writes the wire dictionary itself;
        /// publishing the POCO raw from here reaches the serializer's default branch
        /// and drops the frame.</para>
        /// </summary>
        internal void HandleOnCourier(object? captured)
        {
            if (captured is not RaCapture capture)
            {
                return;
            }
            if (capture.DataRate != null) _dataRate?.Publish(RaWire.DataRate(capture.DataRate), capture.Ut);
            if (capture.LinkMargin != null) _linkMargin?.Publish(RaWire.LinkMargin(capture.LinkMargin), capture.Ut);
            if (capture.LinkQuality != null) _linkQuality?.Publish(RaWire.LinkQuality(capture.LinkQuality), capture.Ut);
            if (capture.HopRates != null) _hopRates?.Publish(RaWire.HopRates(capture.HopRates), capture.Ut);
        }

        /// <summary>
        /// MAIN-THREAD: the reported vessel's per-hop forward rates, one entry per hop
        /// whose <c>ForwardDataRate</c> reads (typed absence otherwise, never a 0
        /// entry), keyed by <see cref="RaCommsBackend.NodeId"/> so the ids match
        /// <c>comms.path</c> hop for hop. Empty when there is no control path.
        /// </summary>
        private List<RealAntennasHopRate> BuildHopRates(Vessel? vessel)
        {
            var rates = new List<RealAntennasHopRate>();
            var path = vessel?.connection?.ControlPath;
            if (_ra == null || path == null)
            {
                return rates;
            }
            foreach (var link in path)
            {
                if (link?.a == null || link.b == null)
                {
                    continue;
                }
                var rate = _ra.ForwardDataRate(link);
                if (rate == null)
                {
                    continue;
                }
                rates.Add(new RealAntennasHopRate
                {
                    FromNodeId = RaCommsBackend.NodeId(link.a),
                    ToNodeId = RaCommsBackend.NodeId(link.b),
                    BitsPerSec = rate.Value,
                });
            }
            return rates;
        }

        /// <summary>Whether the reported vessel currently has a working comms link (CommNet authority).</summary>
        private static bool IsConnected(Vessel? vessel)
        {
            var conn = vessel?.connection;
            return conn != null && conn.IsConnected;
        }

        /// <summary>The first hop of the reported vessel's control path (the vessel's own link), or null.</summary>
        private static CommLink? PrimaryControlLink(Vessel? vessel)
        {
            var path = vessel?.connection?.ControlPath;
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

        /// <summary>
        /// Whether a link's FORWARD direction (its stored <c>a -&gt; b</c>) is the
        /// operator's DOWNLINK (vessel -&gt; home). True when <c>link.a</c> is the
        /// reported vessel's own comm node, so <c>a -&gt; b</c> runs away from the
        /// vessel toward home. Falls back to true, the plain Down=Fwd mapping,
        /// when the vessel node cannot be identified: a coin-flip for that link
        /// rather than a confident swap.
        /// </summary>
        private static bool ForwardIsDownlink(Vessel? vessel, CommLink link)
        {
            var vesselNode = vessel?.connection?.Comm;
            return vesselNode == null || ReferenceEquals(link.a, vesselNode);
        }

        private static string Source(Vessel? vessel) =>
            vessel != null ? "vessel:" + vessel.id : "game";

        private sealed class RaCapture
        {
            public double Ut;
            public string Source = "";
            public CommsDataRate? DataRate;
            public CommsLinkMargin? LinkMargin;
            public CommsLinkQuality? LinkQuality;
            public List<RealAntennasHopRate>? HopRates;
        }

        private sealed class RaAntennaCapture
        {
            public double Ut;
            public List<RealAntennasAntennaState> Antennas = new List<RealAntennasAntennaState>();
        }
    }
}
