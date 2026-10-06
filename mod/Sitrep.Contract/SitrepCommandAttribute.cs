using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// Tags a command's ARGS class with the command id (or ids) it is the args
    /// for, so every command can be enumerated and typed in the TypeScript SDK:
    /// its args type, what it returns, and whether it rides the light-time
    /// delay. It is metadata only and does not touch the wire.
    ///
    /// <para>Apply it once per command when one args class serves several:
    /// <see cref="SetEnabledArgs"/> carries six
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
    /// both is an error that stops the build.</para>
    ///
    /// <para>A command with NO arguments still needs somewhere to carry its tag:
    /// <see cref="NoCommandArgs"/> for core, and a marker class of its own in an
    /// Uplink's slice.</para>
    /// <internal>
    /// Payload and Result are a Type rather than a string, so a result that
    /// does not exist stops the build where the mistake is, rather than
    /// reaching a client as a name that resolves to nothing.
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
        /// Mutually exclusive with <see cref="Payload"/>.
        /// </summary>
        public Type Result { get; set; }

        /// <summary>
        /// Whether this command rides the light-time delay. Default
        /// <see cref="DelayRole.Delayed"/>: an order to a craft crosses the gap
        /// like any other signal, and only a fact with no analogue in flight is
        /// <see cref="DelayRole.TrueNow"/>.
        ///
        /// <para>It is the same enum a channel declares on
        /// <see cref="ChannelDeclaration.Delay"/>, and a command and the channel
        /// it writes take the same role: <c>time.warp</c> and
        /// <c>time.setWarpIndex</c> are both <see cref="DelayRole.TrueNow"/>, and
        /// so are the <c>alarm.scet.*</c> channels and the <c>alarm.scet.arm</c>
        /// and <c>alarm.scet.disarm</c> commands that write them.</para>
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
        /// <para>Three kinds of command are <see cref="DelayRole.TrueNow"/>. A
        /// command that changes the scene (launch, recover, revert, switch
        /// vessel, the tracking station) changes it for every command centre at
        /// once, so there is no light time for it to cross. A game control (warp,
        /// pause) is not a signal to a craft. A display choice (which frame a
        /// readout is in, which command centre a trajectory is drawn for) sends
        /// nothing anywhere. Everything else is delayed, career and construction
        /// orders included, since a second command centre can issue them
        /// too.</para>
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
