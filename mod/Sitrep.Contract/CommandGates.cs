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

        /// <summary>
        /// The argument whose value picks the item a per-item verdict is about,
        /// e.g. <c>facilityId</c>. Empty when the command's gate does not depend
        /// on which item is chosen, and then <see cref="Items"/> is empty too.
        /// </summary>
        [SitrepUnit(Units.Id)]
        public string ItemArgument { get; set; } = "";

        /// <summary>
        /// The verdict for each item that a call naming it would NOT pass, keyed
        /// by the value of <see cref="ItemArgument"/>. Sampled only while
        /// <see cref="Verdict"/> is <see cref="GateOutcome.Abstain"/>: a command
        /// refused or unreadable for every item has nothing to add per item.
        ///
        /// <para>An item with no entry has nothing said about it in advance,
        /// which a client draws exactly as an Abstain: a live control. That
        /// covers an item that passed and one that was never sampled alike, so
        /// absence is never a permission either.</para>
        /// </summary>
        public List<CommandGateItem> Items { get; set; } = new List<CommandGateItem>();
    }

    /// <summary>
    /// One item's verdict in a <see cref="CommandGate"/>: what the gate says
    /// about a call whose <see cref="CommandGate.ItemArgument"/> is
    /// <see cref="Value"/>.
    /// </summary>
    /// <category>System diagnostics</category>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public class CommandGateItem
    {
        /// <summary>The argument's value that names this item, e.g. <c>LaunchPad</c>, exactly as a call would send it.</summary>
        [SitrepUnit(Units.Id)]
        public string Value { get; set; } = "";

        /// <summary>The verdict for a call naming this item, in the shape <see cref="CommandGate.Verdict"/> carries. Never a Pass.</summary>
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

        /// <summary>
        /// One entry per channel that declares a requirement, each with its
        /// current verdict, evaluated with no arguments. Never null; a channel
        /// with no entry declares nothing it needs unlocked.
        /// </summary>
        public List<ChannelGate> Channels { get; set; } = new List<ChannelGate>();
    }

    /// <summary>
    /// One gated channel and what its requirement says right now. A client
    /// reading or drawing this channel shows the missing unlock when the
    /// verdict is a <see cref="CommandErrorCode.NotUnlocked"/> Fail.
    /// </summary>
    /// <category>System diagnostics</category>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public class ChannelGate
    {
        /// <summary>
        /// The channel's topic id, or a dynamic namespace's prefix ending in
        /// <c>.</c> (such as <c>fleet.</c>), which covers every topic under it.
        /// </summary>
        [SitrepUnit(Units.Id)]
        public string Topic { get; set; } = "";

        /// <summary>The verdict, in the shape <see cref="CommandGate.Verdict"/> carries.</summary>
        public GateVerdict Verdict { get; set; } = new GateVerdict();
    }

    /// <summary>Which kind of unlock a <see cref="MissingUnlock"/> names.</summary>
    /// <category>System diagnostics</category>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsEnum]
#endif
    public enum UnlockKind
    {
        /// <summary>A tech node in the save's research tree.</summary>
        Tech = 0,
        /// <summary>A space centre building's level.</summary>
        Facility = 1,
    }

    /// <summary>
    /// One unlock a save is missing, named the way the game names it, so a
    /// client can say "Missing tech: Flight Control" or "Mission Control,
    /// needs Building level 2" without mapping an id to English.
    /// </summary>
    /// <category>System diagnostics</category>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public class MissingUnlock
    {
        /// <summary>Whether this is a tech node or a building.</summary>
        [SitrepUnit(Units.Enumeration)]
        public UnlockKind Kind { get; set; }

        /// <summary>The tech node's <c>techID</c>, or the <c>SpaceCenterFacility</c> member name.</summary>
        [SitrepUnit(Units.Id)]
        public string Id { get; set; } = "";

        /// <summary>The game's own title for it: "Flight Control", "Mission Control".</summary>
        [SitrepUnit(Units.Text)]
        public string Name { get; set; } = "";

        /// <summary>For a building, the level it needs, counted from 1 as the game shows it. Absent for a tech node.</summary>
        [SitrepUnit(Units.Count)]
        [SitrepOmittedWhenNull]
        public int? Tier { get; set; }

        /// <summary>For a tech node, the science it costs to research. Absent for a building.</summary>
        [SitrepUnit(Units.Science)]
        [SitrepOmittedWhenNull]
        public double? ScienceCost { get; set; }
    }
}
