using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Comms;

namespace Gonogo.KSP
{
    /// <summary>
    /// The bundled CORE comms registration (comms-uplink-design.md §2.2, §6):
    /// it OWNS the exclusive <c>"comms"</c> capability (registering
    /// <see cref="CommNetBackend"/> as the always-present vanilla factory),
    /// declares the four shared always-present channels + <c>comms.network</c>
    /// + the core <c>comms.delay</c> channel ONCE, and sources them from
    /// whichever backend the election picked — resolved at capture time via
    /// <c>host.Kernel.Query&lt;ICommsBackend&gt;("comms")</c>. Neither CommNet
    /// nor RealAntennas declares these channels itself; that is the
    /// shared-namespace-single-declaration rule (§5).
    ///
    /// <para>The elected backend reads live KSP, so every read happens in the
    /// capture-on-main sampler (<see cref="CaptureOnMain"/>) — the same F1 seam
    /// GonogoScansatUplink uses. The Courier-side handle
    /// (<see cref="HandleOnCourier"/>) only publishes the plain captured
    /// payloads. <c>comms.delay</c> is computed by the CORE
    /// <see cref="SignalDelay"/> math from the captured hop geometry — gonogo's
    /// own light-time computation, not a backend accessor (§3.1).</para>
    /// </summary>
    [SitrepUplink("comms")]
    public sealed class CommsCoreUplink : ISitrepUplink, IUplinkCapabilityDeclarer
    {
        public const string ConnectivityTopic = "comms.connectivity";
        public const string SignalStrengthTopic = "comms.signalStrength";
        public const string ControlStateTopic = "comms.controlState";
        public const string PathTopic = "comms.path";
        public const string NetworkTopic = "comms.network";
        public const string DelayTopic = "comms.delay";

        // The config flag lives in core (§3). Default OFF for in-place upgraders;
        // the intended forward default is ON at real light-speed (§3.1) — that
        // literal is a config/onboarding decision, so core ships it off and the
        // config layer flips it. Held here so a future config read can set it
        // before Register wires the delay source.
        private static SignalDelayConfig _signalDelayConfig = SignalDelayConfig.Off();

        /// <summary>Set the SignalDelay config (called by the config layer before registration).</summary>
        public static void ConfigureSignalDelay(SignalDelayConfig config) =>
            _signalDelayConfig = config ?? SignalDelayConfig.Off();

        private IChannelPublisher? _connectivity;
        private IChannelPublisher? _signalStrength;
        private IChannelPublisher? _controlState;
        private IChannelPublisher? _path;
        private IChannelPublisher? _network;
        private IChannelPublisher? _delay;

        private Kernel? _kernel;

        private static ChannelDeclaration TrueNow(string topic) => new ChannelDeclaration
        {
            Topic = topic,
            Delivery = Delivery.LossyLatest,
            // Every comms.* channel is TRUE-NOW: ground-side facts about the
            // link as KSC sees it, and comms.delay is the value that DRIVES
            // the delay of everything else so it is never itself delayed (§1).
            Delay = DelayRole.TrueNow,
            Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
        };

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "comms",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                TrueNow(ConnectivityTopic),
                TrueNow(SignalStrengthTopic),
                TrueNow(ControlStateTopic),
                TrueNow(PathTopic),
                TrueNow(NetworkTopic),
                TrueNow(DelayTopic),
            },
        };

        /// <summary>
        /// Two-pass fix (see <see cref="IUplinkCapabilityDeclarer"/>): the
        /// exclusive <c>"comms"</c> capability is declared HERE, in the pre-
        /// Register discovery pass, NOT in <see cref="Register"/>. That
        /// guarantees the capability exists before ANY uplink's
        /// <see cref="Register"/> runs — so RealAntennas' provider registration
        /// (a SEPARATE uplink, in its own <see cref="Register"/>) can never race
        /// ahead of this declaration and throw, regardless of assembly-scan
        /// discovery order. CommNet is the capability's always-present vanilla
        /// fallback; the engine calls <c>Kernel.Resolve()</c> once every uplink
        /// has registered its providers.
        /// </summary>
        public void DeclareCapabilities(Kernel kernel)
        {
            CommsElection.RegisterCapability(kernel, _ => new CommNetBackend());
        }

        public void Register(IUplinkHost host)
        {
            _kernel = host.Kernel;

            _connectivity = host.Publisher(ConnectivityTopic);
            _signalStrength = host.Publisher(SignalStrengthTopic);
            _controlState = host.Publisher(ControlStateTopic);
            _path = host.Publisher(PathTopic);
            _network = host.Publisher(NetworkTopic);
            _delay = host.Publisher(DelayTopic);

            host.AddSampledSource(
                CaptureOnMain,
                HandleOnCourier,
                ConnectivityTopic,
                SignalStrengthTopic,
                ControlStateTopic,
                PathTopic,
                NetworkTopic,
                DelayTopic);
        }

        /// <summary>
        /// MAIN-THREAD capture: resolves the elected backend and reads every
        /// shared readout (live KSP reads, safe here), then computes the core
        /// SignalDelay from the captured hop geometry. Bundles plain payloads
        /// into a <see cref="CommsCapture"/> — no live KSP handles cross to the
        /// Courier thread.
        /// </summary>
        internal object? CaptureOnMain(KspSnapshot? snapshot)
        {
            var backend = _kernel != null ? CommsElection.Elected(_kernel) : null;
            if (backend == null)
            {
                return null; // election not resolved / no backend (pre-flight)
            }

            var path = backend.Path();
            var delay = SignalDelay.Compute(
                _signalDelayConfig,
                path,
                path.Meta?.Source ?? "",
                path.Meta?.Quality ?? Quality.OnRails);

            return new CommsCapture
            {
                Ut = snapshot?.Ut ?? 0.0,
                Connectivity = backend.Connectivity(),
                SignalStrength = backend.SignalStrength(),
                ControlState = backend.ControlState(),
                Path = path,
                Network = backend.Network(),
                Delay = delay,
            };
        }

        /// <summary>COURIER-THREAD handle: publishes the captured payloads. No KSP access.</summary>
        internal void HandleOnCourier(object? captured)
        {
            if (captured is not CommsCapture capture)
            {
                return;
            }
            _connectivity?.Publish(capture.Connectivity, capture.Ut);
            _signalStrength?.Publish(capture.SignalStrength, capture.Ut);
            _controlState?.Publish(capture.ControlState, capture.Ut);
            _path?.Publish(capture.Path, capture.Ut);
            _network?.Publish(capture.Network, capture.Ut);
            _delay?.Publish(capture.Delay, capture.Ut);
        }

        /// <summary>Plain cross-thread payload bundle — no live KSP references.</summary>
        private sealed class CommsCapture
        {
            public double Ut;
            public CommsConnectivity Connectivity = new();
            public CommsSignalStrength SignalStrength = new();
            public CommsControlState ControlState = new();
            public CommsPath Path = new();
            public CommsNetwork Network = new();
            public CommsDelay Delay = new();
        }
    }
}
