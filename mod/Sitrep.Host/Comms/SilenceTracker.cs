using System;
using System.Collections.Generic;
using Sitrep.Propagation;

namespace Sitrep.Host.Comms
{
    /// <summary>State machine phase for a vessel's comms silence.</summary>
    public enum SilenceState
    {
        /// <summary>Contact confirmed as of the most recent sample.</summary>
        Nominal,

        /// <summary>No contact observed; still inside the deadline, or awaiting the consecutive-sample hysteresis.</summary>
        Silent,

        /// <summary>Officially declared lost: either destroyed, or silent past its deadline with the hysteresis satisfied.</summary>
        Lost,
    }

    /// <summary>
    /// The basis a <see cref="SilenceDeadlinePolicy"/> used to produce a
    /// deadline, carried onto the wire as <c>deadlineBasis</c> so an operator
    /// (or a future SystemView countdown) can tell "this is the vessel's own
    /// orbital period" from "this is just the policy's floor/ceiling because
    /// there was nothing better to go on".
    /// </summary>
    public static class SilenceDeadlineBasis
    {
        public const string OrbitalPeriod = "orbital-period";
        public const string PolicyFloor = "policy-floor";
        public const string PolicyCeiling = "policy-ceiling";
        public const string NoOrbit = "no-orbit";
        public const string Destroyed = "destroyed";
    }

    /// <summary>One deadline-policy evaluation: how long to wait, and why.</summary>
    public readonly struct SilenceDeadline
    {
        /// <summary>Seconds from the start of silence to the declare-eligible deadline.</summary>
        public readonly double DurationSec;

        /// <summary>One of <see cref="SilenceDeadlineBasis"/>.</summary>
        public readonly string Basis;

        public SilenceDeadline(double durationSec, string basis)
        {
            DurationSec = durationSec;
            Basis = basis;
        }
    }

    /// <summary>
    /// The pluggable deadline seam: "we are still designing a better
    /// predictor; the seam is the point" (see
    /// <c>local_docs/design/2026-08-15-vessel-officially-lost.md</c>). Given
    /// the vessel's own orbit (null when unknown) and whether it is
    /// currently landed/splashed, returns how long a silence run gets before
    /// it becomes eligible to be declared Lost. Never called for a destroyed
    /// vessel: <see cref="SilenceTracker"/> decides that case itself, with no
    /// deadline at all.
    /// </summary>
    public delegate SilenceDeadline SilenceDeadlinePolicy(OrbitElements? orbit, bool landedOrSplashed);

    /// <summary>One vessel's live comms facts for a single capture tick.</summary>
    public readonly struct SilenceSample
    {
        public readonly string VesselId;
        public readonly bool Connected;

        /// <summary>Null when the vessel has no propagatable orbit this tick.</summary>
        public readonly OrbitElements? Orbit;

        public readonly bool LandedOrSplashed;

        public SilenceSample(string vesselId, bool connected, OrbitElements? orbit, bool landedOrSplashed)
        {
            VesselId = vesselId;
            Connected = connected;
            Orbit = orbit;
            LandedOrSplashed = landedOrSplashed;
        }
    }

    /// <summary>
    /// One vessel's silence/lost bookkeeping. Mutated in place tick over
    /// tick, and carries only primitives, so it round-trips through
    /// ConfigNode cleanly on the Gonogo.KSP side without this type ever
    /// needing to know ConfigNode exists.
    /// </summary>
    public sealed class VesselContactState
    {
        public string VesselId = string.Empty;
        public SilenceState State = SilenceState.Nominal;

        /// <summary>Whether contact was observed on the most recent sample.</summary>
        public bool Connected;

        /// <summary>UT of the last sample that observed contact. Null before the first-ever contact.</summary>
        public double? LastContactUt;

        /// <summary>UT the current silence run began. Null while Nominal.</summary>
        public double? SilenceSinceUt;

        /// <summary>UT at which this silence run becomes eligible to be declared Lost. Null while Nominal, or for a destroyed vessel.</summary>
        public double? DeadlineUt;

