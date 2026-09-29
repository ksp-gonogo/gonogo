using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract
{
    /// <summary>
    /// One gated command and what its gate says right now, evaluated with no
    /// arguments at all.
    ///
    /// <para>This says whether the command can be addressed, not how a dispatch
    /// will go. The same <see cref="CommandRequirement"/> set is evaluated the
    /// same way as at dispatch, except that the arguments are empty, so a
    /// requirement that depends on arguments abstains rather than deciding: a
    /// verdict of <see cref="GateOutcome.Abstain"/> means the result depends on
    /// what you ask the command to do.</para>
    ///
    /// <para>The evaluation at dispatch remains the authority: this snapshot is
    /// up to one sampling interval old and is not a permission. It lets a
    /// control be drawn dark before the operator presses it.</para>
    /// <internal>
    /// Both paths run ChannelEngine.EvaluateGates.
    /// </internal>
    /// </summary>
    /// <category>System diagnostics</category>
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
        /// The verdict, in the same shape a refused dispatch carries, so one
        /// renderer serves both "the game will refuse this" and "the game
        /// refused this" and the two word a reason the same way.
        ///
        /// <para><b>What a client should draw, per outcome. There are four
        /// cases, not two.</b></para>
        ///
        /// <list type="bullet">
        /// <item><description><see cref="GateOutcome.Pass"/>: an ordinary live
        /// control. Not a permission; see <see cref="CommandGate"/>.</description></item>
        /// <item><description><see cref="GateOutcome.Fail"/>: dark, with the
        /// reason reachable. The game evaluated the requirement and said
        /// no.</description></item>
        /// <item><description><see cref="GateOutcome.Abstain"/>: an ordinary
        /// live control. The verdict depends on arguments nobody has supplied
        /// yet, so nothing can be said in advance.</description></item>
        /// <item><description><see cref="GateOutcome.Unknown"/>: an ordinary
        /// live control, and <b>never</b> a dark one. The authority that decides
        /// could not be read, which is not a judgement about the command. A
        /// dispatch in this state is refused (a gate that cannot be read must
        /// not act as no gate), and that refusal names itself when it happens;
        /// a control drawn permanently dark with a confident reason would teach
        /// a false belief and never correct it.</description></item>
        /// </list>
        ///
        /// <para>For example, while a career save is still loading and
        /// <c>ScenarioUpgradeableFacilities.Instance</c> does not exist yet, every
        /// facility gate returns Unknown. Drawing those as Fail would black the
        /// controls out with a reason about a building rather than about a
        /// scene that had not finished loading. (A sandbox save has no facility
        /// tiers at all, so its facility gates evaluate against the maximum tier
        /// rather than returning Unknown.)</para>
        /// </summary>
        public GateVerdict Verdict { get; set; } = new GateVerdict();
    }

    /// <summary>
    /// Wire wrapper for <c>system.uplink.gates</c>: every command that declares
    /// a requirement, with its current verdict. Resampled at the gate sampling
    /// interval and republished whole.
    ///
    /// <para>Only GATED commands appear. An ungated command is absent rather
    /// than present and passing, so a client that finds no entry knows the
    /// command declares no gate, which is different from knowing it is fine. Nothing here is a permission; see <see
    /// cref="CommandGate"/>.</para>
    /// </summary>
    /// <category>System diagnostics</category>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public class CommandGateReport
    {
        /// <summary>One entry per gated command, each with its current verdict. Never null; empty when no command declares a requirement.</summary>
        public List<CommandGate> Gates { get; set; } = new List<CommandGate>();
    }
}
