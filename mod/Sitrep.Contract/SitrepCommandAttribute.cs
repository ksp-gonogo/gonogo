using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// Tags a command's ARGS class with the command id (or ids) it is the args
    /// for, so every command can be enumerated and typed in the TypeScript SDK:
    /// its args type, what it returns, and whether it rides the light-time
    /// delay. It is metadata only and does not touch the wire.
    ///
    /// <para><c>AllowMultiple</c> is on because one args shape routinely serves
    /// several commands: <see cref="SetEnabledArgs"/> carries six
    /// (<c>setSas</c>/<c>setRcs</c>/<c>setGear</c>/<c>setBrakes</c>/
    /// <c>setLights</c>/<c>setAbort</c>).</para>
    ///
    /// <para>What the command returns is one of three things, and the two
    /// optional properties are how a declaration says which. Neither set (the
    /// common case) means a bare <see cref="CommandResult"/>: success or a typed
    /// refusal, nothing more. <see cref="Payload"/> is the <c>T</c> of a
    /// handler's <c>CommandResult&lt;T&gt;</c>, which the SDK maps to
    /// <c>CommandResultOf&lt;T&gt;</c>. <see cref="Result"/> is for a command
    /// that resolves with something that is not a <see cref="CommandResult"/>
    /// at all (<c>system.bodies.statesAt</c> resolves a bare
    /// <see cref="BodyStatesReply"/>), and names that type exactly. Setting
    /// both is a contradiction and stops the build.</para>
    ///
    /// <para>Both are a Type rather than a string, so a result that does not
    /// exist stops the build here, where the mistake is, rather than reaching a
    /// client as a name that resolves to nothing.</para>
    ///
    /// <para>A command with NO arguments still needs somewhere to carry its tag:
    /// <see cref="NoCommandArgs"/> for core, and a marker class of its own in an
    /// Uplink's slice.</para>
    /// <internal>
    /// The write-side twin of <see cref="SitrepTopicAttribute"/>: the TS-SDK
    /// codegen builds the <c>CommandId -&gt; CommandArgs&lt;C&gt;</c> /
    /// <c>CommandReply&lt;C&gt;</c> maps from it by reflection. A command that
    /// took its own one-field class purely to be enumerable would be a shape
    /// invented for the codegen rather than for the wire, hence
    /// <c>AllowMultiple</c>. Lives in <c>Sitrep.Contract</c> and is compiled
    /// into every build, not just the codegen one, the same rule
    /// <see cref="SitrepTopicAttribute"/> and
    /// <see cref="SitrepControlChannelAttribute"/> follow: anything reflecting
    /// over it must never have to resolve an external assembly.
    /// </internal>
    /// </summary>
    /// <category>Commands</category>
    [AttributeUsage(AttributeTargets.Class, Inherited = false, AllowMultiple = true)]
    public sealed class SitrepCommandAttribute : Attribute
    {
        /// <summary>The command id as dispatched, e.g. <c>"vessel.control.setThrottle"</c>. Unique across all declared commands.</summary>
        public string CommandId { get; }

        /// <summary>
        /// The type carried in <c>CommandResult.payload</c> on success, or null
        /// when the command returns a bare <see cref="CommandResult"/>.
        /// </summary>
        public Type Payload { get; set; }

        /// <summary>
        /// The exact type the dispatch resolves with, for a command that does
        /// not return a <see cref="CommandResult"/> at all. Null otherwise.
        /// Mutually exclusive
        /// with <see cref="Payload"/>.
        /// </summary>
        public Type Result { get; set; }

        /// <summary>
        /// Whether this command rides the light-time delay. Default
        /// <see cref="DelayRole.Delayed"/>: an order to a craft crosses the gap
        /// like any other signal, and only a fact with no analogue in flight is
        /// <see cref="DelayRole.TrueNow"/>.
        ///
        /// <para>The SAME enum a channel declares on
        /// <see cref="ChannelDeclaration.Delay"/>, because it is the same
        /// question asked in the other direction: is this datum's subject aboard
        /// a craft across the gap, or here on the ground. A matched pair settles
        /// it. <c>time.warp</c> is a <see cref="DelayRole.TrueNow"/> channel and
        /// <c>time.setWarpIndex</c> is a <see cref="DelayRole.TrueNow"/> command;
        /// the <c>alarm.scet.*</c> channels and the <c>alarm.scet.arm</c> /
        /// <c>alarm.scet.disarm</c> commands that write them are the same pair
        /// again.</para>
        ///
        /// <para>This is the only place a command's delay role is declared: the
        /// mod applies it at dispatch, and a client's delay UX reads the same
        /// value from the SDK.</para>
        /// <internal>
        /// The host reads it through <c>Sitrep.Host.CommandDelayCatalog</c>, and
        /// the SDK codegen writes the same value into
        /// <c>GENERATED_COMMAND_RAIL</c>.
        /// </internal>
        ///
        /// <para>Three things earn <see cref="DelayRole.TrueNow"/>, and the rule
        /// is the SIMULATION's point of view rather than one console's. A command
        /// that changes the SCENE (launch, recover, revert, switch vessel, the
        /// tracking station) changes it for every vantage at once, so there is no
        /// light-time for it to ride. A meta-game control (warp, pause) is not a
        /// signal to a craft. A PRESENTATION choice (which frame a readout is in,
        /// which vantage a trajectory is drawn for) sends nothing anywhere at
        /// all. Everything else delays, career and construction orders included:
        /// those are orders, not ground-side facts, and a second command centre
        /// can issue them.</para>
        /// </summary>
        public DelayRole Delay { get; set; } = DelayRole.Delayed;

        /// <summary>
        /// The args property holding the universal time this command acts at, for
        /// a command that is worthless once the craft's clock has passed it: a
        /// maneuver node scheduled for an instant already gone.
        ///
        /// <para>A client refuses to send such a command when the send time plus
        /// the one-way light time reaches or passes that instant, so it never
        /// leaves the ground to arrive too late. That is the only check: any time
        /// the craft needs to act on it after arrival is the operator's call.
        /// Null for every command without such an instant.</para>
        ///
        /// <para>Must name a <c>double</c> property of the args class, which the
        /// build checks. Write it with <c>nameof</c> so a rename cannot leave it
        /// naming nothing.</para>
        /// </summary>
        public string? ArriveBefore { get; set; }

        /// <summary>Declares the args class as the args of one command.</summary>
        /// <param name="commandId">The command id as dispatched, e.g. <c>"vessel.control.setThrottle"</c>. Unique across all declared commands.</param>
        public SitrepCommandAttribute(string commandId)
        {
            CommandId = commandId;
        }
    }
}
