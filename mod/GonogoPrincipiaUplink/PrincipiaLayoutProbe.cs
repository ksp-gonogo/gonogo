namespace GonogoPrincipiaUplink
{
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
        public static PrincipiaWriteResult? Run(
            PrincipiaMaterialisedPlanGate plan, PrincipiaWriteAuthority authority)
        {
            if (!plan.TryProbe(out var gate, out var refusal, out var detail))
            {
                return PrincipiaWriteResult.Refused(refusal, detail);
            }

            ProbeIntegrator(gate, authority);
            ProbeBurn(gate, authority);
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
            PrincipiaPlanWriteGate gate, PrincipiaWriteAuthority authority)
        {
            if (gate.ManoeuvreCount() <= 0)
            {
                authority.LayoutFailed(
                    "This plan has no burns, so the burn round trip could not be run. Burn edits "
                    + "stay refused until a plan with a burn has been armed: the alternative is "
                    + "trusting a struct shape that has never been demonstrated.",
                    burn: true,
                    integrator: false);
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

            var snapshot = BurnSnapshot(burn);
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
            if (afterBurn == null || BurnSnapshot(afterBurn) != snapshot)
            {
                authority.LayoutFailed(
                    "A burn did not survive a round trip through Principia: what came back is not "
                    + "what went in. That is the platform struct-layout failure this probe exists "
                    + "for, and it would otherwise have written a plausible wrong burn into the "
                    + "save.",
                    burn: true,
                    integrator: false);
                return;
            }

            authority.BurnLayoutPassed();
        }

        /// <summary>
        /// Every field of the burn that matters, flattened into one comparable
        /// string.
        ///
        /// <para>A string rather than a field-by-field comparison so that a field
        /// that could not be read compares unequal to itself read a second time
        /// only if it changed, and so that adding a field to the snapshot cannot be
        /// forgotten in the comparison.</para>
        /// </summary>
        private static string BurnSnapshot(object burn)
        {
            var deltaV = Fields.DeltaV(burn);
            return string.Join(
                "|",
                new[]
                {
                    Text(Fields.GetDouble(burn, PrincipiaBurnStruct.ThrustField)),
                    Text(Fields.GetDouble(burn, PrincipiaBurnStruct.SpecificImpulseField)),
                    Text(Fields.GetDouble(burn, PrincipiaBurnStruct.InitialTimeField)),
                    Fields.GetBool(burn, PrincipiaBurnStruct.InertiallyFixedField)?.ToString() ?? "?",
                    Fields.CoordinateSystem(burn)?.ToString() ?? "?",
                    deltaV == null ? "?" : Text(deltaV.Value.X),
                    deltaV == null ? "?" : Text(deltaV.Value.Y),
                    deltaV == null ? "?" : Text(deltaV.Value.Z),
                    Fields.FrameExtension(burn)?.ToString() ?? "?",
                });
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