        /// <summary>One of <see cref="SilenceDeadlineBasis"/>. Null while Nominal.</summary>
        public string? DeadlineBasis;

        /// <summary>UT this vessel was most recently declared Lost. Null if never declared.</summary>
        public double? DeclaredLostUt;

        /// <summary>
        /// Monotonic: incremented once per NEW declare-lost transition, never
        /// on a repeat sample that is already Lost. A future currency
        /// consumer arms against (VesselId, LostSeq) so a reload replaying
        /// the same declaration cannot double-charge, and a later
        /// reconnect-then-re-lose cycle gets a fresh id.
        /// </summary>
        public int LostSeq;

        /// <summary>
        /// Consecutive silent samples in the CURRENT run (warp hysteresis).
        /// Deliberately not part of what gets persisted: a reload always
        /// resumes at 0, requiring two fresh post-reload samples before an
        /// already-overdue vessel is (re)confirmed Lost, biasing toward not
        /// declaring even across a save/load boundary.
        /// </summary>
        internal int ConsecutiveSilentSamples;
    }

    /// <summary>
    /// Pure, KSP-free "is this vessel out of contact, and should it now be
    /// declared lost" state machine, decoupled from any currency concern
    /// (see <c>local_docs/design/2026-08-15-vessel-officially-lost.md</c>).
    /// Modeled on <c>LandingPredictor</c>'s discipline (no KSP/Unity types,
    /// every input injected, fully unit-testable) but genuinely stateful:
    /// silence has to survive from one capture tick to the next, which a
    /// static pure function cannot do on its own.
    ///
    /// <para><b>Warp hysteresis.</b> A single connected sample clears a
    /// vessel back to <see cref="SilenceState.Nominal"/> instantly. Declaring
    /// <see cref="SilenceState.Lost"/> is the opposite: it requires BOTH the
    /// UT dwell (the policy's deadline has actually passed) AND at least two
    /// CONSECUTIVE silent samples, so a single stale or glitchy reading at
    /// high warp cannot trip a declaration on its own. Every ambiguity
    /// resolves toward NOT declaring.</para>
    ///
    /// <para><b>Destroyed vessels never go through the deadline policy.</b>
    /// <see cref="Tick"/> reconciles its own known-vessel set against the ids
    /// present this capture: anything previously tracked but missing this
    /// tick is gone from <c>FlightGlobals.Vessels</c> and is declared Lost
    /// immediately, <c>deadlineBasis = destroyed</c>, no deadline, no further
    /// propagation.</para>
    /// </summary>
    public sealed class SilenceTracker
    {
        /// <summary>Minimum consecutive silent samples before a Lost declaration is eligible (warp hysteresis).</summary>
        private const int MinConsecutiveSilentSamples = 2;

        private readonly SilenceDeadlinePolicy _policy;
        private readonly Dictionary<string, VesselContactState> _states = new Dictionary<string, VesselContactState>(StringComparer.Ordinal);

        public SilenceTracker(SilenceDeadlinePolicy policy)
        {
            _policy = policy ?? throw new ArgumentNullException(nameof(policy));
        }

        /// <summary>Read-only view of every vessel this tracker currently knows about.</summary>
        public IReadOnlyDictionary<string, VesselContactState> States => _states;

        public VesselContactState? TryGetState(string vesselId) =>
            !string.IsNullOrEmpty(vesselId) && _states.TryGetValue(vesselId, out var s) ? s : null;

        /// <summary>
        /// Restores a previously-persisted record (see the Gonogo.KSP-side
        /// ConfigNode round-trip). Replaces any live in-memory record for the
        /// same vessel id, and always resets
        /// <see cref="VesselContactState.ConsecutiveSilentSamples"/> to 0 -
        /// see that field's own doc comment for why.
        /// </summary>
        public void RestoreState(VesselContactState state)
        {
            if (state == null || string.IsNullOrEmpty(state.VesselId))
            {
                return;
            }
            state.ConsecutiveSilentSamples = 0;
            _states[state.VesselId] = state;
        }

