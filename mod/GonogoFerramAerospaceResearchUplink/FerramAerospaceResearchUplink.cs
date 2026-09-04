using System.Collections.Generic;
using Sitrep.Contract;

namespace GonogoFerramAerospaceResearchUplink
{
    /// <summary>
    /// GonogoFerramAerospaceResearchUplink: the active vessel's aerodynamic state
    /// on the wire. Angle of attack, sideslip, stall fraction, the lift and drag
    /// coefficients and their reference area, indicated and equivalent airspeed,
    /// terminal velocity, ballistic coefficient and specific excess power, read
    /// from Ferram Aerospace Research by reflection.
    ///
    /// <para><b>What this adds and what it deliberately does not.</b> The
    /// ATMOSPHERIC state is already correct on <c>vessel.flight</c> with FAR
    /// installed and is not repeated here: FAR's integrator registration replaces
    /// aerodynamic forces and exposed areas, not the atmosphere, and FAR's own
    /// display reads the stock dynamic pressure. What no channel carried is the
    /// vessel's attitude TO that atmosphere and what the attitude is costing it,
    /// which on an ascent or an entry is the half an operator is actually flying
    /// to.</para>
    ///
    /// <para>Two channels, the shape a reflection-probed Uplink takes here.
    /// The bare <c>aero.available</c> presence primitive is TrueNow and is sourced
    /// whether or not FAR is installed, so a client can gate on it definitively
    /// rather than inferring absence from silence. The per-vessel
    /// <c>aero.state</c> reading is Delayed like any other telemetry taken from a
    /// craft, and declares <c>AbsenceIsData</c>: FAR legitimately holds no reading
    /// for a vessel in a scene it does not run in, and a client should be told
    /// that rather than left waiting for a first value.</para>
    ///
    /// <para>The capture/handle split is load-bearing rather than ceremony. The
    /// reflection walk reads live Unity objects off the vessel's module list,
    /// which is only legal on the main thread;
    /// <see cref="HandleOnCourier"/> receives plain data and publishes, touching
    /// no game API at all.</para>
    /// </summary>
    [SitrepUplink("aero")]
    public sealed class FerramAerospaceResearchUplink : ISitrepUplink
    {
        public const string AvailableTopic = "aero.available";
        public const string StateTopic = "aero.state";

        /// <summary>
        /// The FAR build every member name in <see cref="AeroReflection"/> was
        /// read out of. Surfaced as a health fact so an operator reporting an
        /// empty readout can be asked which FAR they are running rather than
        /// guessing, which matters here because the whole reading hangs off one
        /// struct's field names.
        /// </summary>
        private const string ReadAgainstVersion = "FAR v0.16.1.2";

        /// <summary>
        /// Fields published per UT second. One capture per tick emits one payload
        /// of fifteen fields, so steady state is fifteen; this is set at five
        /// times that, which is loose enough for a keyframe landing beside a
        /// change emission and tight enough that a capture running per FRAME
        /// rather than per tick breaches it within the first second.
        ///
        /// <para>Counting FIELDS rather than payloads is what makes the number
        /// mean anything: a payload count for a single-vessel channel is one per
        /// tick whatever goes wrong with it, so it could only ever catch a cadence
        /// fault, and it would catch it against a threshold of one.</para>
        /// </summary>
        private static readonly PerfBudget AeroFieldBudget = new PerfBudget(
            "FerramAerospaceResearchUplink fields published", threshold: 75, windowSec: 1.0, unit: "fields");

        private readonly AeroReflection _far = new AeroReflection();

        /// <summary>
        /// Core's capability registry, held from <see cref="Register"/>. See
        /// <see cref="ScopedVessel"/>.
        /// </summary>
        private Kernel? _kernel;

