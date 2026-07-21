using System;
using System.Collections.Generic;
using System.Threading;
using Sitrep.Contract;

namespace Gonogo.KerbcastUplink
{
    /// <summary>
    /// The GonogoKerbcastUplink — kerbcast's CONTROL plane as a first-class
    /// Uplink, discovered by the same <c>[SitrepUplink]</c> assembly scan as
    /// every other.
    ///
    /// <para><b>What this owns:</b> the camera inventory
    /// (<c>kerbcast.cameras</c> — identity, capabilities, and the DERIVED
    /// docking-port association), the presence gate
    /// (<c>kerbcast.available</c>), the aim/zoom commands
    /// (<c>kerbcast.setFieldOfView</c>/<c>kerbcast.setPan</c>), and — the point
    /// of the exercise — a real, contract-reported HEALTH state that lands in
    /// <c>system.uplinks</c> alongside every other Uplink's.</para>
    ///
    /// <para><b>What this does NOT own: the video.</b> kerbcast's H.264 stream
    /// runs sidecar -> browser over WebRTC and stays there. A UT-indexed,
    /// keyframed telemetry channel is the wrong shape for encoded media, and
    /// the WebRTC path already works. The client's delay authority
    /// (<c>useViewClock()</c>) is what keeps that media aligned with telemetry;
    /// this uplink deliberately does not disturb that seam. Control rides
    /// Sitrep, media rides WebRTC — and because the control plane is Delayed
    /// like everything else, the two agree.</para>
    ///
    /// <para><b>Health is why this exists.</b> Before this uplink, "is my
    /// camera feed healthy" could only be answered by reading the browser's
    /// own <c>KerbcastDataSource.status</c> — a client-side read of a separate
    /// WebRTC connection, bypassing the mod contract entirely. That row was
    /// deleted in <c>45111e44</c> precisely because the Uplinks list is
    /// contract-only. Implementing <see cref="ISitrepUplink.Health"/> here is
    /// what earns the row back honestly: the mod itself reports whether
    /// kerbcast is installed, running, and seeing cameras, over the one Sitrep
    /// connection, exactly like every other Uplink. This is the FIRST real
    /// <see cref="ISitrepUplink.Health"/> implementation in the repo.</para>
    ///
    /// <para>NO compile-time reference to kerbcast's CC-BY-NC-SA-4.0 assembly —
    /// every kerbcast member is reached by reflection
    /// (<see cref="KerbcastReflection"/>). Compile surface is
    /// <c>Sitrep.Contract</c> + stock KSP only.</para>
    /// </summary>
    [SitrepUplink("kerbcast")]
    public sealed class KerbcastUplink : ISitrepUplink
    {
        public const string AvailableTopic = "kerbcast.available";
        public const string CamerasTopic = "kerbcast.cameras";
        public const string SetFieldOfViewCommand = "kerbcast.setFieldOfView";
        public const string SetPanCommand = "kerbcast.setPan";

        private KerbcastReflection? _kerbcast;
        private IChannelPublisher? _cameras;