        /// <summary>
        /// Advances every vessel present this capture tick, then declares
        /// Lost (basis <c>destroyed</c>) any vessel this tracker previously
        /// knew about but that is absent from <paramref name="presentVessels"/>
        /// - i.e. gone from <c>FlightGlobals.Vessels</c>. Returns the current
        /// state of every vessel touched this tick (present + newly
        /// destroyed), for the caller to publish.
        /// </summary>
        public IReadOnlyList<VesselContactState> Tick(IReadOnlyList<SilenceSample> presentVessels, double ut)
        {
            if (presentVessels == null) throw new ArgumentNullException(nameof(presentVessels));

            var seen = new HashSet<string>(StringComparer.Ordinal);
            var touched = new List<VesselContactState>(presentVessels.Count);

            foreach (var sample in presentVessels)
            {
                if (string.IsNullOrEmpty(sample.VesselId))
                {
                    continue;
                }
                seen.Add(sample.VesselId);
                touched.Add(SampleOne(sample, ut));
            }

            foreach (var kv in _states)
            {
                if (seen.Contains(kv.Key))
                {
                    continue;
                }
                touched.Add(MarkDestroyed(kv.Value, ut));
            }

            return touched;
        }

        private VesselContactState GetOrCreate(string vesselId)
        {
            if (!_states.TryGetValue(vesselId, out var state))
            {
                state = new VesselContactState { VesselId = vesselId };
                _states[vesselId] = state;
            }
            return state;
        }

        private VesselContactState SampleOne(SilenceSample sample, double ut)
        {
            var s = GetOrCreate(sample.VesselId);
            s.Connected = sample.Connected;

            if (sample.Connected)
            {
                // ONE connected sample clears instantly, from any prior state.
                s.LastContactUt = ut;
                s.State = SilenceState.Nominal;
                s.SilenceSinceUt = null;
                s.DeadlineUt = null;
                s.DeadlineBasis = null;
                s.ConsecutiveSilentSamples = 0;
                return s;
            }

            s.ConsecutiveSilentSamples++;

            if (s.State == SilenceState.Nominal)
            {
                // First sign of silence: arm the clock and ask the policy
                // once, up front, for a stable deadline. Recomputing it on
                // every subsequent silent sample would make a future
                // SystemView countdown jitter as the unloaded vessel's orbit
                // evolves underneath it.
                s.State = SilenceState.Silent;
                s.SilenceSinceUt = ut;
                var deadline = _policy(sample.Orbit, sample.LandedOrSplashed);
                s.DeadlineUt = ut + deadline.DurationSec;
                s.DeadlineBasis = deadline.Basis;
                return s;
            }

            if (s.State == SilenceState.Lost)
            {
                // Already declared and not destroyed (a destroyed vessel
                // never reaches here disconnected - see MarkDestroyed).
                // Sticky until a connected sample clears it above.
                return s;
            }

            // Silent, possibly resumed from a reload: declare only once BOTH
            // the UT dwell and the consecutive-sample hysteresis agree.
            if (s.DeadlineUt.HasValue && ut >= s.DeadlineUt.Value && s.ConsecutiveSilentSamples >= MinConsecutiveSilentSamples)
            {
                s.State = SilenceState.Lost;
                s.DeclaredLostUt = ut;
                s.LostSeq++;
            }

            return s;
        }

        private static VesselContactState MarkDestroyed(VesselContactState s, double ut)
        {
            var alreadyDestroyed = s.State == SilenceState.Lost && s.DeadlineBasis == SilenceDeadlineBasis.Destroyed;
            s.Connected = false;
            if (!alreadyDestroyed)
            {
                s.DeclaredLostUt = ut;
                s.LostSeq++;
            }
            s.State = SilenceState.Lost;
            s.DeadlineUt = null;
            s.DeadlineBasis = SilenceDeadlineBasis.Destroyed;
            s.ConsecutiveSilentSamples = 0;
            return s;
        }
    }
}
