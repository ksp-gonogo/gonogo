using System;
using System.Collections.Generic;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Builds a burn for the layout probe to round trip, saying why when it
    /// cannot.
    ///
    /// <para>The reason is an out-parameter rather than a null return because a
    /// probe that can only say "the struct's shape has not been demonstrated"
    /// leaves an operator with nothing to act on, and leaves the next person
    /// reading a rig transcript guessing between a missing frame, an unreadable
    /// mass and a struct that genuinely moved.</para>
    /// </summary>
    public delegate object? ProbeBurnFactory(double desiredFinalTimeUt, out string? reason);

    /// <summary>
    /// Proves, by doing it, that a struct handed to the plugin comes back
    /// unchanged.
    ///
    /// <para><b>Why this cannot be replaced by reading.</b> Every struct on the
    /// write surface is generated at the producer's build time from a schema that
    /// churns: the burn gained a field and lost one in the very release this Uplink
    /// is keyed to. The shapes agree across the three compilers Principia ships for
    /// under the rules those compilers follow, and that is an argument rather than
    /// evidence. A padding difference on ONE platform is a silent write corruption
    /// on that platform only, and it is invisible from the managed side: nothing
    /// fails to resolve, nothing throws, and the burn that lands in the save is
    /// plausible.</para>
    ///
    /// <para><b>So the probe is a write.</b> Read a burn, hand the same burn
    /// straight back, read it again, and require the two readings to be identical.
    /// There is no cheaper form: a probe that only reads proves the read, which was
    /// never the thing in doubt. That is why arming the write surface is what runs
    /// it, and why the probe is exempt from the arm rather than from anything
    /// else.</para>
    ///
    /// <para><b>Two structs, two independent verdicts.</b> A plan with no burns has
    /// nothing to round-trip and still wants its step limit raised, which is the
    /// commonest remedy for the plan most likely to have no burns drawn. So the
    /// step-parameter probe stands alone, and a burn edit is refused for want of the
    /// burn probe without taking that remedy down with it.</para>
    /// </summary>
    public static class PrincipiaLayoutProbe
    {
        private static readonly PrincipiaBurnStruct Fields = new PrincipiaBurnStruct();

        /// <summary>
        /// Runs both probes against the selected plan and records the verdicts on
        /// <paramref name="authority"/>.
        ///
        /// <para>Returns the refusal when the surface could not be probed at all,
        /// and null once it has been probed, whatever the verdicts were. A failed
        /// probe is not an error of the caller's: it is the answer, and the write
        /// that needs the failed struct refuses later with
        /// <see cref="PrincipiaWriteRefusal.LayoutUnverified"/>.</para>
        /// </summary>
        /// <param name="composeAt">Builds a burn for a stated ignition instant,
        /// used only when the plan holds none to round-trip. Null when nothing can
        /// build one, which leaves the burn verdict where it was before: a plan with
        /// no burns cannot be probed.</param>
        public static PrincipiaWriteResult? Run(
            PrincipiaMaterialisedPlanGate plan,
            PrincipiaWriteAuthority authority,
            ProbeBurnFactory? composeAt = null)
        {
            if (!plan.TryProbe(out var gate, out var refusal, out var detail))
            {
                return PrincipiaWriteResult.Refused(refusal, detail);
            }

            ProbeIntegrator(gate, authority);
            ProbeBurn(gate, authority, composeAt, plan.DesiredFinalTimeUt);
            return null;
        }

        /// <summary>
        /// Reads the step parameters, writes the identical struct back, and reads
        /// again.
        ///
        /// <para>Semantically a no-op and not a cheap one: writing these recomputes
        /// every segment of the plan. That cost is the probe's, paid once at arming
        /// rather than per edit.</para>
        /// </summary>
        private static void ProbeIntegrator(
            PrincipiaPlanWriteGate gate, PrincipiaWriteAuthority authority)
        {
            var before = gate.AdaptiveStepParameters();
            if (before == null)
            {
                authority.LayoutFailed(
                    "Principia's step parameters could not be read, so nothing can be written "
                    + "back to them.",
                    burn: false,
                    integrator: true);
                return;
            }

            var snapshot = IntegratorSnapshot(before);
            var written = gate.SetAdaptiveStepParameters(before);
            if (written.Outcome != PrincipiaWriteOutcome.Written)
            {
                authority.LayoutFailed(
                    "Writing Principia's own step parameters back unchanged was "
                    + written.Outcome + ": " + (written.Detail ?? written.StatusMessage ?? "no reason given"),
                    burn: false,
                    integrator: true);
                return;
            }

            var after = gate.AdaptiveStepParameters();
            if (after == null || IntegratorSnapshot(after) != snapshot)
            {
                authority.LayoutFailed(
                    "Principia's step parameters did not survive a round trip: what came back is "
                    + "not what went in, so this build's struct is not the shape this Uplink was "
                    + "audited against.",
                    burn: false,
                    integrator: true);
                return;
            }

            authority.IntegratorLayoutPassed();
        }

        /// <summary>
        /// Reads burn zero, replaces it with itself, and reads it again.
        ///
        /// <para>Burn zero rather than the last one, because replacing the LAST
        /// manoeuvre can move the plan's end instant. With an identical burn the move
        /// is a no-op, and choosing the earliest burn keeps the probe from depending
        /// on that being true.</para>
        /// </summary>
        private static void ProbeBurn(
            PrincipiaPlanWriteGate gate,
            PrincipiaWriteAuthority authority,
            ProbeBurnFactory? composeAt,
            double desiredFinalTimeUt)
        {
            if (gate.ManoeuvreCount() <= 0)
            {
                // No burn to copy, so one is BUILT and round-tripped instead, then
                // taken out again. The property under test is the same and is tested
                // the same way: a struct goes through the producer's marshaller and
                // what comes back is compared with what went in. Using a composed
                // burn is if anything the truer test, because a composed burn is
                // exactly what the write that follows will send.
                ProbeComposedBurn(gate, authority, composeAt, desiredFinalTimeUt);
                return;
            }

            var manoeuvre = gate.Manoeuvre(0);
            var burn = manoeuvre == null
                ? null
                : Fields.Get(manoeuvre, PrincipiaBurnStruct.ManoeuvreBurnField);
            if (burn == null)
            {
                authority.LayoutFailed(
                    "Principia's first manoeuvre carried no burn where this Uplink expects one, so "
                    + "its struct is not the shape that was audited.",
                    burn: true,
                    integrator: false);
                return;
            }

            var snapshot = burn;
            var written = gate.Replace(0, burn);
            if (written.Outcome != PrincipiaWriteOutcome.Written)
            {
                authority.LayoutFailed(
                    "Writing Principia's own first burn back unchanged was " + written.Outcome
                    + ": " + (written.Detail ?? written.StatusMessage ?? "no reason given"),
                    burn: true,
                    integrator: false);
                return;
            }

            var after = gate.Manoeuvre(0);
            var afterBurn = after == null
                ? null
                : Fields.Get(after, PrincipiaBurnStruct.ManoeuvreBurnField);
            var difference = afterBurn == null ? null : DescribeBurnDifference(snapshot, afterBurn);
            if (afterBurn == null || difference != null)
            {
                authority.LayoutFailed(
                    "A burn did not survive a round trip through Principia: "
                    + (afterBurn == null
                        ? "nothing came back to compare."
                        : difference + ".")
                    + " It would otherwise have written a plausible wrong burn into the save. "
                    + "What that difference MEANS is not settled here: a struct-layout mismatch "
                    + "and a normalisation Principia applies on the way in look the same from "
                    + "this side.",
                    burn: true,
                    integrator: false);
                return;
            }

            authority.BurnLayoutPassed();
        }

        /// <summary>
        /// Round-trips a BUILT burn through an empty plan, then takes it out again.
        ///
        /// <para><b>Why an empty plan can be probed at all now.</b> The round trip
        /// needs a burn, not a burn that came from the plan, and one built from the
        /// loaded build's own struct type carries exactly this build's fields. So the
        /// probe inserts it, reads it back, compares, and removes it, which is the
        /// same demonstration the copy probe makes and leaves the plan as it found
        /// it.</para>
        ///
        /// <para><b>The removal is checked.</b> A probe that left its own burn behind
        /// would put a manoeuvre in somebody's plan that no operator asked for, and a
        /// failure to remove is reported rather than passed over: the plan is not as
        /// it was, and saying so is the only way anyone finds out.</para>
        /// </summary>
        private static void ProbeComposedBurn(
            PrincipiaPlanWriteGate gate,
            PrincipiaWriteAuthority authority,
            ProbeBurnFactory? composeAt,
            double desiredFinalTimeUt)
        {
            if (composeAt == null)
            {
                authority.LayoutFailed(
                    "This plan has no burns and none could be built to round trip, so the burn "
                    + "round trip could not be run. Burn edits stay refused: the alternative is "
                    + "trusting a struct shape that has never been demonstrated.",
                    burn: true,
                    integrator: false);
                return;
            }

            // The caller picks the instant, given the plan's end: it holds the
            // frame's own clock and so is the only side that can place a burn both
            // ahead of now and inside the plan. A burn outside the window is one the
            // producer will not accept, and that refusal would read here as a layout
            // failure rather than as a badly chosen instant.
            var burn = composeAt(desiredFinalTimeUt, out var why);
            if (burn == null)
            {
                authority.LayoutFailed(
                    "A burn could not be built to round trip through this plan, so the struct's "
                    + "shape has not been demonstrated: "
                    + (why ?? "no reason given"),
                    burn: true,
                    integrator: false);
                return;
            }

            var snapshot = burn;
            var written = gate.Insert(0, burn);
            if (written.Outcome != PrincipiaWriteOutcome.Written)
            {
                authority.LayoutFailed(
                    "Writing a built burn into this plan was " + written.Outcome + ": "
                    + (written.Detail ?? written.StatusMessage ?? "no reason given"),
                    burn: true,
                    integrator: false);
                return;
            }

            var after = gate.Manoeuvre(0);
            var afterBurn = after == null
                ? null
                : Fields.Get(after, PrincipiaBurnStruct.ManoeuvreBurnField);
            var difference = afterBurn == null ? null : DescribeBurnDifference(snapshot, afterBurn);
            var survived = afterBurn != null && difference == null;

            var removed = gate.Remove(0);
            if (removed.Outcome != PrincipiaWriteOutcome.Written)
            {
                authority.LayoutFailed(
                    "The burn this probe wrote could not be taken back out: " + removed.Outcome
                    + ": " + (removed.Detail ?? removed.StatusMessage ?? "no reason given")
                    + ". The plan is not as it was.",
                    burn: true,
                    integrator: false);
                return;
            }

            if (!survived)
            {
                authority.LayoutFailed(
                    "A built burn did not survive a round trip through Principia: "
                    + (afterBurn == null
                        ? "nothing came back to compare."
                        : difference + ".")
                    + " It would otherwise have written a plausible wrong burn into the save. "
                    + "What that difference MEANS is not settled here: a struct-layout mismatch "
                    + "and a normalisation Principia applies on the way in look the same from "
                    + "this side.",
                    burn: true,
                    integrator: false);
                return;
            }

            authority.BurnLayoutPassed();
        }

        /// <summary>
        /// Whether a burn read back out of the plan is the burn that went in.
        ///
        /// <para>The same comparison the probe makes, offered to the one caller that
        /// makes the demonstration and the write in a single act: a burn built rather
        /// than copied has no earlier round trip behind it, so the insert that
        /// originates it IS the round trip. Sharing the comparison is the point. Two
        /// notions of "the same burn" would let one of them drift, and the drifted
        /// one would be the one deciding whether somebody's plan is trustworthy.</para>
        /// </summary>
        public static bool SameBurn(object went, object came) =>
            DescribeBurnDifference(went, came) == null;

        /// <summary>
        /// WHICH fields of a burn came back different, and what the two values
        /// were, or null when nothing changed.
        ///
        /// <para><b>This exists because the refusal it feeds used to assert a cause
        /// it had no way to establish.</b> It named a struct-layout failure, having
        /// compared nine values and reported none of them, so a plugin-side
        /// normalisation of one field was indistinguishable from byte-level
        /// corruption and read as the latter. Naming the field does not decide
        /// between those either; it hands over the evidence instead of a
        /// conclusion, which is the difference between a diagnosis and a
        /// guess.</para>
        ///
        /// <para>It refuses exactly as before. Nothing here is a relaxation: the
        /// comparison is the same nine values, and any difference at all still
        /// fails.</para>
        /// </summary>
        public static string? DescribeBurnDifference(object went, object came)
        {
            var before = BurnSnapshot(went);
            var after = BurnSnapshot(came);
            var differences = new List<string>();
            foreach (var field in BurnFieldNames)
            {
                if (before.TryGetValue(field, out var was)
                    && after.TryGetValue(field, out var now)
                    && was != now)
                {
                    differences.Add(field + " went in as " + was + " and came back as " + now);
                }
            }
            return differences.Count == 0 ? null : string.Join("; ", differences);
        }

        /// <summary>
        /// The fields compared, in the order a reader wants them. Its own list so a
        /// field added to <see cref="BurnSnapshot"/> and not to this one shows up as
        /// a field silently excused from the comparison rather than as nothing.
        /// </summary>
        private static readonly string[] BurnFieldNames =
        {
            PrincipiaBurnStruct.ThrustField,
            PrincipiaBurnStruct.SpecificImpulseField,
            PrincipiaBurnStruct.InitialTimeField,
            PrincipiaBurnStruct.InertiallyFixedField,
            "coordinate_system",
            "delta_v_tangent",
            "delta_v_normal",
            "delta_v_binormal",
            "frame_extension",
        };

        /// <summary>
        /// Every field of the burn that matters, keyed by the producer's own name
        /// for it.
        ///
        /// <para>An unreadable field is recorded as <c>?</c> rather than omitted, so
        /// it compares equal to itself read a second time and unequal to a field
        /// that became readable. Dropping it would let a field that stopped
        /// resolving pass as unchanged.</para>
        /// </summary>
        private static Dictionary<string, string> BurnSnapshot(object burn)
        {
            var deltaV = Fields.DeltaV(burn);
            return new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [PrincipiaBurnStruct.ThrustField] =
                    Text(Fields.GetDouble(burn, PrincipiaBurnStruct.ThrustField)),
                [PrincipiaBurnStruct.SpecificImpulseField] =
                    Text(Fields.GetDouble(burn, PrincipiaBurnStruct.SpecificImpulseField)),
                [PrincipiaBurnStruct.InitialTimeField] =
                    Text(Fields.GetDouble(burn, PrincipiaBurnStruct.InitialTimeField)),
                [PrincipiaBurnStruct.InertiallyFixedField] =
                    Fields.GetBool(burn, PrincipiaBurnStruct.InertiallyFixedField)?.ToString() ?? "?",
                ["coordinate_system"] = Fields.CoordinateSystem(burn)?.ToString() ?? "?",
                ["delta_v_tangent"] = deltaV == null ? "?" : Text(deltaV.Value.X),
                ["delta_v_normal"] = deltaV == null ? "?" : Text(deltaV.Value.Y),
                ["delta_v_binormal"] = deltaV == null ? "?" : Text(deltaV.Value.Z),
                ["frame_extension"] = Fields.FrameExtension(burn)?.ToString() ?? "?",
            };
        }

        private static string IntegratorSnapshot(object parameters) =>
            string.Join(
                "|",
                new[]
                {
                    Fields.GetInt(parameters, PrincipiaIntegratorRules.IntegratorKindField)
                        ?.ToString() ?? "?",
                    Fields.GetInt(
                            parameters, PrincipiaIntegratorRules.GeneralizedIntegratorKindField)
                        ?.ToString() ?? "?",
                    Text(Fields.GetDouble(parameters, PrincipiaIntegratorRules.MaxStepsField)),
                    Text(Fields.GetDouble(parameters, PrincipiaIntegratorRules.LengthToleranceField)),
                    Text(Fields.GetDouble(parameters, PrincipiaIntegratorRules.SpeedToleranceField)),
                });

        private static string Text(double? value) =>
            value?.ToString("R", System.Globalization.CultureInfo.InvariantCulture) ?? "?";
    }
}
