using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract
{
    /// <summary>
    /// One gated command and what its gate says RIGHT NOW, evaluated with no
    /// arguments at all.
    ///
    /// <para>This is the addressability answer, not the dispatch answer. The
    /// engine evaluates the same <see cref="CommandRequirement"/> set the same
    /// way in both cases (see <c>ChannelEngine.EvaluateGates</c>); the only
    /// difference is that here the argument bag is empty, so an
    /// argument-dependent requirement abstains rather than deciding. A command
    /// whose verdict is <see cref="GateOutcome.Abstain"/> is one whose answer
    /// depends on what you ask it to do, and the only honest thing to say in
    /// advance is nothing.</para>
    ///
    /// <para>The dispatch-time evaluation remains the authority: this snapshot
    /// is at most one sampling interval old and a client must not treat it as
    /// permission. It exists so a control can be drawn dark BEFORE the operator
    /// presses it, which is the whole point of asking the game in advance.</para>
    /// </summary>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public class CommandGate
    {
        /// <summary>The command id, e.g. <c>career.crew.hire</c>.</summary>
        [SitrepUnit(Units.Id)]
        public string Command { get; set; } = "";

        /// <summary>
        /// The verdict, in the same shape a refused dispatch carries. Same type
        /// deliberately: one client renderer then serves both "the game will
        /// refuse this" and "the game refused this", and the two can never
        /// disagree about how a reason is worded.
        ///
        /// <para><b>What a client should draw, per outcome. The four are NOT
        /// two.</b></para>
        ///
        /// <list type="bullet">
        /// <item><description><see cref="GateOutcome.Pass"/>: an ordinary live
        /// control. Not permission, see the type's own remarks.</description></item>
        /// <item><description><see cref="GateOutcome.Fail"/>: dark, with the
        /// reason reachable. The game evaluated the requirement and said
        /// no.</description></item>
        /// <item><description><see cref="GateOutcome.Abstain"/>: an ordinary
        /// live control. The answer depends on arguments nobody has supplied
        /// yet, so there is nothing honest to say in advance.</description></item>
        /// <item><description><see cref="GateOutcome.Unknown"/>: an ordinary
        /// live control, and <b>never</b> a dark one. This is an authority that
        /// was not there to ask, not a judgement about the command. It refuses
        /// at DISPATCH, deliberately, because a gate that cannot be read must
        /// not read as no gate; that is a fail-closed rule about ACTING, and it
        /// is not a licence to render a false certainty in advance. A refusal
        /// that arrives on dispatch at least names itself as one at the moment
        /// it happens; a permanently dark control with a confident sentence
        /// teaches a false belief and never corrects it.</description></item>
        /// </list>
        ///
        /// <para>The case that makes this concrete: a career save is still
        /// loading and <c>ScenarioUpgradeableFacilities.Instance</c> is not there
        /// yet, so every facility gate answers Unknown for as long as that takes.
        /// Collapsing Unknown into Fail would black those controls out and
        /// explain it in the game's own voice, and the explanation would be
        /// about a building rather than about a scene that had not finished
        /// loading.</para>
        ///
        /// <para>That example used to be the sandbox save, where the scenario is
        /// absent for good. It is not any more, and the reason is worth keeping:
        /// sandbox HAS no facility tiers, so "cannot read the tier" was the wrong
        /// question there and the gates now answer max instead of Unknown. An
        /// authority that does not exist is not an authority that could not be
        /// read, and only the second one is this.</para>
        /// </summary>
        public GateVerdict Verdict { get; set; } = new GateVerdict();
    }

    /// <summary>
    /// Wire wrapper for <c>system.uplink.gates</c>: every command that declares
    /// a requirement, with its current verdict. Resampled on the main thread at
    /// the engine's gate cadence and republished whole.
    ///
    /// <para>Only GATED commands appear. An ungated command is absent rather
    /// than present-and-passing, so a client that finds no entry knows the
    /// command has nothing to say about itself, which is different from knowing
    /// it is fine. Nothing here is a permission; see <see cref="CommandGate"/>.</para>
    /// </summary>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public class CommandGateReport
    {
        public List<CommandGate> Gates { get; set; } = new List<CommandGate>();
    }
}
