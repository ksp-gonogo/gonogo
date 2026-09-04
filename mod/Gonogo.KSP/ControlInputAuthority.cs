using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// Whether KSP will hand this craft the control input we are about to write.
    ///
    /// <para><b>The gap this closes.</b> <c>Vessel.FeedInputFeed()</c> runs
    /// <c>OnFlyByWire(ctrlState)</c> FIRST, so the fly-by-wire override we attach
    /// executes and writes every axis it holds. Only afterwards does it decide
    /// whether the parts ever see that state:
    /// <c>rootPart.propagateControlUpdate(ctrlState)</c> sits behind
    /// <c>loaded &amp;&amp; !packed &amp;&amp; !physicsHoldLock &amp;&amp;
    /// isControllable</c>. So on a craft with no control source the write
    /// happened, the propagation did not, and the command answered
    /// <c>Ok()</c>.</para>
    ///
    /// <para><b>Why only the last of those four gates is asked here.</b>
    /// <c>packed</c>, <c>physicsHoldLock</c> and <c>!loaded</c> are moments, not
    /// states of the craft: they clear when warp ends or physics resume, and the
    /// override is DESIGNED to survive them, since it re-applies from the held
    /// axes on every frame. Under light-time delay that is not an edge case, it
    /// is the normal shape of a command that arrives while the craft is on rails.
    /// Refusing there would break the thing the override exists for.
    /// <c>isControllable</c> is different: it is
    /// <c>controlLevel &gt; ControlLevel.NONE</c> over the craft's own control
    /// sources, capped by whatever CommNet allows, and it is the same test stock
    /// uses to decide the player's stick does nothing.</para>
    ///
    /// <para><b>Not EVA-specific</b>, which is why it is not an arm of
    /// <see cref="EvaCommandRule"/>. The commonest way to reach it is a crew
    /// transfer or an EVA that leaves a craft with no probe core aboard, but a
    /// flat battery and a lost signal get there too, with nobody outside.</para>
    ///
    /// <para>Carved out so it names no KSP type and a headless test can enter it,
    /// the same discipline as <see cref="EvaCommandRule"/> and
    /// <see cref="StageRule"/> beside it.</para>
    /// </summary>
    internal static class ControlInputAuthority
    {
        /// <summary>
        /// Names the mechanism rather than the moment. "Not right now" would send
        /// an operator back to try again at a craft that needs a probe core, a
        /// crew member or a link before anything they send can land.
        /// </summary>
        public const string NoControlSource =
            "this craft has no live control source, so KSP does not pass control input to its parts";

        /// <summary>The refusal, or null when the input will actually reach the craft.</summary>
        /// <param name="controllable">
        /// <c>Vessel.IsControllable</c>: the same flag
        /// <c>FeedInputFeed</c> gates the propagation on.
        /// </param>
        public static Refusal? RefusalFor(bool controllable) =>
            controllable
                ? (Refusal?)null
                : new Refusal(CommandErrorCode.CapabilityMismatch, NoControlSource);
    }
}