        // Health state, written by the MAIN-THREAD capture and read by Health()
        // on the Courier thread. Volatile int/string rather than touching KSP:
        // Health() is polled on EVERY system.uplinks sample and must be cheap
        // and non-blocking, and it must never touch a live Unity object off the
        // main thread (a Unity null-check off-thread is not safe).
        private volatile string? _unavailableReason;
        private volatile bool _coreActive;
        private volatile bool _sampledOnce;
        private int _cameraCount = -1;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "kerbcast",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                // Whether the kerbcast mod is installed at all — a GROUND-side
                // fact about the INSTALL, not vessel telemetry, so TrueNow:
                // the same disposition every other mod-presence and uplink-health
                // channel carries. This is the presence gate a client augment
                // declares `requires: "kerbcast"` against.
                new ChannelDeclaration
                {
                    Topic = AvailableTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.TrueNow,
                },
                // The camera inventory IS vessel telemetry — an observation of
                // hardware on the craft, learned over the comms link — so it is
                // Delayed like any other vessel channel. This is also what keeps
                // the control plane honest against the WebRTC video: the feed is
                // played out through the same delay authority, so the camera list
                // and the picture it describes reveal together rather than the
                // list racing ahead of the image.
                new ChannelDeclaration
                {
                    Topic = CamerasTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.Delayed,
                },
            },
            Commands = new List<CommandDeclaration>
            {
                // Delayed: aiming or zooming a camera is an instruction to
                // hardware on the craft, so it rides the signal-delay Courier
                // exactly like a staging or SAS command.
                new CommandDeclaration { Command = SetFieldOfViewCommand, Delayed = true },
                new CommandDeclaration { Command = SetPanCommand, Delayed = true },
            },
        };

        public void Register(IUplinkHost host)
        {
            _kerbcast = KerbcastReflection.Probe();

            if (_kerbcast == null)
            {
                GoInert(host, "kerbcast mod not installed (Kerbcast assembly not loaded)");
                return;
            }
            if (!_kerbcast.IsAvailable)
            {
                GoInert(host, _kerbcast.Reason ?? "kerbcast unavailable");
                return;
            }

            host.AddChannelSource(AvailableTopic, _ => true);
            _cameras = host.Publisher(CamerasTopic);

            // The UNGATED AddSampledSource overload, deliberately. The gated
            // overload skips the capture when nobody is subscribed to the
            // topic — which would make Health() report a stale camera count
            // (or none at all) whenever no camera widget happens to be on the
            // dashboard. The whole point of a MANDATORY healthcheck is that it
            // answers even when nothing is watching, so this capture runs every
            // tick. It stays cheap: kerbcast's camera list is a handful of
            // entries and the docking read is a short module scan per camera.
            host.AddSampledSource(CaptureOnMain, HandleOnCourier);

            host.AddCommandHandler<KerbcastSetFieldOfViewArgs, CommandResult>(
                SetFieldOfViewCommand, HandleSetFieldOfView);
            host.AddCommandHandler<KerbcastSetPanArgs, CommandResult>(
                SetPanCommand, HandleSetPan);
        }

        /// <summary>
        /// kerbcast absent or unreadable: report why, and register INERT sources
        /// so <c>kerbcast.available:false</c> still reaches the client. That
        /// false is load-bearing — it is what lets a client augment gated on
        /// <c>requires: "kerbcast"</c> compose its slot without kerbcast rather
        /// than waiting forever on a topic that never arrives. (A sibling Uplink
        /// with no presence gate to feed registers nothing here instead.)
        /// </summary>
        private void GoInert(IUplinkHost host, string reason)
        {
            _unavailableReason = reason;
            host.SetAvailability(Availability.Unavailable(reason));
            host.AddChannelSource(AvailableTopic, _ => false);
            host.AddChannelSource(CamerasTopic, _ => new List<object>());
        }

        /// <summary>
        /// MAIN-THREAD capture: reads kerbcast's live camera views and the stock
        /// KSP parts behind them. Returns plain data only — no live Part or
        /// kerbcast handle escapes to the Courier thread.
        /// </summary>
        internal object? CaptureOnMain(KspSnapshot? snapshot)
        {
            var kerbcast = _kerbcast;
            if (kerbcast == null)
            {
                return null;
            }

            var capture = new CameraCapture { Ut = snapshot?.Ut ?? 0.0 };

            var coreActive = kerbcast.IsActive();
            _coreActive = coreActive;
            _sampledOnce = true;

            var vessel = FlightGlobals.ActiveVessel;
            if (!coreActive || vessel == null)
            {
                // Definitive empty rather than "no value": kerbcast.cameras is
                // LossyLatest, so publishing nothing would leave the previous
                // vessel's camera list stale on the wire after a scene change —
                // the same trap RaLinkDown documents for comms.
                Volatile.Write(ref _cameraCount, 0);
                capture.Entries = new List<object?>();
                return capture;
            }

            var vesselId = "vessel:" + vessel.id;
            var views = kerbcast.CamerasFor(vessel);
            var entries = new List<object?>(views.Count);

            foreach (var raw in views)
            {
                var view = kerbcast.ReadView(raw);
                var docking = DockingCameraDetector.Detect(view.Part);
                entries.Add(KerbcastCameraEntryBuilder.Build(view, docking, vesselId));
            }

            Volatile.Write(ref _cameraCount, entries.Count);
            capture.Entries = entries;
            return capture;
        }

        /// <summary>COURIER-THREAD handle: publish the captured inventory.</summary>
        internal void HandleOnCourier(object? captured)
        {
            if (captured is not CameraCapture capture || capture.Entries == null)
            {
                return;
            }
            _cameras?.Publish(capture.Entries, capture.Ut);
        }

        /// <summary>
        /// The MANDATORY healthcheck — polled on the Courier thread every
        /// <c>system.uplinks</c> sample, so it only ever reads cached volatile
        /// state written by the main-thread capture. Never touches KSP or
        /// kerbcast directly.
        ///
        /// <para>The states are meaningfully different, which is the point:
        /// "not installed" is an install problem, "core not running" is a
        /// scene problem (you're in the VAB), and "no cameras" is a craft
        /// problem (you didn't put a camera on it). An operator staring at a
        /// black feed can tell those three apart at a glance.</para>
        /// </summary>
        public UplinkHealth Health() => KerbcastHealth.Evaluate(
            _unavailableReason, _sampledOnce, _coreActive, Volatile.Read(ref _cameraCount));

        /// <summary>
        /// MAIN-THREAD command: zoom a camera. Runs on the actuator thread the
        /// engine dispatches commands on, after the Courier's delay.
        /// </summary>
        internal CommandResult HandleSetFieldOfView(KerbcastSetFieldOfViewArgs? args)
        {
            var kerbcast = _kerbcast;
            if (args == null)
            {
                return CommandResult.Fail(CommandErrorCode.Range);
            }
            if (kerbcast == null || !kerbcast.IsAvailable)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }
            if (!TryCameraId(args.CameraId, out var cameraId))
            {
                return CommandResult.Fail(CommandErrorCode.Range);
            }
            // kerbcast clamps to the camera's own bounds and returns false when
            // the id doesn't resolve — NotFound is the honest code for that.
            return kerbcast.SetFov(cameraId, (float)args.FieldOfView)
                ? CommandResult.Ok()
                : CommandResult.Fail(CommandErrorCode.NotFound);
        }

        /// <summary>MAIN-THREAD command: aim a camera (absolute degrees).</summary>
        internal CommandResult HandleSetPan(KerbcastSetPanArgs? args)
        {
            var kerbcast = _kerbcast;
            if (args == null)
            {
                return CommandResult.Fail(CommandErrorCode.Range);
            }
            if (kerbcast == null || !kerbcast.IsAvailable)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable);
            }
            if (!TryCameraId(args.CameraId, out var cameraId))
            {
                return CommandResult.Fail(CommandErrorCode.Range);
            }
            return kerbcast.SetPan(cameraId, (float)args.Yaw, (float)args.Pitch)
                ? CommandResult.Ok()
                : CommandResult.Fail(CommandErrorCode.NotFound);
        }

        // The wire carries cameraId as a JSON number (long on the contract);
        // kerbcast's handle is a uint. Reject anything that isn't representable
        // rather than wrapping it into a different camera's id.
        private static bool TryCameraId(long value, out uint cameraId)
        {
            if (value < 0 || value > uint.MaxValue)
            {
                cameraId = 0;
                return false;
            }
            cameraId = (uint)value;
            return true;
        }

        private sealed class CameraCapture
        {
            public double Ut;
            public List<object?>? Entries;
        }
    }
}
