using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// The flight-plan write commands: one frame each, no yield inside it, and a
    /// re-read of the plan on the way out.
    ///
    /// <para><b>Every handler has the same five-step shape and the order is
    /// load-bearing.</b> Prove the vessel; prove the plan; materialise it; take the
    /// write gate, which is where the version, the arm and the optimiser are
    /// checked; write; re-read. Nothing between the first and last step may yield,
    /// await or hop threads, because every one of those steps is a statement about
    /// the plugin's state at the instant it was made and the only thing keeping the
    /// statements true is that nothing else ran in between.</para>
    ///
    /// <para><b>Why a request id and not a fresh id per attempt.</b> A plan write
    /// re-integrates the plan synchronously on the game's own thread, so repeating
    /// one is expensive as well as wrong. A retry that reuses its id gets the
    /// previous receipt back, marked as a replay, and the plugin is not touched
    /// again. That is what makes a retry safe to send, which is what makes the
    /// timeout on the other side of the wire safe to have.</para>
    ///
    /// <para>The whole class is game-free: it reads its session out of the settings
    /// source, which is the same seam the settings channel uses, so every decision
    /// here is drivable against a fake plugin with nothing hand-set.</para>
    /// </summary>
    public sealed class PlanCommands
    {
        /// <summary>How many receipts to remember for replay. Small deliberately: a
        /// console has one operator and a handful of live intents, and a cache that
        /// remembers forever would answer a reused id from an hour ago.</summary>
        internal const int ReceiptMemory = 16;

        public const string ArmCommand = "principia.plan.arm";
        public const string ReplaceBurnCommand = "principia.plan.burn.replace";
        public const string InsertBurnCommand = "principia.plan.burn.insert";
        public const string RemoveBurnCommand = "principia.plan.burn.remove";
        public const string HorizonCommand = "principia.plan.horizon";
        public const string IntegratorCommand = "principia.plan.integrator";
        public const string CreateCommand = "principia.plan.create";
        public const string DeleteCommand = "principia.plan.delete";
        public const string SendCommand = "principia.plan.send";
        public const string DuplicateCommand = "principia.plan.duplicate";

        private static readonly PrincipiaBurnStruct Fields = new PrincipiaBurnStruct();

        private readonly Func<ISettingsSource?> _source;
        private readonly Func<SettingsObservation?> _observation;
        private readonly PrincipiaBurnComposer _composer = new PrincipiaBurnComposer(Fields);
        private readonly PlanReader _reader = new PlanReader();
        private readonly Dictionary<string, Dictionary<string, object?>> _receipts =
            new Dictionary<string, Dictionary<string, object?>>();
        private readonly List<string> _receiptOrder = new List<string>();

        /// <param name="observation">The last settings reading, which is where the
        /// frame a composed burn is expressed in comes from. A separate seam from
        /// <paramref name="source"/> because it is a SAMPLE rather than a live
        /// object: turning the producer's selector into a frame is the settings
        /// channel's work, and doing it again here would be a second reading that
        /// could disagree with the one on the wire.</param>
        public PlanCommands(
            Func<ISettingsSource?> source, Func<SettingsObservation?> observation)
        {
            _source = source;
            _observation = observation;
        }

        /// <summary>
        /// The thread every write must run on, captured where the host promises to
        /// call us on it.
        ///
        /// <para><b>Why this is checked rather than assumed.</b> Principia's own
        /// comment on the members a plan write touches is "these members are only
        /// accessed by the main thread", and a write destroys trajectory segments a
        /// live renderer may be walking. The host does put command handlers on the
        /// main thread, but only when it was built to: the flag defaults to off for
        /// headless callers, and a host built the other way would run every one of
        /// these off-thread with nothing anywhere saying so. An assumption that
        /// cannot express its own violation is the shape of defect this repo keeps
        /// finding, so it is a comparison instead.</para>
        /// </summary>
        internal int? MainThreadId { get; private set; }

        /// <summary>Records the thread the host registered us on. Called from
        /// <c>Register</c>, which the host documents as main-thread.</summary>
        internal void BindToCallingThread()
        {
            MainThreadId = System.Threading.Thread.CurrentThread.ManagedThreadId;
        }

        /// <summary>Why this write must not run here, or null.</summary>
        private PrincipiaWriteResult? WrongThread()
        {
            var main = MainThreadId;
            if (main == null
                || main.Value == System.Threading.Thread.CurrentThread.ManagedThreadId)
            {
                return null;
            }
            return PrincipiaWriteResult.Refused(
                PrincipiaWriteRefusal.SurfaceUnavailable,
                "A flight-plan write arrived off the game's main thread, so it was refused. "
                + "Principia's plan members are main-thread only and a write destroys trajectory "
                + "segments a renderer may be reading. The host must be built with commands "
                + "executing on the main thread for this surface to be usable.");
        }

        /// <summary>
        /// Runs the struct round-trip probes and, if the burn probe passes, arms the
        /// surface.
        ///
        /// <para>The arm and the probe are the same action on purpose. A probe is a
        /// write, so it cannot be gated on the arm it is the precondition of; and an
        /// arm that did not probe would be a permission granted without the one piece
        /// of evidence that cannot be got by reading.</para>
        /// </summary>
        public CommandResult<Dictionary<string, object?>> Arm(PrincipiaPlanArmArgs? args)
        {
            var vesselId = args?.VesselId;
            var requestId = args?.RequestId;
            if (Replay(ArmCommand, requestId, out var replayed))
            {
                return Ok(replayed!, replay: true);
            }

            var offThread = WrongThread();
            if (offThread.HasValue)
            {
                return Refusal(ArmCommand, requestId, offThread.Value, null);
            }

            var session = Session();
            if (session == null)
            {
                return Refusal(
                    ArmCommand, requestId, NoSession(), null);
            }

            using var frame = Frame(session);
            if (frame == null)
            {
                return Refusal(ArmCommand, requestId, NoPlugin(), null);
            }

            if (!frame.TryVessel(vesselId, out var vessel))
            {
                return Refusal(ArmCommand, requestId, UnknownVessel(vesselId), null);
            }
            var now = frame.CurrentTime();
            if (!vessel.TryFlightPlan(out var plan))
            {
                // Arm anyway, and this is the whole of what made plan creation
                // reachable. Arming needed a plan, creating a plan needed an arm,
                // and creation is the only thing that makes a plan: the three
                // deadlocked, so `principia.plan.create` could never succeed from
                // a client at all. Measured on the rig, both refusals verbatim.
                //
                // Safe because of what this arm can and cannot authorise. The
                // probe skipped here round-trips Principia's BURN struct, and a
                // plan with no burns has none to probe; creation writes no burn
                // struct either, it asks for an empty plan and a final time. Every
                // burn write consults `BurnLayoutVerified` on its own account
                // rather than trusting the arm, so an arm taken without that probe
                // cannot be spent on one.
                session.Writes.Arm(vessel.Guid);
                return Settle(
                    ArmCommand,
                    requestId,
                    PrincipiaWriteResult.Written(),
                    ReadPlan(session, frame, vessel.Guid, now));
            }

            var materialised = plan.Materialise();
            // No burn factory, so arming a plan with no burns writes NOTHING to the
            // producer and the burn verdict stays unproven.
            //
            // WHAT IS NOW MEASURED, replacing the caution that used to stand here.
            // A composed burn HAS crossed into a running plugin: 2026-08-31, on a
            // clean rig, dispatched by `principia.plan.burn.insert` against a V-2
            // holding a plan with no burns. The process did NOT abort. The crossing
            // was refused by the round-trip comparison and reverted cleanly, so what
            // it demonstrated is that the write path is survivable, not that the
            // struct is right. The earlier abort this comment used to cite happened
            // on a rig whose craft had just been teleported out from under a plan
            // anchored somewhere else, and that confound is now resolved: the clean
            // case does not abort.
            //
            // So the reason for not wiring `ComposeProbeBurn` below is no longer
            // fear of an abort. It is that doing so gives the ARM three native
            // write-path calls it does not make today, and an arm is what an operator
            // does to find out whether editing is possible. Moving that risk onto it
            // is a trade for the operator to make rather than a correctness fix.
            //
            // What IS fixed here is the reporting: `burnLayoutVerified` now travels
            // on the write surface, so an arm that verified only the integrator says
            // so instead of answering a plain "armed".
            var probeRefusal = PrincipiaLayoutProbe.Run(materialised, session.Writes);
            if (probeRefusal.HasValue)
            {
                return Refusal(
                    ArmCommand,
                    requestId,
                    probeRefusal.Value,
                    ReadPlan(session, frame, vessel.Guid, now));
            }

            // Armed on the strength of the struct probe that matters for the edits an
            // operator is about to make. The step-parameter probe standing alone is
            // not enough to arm, because the burn edits are what an arm is FOR, but a
            // failed burn probe does not withhold the step-parameter remedy either:
            // both verdicts travel and each write consults the one it needs.
            if (!session.Writes.BurnLayoutVerified && !session.Writes.IntegratorLayoutVerified)
            {
                return Refusal(
                    ArmCommand,
                    requestId,
                    PrincipiaWriteResult.Refused(
                        PrincipiaWriteRefusal.LayoutUnverified,
                        session.Writes.LayoutFailure
                        ?? "Neither of Principia's structs survived a round trip, so nothing here "
                        + "can be written safely."),
                    ReadPlan(session, frame, vessel.Guid, now));
            }

            session.Writes.Arm(vessel.Guid);
            return Settle(
                ArmCommand,
                requestId,
                PrincipiaWriteResult.Written(),
                ReadPlan(session, frame, vessel.Guid, now));
        }

        /// <summary>
        /// The plan as it stands, for the receipt beside a write.
        ///
        /// <para>Named through the same body table the streamed reading uses, so a
        /// receipt's plan carries the frames its burns are quoted in rather than
        /// bare kinds. A receipt that dropped them would leave the editor showing
        /// a burn whose frame it can no longer name, immediately after an edit and
        /// only after one.</para>
        /// </summary>
        private PlanObservation? ReadPlan(
            PrincipiaSession session, PrincipiaFrame frame, string vesselGuid, double now) =>
            _reader.ReadInFrame(session, frame, vesselGuid, now, _source()?.Celestials);

        /// <summary>Tunes one existing burn: time, the Dv triple, the attitude
        /// mode, the propulsion profile, in any combination.</summary>
        public CommandResult<Dictionary<string, object?>> ReplaceBurn(PrincipiaBurnEditArgs? args) =>
            EditBurn(ReplaceBurnCommand, args, insert: false);

        /// <summary>
        /// Adds a burn by COPYING one that is already in the plan and changing the
        /// stated fields.
        ///
        /// <para>There is no way to add a burn from nothing here, and that is the
        /// version-fragility rule rather than a missing feature: the burn struct is
        /// generated from a schema that gained a field and lost one in this release,
        /// so a composed burn is a bet on a layout while a copied one is not. A plan
        /// with no burns is therefore refused rather than served, and the refusal says
        /// why.</para>
        /// </summary>
        public CommandResult<Dictionary<string, object?>> InsertBurn(PrincipiaBurnEditArgs? args) =>
            EditBurn(InsertBurnCommand, args, insert: true);

        private CommandResult<Dictionary<string, object?>> EditBurn(
            string command, PrincipiaBurnEditArgs? args, bool insert)
        {
            if (args == null)
            {
                return Refusal(command, null, NoArgs(), null);
            }
            if (Replay(command, args.RequestId, out var replayed))
            {
                return Ok(replayed!, replay: true);
            }

            return InPlan(
                command,
                args.VesselId,
                args.RequestId,
                (session, gate, now) =>
                {
                    var count = gate.ManoeuvreCount();
                    if (count > 0 && !session.Writes.BurnLayoutVerified)
                    {
                        return LayoutUnverified(session, "burn");
                    }
                    if (count <= 0)
                    {
                        // Nothing to copy, so the first burn is BUILT, from the
                        // loaded build's own struct. Only an insert may: a replace
                        // names a burn that is not there.
                        if (!insert)
                        {
                            return PrincipiaWriteResult.Refused(
                                PrincipiaWriteRefusal.BurnIndexOutOfRange,
                                "This plan has no burns, so there is none to change. Add one "
                                + "first.");
                        }
                        return ComposeFirstBurn(
                            session,
                            gate,
                            args.IgnitionUt,
                            args.DeltaVTangent,
                            args.DeltaVNormal,
                            args.DeltaVBinormal,
                            args.InertiallyFixed,
                            args.VesselId!,
                            now);
                    }

                    // Insert copies a template and puts the new burn at the requested
                    // index; past the end, the last burn is the template. Replace
                    // edits the burn named. Both go through the same round trip, and
                    // neither composes a burn.
                    var templateIndex = insert
                        ? Math.Min(Math.Max(args.BurnIndex, 0), count - 1)
                        : args.BurnIndex;
                    var manoeuvre = gate.Manoeuvre(templateIndex);
                    if (manoeuvre == null)
                    {
                        return PrincipiaWriteResult.Refused(
                            PrincipiaWriteRefusal.BurnIndexOutOfRange,
                            "Burn " + (templateIndex + 1) + " is not in this plan, which holds "
                            + count + ".");
                    }

                    var burn = Fields.Get(manoeuvre, PrincipiaBurnStruct.ManoeuvreBurnField);
                    if (burn == null)
                    {
                        return PrincipiaWriteResult.Refused(
                            PrincipiaWriteRefusal.PluginShapeChanged,
                            "Principia's manoeuvre carried no burn where this Uplink expects one.");
                    }

                    // Against `now`, which is the instant the write ARRIVED at
                    // rather than the instant it was composed at. A declared
                    // precondition would run at dispatch and so could not see this
                    // at all; under signal delay the two instants are a light time
                    // apart, and the difference between them is the whole of what
                    // this catches. Applies to an insert as well, because an
                    // inserted burn is written at the requested instant too.
                    var stale = PrincipiaBurnRules.RejectRequestedIgnition(
                        args.IgnitionUt, now);
                    if (stale.HasValue)
                    {
                        return stale.Value;
                    }

                    if (!insert)
                    {
                        var executing = PrincipiaBurnRules.RejectExecuting(
                            Fields.GetDouble(burn, PrincipiaBurnStruct.InitialTimeField),
                            Fields.GetDouble(manoeuvre, PrincipiaBurnStruct.ManoeuvreFinalTimeField),
                            now);
                        if (executing.HasValue)
                        {
                            return executing.Value;
                        }
                    }

                    var applied = PrincipiaBurnRules.Apply(
                        burn,
                        args,
                        Fields.GetDouble(manoeuvre, PrincipiaBurnStruct.ManoeuvreInitialMassField));
                    if (applied.HasValue)
                    {
                        return applied.Value;
                    }

                    return insert
                        ? gate.Insert(args.BurnIndex, burn)
                        : gate.Replace(args.BurnIndex, burn);
                });
        }

        /// <summary>
        /// Builds the plan's first burn and inserts it at the head.
        ///
        /// <para><b>Why building one is safe here when copying is the rule
        /// everywhere else.</b> The rule guards against a STALE FIELD SET: the burn
        /// struct is generated from a schema that has moved between releases, so a
        /// shape written down here would resolve, not throw, and write a plausible
        /// wrong burn into somebody's save. A struct constructed from the loaded
        /// build's own type has that property by construction, exactly as a copy
        /// does, because every field it carries is a field this build declares. It
        /// is the same guarantee reached a different way, not an exception to
        /// it.</para>
        ///
        /// <para><b>Every value is stated and none is inherited.</b> There is no
        /// burn to be a delta against, so an absent component is zero rather than
        /// unchanged, and the propulsion is the producer's own instant-impulse
        /// preset against a stated mass. That preset is the only profile this Uplink
        /// ever writes, on this path or the copy path, because the other two are
        /// computed from the vessel's live engines by a method on the producer's own
        /// window rather than by anything readable from here.</para>
        /// </summary>
        private PrincipiaWriteResult ComposeFirstBurn(
            PrincipiaSession session,
            PrincipiaPlanWriteGate gate,
            double? ignitionUt,
            double? deltaVTangent,
            double? deltaVNormal,
            double? deltaVBinormal,
            bool? inertiallyFixed,
            string vesselGuid,
            double now)
        {
            if (ignitionUt == null)
            {
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.ComposedBurnIncomplete,
                    "The first burn of a plan has no earlier burn to take an instant from, so "
                    + "its ignition has to be stated.");
            }
            var stale = PrincipiaBurnRules.RejectRequestedIgnition(ignitionUt, now);
            if (stale.HasValue)
            {
                return stale.Value;
            }
            var source = _source();
            if (source == null)
            {
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.SurfaceUnavailable,
                    "The game is not reachable, so neither the craft's mass nor the frame this "
                    + "burn would be built in can be read.");
            }

            var massTons = source.MassTonsOf(vesselGuid);
            if (massTons == null || !(massTons.Value > 0))
            {
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.SurfaceUnavailable,
                    "The craft's mass could not be read, and the propulsion for a burn with no "
                    + "manœuvre ahead of it is derived from it. Nothing is written on a mass "
                    + "nobody has.");
            }

            if (!PrincipiaComposedFrame.TryResolve(
                    _observation()?.PlottingFrame,
                    out var extension,
                    out var centre,
                    out var primary,
                    out var secondary,
                    out var frameRefusal))
            {
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.BurnFrameUnsupported, frameRefusal!);
            }

            var request = new ComposedBurnRequest(
                ignitionUt: ignitionUt.Value,
                deltaVTangent: deltaVTangent ?? 0.0,
                deltaVNormal: deltaVNormal ?? 0.0,
                deltaVBinormal: deltaVBinormal ?? 0.0,
                inertiallyFixed: inertiallyFixed ?? false,
                thrustKilonewtons:
                    massTons.Value * PrincipiaBurnRules.InstantImpulseThrustPerTonne,
                specificImpulseSeconds: PrincipiaBurnRules.InstantImpulseSpecificImpulseSeconds,
                frameExtension: extension,
                centreBodyIndex: centre,
                primaryBodyIndex: primary,
                secondaryBodyIndex: secondary);

            var burn = _composer.Compose(
                session.Plugin.BurnType(), request, source.Celestials.Indices, out var refusal);
            if (burn == null)
            {
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.PluginShapeChanged, refusal!);
            }

            var written = gate.Insert(0, burn);
            if (written.Outcome != PrincipiaWriteOutcome.Written)
            {
                return written;
            }

            // The insert IS the round trip. A burn built rather than copied has no
            // earlier crossing behind it, so reading this one back and comparing is
            // the only demonstration there is that the struct this build takes is the
            // struct it hands out. Done here rather than at arming so the write
            // happens on an operator asking for a burn, never on their asking whether
            // editing is possible.
            var after = gate.Manoeuvre(0);
            var afterBurn = after == null
                ? null
                : Fields.Get(after, PrincipiaBurnStruct.ManoeuvreBurnField);
            var difference = afterBurn == null
                ? null
                : PrincipiaLayoutProbe.DescribeBurnDifference(burn, afterBurn);
            if (afterBurn == null || difference != null)
            {
                // Taken back out, because what is in the plan is not what was asked
                // for and leaving it would be the plausible wrong burn this whole
                // apparatus exists to keep out of somebody's save.
                gate.Remove(0);

                // The FIELD, and both values, rather than a cause. This message used
                // to end "that is the struct-layout failure this check exists for",
                // which the check has no way to establish: it compares nine values
                // and used to report none of them, so a normalisation Principia
                // applies on the way in was indistinguishable from corruption and
                // read as corruption. That sentence was repeated onward as a
                // measurement. Hand over the evidence instead.
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.LayoutUnverified,
                    "The burn did not survive the crossing into Principia, so it was taken "
                    + "back out: "
                    + (afterBurn == null
                        ? "nothing came back to compare."
                        : difference + ".")
                    + " That is either a struct-layout mismatch or a value Principia "
                    + "normalises on the way in, and the two look the same from here.");
            }

            session.Writes.BurnLayoutPassed();
            return written;
        }

        /// <summary>
        /// A burn for the layout probe to round trip, or null when one cannot be
        /// built.
        ///
        /// <para>Deliberately the SAME construction the real write uses, down to the
        /// frame and the propulsion, because a probe that demonstrated a different
        /// struct than the one that follows it would be demonstrating the wrong
        /// thing. Nothing is refused here with a reason: the probe turns a null into
        /// its own layout verdict, which is the sentence an operator reads.</para>
        /// </summary>
        private object? ComposeProbeBurn(
            PrincipiaSession session,
            string? vesselId,
            double ignitionUt,
            out string? reason)
        {
            reason = null;
            var source = _source();
            if (source == null || vesselId == null)
            {
                reason = "the game is not reachable from here";
                return null;
            }
            var massTons = source.MassTonsOf(vesselId);
            if (massTons == null || !(massTons.Value > 0))
            {
                reason = "the craft's mass could not be read, and the propulsion comes from it";
                return null;
            }
            if (!PrincipiaComposedFrame.TryResolve(
                    _observation()?.PlottingFrame,
                    out var extension,
                    out var centre,
                    out var primary,
                    out var secondary,
                    out var frameReason))
            {
                reason = frameReason;
                return null;
            }

            // No Δv at all: the probe is about the struct surviving the crossing,
            // and a burn that would move the craft is a bigger thing to write into
            // somebody's plan than one that would not, even for the instant it is
            // there.
            var request = new ComposedBurnRequest(
                ignitionUt: ignitionUt,
                deltaVTangent: 0.0,
                deltaVNormal: 0.0,
                deltaVBinormal: 0.0,
                inertiallyFixed: false,
                thrustKilonewtons:
                    massTons.Value * PrincipiaBurnRules.InstantImpulseThrustPerTonne,
                specificImpulseSeconds: PrincipiaBurnRules.InstantImpulseSpecificImpulseSeconds,
                frameExtension: extension,
                centreBodyIndex: centre,
                primaryBodyIndex: primary,
                secondaryBodyIndex: secondary);

            return _composer.Compose(
                session.Plugin.BurnType(), request, source.Celestials.Indices, out reason);
        }

        /// <summary>
        /// Makes a plan for a craft that has none, so a composed plan has somewhere
        /// to be installed. Null when there is one already or one was made, and the
        /// refusal when it could not be.
        ///
        /// <para>Its own frame, before the install's. Two frames rather than one
        /// because creating and editing are different gates on the producer's side
        /// and the second is minted from a proof the first has already succeeded.
        /// Nothing is lost by the split: the create writes no burn, and the install
        /// re-reads the plan it lands in.</para>
        /// </summary>
        /// <summary>
        /// The instant a write issued now would land at, or null with the reason the
        /// game could not be asked.
        ///
        /// <para>Its own frame, opened for nothing but the clock, so a check that has
        /// to run before any write can have the instant it compares against. Reading
        /// it from the frame the write happens in would be one call cheaper and would
        /// put the check after the write it exists to prevent.</para>
        /// </summary>
        private double? ArrivalInstant(out PrincipiaWriteResult? unreachable)
        {
            unreachable = WrongThread();
            if (unreachable.HasValue)
            {
                return null;
            }

            var session = Session();
            if (session == null)
            {
                unreachable = NoSession();
                return null;
            }
            using var frame = Frame(session);
            if (frame == null)
            {
                unreachable = NoPlugin();
                return null;
            }
            return frame.CurrentTime();
        }

        private PrincipiaWriteResult? EnsurePlanExists(
            string? vesselId, double? desiredFinalTimeUt)
        {
            var offThread = WrongThread();
            if (offThread.HasValue)
            {
                return offThread.Value;
            }

            var session = Session();
            if (session == null)
            {
                return NoSession();
            }
            using var frame = Frame(session);
            if (frame == null)
            {
                return NoPlugin();
            }
            if (!frame.TryVessel(vesselId, out var vessel))
            {
                return UnknownVessel(vesselId);
            }
            if (vessel.TryFlightPlan(out _))
            {
                return null;
            }

            if (!vessel.TryPlanCreation(out var gate, out var refusal, out var detail))
            {
                return PrincipiaWriteResult.Refused(refusal, detail);
            }

            var massTons = _source()?.MassTonsOf(vessel.Guid);
            if (massTons == null || !(massTons.Value > 0))
            {
                return PrincipiaWriteResult.Refused(
                    PrincipiaWriteRefusal.SurfaceUnavailable,
                    "The craft's mass could not be read, and a plan created without one starts "
                    + "from a craft that weighs nothing.");
            }

            // An hour past now when the plan did not say, which is what the
            // producer's own planner asks for when it is given nothing. A plan
            // ending before it starts is an assertion failure inside the plugin
            // rather than an error return.
            var now = frame.CurrentTime();
            var finalTime = desiredFinalTimeUt ?? now + 3600.0;
            var created = gate.Create(finalTime, massTons.Value);
            return created.Outcome == PrincipiaWriteOutcome.Written ? null : created;
        }

        /// <summary>Drops one burn from the plan.</summary>
        public CommandResult<Dictionary<string, object?>> RemoveBurn(PrincipiaBurnRemoveArgs? args)
        {
            if (args == null)
            {
                return Refusal(RemoveBurnCommand, null, NoArgs(), null);
            }
            if (Replay(RemoveBurnCommand, args.RequestId, out var replayed))
            {
                return Ok(replayed!, replay: true);
            }

            return InPlan(
                RemoveBurnCommand,
                args.VesselId,
                args.RequestId,
                (session, gate, now) =>
                {
                    var manoeuvre = gate.Manoeuvre(args.BurnIndex);
                    if (manoeuvre != null)
                    {
                        var burn = Fields.Get(manoeuvre, PrincipiaBurnStruct.ManoeuvreBurnField);
                        var executing = PrincipiaBurnRules.RejectExecuting(
                            burn == null
                                ? null
                                : Fields.GetDouble(burn, PrincipiaBurnStruct.InitialTimeField),
                            Fields.GetDouble(manoeuvre, PrincipiaBurnStruct.ManoeuvreFinalTimeField),
                            now);
                        if (executing.HasValue)
                        {
                            return executing.Value;
                        }
                    }
                    return gate.Remove(args.BurnIndex);
                });
        }

        /// <summary>Moves where the plan is asked to end.</summary>
        public CommandResult<Dictionary<string, object?>> SetHorizon(PrincipiaPlanHorizonArgs? args)
        {
            if (args == null)
            {
                return Refusal(HorizonCommand, null, NoArgs(), null);
            }
            if (Replay(HorizonCommand, args.RequestId, out var replayed))
            {
                return Ok(replayed!, replay: true);
            }

            return InPlan(
                HorizonCommand,
                args.VesselId,
                args.RequestId,
                (session, gate, now) => gate.SetDesiredFinalTime(args.DesiredFinalTimeUt));
        }

        /// <summary>
        /// Raises the step budget or loosens the tolerances, by reading the
        /// producer's own struct back and changing three of its five fields.
        /// </summary>
        public CommandResult<Dictionary<string, object?>> SetIntegrator(
            PrincipiaPlanIntegratorArgs? args)
        {
            if (args == null)
            {
                return Refusal(IntegratorCommand, null, NoArgs(), null);
            }
            if (Replay(IntegratorCommand, args.RequestId, out var replayed))
            {
                return Ok(replayed!, replay: true);
            }

            return InPlan(
                IntegratorCommand,
                args.VesselId,
                args.RequestId,
                (session, gate, now) =>
                {
                    if (!session.Writes.IntegratorLayoutVerified)
                    {
                        return LayoutUnverified(session, "step parameter");
                    }
                    var parameters = gate.AdaptiveStepParameters();
                    if (parameters == null)
                    {
                        return PrincipiaWriteResult.Refused(
                            PrincipiaWriteRefusal.PluginShapeChanged,
                            "Principia's step parameters could not be read, so there is nothing to "
                            + "change and hand back.");
                    }
                    var applied = PrincipiaIntegratorRules.Apply(parameters, args);
                    if (applied.HasValue)
                    {
                        return applied.Value;
                    }
                    return gate.SetAdaptiveStepParameters(parameters);
                });
        }

        /// <summary>Creates a plan on a vessel that has none.</summary>
        public CommandResult<Dictionary<string, object?>> CreatePlan(PrincipiaPlanSlotArgs? args)
        {
            if (args == null)
            {
                return Refusal(CreateCommand, null, NoArgs(), null);
            }
            if (Replay(CreateCommand, args.RequestId, out var replayed))
            {
                return Ok(replayed!, replay: true);
            }

            var offThread = WrongThread();
            if (offThread.HasValue)
            {
                return Refusal(CreateCommand, args.RequestId, offThread.Value, null);
            }

            var session = Session();
            if (session == null)
            {
                return Refusal(CreateCommand, args.RequestId, NoSession(), null);
            }
            using var frame = Frame(session);
            if (frame == null)
            {
                return Refusal(CreateCommand, args.RequestId, NoPlugin(), null);
            }
            if (!frame.TryVessel(args.VesselId, out var vessel))
            {
                return Refusal(CreateCommand, args.RequestId, UnknownVessel(args.VesselId), null);
            }

            var now = frame.CurrentTime();
            if (!vessel.TryPlanCreation(out var gate, out var refusal, out var detail))
            {
                return Refusal(
                    CreateCommand,
                    args.RequestId,
                    PrincipiaWriteResult.Refused(refusal, detail),
                    ReadPlan(session, frame, vessel.Guid, now));
            }

            // An hour, which is what Principia's own planner asks for when the
            // operator gives it nothing. Stated rather than left to a null: a plan
            // that ends before it starts is an assertion failure inside the plugin.
            var finalTime = args.FinalTimeUt ?? now + 3600.0;
            var massTons = _source()?.MassTonsOf(vessel.Guid);
            if (massTons == null || !(massTons.Value > 0))
            {
                // Zero is accepted here and produces a plan whose craft cannot be
                // slowed down, so a mass nobody has refuses rather than defaults.
                return Refusal(
                    CreateCommand,
                    args.RequestId,
                    PrincipiaWriteResult.Refused(
                        PrincipiaWriteRefusal.SurfaceUnavailable,
                        "The craft's mass could not be read, and a plan created without one "
                        + "starts from a craft that weighs nothing."),
                    ReadPlan(session, frame, vessel.Guid, now));
            }
            var result = gate.Create(finalTime, massTons.Value);
            return Settle(
                CreateCommand,
                args.RequestId,
                result,
                ReadPlan(session, frame, vessel.Guid, now));
        }

        /// <summary>Deletes the selected plan.</summary>
        public CommandResult<Dictionary<string, object?>> DeletePlan(PrincipiaPlanSlotArgs? args)
        {
            if (args == null)
            {
                return Refusal(DeleteCommand, null, NoArgs(), null);
            }
            if (Replay(DeleteCommand, args.RequestId, out var replayed))
            {
                return Ok(replayed!, replay: true);
            }
            return InPlan(
                DeleteCommand, args.VesselId, args.RequestId, (session, gate, now) => gate.Delete());
        }

        /// <summary>Copies the selected plan into a new slot.</summary>
        public CommandResult<Dictionary<string, object?>> DuplicatePlan(PrincipiaPlanSlotArgs? args)
        {
            if (args == null)
            {
                return Refusal(DuplicateCommand, null, NoArgs(), null);
            }
            if (Replay(DuplicateCommand, args.RequestId, out var replayed))
            {
                return Ok(replayed!, replay: true);
            }
            return InPlan(
                DuplicateCommand,
                args.VesselId,
                args.RequestId,
                (session, gate, now) => gate.Duplicate());
        }

        /// <summary>
        /// The five steps every plan write shares, so no handler can leave one out.
        /// </summary>
        /// <summary>
        /// Install a whole flight plan composed at a command centre.
        ///
        /// <para>Checked entirely before anything is written, and one unusable burn
        /// refuses the lot. Principia offers no transaction, so this is
        /// validate-then-write and not a rollback: what it guarantees is that a plan
        /// failing any check writes NOTHING, and the receipt re-reads the plan either
        /// way so a partial write cannot be mistaken for a clean one.</para>
        ///
        /// <para>The head burn is BUILT where the craft holds none, from the type the
        /// producer's own entry point declares, and every burn after it is copied
        /// from that head. A craft with no plan at all gets one made for it here
        /// rather than being refused: "install this plan on that craft" is the whole
        /// of what this command means, and requiring the operator to send a separate
        /// create first would put the two halves a light-time apart, which is exactly
        /// what sending a plan as ONE message exists to avoid.</para>
        /// </summary>
        public CommandResult<Dictionary<string, object?>> SendPlan(PrincipiaPlanSendArgs? args)
        {
            if (args == null)
            {
                return Refusal(SendCommand, null, NoArgs(), null);
            }
            if (Replay(SendCommand, args.RequestId, out var replayed))
            {
                return Ok(replayed!, replay: true);
            }

            // Checked before the plan is made, because making one is a write and the
            // guarantee this command states is that a plan failing any check writes
            // NOTHING. Checked again inside the install below, against that frame's
            // own instant: this one exists to keep an empty plan off a craft the
            // operator never planned for, not to replace the check the write makes.
            var arrival = ArrivalInstant(out var unreachable);
            if (arrival == null)
            {
                return Refusal(SendCommand, args.RequestId, unreachable!.Value, null);
            }
            var unusable = PrincipiaComposedPlanRules.Reject(args, arrival.Value);
            if (unusable.HasValue)
            {
                return Refusal(SendCommand, args.RequestId, unusable.Value, null);
            }

            var madeOne = EnsurePlanExists(args.VesselId, args.DesiredFinalTimeUt);
            if (madeOne.HasValue)
            {
                return Refusal(SendCommand, args.RequestId, madeOne.Value, null);
            }

            return InPlan(
                SendCommand,
                args.VesselId,
                args.RequestId,
                (session, gate, now) =>
                {
                    // Only where there is a burn to copy. A plan sent to a craft
                    // holding none builds its head instead, and that build is its own
                    // demonstration of the struct, so gating on a verdict the arm
                    // could not reach would refuse exactly the case this command
                    // exists for: giving a plan to a craft that has none.
                    if (gate.ManoeuvreCount() > 0 && !session.Writes.BurnLayoutVerified)
                    {
                        return LayoutUnverified(session, "burn");
                    }

                    // Against `now`, the instant the plan ARRIVED. A plan composed
                    // while every burn was ahead can land a light-time later with its
                    // first already past, and the sender cannot know that.
                    var refused = PrincipiaComposedPlanRules.Reject(args, now);
                    if (refused.HasValue)
                    {
                        return refused.Value;
                    }

                    var wanted = args.Burns!;

                    // Extend the horizon first where one was asked for: a burn beyond
                    // the plan's end is not a burn Principia will accept, and the
                    // rules above already refuse a plan that ends before its own last
                    // ignition.
                    if (args.DesiredFinalTimeUt != null)
                    {
                        var horizon = gate.SetDesiredFinalTime(args.DesiredFinalTimeUt.Value);
                        if (horizon.Outcome != PrincipiaWriteOutcome.Written)
                        {
                            return horizon;
                        }
                    }

                    // Surplus goes from the END, so the indices of the burns being
                    // kept do not move under the loop that follows.
                    while (gate.ManoeuvreCount() > wanted.Length)
                    {
                        var dropped = gate.Remove(gate.ManoeuvreCount() - 1);
                        if (dropped.Outcome != PrincipiaWriteOutcome.Written)
                        {
                            return dropped;
                        }
                    }

                    // The head burn is BUILT where the plan is empty, so that every
                    // burn after it has one to copy. Done inside the horizon that was
                    // just set and before the loop, because the loop's whole shape
                    // assumes a template exists.
                    if (gate.ManoeuvreCount() <= 0 && wanted.Length > 0)
                    {
                        var head = wanted[0];
                        var composed = ComposeFirstBurn(
                            session,
                            gate,
                            head.IgnitionUt,
                            head.DeltaVTangent,
                            head.DeltaVNormal,
                            head.DeltaVBinormal,
                            head.InertiallyFixed,
                            args.VesselId!,
                            now);
                        if (composed.Outcome != PrincipiaWriteOutcome.Written)
                        {
                            return composed;
                        }
                    }

                    for (var i = 0; i < wanted.Length; i++)
                    {
                        var existing = gate.ManoeuvreCount();
                        var insert = i >= existing;
                        var templateIndex = insert ? existing - 1 : i;
                        var manoeuvre = gate.Manoeuvre(templateIndex);
                        if (manoeuvre == null)
                        {
                            return PrincipiaWriteResult.Refused(
                                PrincipiaWriteRefusal.BurnIndexOutOfRange,
                                "Burn " + (templateIndex + 1) + " went missing while this plan was "
                                + "being installed, which means the plan changed underneath the "
                                + "write.");
                        }

                        var burn = Fields.Get(manoeuvre, PrincipiaBurnStruct.ManoeuvreBurnField);
                        if (burn == null)
                        {
                            return PrincipiaWriteResult.Refused(
                                PrincipiaWriteRefusal.PluginShapeChanged,
                                "Principia's manoeuvre carried no burn where this Uplink expects one.");
                        }

                        var applied = PrincipiaBurnRules.Apply(
                            burn,
                            AsEdit(wanted[i], i),
                            Fields.GetDouble(manoeuvre, PrincipiaBurnStruct.ManoeuvreInitialMassField));
                        if (applied.HasValue)
                        {
                            return applied.Value;
                        }

                        var written = insert ? gate.Insert(i, burn) : gate.Replace(i, burn);
                        if (written.Outcome != PrincipiaWriteOutcome.Written)
                        {
                            return written;
                        }
                    }

                    return PrincipiaWriteResult.Written();
                });
        }

        /// <summary>
        /// A composed burn as the single-burn writer wants it. Every component is
        /// carried, never <c>Unchanged</c>: a composed plan states its burns outright
        /// rather than as a delta against a value the sender could not see.
        /// </summary>
        private static PrincipiaBurnEditArgs AsEdit(PrincipiaComposedBurn burn, int index) =>
            new PrincipiaBurnEditArgs
            {
                BurnIndex = index,
                IgnitionUt = burn.IgnitionUt,
                DeltaVTangent = burn.DeltaVTangent,
                DeltaVNormal = burn.DeltaVNormal,
                DeltaVBinormal = burn.DeltaVBinormal,
                InertiallyFixed = burn.InertiallyFixed,
                Profile = burn.Profile,
            };

        private CommandResult<Dictionary<string, object?>> InPlan(
            string command,
            string? vesselId,
            string? requestId,
            Func<PrincipiaSession, PrincipiaPlanWriteGate, double, PrincipiaWriteResult> write)
        {
            var offThread = WrongThread();
            if (offThread.HasValue)
            {
                return Refusal(command, requestId, offThread.Value, null);
            }

            var session = Session();
            if (session == null)
            {
                return Refusal(command, requestId, NoSession(), null);
            }

            using var frame = Frame(session);
            if (frame == null)
            {
                return Refusal(command, requestId, NoPlugin(), null);
            }

            if (!frame.TryVessel(vesselId, out var vessel))
            {
                return Refusal(command, requestId, UnknownVessel(vesselId), null);
            }

            var now = frame.CurrentTime();
            if (!vessel.TryFlightPlan(out var plan))
            {
                return Refusal(
                    command,
                    requestId,
                    NoPlan(),
                    ReadPlan(session, frame, vessel.Guid, now));
            }

            var materialised = plan.Materialise();
            if (!materialised.TryWrite(out var gate, out var refusal, out var detail))
            {
                return Refusal(
                    command,
                    requestId,
                    PrincipiaWriteResult.Refused(refusal, detail),
                    ReadPlan(session, frame, vessel.Guid, now));
            }

            var result = write(session, gate, now);

            // The re-read happens whatever the outcome, including a refusal that got
            // this far, because "what does the plan look like now" is the question a
            // receipt exists to answer and a refusal is not a reason to withhold it.
            return Settle(
                command, requestId, result, ReadPlan(session, frame, vessel.Guid, now));
        }

        private static PrincipiaWriteResult LayoutUnverified(PrincipiaSession session, string what) =>
            PrincipiaWriteResult.Refused(
                PrincipiaWriteRefusal.LayoutUnverified,
                "Principia's " + what + " struct has not survived a round trip in this session, so "
                + "nothing will be written through it. " + (session.Writes.LayoutFailure ?? "")
                + " Arm the write surface on a plan that has at least one burn.");

        private static PrincipiaWriteResult NoArgs() =>
            PrincipiaWriteResult.Refused(
                PrincipiaWriteRefusal.SurfaceUnavailable,
                "The command carried no arguments, so there is nothing to write and no vessel to "
                + "write it to.");

        private static PrincipiaWriteResult NoSession() =>
            PrincipiaWriteResult.Refused(
                PrincipiaWriteRefusal.SurfaceUnavailable,
                "No Principia session is bound, so the plan cannot be read, let alone changed.");

        private static PrincipiaWriteResult NoPlugin() =>
            PrincipiaWriteResult.Refused(
                PrincipiaWriteRefusal.SurfaceUnavailable,
                "Principia's plugin is not running right now (main menu, or mid-reset).");

        private static PrincipiaWriteResult NoPlan() =>
            PrincipiaWriteResult.Refused(
                PrincipiaWriteRefusal.NoFlightPlan,
                "The vessel has no flight plan. Create one first.");

        private static PrincipiaWriteResult UnknownVessel(string? vesselId) =>
            PrincipiaWriteResult.Refused(
                PrincipiaWriteRefusal.VesselUnknown,
                string.IsNullOrEmpty(vesselId)
                    ? "No vessel was named, and a plan write is per-vessel."
                    : "Principia no longer knows vessel " + vesselId
                        + ". It may have been recovered, destroyed, or merged since the console "
                        + "last read it.");

        private ISettingsSource? Source() => _source();

        private PrincipiaSession? Session() => Source()?.Session;

        private static PrincipiaFrame? Frame(PrincipiaSession session) =>
            session.TryBeginFrame(out var frame) ? frame : null;

        /// <summary>
        /// Records the receipt and turns it into a command result.
        ///
        /// <para>A refused or rejected write is a command FAILURE with a typed code,
        /// and it still carries the whole receipt: the code is what a client branches
        /// on and the receipt is what it shows. Neither is worth sending without the
        /// other.</para>
        /// </summary>
        private CommandResult<Dictionary<string, object?>> Settle(
            string command,
            string? requestId,
            PrincipiaWriteResult result,
            PlanObservation? plan)
        {
            var receipt = PlanBuilder.BuildReceipt(requestId, result, plan);
            Remember(command, requestId, receipt);
            if (result.Outcome == PrincipiaWriteOutcome.Written)
            {
                return Ok(receipt, replay: false);
            }
            return new CommandResult<Dictionary<string, object?>>
            {
                Success = false,
                ErrorCode = Code(result),
                Detail = result.Detail ?? result.StatusMessage,
                Payload = receipt,
            };
        }

        private CommandResult<Dictionary<string, object?>> Refusal(
            string command,
            string? requestId,
            PrincipiaWriteResult result,
            PlanObservation? plan) =>
            Settle(command, requestId, result, plan);

        private static CommandResult<Dictionary<string, object?>> Ok(
            Dictionary<string, object?> receipt, bool replay)
        {
            if (replay)
            {
                receipt = new Dictionary<string, object?>(receipt) { ["replayed"] = true };
            }
            // A replayed receipt reports the outcome AND the code it reported the
            // first time, including a failure, because the honest answer to "what
            // happened to request 7" does not change on being asked twice. Both are
            // recovered from the receipt rather than re-derived from anything live:
            // the world may have moved on, and this answer is about the past.
            var outcome = receipt.TryGetValue("outcome", out var value) && value is int code
                ? (PrincipiaWriteOutcome)code
                : PrincipiaWriteOutcome.Refused;
            if (outcome == PrincipiaWriteOutcome.Written)
            {
                return CommandResult<Dictionary<string, object?>>.Ok(receipt);
            }
            var refusal =
                receipt.TryGetValue("refusal", out var refusalValue) && refusalValue is int refusalCode
                    ? (PrincipiaWriteRefusal)refusalCode
                    : PrincipiaWriteRefusal.SurfaceUnavailable;
            return new CommandResult<Dictionary<string, object?>>
            {
                Success = false,
                ErrorCode = Code(outcome, refusal),
                Detail = receipt.TryGetValue("refusalDetail", out var detail) ? detail as string : null,
                Payload = receipt,
            };
        }

        /// <summary>
        /// Maps a write outcome onto the typed command code a client branches on.
        ///
        /// <para>The refusal enum on the receipt is the precise answer and this is
        /// the coarse one, and both travel: a client that only knows the shared
        /// vocabulary still gets a code it can act on, and one that knows this
        /// Uplink's gets the guard by name. There is deliberately no
        /// <c>LimitBreach</c> on the plan-slot refusal: that type is shaped around a
        /// named FACILITY and a plan slot is not one, so the numbers ride in the
        /// sentence instead.</para>
        /// </summary>
        private static CommandErrorCode Code(PrincipiaWriteResult result) =>
            Code(result.Outcome, result.Refusal);

        private static CommandErrorCode Code(
            PrincipiaWriteOutcome outcome, PrincipiaWriteRefusal refusal) =>
            outcome == PrincipiaWriteOutcome.Rejected
                ? CommandErrorCode.WrongState
                : refusal switch
                {
                    PrincipiaWriteRefusal.SurfaceUnavailable => CommandErrorCode.ModeUnavailable,
                    PrincipiaWriteRefusal.NotArmed => CommandErrorCode.NotClearToProceed,
                    PrincipiaWriteRefusal.LayoutUnverified => CommandErrorCode.ModeUnavailable,
                    PrincipiaWriteRefusal.VesselUnknown => CommandErrorCode.NoVessel,
                    PrincipiaWriteRefusal.NoFlightPlan => CommandErrorCode.WrongState,
                    PrincipiaWriteRefusal.PlanAlreadyExists => CommandErrorCode.WrongState,
                    PrincipiaWriteRefusal.PlanSlotsFull => CommandErrorCode.LimitReached,
                    PrincipiaWriteRefusal.BurnIndexOutOfRange => CommandErrorCode.NotFound,
                    PrincipiaWriteRefusal.BurnExecuting => CommandErrorCode.NotClearToProceed,
                    PrincipiaWriteRefusal.BurnFrameUnsupported => CommandErrorCode.CapabilityMismatch,
                    PrincipiaWriteRefusal.OptimisationRunning => CommandErrorCode.NotClearToProceed,
                    PrincipiaWriteRefusal.ValueNotFinite => CommandErrorCode.Range,
                    PrincipiaWriteRefusal.ThrustNotPositive => CommandErrorCode.Range,
                    PrincipiaWriteRefusal.IntegratorKindUnexpected =>
                        CommandErrorCode.CapabilityMismatch,
                    PrincipiaWriteRefusal.IntegratorBoundsExceeded => CommandErrorCode.Range,
                    PrincipiaWriteRefusal.FinalTimeInPast => CommandErrorCode.Range,
                    PrincipiaWriteRefusal.ComposedBurnIncomplete => CommandErrorCode.Range,
                    PrincipiaWriteRefusal.PluginShapeChanged => CommandErrorCode.CapabilityMismatch,
                    _ => CommandErrorCode.Unknown,
                };

        private bool Replay(
            string command, string? requestId, out Dictionary<string, object?>? receipt)
        {
            receipt = null;
            if (string.IsNullOrEmpty(requestId))
            {
                return false;
            }
            return _receipts.TryGetValue(Key(command, requestId!), out receipt);
        }

        private void Remember(
            string command, string? requestId, Dictionary<string, object?> receipt)
        {
            if (string.IsNullOrEmpty(requestId))
            {
                return;
            }
            var key = Key(command, requestId!);
            if (!_receipts.ContainsKey(key))
            {
                _receiptOrder.Add(key);
            }
            _receipts[key] = receipt;
            while (_receiptOrder.Count > ReceiptMemory)
            {
                _receipts.Remove(_receiptOrder[0]);
                _receiptOrder.RemoveAt(0);
            }
        }

        private static string Key(string command, string requestId) =>
            command + "\0" + requestId;
    }
}
