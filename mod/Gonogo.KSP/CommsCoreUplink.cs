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

            // Advertise comms.delay to the engine's server-side reveal gate as
            // the AUTHORITATIVE, subscription-independent delay source (§7.3
            // Step 2). Without this the gate only ever learned the delay from a
            // pull-style AddChannelSource (which comms.delay is NOT — it rides
            // the main-thread capture above) or the subscription-gated wire
            // snoop, so a Delayed channel was delivered live whenever no client
            // subscribed comms.delay. This closure is evaluated on the MAIN
            // thread every tick (same seam as CaptureOnMain), so reading the
            // live elected backend is safe.
            host.SetSignalDelaySource(ComputeDelayOnMain);

            // Freeze-on-disconnect: advertise the CONNECTED/DISCONNECTED state to
            // the reveal gate the SAME subscription-independent, main-thread way
            // as the delay. When the control link is down, the gate withholds
            // (freezes) every Delayed channel instead of revealing it live off a
            // zero/None delay; on reconnect it drops the backlog and resumes. See
            // IUplinkHost.SetConnectivitySource.
            host.SetConnectivitySource(ComputeConnectedOnMain);
        }

        /// <summary>
        /// MAIN-THREAD connectivity computation for the engine's reveal gate (see
        /// <see cref="IUplinkHost.SetConnectivitySource"/>) — reads the elected
        /// backend's <see cref="ICommsBackend.Connectivity"/> live, exactly where
        /// <see cref="CaptureOnMain"/>/<see cref="ComputeDelayOnMain"/> run.
        /// Returns null pre-election (no backend), which the gate treats as "no
        /// authority yet" and leaves the last-known state untouched (default
        /// CONNECTED) — never worse than today's LAN behaviour.
        /// </summary>
        internal bool? ComputeConnectedOnMain(KspSnapshot? snapshot)
        {
            var backend = _kernel != null ? CommsElection.Elected(_kernel) : null;
            if (backend == null)
            {
                return null;
            }

            // A transient backend-read THROW must NOT be swallowed into a hard
            // `false`. The reveal gate treats a `false` from this source as an
            // AUTHORITATIVE disconnect and FREEZES every Delayed channel — so a
            // scene-settle / vessel-unload / vessel-change tick where the read
            // throws (e.g. CommNetBackend's un-guarded Meta() dereferencing a
            // torn ActiveVessel) would wrongly freeze ALL vessel.* telemetry,
            // even though the link is up. Worse, the comms.connectivity CHANNEL
            // fail-softs the SAME throw the opposite way (its capture returns
            // null ⇒ keeps last-known `connected:true`), so the two diverge:
            // the channel reads connected while the gate stays frozen — the
            // exact live-KSP symptom.
            //
            // Let the throw PROPAGATE instead. The engine's recoverable
            // connectivity fail-soft (ChannelEngine.CaptureConnectivityOnMain →
            // RefreshConnectivityFromCapability) treats a thrown source as
            // CONNECTED and retries next tick — matching the reveal gate's own
            // documented "a source that threw ⇒ treated as CONNECTED" contract
            // and never worsening LAN behaviour. A GENUINE disconnect still
            // arrives as a clean `false` (Connection() null ⇒ Connected=false,
            // no throw) and still freezes, as intended.
            return backend.Connectivity().Connected;
        }

        /// <summary>
        /// MAIN-THREAD delay computation for the engine's reveal gate (see
        /// <see cref="IUplinkHost.SetSignalDelaySource"/>) — the same elected-
        /// backend resolution + core <see cref="SignalDelay"/> light-time math
        /// <see cref="CaptureOnMain"/> performs for the <c>comms.delay</c>
        /// channel, factored out so the gate and the channel share one
        /// computation. Returns null pre-election (no backend), which the gate
        /// treats as "no delay authority yet" and leaves the last-known delay
        /// untouched.
        /// </summary>
        internal CommsDelay? ComputeDelayOnMain(KspSnapshot? snapshot)
        {
            var backend = _kernel != null ? CommsElection.Elected(_kernel) : null;
            if (backend == null)
            {
                return null;
            }

            // A transient backend-read THROW must PROPAGATE, not be swallowed
            // into NoneDelay (OneWaySeconds=0). Dropping the delay to 0 on a
            // one-tick read blip would momentarily collapse the reveal horizon
            // and prematurely reveal a still-in-flight Delayed sample. The
            // engine's recoverable delay fail-soft
            // (ChannelEngine.CaptureSignalDelayOnMain →
            // RefreshSignalDelayFromCapability → FailSoftSignalDelaySource)
            // instead leaves the LAST-KNOWN delay untouched and retries next
            // tick — the correct "never reveal earlier than the known horizon"
            // behaviour, symmetric with ComputeConnectedOnMain above.
            var path = backend.Path();
            return SignalDelay.Compute(
                _signalDelayConfig,
                path,
                path.Meta?.Source ?? "",
                path.Meta?.Quality ?? Quality.OnRails);
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

            try
            {
                var path = backend.Path();
                var delay = SignalDelay.Compute(
                    _signalDelayConfig,
                    path,
                    path.Meta?.Source ?? "",
                    path.Meta?.Quality ?? Quality.OnRails);
                var connectivity = backend.Connectivity();

                return new CommsCapture
                {
                    Ut = snapshot?.Ut ?? 0.0,
                    Connectivity = connectivity,
                    SignalStrength = backend.SignalStrength(),
                    ControlState = backend.ControlState(),
                    Path = path,
                    Network = backend.Network(),
                    Delay = delay,
                };
            }
            catch (Exception)
            {
                // NULL-SAFE capture: a backend read that threw on a transient /
                // unloaded vessel yields no comms capture THIS tick (last-known
                // stays) rather than an exception that would fail-soft the whole
                // comms uplink. Retried next tick. The built-in CommNetBackend is
                // already exception-safe; this guards a third-party backend too.
                return null;
            }
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
