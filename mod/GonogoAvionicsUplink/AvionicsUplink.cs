using System.Collections.Generic;
using Sitrep.Contract;

namespace GonogoAvionicsUplink
{
    /// <summary>
    /// GonogoAvionicsUplink — the RP-1 controllable-mass ascent go/no-go. Reflects
    /// the RP-1 avionics units' live <c>CurrentMassLimit</c> (arm's-length, no
    /// RP-0 compile link) and pairs it with the active vessel's stock total mass,
    /// emitting a single <c>avionics.status</c> Topic. Presence is exposed on the
    /// bare TrueNow <c>avionics.available</c> primitive; the per-vessel status is
    /// Delayed (reveal-gated). Health is Unavailable when RP-1 is not loaded.
    ///
    /// <para>Accessors mirror the established uplinks: <c>AddChannelSource</c> for
    /// the bare available boolean (as ScansatUplink does), and the capture-on-main
    /// / handle-on-Courier <c>AddSampledSource</c> seam for the status (live KSP
    /// reads stay on the main thread, as RealAntennasUplink does). The active
    /// vessel comes from <c>FlightGlobals.ActiveVessel</c>; the sampled UT is
    /// carried on the capture and used at publish time.</para>
    /// </summary>
    [SitrepUplink("avionics")]
    public sealed class AvionicsUplink : ISitrepUplink
    {
        public const string AvailableTopic = "avionics.available";
        public const string StatusTopic = "avionics.status";

        private readonly AvionicsReflection _a = new AvionicsReflection();
        private IChannelPublisher? _status;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "avionics",
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
                    Topic = StatusTopic,
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.Delayed,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
            },
        };

        public void Register(IUplinkHost host)
        {
            // Bare presence primitive is always sourced with the real availability,
            // even when RP-1 is absent (so the client can gate on it definitively).
            host.AddChannelSource(AvailableTopic, _ => _a.IsAvailable);

            if (!_a.IsAvailable)
            {
                host.SetAvailability(Availability.Unavailable("RP-1 avionics assembly not loaded"));
                return;
            }

            _status = host.Publisher(StatusTopic);
            host.AddSampledSource(CaptureOnMain, HandleOnCourier, StatusTopic);
        }

        /// <summary>MAIN-THREAD capture: reads the avionics limit + vessel mass off
        /// the live control path. Null when there is no active vessel or RP-1 is
        /// absent.</summary>
        internal object? CaptureOnMain(KspSnapshot? snapshot)
        {
            var vessel = FlightGlobals.ActiveVessel;
            if (vessel == null || !_a.IsAvailable)
            {
                return null;
            }
            return new AvionicsCaptureData
            {
                Ut = snapshot?.Ut ?? 0.0,
                Raw = _a.Read(vessel),
                VesselMassTons = vessel.totalMass,
            };
        }

        /// <summary>COURIER-THREAD handle: build + publish the status dict.</summary>
        internal void HandleOnCourier(object? captured)
        {
            if (captured is not AvionicsCaptureData cap)
            {
                return;
            }
            _status?.Publish(AvionicsCapture.Build(cap.Raw, cap.VesselMassTons), cap.Ut);
        }

        public UplinkHealth Health() =>
            _a.IsAvailable
                ? UplinkHealth.Healthy
                : new UplinkHealth(UplinkHealthState.Unavailable, "RP-1 avionics assembly not loaded");

        private sealed class AvionicsCaptureData
        {
            public double Ut;
            public AvionicsRaw? Raw;
            public double VesselMassTons;
        }
    }
}
