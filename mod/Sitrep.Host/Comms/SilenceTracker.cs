using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Propagation;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>State machine phase for a vessel's comms silence.</summary>
    public enum SilenceState
    {
        /// <summary>Contact confirmed as of the most recent sample.</summary>
        Nominal,
        /// <summary>No contact observed since the last contact.</summary>
        Silent,
        /// <summary>No longer in the game: destroyed, recovered or otherwise removed.</summary>
        Gone,
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
        /// offers no explanation for this silence and predicts no emergence.
        ///
        /// <para>This means "there is no countdown to show", and it must never
        /// be read as "declare fast". The naive treatment, no occultation, so
        /// nothing to wait for, fall to the floor, declares an LKO vessel lost
        /// ten minutes after any blip, and under this save's relay ring an LKO
        /// craft is geometrically blind 0.0% of the time, so that is every LKO
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

        /// <summary>
        /// The sweep found an emergence, but the error budget around it (sweep
        /// resolution, the gap between observations, the wait for a link to
        /// close) came out wider than any deadline worth declaring a vessel
        /// lost against. Truncating that budget to the ceiling and declaring
        /// anyway would publish a number nothing in the sum supports, so the
        /// prediction is withheld exactly as
        /// <see cref="NoOccultation"/> and <see cref="WarpLimited"/> are.
        ///
        /// <para>Distinct from <see cref="WarpLimited"/>, which is the sweep
        /// declining to look at all. Here the sweep ran and answered; it is the
        /// answer's precision that is not good enough.</para>
        /// </summary>
        public const string GraceExceedsCeiling = "grace-exceeds-ceiling";

        /// <summary>
        /// The sweep could only be run as far as the elected propagation
        /// capability vouches for this craft's trajectory, and found no
        /// emergence inside that. Same treatment as
        /// <see cref="NoOccultation"/>: orbital-period deadline, no prediction.
        ///
        /// <para>Distinct from <see cref="NoEmergenceInWindow"/>, and the
        /// distinction is the whole point. That one says the craft is behind
        /// something for at least the span the policy wanted to search, which
        /// under an integrating provider would be a claim about arc nobody
        /// vouched for. This one says the search itself was cut short, so
        /// nothing at all is being asserted about the part that was not
        /// reached.</para>
        ///
        /// <para>Never reached under the two-body vanilla, which bounds
        /// nothing: there the sweep always gets the window it asked for.</para>
        /// </summary>
        public const string HorizonLimited = "horizon-limited";
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
        /// is a prediction withheld, never a prediction of "now".
        /// </summary>
        public readonly double? PredictedReacquisitionUt;

        /// <summary>
        /// The error budget the deadline was armed with, seconds: how long after
        /// the predicted return the craft can stay quiet before the silence is
        /// something other than a late reappearance.
        ///
        /// <para>Reported rather than only spent, because it is the only thing
        /// that says how much confidence to place in the prediction beside it:
        /// "back in 15 min" and "back in 15 min, and we would not call it late
        /// for another 5" are different operational statements. Null wherever
        /// <see cref="PredictedReacquisitionUt"/> is: a budget quoted next to a
        /// withheld prediction is an error bar around nothing.</para>
        ///
        /// <para>One-sided, and not a symmetric uncertainty. It is an allowance
        /// after the predicted moment, so a client renders "allowing 5 min of
        /// slack" and never "+/- 5 min". A real two-sided error bar would have
        /// to come out of the sweep itself, which is separate and larger
        /// work.</para>
        /// </summary>
        public readonly double? PredictionGraceSec;

        public SilenceDeadline(
            double durationSec,
            string basis,
            double? predictedReacquisitionUt = null,
            double? predictionGraceSec = null)
        {
            DurationSec = durationSec;
            Basis = basis;
            PredictedReacquisitionUt = predictedReacquisitionUt;
            PredictionGraceSec = predictionGraceSec;
        }
    }

    /// <summary>
    /// The pluggable deadline seam: "we are still designing a better
    /// predictor; the seam is the point." Given
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
    /// One vessel's silence bookkeeping. Mutated in place tick over
    /// tick, and carries only primitives, so it round-trips through
    /// ConfigNode cleanly on the Gonogo.KSP side without this type ever
    /// needing to know ConfigNode exists.
    /// </summary>
    public sealed class VesselContactState
    {
        public string VesselId = string.Empty;

        /// <summary>Whether the vessel is gone from the game.</summary>
        public bool IsDestroyed => State == SilenceState.Gone;

        public SilenceState State = SilenceState.Nominal;

        /// <summary>Whether contact was observed on the most recent sample.</summary>
        public bool Connected;

        /// <summary>UT of the last sample that observed contact. Null before the first-ever contact.</summary>
        public double? LastContactUt;

        /// <summary>UT the current silence run began. Null while Nominal.</summary>
        public double? SilenceSinceUt;

        /// <summary>UT past which the ground stops expecting this silence to end: the deadline the craft's forecast carries home. Null while Nominal, or for a destroyed vessel.</summary>
        public double? DeadlineUt;

        /// <summary>One of <see cref="SilenceDeadlineBasis"/>. Null while Nominal.</summary>
        public string? DeadlineBasis;

        /// <summary>
        /// UT the path is predicted to re-open, when the policy found one.
        /// Null while Nominal, and null during a silence the geometry cannot
        /// explain: see <see cref="SilenceDeadlineBasis.NoOccultation"/>.
        /// </summary>
        public double? PredictedReacquisitionUt;

        /// <summary>
        /// The error budget behind <see cref="DeadlineUt"/>, seconds: how long
        /// past the predicted return a craft may stay quiet before its silence
        /// is something other than a late reappearance. Null whenever
        /// <see cref="PredictedReacquisitionUt"/> is; see
        /// <see cref="SilenceDeadline.PredictionGraceSec"/> for why it is
        /// one-sided.
        /// </summary>
        public double? PredictionGraceSec;

        /// <summary>
        /// Whether this silence run has already spent its one deadline
        /// re-evaluation. Deliberately not persisted: a reload grants one more
        /// attempt, which biases toward eventually getting a prediction rather
        /// than toward never trying again.
        /// </summary>
        internal bool DeadlineUpgraded;

        /// <summary>
        /// Whether the absence of this vessel has already been handed to the caller of
        /// <see cref="SilenceTracker.Tick"/>. Not persisted: a reload reports each
        /// destroyed vessel once more, so the new session has a value for it, and a
        /// vessel that reappears is reported again if it is destroyed again.
        /// </summary>
        internal bool DestroyedReported;
    }

    /// <summary>
    /// Pure, KSP-free "is this vessel out of contact, and when is it expected
    /// back" state machine, decoupled from any currency concern.
    /// Modeled on <c>LandingPredictor</c>'s discipline (no KSP/Unity types,
    /// every input injected, fully unit-testable) but genuinely stateful:
    /// silence has to survive from one capture tick to the next, which a
    /// static pure function cannot do on its own.
    ///
    /// <para>A single connected sample clears a vessel back to
    /// <see cref="SilenceState.Nominal"/>. Whether a silent craft is lost is
    /// not decided here: the ground judges that from the forecast this
    /// tracker's deadline feeds.</para>
    ///
    /// <para><b>Destroyed vessels never go through the deadline policy.</b>
    /// <see cref="Tick"/> reconciles its own known-vessel set against the ids
    /// present this capture: anything previously tracked but missing this
    /// tick is gone from <c>FlightGlobals.Vessels</c> and is marked
    /// <see cref="SilenceState.Gone"/> immediately,
    /// <c>deadlineBasis = destroyed</c>, no deadline, no further
    /// propagation.</para>
    /// </summary>
    public sealed class SilenceTracker
    {
        private readonly SilenceDeadlinePolicy _policy;
        private readonly Dictionary<string, VesselContactState> _states = new Dictionary<string, VesselContactState>(StringComparer.Ordinal);

        public SilenceTracker(SilenceDeadlinePolicy policy)
        {
            _policy = policy ?? throw new ArgumentNullException(nameof(policy));
        }

        /// <summary>Read-only view of every vessel this tracker currently knows about.</summary>
        public IReadOnlyDictionary<string, VesselContactState> States => _states;

        /// <summary>
        /// The states of vessels still in the game: <see cref="States"/> without the ones
        /// that are gone. A destroyed vessel keeps its record
        /// for good, so a view that must scale with the fleet reads this one.
        /// </summary>
        public IEnumerable<VesselContactState> LiveStates =>
            _states.Values.Where(s => !s.IsDestroyed);

        public VesselContactState? TryGetState(string vesselId) =>
            !string.IsNullOrEmpty(vesselId) && _states.TryGetValue(vesselId, out var s) ? s : null;

        /// <summary>
        /// Restores a previously-persisted record (see the Gonogo.KSP-side
        /// ConfigNode round-trip). Replaces any live in-memory record for the
        /// same vessel id.
        /// </summary>
        public void RestoreState(VesselContactState state)
        {
            if (state == null || string.IsNullOrEmpty(state.VesselId))
            {
                return;
            }
            _states[state.VesselId] = state;
        }

        /// <summary>
        /// Advances every vessel present this capture tick, then marks
        /// <see cref="SilenceState.Gone"/> (basis <c>destroyed</c>) any vessel this tracker previously
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
                if (kv.Value.DestroyedReported)
                {
                    continue;
                }
                kv.Value.DestroyedReported = true;
                touched.Add(MarkDestroyed(kv.Value));
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
            s.DestroyedReported = false;

            if (sample.Connected)
            {
                // ONE connected sample clears instantly, from any prior state.
                s.LastContactUt = ut;
                s.State = SilenceState.Nominal;
                s.SilenceSinceUt = null;
                s.DeadlineUt = null;
                s.DeadlineBasis = null;
                s.PredictedReacquisitionUt = null;
                s.PredictionGraceSec = null;
                return s;
            }

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
                s.PredictionGraceSec = deadline.PredictionGraceSec;
                s.DeadlineUpgraded = false;
                return s;
            }

            if (s.State == SilenceState.Gone)
            {
                // Stays gone until a connected sample clears it above.
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
                // predicted. Every predictor basis is an answer - including
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
                    // would move the deadline backwards, in the worst case behind
                    // the current tick.
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
                    s.PredictionGraceSec = upgraded.PredictionGraceSec;
                }
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
            || basis == SilenceDeadlineBasis.WarpLimited
            || basis == SilenceDeadlineBasis.GraceExceedsCeiling
            || basis == SilenceDeadlineBasis.HorizonLimited;

        private static VesselContactState MarkDestroyed(VesselContactState s)
        {
            s.Connected = false;
            s.State = SilenceState.Gone;
            s.DeadlineUt = null;
            s.DeadlineBasis = SilenceDeadlineBasis.Destroyed;
            s.PredictedReacquisitionUt = null;
            return s;
        }
    }
}