        private IChannelPublisher? _state;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "aero",
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
                    Topic = StateTopic,
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.Delayed,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    // A vessel FAR holds no flight information for is a real
                    // subject with no reading, not a subject that has yet to
                    // appear. Without this the client waits for a first value
                    // through every scene FAR does not run in.
                    AbsenceIsData = true,
                },
            },
        };

        public void Register(IUplinkHost host)
        {
            _kernel = host.Kernel;

            // Sourced with the real answer even when FAR is absent, so a client
            // can gate on it definitively.
            host.AddChannelSource(AvailableTopic, _ => _far.IsAvailable);

            if (!_far.IsAvailable)
            {
                host.SetAvailability(Availability.Unavailable("Ferram Aerospace Research not loaded"));
                return;
            }

            _state = host.Publisher(StateTopic);

            // Gated, and safe to gate: this capture's ENTIRE effect is its return
            // value. It stashes nothing, elects nothing, and no command pre-filter
            // reads it, so a tick nobody is watching skips a reflection walk and
            // starves nothing downstream.
            host.AddSampledSource(CaptureOnMain, HandleOnCourier, StateTopic);
        }

        /// <summary>
        /// The craft this channel is about, from core's <c>activeVessel</c>
        /// capability rather than from KSP.
        ///
        /// <para>KSP's answer during an EVA is the kerbal, and FAR does have a
        /// reading for one: a kerbal in atmosphere has drag and dynamic pressure
        /// of their own. So this is not a channel that would merely go quiet, it
        /// would publish plausible aerodynamics for the wrong body while the
        /// craft it names is the one descending. Queried per call, as
        /// <see cref="IActiveVessel"/> requires.</para>
        /// </summary>
        private Vessel? ScopedVessel() => _kernel.ReportedVessel() as Vessel;

        /// <summary>
        /// MAIN-THREAD capture: the reflection walk, returning plain data with no
        /// live FAR or Unity object in it. Null when there is no reported vessel at
        /// all, which is a different thing from a vessel FAR has no reading for:
        /// the first publishes nothing, the second publishes an explicit absence.
        /// </summary>
        internal object? CaptureOnMain(KspSnapshot? snapshot)
        {
            var vessel = ScopedVessel();
            if (vessel == null)
            {
                return null;
            }
            var ut = snapshot?.Ut ?? 0.0;
            return new AeroCaptured { Ut = ut, Raw = _far.Read(vessel, ut) };
        }

        /// <summary>COURIER-THREAD handle: map to the wire dict and publish. No game API.</summary>
        internal void HandleOnCourier(object? captured)
        {
            if (captured is not AeroCaptured cap)
            {
                return;
            }
            var payload = AeroCapture.Build(cap.Raw);
            AeroFieldBudget.Record(payload?.Count ?? 0, cap.Ut);
            _state?.Publish(payload, cap.Ut);
        }

        /// <summary>
        /// Health, and WHICH Ferram. The version caveat on
        /// <see cref="ReadAgainstVersion"/> is why these rows are load-bearing
        /// rather than decorative: every reading hangs off one struct's field
        /// names, so an operator seeing an empty aerodynamic panel needs to be
        /// able to say which build the mod resolved against.
        /// </summary>
        public UplinkHealth Health()
        {
            var facts = new List<UplinkHealthFact>
            {
                new UplinkHealthFact("FAR assembly", _far.AssemblyIdentity),
                new UplinkHealthFact("FlightGUI", _far.IsAvailable ? "resolved" : "type or members not found"),
                new UplinkHealthFact("airspeed", _far.AirspeedAvailable ? "resolved" : "IAS/EAS not found"),
                new UplinkHealthFact("voxelisation", _far.VoxelizationAvailable ? "resolved" : "qualifier not found"),
                new UplinkHealthFact("read against", ReadAgainstVersion),
            };

            if (!_far.IsAvailable)
            {
                return new UplinkHealth(UplinkHealthState.Unavailable, "Ferram Aerospace Research not loaded", facts);
            }
            if (!_far.AirspeedAvailable || !_far.VoxelizationAvailable)
            {
                // Degraded rather than Unavailable: the aerodynamic state still
                // reaches the operator, and naming which part of it does not is
                // more useful than reporting the whole Uplink dark.
                return new UplinkHealth(
                    UplinkHealthState.Degraded,
                    "FAR is loaded but part of its surface has moved: some readings will be absent",
                    facts);
            }
            return new UplinkHealth(UplinkHealthState.Healthy, null, facts);
        }

        private sealed class AeroCaptured
        {
            public double Ut;
            public AeroRaw? Raw;
        }
    }
}
