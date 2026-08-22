using System;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// What one attempted plan write did, before anything turns it into a wire
    /// payload.
    ///
    /// <para><see cref="Outcome"/>'s default is
    /// <see cref="PrincipiaWriteOutcome.Refused"/> and
    /// <see cref="Refusal"/>'s is <see cref="PrincipiaWriteRefusal.SurfaceUnavailable"/>,
    /// so a value nobody filled in reads as "we did not touch the plan". That is the
    /// safe direction, and it is the opposite of the mistake this mod has already
    /// shipped once, where an unset refusal read as "nothing was refused" and a
    /// feature that never ran looked exactly like one that had nothing to say.</para>
    /// </summary>
    public readonly struct PrincipiaWriteResult
    {
        private PrincipiaWriteResult(
            PrincipiaWriteOutcome outcome,
            PrincipiaWriteRefusal refusal,
            string? detail,
            int? statusError,
            string? statusMessage)
        {
            Outcome = outcome;
            Refusal = refusal;
            Detail = detail;
            StatusError = statusError;
            StatusMessage = statusMessage;
        }

        public PrincipiaWriteOutcome Outcome { get; }

        public PrincipiaWriteRefusal Refusal { get; }

        /// <summary>The refusal in a sentence, with the numbers behind it.</summary>
        public string? Detail { get; }

        /// <summary>The producer's own status code: zero when it accepted, null
        /// when we never called or when the entry point reports nothing.</summary>
        public int? StatusError { get; }

        public string? StatusMessage { get; }

        public static PrincipiaWriteResult Refused(PrincipiaWriteRefusal refusal, string detail) =>
            new PrincipiaWriteResult(
                PrincipiaWriteOutcome.Refused, refusal, detail, null, null);

        /// <summary>A write the producer accepted. Entry points that report nothing
        /// land here with no status, which is why the receipt carries a re-read of
        /// the plan rather than this value alone.</summary>
        public static PrincipiaWriteResult Written(int? statusError = null) =>
            new PrincipiaWriteResult(
                PrincipiaWriteOutcome.Written,
                PrincipiaWriteRefusal.NotRefused,
                null,
                statusError,
                null);

        /// <summary>A write the producer declined, with its own code and words.</summary>
        public static PrincipiaWriteResult Rejected(int statusError, string? message) =>
            new PrincipiaWriteResult(
                PrincipiaWriteOutcome.Rejected,
                PrincipiaWriteRefusal.NotRefused,
                null,
                statusError,
                message);
    }

    /// <summary>
    /// A flight plan that has been MATERIALISED in this frame, which is a stronger
    /// fact than existing.
    ///
    /// <para>A plan loaded from a save is held as a serialised message until
    /// something forces it open, and exactly one exported call does that. Until it
    /// has happened, one read on this surface reaches into a variant holding the
    /// other alternative and throws a C++ exception across the native boundary,
    /// where there is nothing to catch it. The producer's own window never hits it
    /// because it reads a plan field first, every frame, by luck of ordering. This
    /// type is that ordering made into a type: you cannot ask whether an
    /// optimisation is running, and you cannot write, without having gone through
    /// it.</para>
    /// </summary>
    public readonly struct PrincipiaMaterialisedPlanGate
    {
        private readonly PrincipiaSession? _session;
        private readonly int _generation;
        private readonly string _guid;

        internal PrincipiaMaterialisedPlanGate(
            PrincipiaSession session, int generation, string guid, double desiredFinalTimeUt)
        {
            _session = session;
            _generation = generation;
            _guid = guid;
            DesiredFinalTimeUt = desiredFinalTimeUt;
        }

        /// <summary>The plan's end instant, read as the act of materialising it, so
        /// nothing has to read it twice.</summary>
        public double DesiredFinalTimeUt { get; }

        /// <summary>
        /// Which burn the producer's optimiser is working on, or -1 when none is.
        ///
        /// <para>Not informational. A write made while this is not -1 is discarded:
        /// the optimiser publishes a fresh candidate plan and the producer's own
        /// planner window swaps it over the live plan every frame, so the edit is
        /// gone with nothing reported anywhere.</para>
        /// </summary>
        public int OptimisationManoeuvreIndex()
        {
            var handle = PrincipiaGateCheck.Enter(
                _session, _generation, "a plan's optimisation state");
            return _session!.Plugin.FlightPlanOptimizationDriverInProgress(handle, _guid);
        }

        /// <summary>
        /// Hands back the write gate, or the refusal that stopped it.
        ///
        /// <para>The optimiser check is here rather than inside each write, because
        /// it is the one refusal that is about the plan's situation rather than about
        /// the edit, and because a caller that has already asked should not pay for
        /// the call twice.</para>
        /// </summary>
        public bool TryWrite(
            out PrincipiaPlanWriteGate gate,
            out PrincipiaWriteRefusal refusal,
            out string detail)
        {
            gate = default;
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "a plan write");
            if (!_session!.Writes.TryPermit(_guid, out refusal, out detail))
            {
                return false;
            }

            var optimising = _session.Plugin.FlightPlanOptimizationDriverInProgress(handle, _guid);
            if (optimising >= 0)
            {
                refusal = PrincipiaWriteRefusal.OptimisationRunning;
                detail =
                    "Principia is optimising burn " + (optimising + 1) + " of this plan. An edit "
                    + "made now is reverted without being reported: the optimiser publishes a new "
                    + "candidate plan and Principia's own planner swaps it over the live one every "
                    + "frame. Stop the optimisation in-game first.";
                return false;
            }

            gate = new PrincipiaPlanWriteGate(_session, _generation, _guid);
            refusal = PrincipiaWriteRefusal.NotRefused;
            detail = string.Empty;
            return true;
        }

        /// <summary>
        /// The arming path's own gate, which skips the arm check and nothing else.
        ///
        /// <para>Arming runs the struct round-trip probes, and a probe is a real
        /// write: it is the only way to establish that the burn the plugin hands
        /// back is the burn it takes, which cannot be established by reading and is
        /// the single largest unverified risk in the whole write surface. So the
        /// probe cannot require the arm that it is the precondition of. Everything
        /// else still applies: the version gate, the bind, the optimiser check, the
        /// frame whitelist, the index bound.</para>
        /// </summary>
        internal bool TryProbe(
            out PrincipiaPlanWriteGate gate,
            out PrincipiaWriteRefusal refusal,
            out string detail)
        {
            gate = default;
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "a plan layout probe");
            var unavailable = _session!.Writes.UnavailableReason;
            if (unavailable != null)
            {
                refusal = PrincipiaWriteRefusal.SurfaceUnavailable;
                detail = unavailable;
                return false;
            }

            var optimising = _session.Plugin.FlightPlanOptimizationDriverInProgress(handle, _guid);
            if (optimising >= 0)
            {
                refusal = PrincipiaWriteRefusal.OptimisationRunning;
                detail =
                    "Principia is optimising this plan, so the round-trip probe would be reverted "
                    + "and could not prove anything. Stop the optimisation in-game first.";
                return false;
            }

            gate = new PrincipiaPlanWriteGate(_session, _generation, _guid);
            refusal = PrincipiaWriteRefusal.NotRefused;
            detail = string.Empty;
            return true;
        }
    }

    /// <summary>
    /// The eight writes this Uplink will make to an existing flight plan, each
    /// bounding its own index against a count read in this same frame.
    ///
    /// <para><b>The gate reads the bound itself rather than accepting one.</b> The
    /// read side's rule is that a caller never holds an index, which works because a
    /// reader is iterating. A writer cannot work that way: the operator names the
    /// burn. So the bound is captured HERE, inside the same call that uses it, which
    /// is the strongest form available: an index that was valid last tick and is not
    /// valid now is refused rather than passed to a call that aborts on it.</para>
    ///
    /// <para><b>Insert and Replace differ by one and it is deliberate.</b> Insert
    /// accepts an index equal to the count, which appends. Replace aborts on it.
    /// They are separate methods with separate bounds for the same reason the read
    /// side keeps two cursors: two nearly identical calls with different limits is
    /// what gets copy-pasted wrong.</para>
    /// </summary>
    public readonly struct PrincipiaPlanWriteGate
    {
        /// <summary>The producer's own cap, and the only thing enforcing it.
        /// Nothing native limits the plan count, and the producer's window names
        /// its plans from a ten-character string, so an eleventh plan makes that
        /// window throw on every layout pass, permanently, with the button that
        /// would delete it inside the part that stopped rendering.</summary>
        public const int MaxFlightPlans = 10;

        /// <summary>The step-count range the producer's own stepper offers.</summary>
        public const double MinMaxSteps = 64;
        public const double MaxMaxSteps = 1048576;

        /// <summary>The tolerance range the producer's own controls offer, in
        /// metres and metres per second.</summary>
        public const double MinTolerance = 1e-6;
        public const double MaxTolerance = 1e6;

        /// <summary>The only integrator kind the plan's own equation accepts.
        /// Anything else is a bare abort with no message, because the read that
        /// decodes it dispatches on the equation type and the other arms of that
        /// dispatch simply give up.</summary>
        public const int RequiredIntegratorKind = 1;

        /// <summary>The two kinds the GENERALIZED equation accepts, a disjoint set
        /// from <see cref="RequiredIntegratorKind"/>. Swapping the two fields is the
        /// single most likely mistake in a hand-written struct and the least
        /// diagnosable.</summary>
        public static readonly int[] AllowedGeneralizedIntegratorKinds = { 2, 4 };

        private readonly PrincipiaSession? _session;
        private readonly int _generation;
        private readonly string _guid;

        internal PrincipiaPlanWriteGate(PrincipiaSession session, int generation, string guid)
        {
            _session = session;
            _generation = generation;
            _guid = guid;
        }

        /// <summary>How many burns the plan holds right now.</summary>
        public int ManoeuvreCount()
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "a plan's manoeuvre count");
            return _session!.Plugin.FlightPlanNumberOfManoeuvres(handle, _guid);
        }

        /// <summary>The burn at <paramref name="index"/>, as the producer's own
        /// struct, or null when the index is out of the count read right now.</summary>
        public object? Manoeuvre(int index)
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "a manoeuvre");
            var count = _session!.Plugin.FlightPlanNumberOfManoeuvres(handle, _guid);
            if (index < 0 || index >= count)
            {
                return null;
            }
            return _session.Plugin.FlightPlanGetManoeuvre(handle, _guid, index);
        }

        /// <summary>The plan's step parameters, as the producer's own struct, for
        /// mutating and handing straight back.</summary>
        public object? AdaptiveStepParameters()
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "a plan's step parameters");
            return _session!.Plugin.FlightPlanGetAdaptiveStepParameters(handle, _guid);
        }

        public PrincipiaWriteResult Replace(int index, object burn)
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "replacing a manoeuvre");
            var count = _session!.Plugin.FlightPlanNumberOfManoeuvres(handle, _guid);
            if (index < 0 || index >= count)
            {
                return OutOfRange(index, count, "0 to " + (count - 1));
            }
            var invalid = PrincipiaBurnRules.Reject(burn);
            if (invalid.HasValue)
            {
                return invalid.Value;
            }
            return Status(_session.Plugin.FlightPlanReplace(handle, _guid, burn, index));
        }

        public PrincipiaWriteResult Insert(int index, object burn)
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "inserting a manoeuvre");
            var count = _session!.Plugin.FlightPlanNumberOfManoeuvres(handle, _guid);
            if (index < 0 || index > count)
            {
                return OutOfRange(index, count, "0 to " + count);
            }
            var invalid = PrincipiaBurnRules.Reject(burn);
            if (invalid.HasValue)
            {
                return invalid.Value;
            }
            return Status(_session.Plugin.FlightPlanInsert(handle, _guid, burn, index));
        }

        public PrincipiaWriteResult Remove(int index)
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "removing a manoeuvre");
            var count = _session!.Plugin.FlightPlanNumberOfManoeuvres(handle, _guid);
            if (index < 0 || index >= count)
            {
                return OutOfRange(index, count, "0 to " + (count - 1));
            }
            return Status(_session.Plugin.FlightPlanRemove(handle, _guid, index));
        }

        public PrincipiaWriteResult SetDesiredFinalTime(double finalTimeUt)
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "a plan's end instant");
            if (double.IsNaN(finalTimeUt) || double.IsInfinity(finalTimeUt))
            {
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.ValueNotFinite,
                    "A plan cannot be asked to end at an instant that is not a finite number. An "
                    + "infinite end instant is accepted by Principia, spawns a thread that never "
                    + "terminates, and is written into the save.");
            }
            return Status(_session!.Plugin.FlightPlanSetDesiredFinalTime(handle, _guid, finalTimeUt));
        }

        /// <summary>
        /// Writes back a step-parameter struct that came out of
        /// <see cref="AdaptiveStepParameters"/>, having checked the two integrator
        /// kinds are the pair this build expects and the three numbers are inside
        /// the producer's own ranges.
        ///
        /// <para>The kind check is cheap and catches the one thing that cannot be
        /// diagnosed after the fact: a shape change that moved the two kind fields
        /// past each other is an abort with no message and no log line, and it looks
        /// identical at runtime to several unrelated failures.</para>
        /// </summary>
        public PrincipiaWriteResult SetAdaptiveStepParameters(object parameters)
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "a plan's step parameters");
            var invalid = PrincipiaIntegratorRules.Reject(parameters);
            if (invalid.HasValue)
            {
                return invalid.Value;
            }
            return Status(
                _session!.Plugin.FlightPlanSetAdaptiveStepParameters(handle, _guid, parameters));
        }

        /// <summary>
        /// Deletes the selected plan, having asked ONE MORE TIME whether it exists.
        ///
        /// <para><b>This re-check is the whole guard, and the producer's own header
        /// comment is what makes it necessary.</b> That comment promises the call
        /// performs no action unless a plan exists. The body contains no such test:
        /// with no plan the selected index is still minus one, and it erases an
        /// iterator one before the beginning of the vector. That is undefined
        /// behaviour, not a diagnosed abort, so there is no crash to read and no log
        /// line to find. Every sibling operation gets a clean assertion for free by
        /// reaching the selected plan; this one never touches it.</para>
        ///
        /// <para>The gate this method hangs off already proves a plan existed this
        /// frame. Asking again costs one call and closes the window between that
        /// proof and this line, which is the window a header comment cannot be
        /// trusted to have closed.</para>
        /// </summary>
        public PrincipiaWriteResult Delete()
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "deleting a plan");
            if (!_session!.Plugin.FlightPlanExists(handle, _guid))
            {
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.NoFlightPlan,
                    "The vessel has no flight plan to delete. Principia's delete entry point is "
                    + "documented as doing nothing in that case and in fact erases past the "
                    + "beginning of its own vector, which is silent corruption rather than a "
                    + "crash.");
            }
            _session.Plugin.FlightPlanDelete(handle, _guid);
            return PrincipiaWriteResult.Written();
        }

        /// <summary>
        /// Copies the selected plan, refusing at the producer's ten-plan cap.
        /// </summary>
        public PrincipiaWriteResult Duplicate()
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "duplicating a plan");
            var count = _session!.Plugin.FlightPlanCount(handle, _guid);
            if (count >= MaxFlightPlans)
            {
                return AtPlanCap(count);
            }
            _session.Plugin.FlightPlanDuplicate(handle, _guid);
            return PrincipiaWriteResult.Written();
        }

        private static PrincipiaWriteResult AtPlanCap(int count) =>
            PrincipiaWriteResult.Refused(
                PrincipiaWriteRefusal.PlanSlotsFull,
                "The vessel already holds " + count + " flight plans, which is Principia's "
                + "maximum of " + MaxFlightPlans + ". An eleventh makes Principia's own flight "
                + "planner throw on every layout pass, for as long as the window is open, and the "
                + "button that would delete it is inside the part that stopped drawing.");

        private static PrincipiaWriteResult OutOfRange(int index, int count, string range) =>
            PrincipiaWriteResult.Refused(
                PrincipiaWriteRefusal.BurnIndexOutOfRange,
                "Burn " + (index + 1) + " is not in this plan, which holds " + count
                + ". Valid indices right now are " + range
                + ". The plan may have changed since the console last read it.");

        /// <summary>
        /// Turns the producer's status object into a result.
        ///
        /// <para>A null status is a write that REPORTED nothing rather than a write
        /// that failed: three of the eight entry points return void, and the honest
        /// answer for those is "we called it, go and look", which is why the receipt
        /// carries a fresh reading of the plan.</para>
        /// </summary>
        private PrincipiaWriteResult Status(object? status)
        {
            if (status == null)
            {
                return PrincipiaWriteResult.Written();
            }
            var error = PrincipiaStatus.Error(status);
            if (error == null)
            {
                return PrincipiaWriteResult.Written();
            }
            if (error.Value == 0)
            {
                return PrincipiaWriteResult.Written(0);
            }
            return PrincipiaWriteResult.Rejected(error.Value, PrincipiaStatus.Message(status));
        }
    }

    /// <summary>
    /// Creating a plan, which is the one write that needs a vessel and NOT a plan.
    ///
    /// <para>Separate from <see cref="PrincipiaPlanWriteGate"/> because its
    /// precondition is the negation of that type's: creating appends and selects a
    /// new plan rather than replacing the existing one, so running it when a plan is
    /// already there gives the vessel a second plan nobody asked for.</para>
    /// </summary>
    public readonly struct PrincipiaPlanCreateGate
    {
        private readonly PrincipiaSession? _session;
        private readonly int _generation;
        private readonly string _guid;

        internal PrincipiaPlanCreateGate(PrincipiaSession session, int generation, string guid)
        {
            _session = session;
            _generation = generation;
            _guid = guid;
        }

        /// <summary>
        /// Creates a plan ending at <paramref name="finalTimeUt"/> from a vessel mass
        /// of <paramref name="massTons"/>.
        ///
        /// <para>The end instant is checked against the plugin's own clock because
        /// the producer asserts on it: a plan ending before it starts is an assertion
        /// failure that takes the game down, not an error return. Equality is
        /// allowed, and the producer's own window always asks for an hour.</para>
        /// </summary>
        public PrincipiaWriteResult Create(double finalTimeUt, double massTons)
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "creating a plan");

            if (_session!.Plugin.FlightPlanExists(handle, _guid))
            {
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.PlanAlreadyExists,
                    "The vessel already has a flight plan. Creating another appends a second plan "
                    + "and selects it rather than replacing the first, so this is refused as an "
                    + "edit made by accident.");
            }

            var count = _session.Plugin.FlightPlanCount(handle, _guid);
            if (count >= PrincipiaPlanWriteGate.MaxFlightPlans)
            {
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.PlanSlotsFull,
                    "The vessel already holds " + count + " flight plans, Principia's maximum.");
            }

            if (double.IsNaN(finalTimeUt) || double.IsInfinity(finalTimeUt)
                || double.IsNaN(massTons) || double.IsInfinity(massTons))
            {
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.ValueNotFinite,
                    "A plan cannot be created from an end instant or a mass that is not a finite "
                    + "number.");
            }

            if (massTons <= 0)
            {
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.ValueNotFinite,
                    "A plan cannot be created from a mass of " + massTons + " tonnes. Principia "
                    + "accepts it and every burn duration in the plan is then poisoned by it.");
            }

            var now = _session.Plugin.CurrentTime(handle);
            if (finalTimeUt < now)
            {
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.FinalTimeInPast,
                    "A plan cannot be created ending before it starts. Principia asserts on that "
                    + "rather than returning an error, which ends the game.");
            }

            _session.Plugin.FlightPlanCreate(handle, _guid, finalTimeUt, massTons);
            return PrincipiaWriteResult.Written();
        }
    }

    /// <summary>
    /// The producer's status object, decoded by field.
    ///
    /// <para>Both members are plain public fields on the producer's own type, so no
    /// getter runs and none of the fatal-log risk that made the read side's property
    /// allowlist necessary applies here.</para>
    /// </summary>
    internal static class PrincipiaStatus
    {
        private static readonly ReflectedMembers Members = new ReflectedMembers();

        internal static int? Error(object status) => Members.ReadInt(status, "error");

        internal static string? Message(object status) => Members.ReadString(status, "message");
    }
}
