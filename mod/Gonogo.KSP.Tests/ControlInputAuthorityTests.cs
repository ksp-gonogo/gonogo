using Gonogo.KSP.Tests.CurrencyDelay;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// The three control-input commands, on a craft KSP will not pass control
    /// input to.
    ///
    /// <para><b>What was wrong.</b> <c>Vessel.FeedInputFeed()</c> calls
    /// <c>OnFlyByWire(ctrlState)</c> - so our override runs and writes every axis
    /// it holds - and only then decides whether to hand that state to the parts:
    /// <c>rootPart.propagateControlUpdate(ctrlState)</c> is guarded by
    /// <c>loaded &amp;&amp; !packed &amp;&amp; !physicsHoldLock &amp;&amp;
    /// isControllable</c>. On a craft with no control source the axes were
    /// written, dropped, and reported back as <c>Ok()</c>. Throttle takes the
    /// same route (<c>FlightInputHandler</c> writes the active vessel's
    /// <c>ctrlState</c>, which reaches the engines through that same
    /// propagation) and told the same lie.</para>
    ///
    /// <para><b>Not an EVA defect.</b> It is true of any craft whose last crew
    /// member left without a probe core aboard, and of one that has lost signal
    /// or run its batteries flat, whether or not anyone is outside. That is why
    /// it is its own rule rather than an arm of
    /// <see cref="Gonogo.KSP.EvaCommandRule"/>, and why the refusal is
    /// <c>CapabilityMismatch</c>: the answer is about what the craft can accept,
    /// not about a moment passing.</para>
    ///
    /// <para><b>Only the three that ride that propagation.</b> The action groups
    /// do not: <c>ActionGroups.SetGroup</c> writes the vessel's own group state
    /// and stock fires those on an uncontrolled craft too, so gating them here
    /// would refuse a thing that works.</para>
    ///
    /// <para>Asserted over the shipped source for the reason
    /// <see cref="ActiveVessel.EvaCommandRefusalTests"/> gives: these command
    /// bodies reach Unity assemblies the reference set does not ship. The
    /// DECISION is <see cref="Gonogo.KSP.ControlInputAuthority"/>, which names no
    /// KSP type and is entered directly.</para>
    /// </summary>
    public class ControlInputAuthorityTests
    {
        /// <summary>
        /// A controllable craft refuses nothing. A rule that refused here would
        /// take the stick away from every normal flight.
        /// </summary>
        [Fact]
        public void AControllableCraftIsNotRefused()
        {
            Assert.Null(ControlInputAuthority.RefusalFor(controllable: true));
        }

        /// <summary>
        /// <c>CapabilityMismatch</c>, whose contract wording is "the craft would
        /// have to be different for this to work". <c>NotClearToProceed</c> would
        /// be the wrong shape: it promises the moment will pass, and a craft with
        /// no command pod and no probe core is not waiting for anything.
        /// </summary>
        [Fact]
        public void AnUncontrollableCraftIsRefusedAsACapabilityAndSaysWhy()
        {
            var refusal = ControlInputAuthority.RefusalFor(controllable: false);

            Assert.NotNull(refusal);
            Assert.Equal(CommandErrorCode.CapabilityMismatch, refusal!.Value.Code);
            Assert.NotEqual("", refusal.Value.Detail);
        }

        /// <summary>
        /// One case per command rather than one sweep: two of the three fixed
        /// leaves the third reporting a success it did not perform, and a sweep
        /// that passed on two would not say which.
        /// </summary>
        public static TheoryData<string> CommandsThatRideTheControlPropagation => new TheoryData<string>
        {
            "public CommandResult SetThrottle(",
            "public CommandResult SetFlyByWire(",
            "public CommandResult SetControlAxes(",
        };

        [Theory]
        [MemberData(nameof(CommandsThatRideTheControlPropagation))]
        public void EveryCommandThatRidesTheControlPropagationAsksTheAuthority(string declaration)
        {
            var body = CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("KspVesselActuator.cs"), declaration);

            Assert.Contains("ControlInputAuthority.RefusalFor(", body);
        }

        /// <summary>
        /// Disarming is exempt, and has to be. It neutralises the held axes and
        /// detaches the callback, so it is the one control command that does
        /// something useful on a craft that cannot take control input: refusing
        /// it would strand an armed override on a craft nobody can clear it from.
        /// </summary>
        [Fact]
        public void DisarmingFlyByWireIsNotGated()
        {
            var body = CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("KspVesselActuator.cs"),
                "public CommandResult SetFlyByWire(");

            var gate = body.IndexOf("ControlInputAuthority.RefusalFor(", System.StringComparison.Ordinal);
            var arming = body.IndexOf("if (enabled)", System.StringComparison.Ordinal);

            Assert.True(gate >= 0, "SetFlyByWire does not consult the authority at all");
            Assert.True(arming >= 0, "SetFlyByWire no longer branches on the arm/disarm flag");
            Assert.True(
                gate > arming,
                "SetFlyByWire refuses before it knows whether it was asked to arm or to disarm");
        }

        /// <summary>
        /// The action groups deliberately stay outside the rule. Stock fires them
        /// on an uncontrolled craft, so a gate here would refuse a thing that
        /// works, and the widget row for lights and gear would go dead exactly
        /// when an operator is trying to find their derelict.
        /// </summary>
        [Theory]
        [InlineData("public CommandResult SetRcs(")]
        [InlineData("public CommandResult SetGear(")]
        [InlineData("public CommandResult SetLights(")]
        [InlineData("public CommandResult SetBrakes(")]
        public void TheActionGroupsAreDeliberatelyNotGated(string declaration)
        {
            var body = CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.ReadRelative("KspVesselActuator.cs"), declaration);

            Assert.DoesNotContain("ControlInputAuthority.RefusalFor(", body);
        }
    }
}
