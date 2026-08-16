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

        /// <summary>
        /// A visibility sweep found the path re-opening at a specific UT, so
        /// the deadline is that emergence plus a grace rather than a multiple
        /// of the orbital period. The only basis that carries a
        /// <see cref="SilenceDeadline.PredictedReacquisitionUt"/>.
        /// </summary>
        public const string PredictedReacquisition = "predicted-reacquisition";

        /// <summary>
        /// The sweep ran and found the path clear for the whole window: no
        /// body ever comes between the vessel and a station, so geometry
        /// offers NO explanation for this silence and predicts no emergence.
        ///
        /// <para>This means "there is no countdown to show", and it must never
        /// be read as "declare fast". The naive treatment, no occultation, so
        /// nothing to wait for, fall to the floor, declares an LKO vessel lost
        /// ten minutes after any blip, and under this save's relay ring an LKO
        /// craft is geometrically blind 0.0% of the time, so that is EVERY LKO
        /// vessel. The deadline falls through to the orbital-period policy
        /// instead; only the prediction is withheld.</para>
        /// </summary>
        public const string NoOccultation = "no-occultation";

        /// <summary>
        /// The sweep ran and the path was blocked for the whole window: the
        /// vessel is behind something and stays there for at least the
        /// searched span. Distinct from <see cref="NoOccultation"/>, which is
        /// the opposite finding, because "it is still behind the Mun" and
        /// "nothing is in the way" are different things to tell an operator
        /// even though both withhold a prediction.
        /// </summary>
        public const string NoEmergenceInWindow = "no-emergence-in-window";

        /// <summary>
        /// Time warp is fast enough that the sweep step needed to resolve an
        /// occultation exceeds the occultation itself, so any emergence time
        /// would be fabricated. Same treatment as
        /// <see cref="NoOccultation"/>: orbital-period deadline, no prediction.
        /// </summary>
        public const string WarpLimited = "warp-limited";
    }

    /// <summary>One deadline-policy evaluation: how long to wait, and why.</summary>
    public readonly struct SilenceDeadline
    {
        /// <summary>Seconds from the start of silence to the declare-eligible deadline.</summary>
        public readonly double DurationSec;

        /// <summary>One of <see cref="SilenceDeadlineBasis"/>.</summary>
        public readonly string Basis;

        /// <summary>
        /// Absolute UT at which the path is predicted to re-open, when a
        /// visibility sweep found one. Null whenever no honest prediction
        /// exists, which is most of the time: no geometry available, no
        /// occultation found, or a warp too fast to resolve one. A null here
        /// is a prediction WITHHELD, never a prediction of "now".
        /// </summary>
        public readonly double? PredictedReacquisitionUt;

        public SilenceDeadline(double durationSec, string basis, double? predictedReacquisitionUt = null)
        {
            DurationSec = durationSec;
            Basis = basis;
            PredictedReacquisitionUt = predictedReacquisitionUt;
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
    ///
    /// <para><paramref name="ut"/> is the moment the silence began, which a
    /// geometry-based policy needs as the origin of its forward sweep. A
    /// policy that only scales the orbital period ignores it, as it ignores
    /// everything on the sample beyond the orbit.</para>
    /// </summary>
    public delegate SilenceDeadline SilenceDeadlinePolicy(SilenceSample sample, double ut);

    /// <summary>One vessel's live comms facts for a single capture tick.</summary>
    public readonly struct SilenceSample
    {
        public readonly string VesselId;
        public readonly bool Connected;

        /// <summary>Null when the vessel has no propagatable orbit this tick.</summary>
        public readonly OrbitElements? Orbit;

        public readonly bool LandedOrSplashed;

        /// <summary>
        /// Index into <c>FlightGlobals.Bodies</c> of the body
        /// <see cref="Orbit"/> is relative to, or null when unknown. The
        /// elements alone do not say which body they orbit, and a predictor
        /// cannot pick an occluder or a set of ground stations without that.
        /// </summary>
        public readonly int? ReferenceBodyIndex;

        public SilenceSample(
            string vesselId,
            bool connected,
            OrbitElements? orbit,
            bool landedOrSplashed,
            int? referenceBodyIndex = null)
        {
            VesselId = vesselId;
            Connected = connected;
            Orbit = orbit;
            LandedOrSplashed = landedOrSplashed;
            ReferenceBodyIndex = referenceBodyIndex;
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

        /// <summary>
        /// UT the path is predicted to re-open, when the policy found one.
        /// Null while Nominal, and null during a silence the geometry cannot
        /// explain: see <see cref="SilenceDeadlineBasis.NoOccultation"/>.
        /// </summary>
        public double? PredictedReacquisitionUt;

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
        /// Whether this silence run has already spent its one deadline
        /// re-evaluation. Deliberately not persisted: a reload grants one more
        /// attempt, which biases toward eventually getting a prediction rather
        /// than toward never trying again.
        /// </summary>
        internal bool DeadlineUpgraded;

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
                s.PredictedReacquisitionUt = null;
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
                var deadline = _policy(sample, ut);
                s.DeadlineUt = ut + deadline.DurationSec;
                s.DeadlineBasis = deadline.Basis;
                s.PredictedReacquisitionUt = deadline.PredictedReacquisitionUt;
                s.DeadlineUpgraded = false;
                return s;
            }

            if (s.State == SilenceState.Lost)
            {
                // Already declared and not destroyed (a destroyed vessel
                // never reaches here disconnected - see MarkDestroyed).
                // Sticky until a connected sample clears it above.
                return s;
            }

            // ONE re-evaluation per silence run, and only while the current
            // answer carries no prediction.
            //
            // The deadline is otherwise armed on the Nominal -> Silent edge and
            // then held, so a countdown does not jitter as an unloaded vessel's
            // orbit evolves underneath it. That is right for a craft that goes
            // dark mid-flight, and wrong for the case that actually dominates:
            // loading a save, where every already-silent vessel arms on the
            // first tick, which is the one moment CommNet has not been built
            // and no geometry can be had. Every vessel in a 24-craft save then
            // holds an orbital-period deadline for its entire run, and the
            // predictor looks broken when it was simply never asked again.
            //
            // Upgrading only from a non-predicting basis, and only once, keeps
            // the no-jitter property where it matters: a prediction, once made,
            // is never revised.
            if (!s.DeadlineUpgraded && !HasPrediction(s.DeadlineBasis))
            {
                var origin = s.SilenceSinceUt ?? ut;
                var upgraded = _policy(sample, origin);

                // Spend the retry when the policy ANSWERED, not merely when it
                // predicted. The four predictor bases are answers - including
                // the ones that decline to predict - and re-asking costs a full
                // ~1400-sample sweep every tick, which at warp is the stutter
                // the sliced-solver design exists to avoid.
                //
                // A fallback basis means the policy could not attempt at all
                // (no geometry yet), which is transient and cheap: the factory
                // returns before any sweep. Spending the one retry on it burned
                // the attempt at the worst possible moment - the tick right
                // after a save load, when CommNet has not been built - and left
                // every vessel holding an orbital-period deadline for the rest
                // of its run.
                if (IsPredictorBasis(upgraded.Basis))
                {
                    s.DeadlineUpgraded = true;

                    // Record the VERDICT, not just a prediction. The three
                    // non-predicting bases are answers - "nothing is in the way",
                    // "still behind something", "too fast to resolve" - and
                    // leaving them unwritten meant the wire kept reporting the
                    // armed orbital-period basis forever, so a working sweep and
                    // a sweep that never ran looked identical to every consumer.
                    // That is precisely what made this feature look dead while
                    // the geometry underneath it was fine.
                    //
                    // The DEADLINE is deliberately not touched here: those bases
                    // carry the fallback duration unchanged, which is the whole
                    // point of no-occultation not shortening anything.
                    s.DeadlineBasis = upgraded.Basis;
                }
                if (upgraded.PredictedReacquisitionUt.HasValue)
                {
                    // NEVER earlier. The upgrade is evaluated from the silence
                    // ORIGIN, so its duration is measured from a UT that may be
                    // hours in the past; writing that over the armed deadline
                    // moved the deadline BACKWARDS, and in the worst case behind
                    // the current tick, declaring the vessel Lost in the very
                    // call that first managed to predict its return.
                    //
                    // A prediction is allowed to explain a silence and to push
                    // the deadline out. It is never allowed to shorten a
                    // vessel's remaining life.
                    var candidate = origin + upgraded.DurationSec;
                    if (s.DeadlineUt.HasValue && candidate < s.DeadlineUt.Value)
                    {
                        candidate = s.DeadlineUt.Value;
                    }

                    s.DeadlineUt = candidate;
                    s.DeadlineBasis = upgraded.Basis;
                    s.PredictedReacquisitionUt = upgraded.PredictedReacquisitionUt;
                }
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

        private static bool HasPrediction(string? basis) =>
            basis == SilenceDeadlineBasis.PredictedReacquisition;

        /// <summary>
        /// Whether the deadline policy actually reached a verdict about the
        /// geometry, as opposed to falling back because it could not look.
        /// </summary>
        private static bool IsPredictorBasis(string? basis) =>
            basis == SilenceDeadlineBasis.PredictedReacquisition
            || basis == SilenceDeadlineBasis.NoOccultation
            || basis == SilenceDeadlineBasis.NoEmergenceInWindow
            || basis == SilenceDeadlineBasis.WarpLimited;

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
            s.PredictedReacquisitionUt = null;
            s.ConsecutiveSilentSamples = 0;
            return s;
        }
    }
}
