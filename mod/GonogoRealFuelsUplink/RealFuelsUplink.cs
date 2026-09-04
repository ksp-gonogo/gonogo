using System.Collections.Generic;
using Sitrep.Contract;

namespace GonogoRealFuelsUplink
{
    /// <summary>
    /// GonogoRealFuelsUplink: the two RealFuels facts that decide whether a burn
    /// happens under Realism Overhaul, and which nothing else on this wire
    /// answers. Can this engine be lit again (the ignition budget, with its two
    /// overloaded readings unpicked) and is the propellant settled against the
    /// tank outlet (ullage stability and the ignition probability derived from
    /// it). Cryogenic boiloff rides alongside, because it is what bounds the
    /// coast between the two.
    ///
    /// <para>It models no failure and no reliability: TestFlight owns those and
    /// has its own Uplink. RealFuels has no failure model of its own, it only
    /// DISPLAYS TestFlight's numbers in its editor UI, so the two do not
    /// overlap.</para>
    ///
    /// <para>Reaches every RealFuels member by runtime reflection
    /// (<see cref="RealFuelsReflection"/>), never a compile-time reference: same
    /// arm's-length pattern as every other third-party-mod uplink here, and see
    /// the csproj header for why it is mandatory for this mod's licence.</para>
    /// </summary>
    [SitrepUplink("realfuels")]
    public sealed class RealFuelsUplink : ISitrepUplink
    {
        public const string AvailableTopic = "realfuels.available";
        public const string EnginesTopic = "realfuels.engines";
        public const string BoiloffTopic = "realfuels.boiloff";

        /// <summary>
        /// Engine rows published per second. Rows rather than payloads, because a
        /// per-vessel payload count is one a tick however wrong the contents are:
        /// what actually grows is the engine list, and a cluster-first-stage RO
        /// launcher is a few tens of rows a tick. A runaway here means the
        /// subscription gate stopped gating, not that the vessel got big.
        /// </summary>
        private static readonly PerfBudget EngineRowBudget = new PerfBudget(
            "RealFuelsUplink engine rows published", threshold: 2000, windowSec: 1.0, unit: "rows");

        private readonly RealFuelsReflection _rf = new RealFuelsReflection();

        /// <summary>
        /// Core's capability registry, held from <see cref="Register"/>. See
        /// <see cref="ScopedVessel"/>.
        /// </summary>
        private Kernel? _kernel;

        private IChannelPublisher? _engines;
        private IChannelPublisher? _boiloff;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "realfuels",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = AvailableTopic,
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.TrueNow,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
                new ChannelDeclaration
                {
                    Topic = EnginesTopic,
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.Delayed,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
                new ChannelDeclaration
                {
                    Topic = BoiloffTopic,
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.Delayed,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
            },
        };

        public void Register(IUplinkHost host)
        {
            _kernel = host.Kernel;

            // The presence primitive carries the real availability whether or not
            // RealFuels is loaded, so a client can gate on it definitively rather
            // than infer absence from a silent channel.
            host.AddChannelSource(AvailableTopic, _ => _rf.IsAvailable);

            if (!_rf.IsAvailable)
            {
                host.SetAvailability(Availability.Unavailable("RealFuels assembly not loaded"));
                return;
            }

            _engines = host.Publisher(EnginesTopic);
            _boiloff = host.Publisher(BoiloffTopic);

            // Two sources rather than one because the two answer unrelated
            // questions off unrelated objects: the engines walk reaches every
            // ModuleEnginesRF and its ullage simulator, the boiloff walk reaches
            // every fuel tank. A dashboard watching only ignitions never pays for
            // the tank walk. Both captures produce nothing but their own topic's
            // value, so the subscription gate starves nothing downstream.
            host.AddSampledSource(CaptureEnginesOnMain, HandleEnginesOnCourier, EnginesTopic);
            host.AddSampledSource(CaptureBoiloffOnMain, HandleBoiloffOnCourier, BoiloffTopic);
        }

        /// <summary>
        /// The craft these two channels are about, from core's
        /// <c>activeVessel</c> capability rather than from KSP.
        ///
        /// <para>A kerbal has no engines and no tanks, so KSP's answer during an
        /// EVA empties both channels. Ignition budget and ullage state are what
        /// the operator is holding a coast open to read, and boiloff is what
        /// bounds that coast, so a hold that is being watched over an EVA is
        /// exactly when they must not go blank. Queried per call, as
        /// <see cref="IActiveVessel"/> requires.</para>
        /// </summary>
        private Vessel? ScopedVessel() => _kernel.ReportedVessel() as Vessel;

        /// <summary>MAIN-THREAD capture: reads every engine's ignition and ullage
        /// state off the live modules. Null when there is no reported vessel.</summary>
        internal object? CaptureEnginesOnMain(KspSnapshot? snapshot)
        {
            var vessel = ScopedVessel();
            if (vessel == null)
            {
                return null;
            }
            return new EnginesCaptureData
            {
                Ut = snapshot?.Ut ?? 0.0,
                Raw = _rf.ReadEngines(vessel),
            };
        }

        /// <summary>COURIER-THREAD handle: build + publish the engines payload.</summary>
        internal void HandleEnginesOnCourier(object? captured)
        {
            if (captured is not EnginesCaptureData cap)
            {
                return;
            }
            EngineRowBudget.Record(cap.Raw?.Engines.Count ?? 0, cap.Ut);
            _engines?.Publish(RealFuelsCapture.BuildEngines(cap.Raw), cap.Ut);
        }

        /// <summary>MAIN-THREAD capture: reads the vessel's accumulated boiloff
        /// mass and the physics interval it accumulated over.</summary>
        internal object? CaptureBoiloffOnMain(KspSnapshot? snapshot)
        {
            var vessel = ScopedVessel();
            if (vessel == null)
            {
                return null;
            }
            return new BoiloffCaptureData
            {
                Ut = snapshot?.Ut ?? 0.0,
                Raw = _rf.ReadBoiloff(vessel),
            };
        }

        /// <summary>COURIER-THREAD handle: build + publish the boiloff payload.</summary>
        internal void HandleBoiloffOnCourier(object? captured)
        {
            if (captured is not BoiloffCaptureData cap)
            {
                return;
            }
            _boiloff?.Publish(RealFuelsCapture.BuildBoiloff(cap.Raw), cap.Ut);
        }

        public UplinkHealth Health() =>
            _rf.IsAvailable
                ? UplinkHealth.Healthy
                : new UplinkHealth(UplinkHealthState.Unavailable, "RealFuels assembly not loaded");

        private sealed class EnginesCaptureData
        {
            public double Ut;
            public RealFuelsVesselRaw? Raw;
        }

        private sealed class BoiloffCaptureData
        {
            public double Ut;
            public RealFuelsBoiloffRaw? Raw;
        }
    }
}
