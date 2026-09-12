using System;

namespace Sitrep.Contract
{
    /// <summary>
    /// Tags a command's ARGS class with the command id (or ids) it is the args
    /// for, so the TS-SDK codegen can build the
    /// <c>CommandId -&gt; CommandArgs&lt;C&gt;</c> / <c>CommandReply&lt;C&gt;</c>
    /// maps by reflection. The write-side twin of
    /// <see cref="SitrepTopicAttribute"/>, and it exists for the same reason: a
    /// command an author cannot enumerate is a command they cannot find. Before
    /// this tag the SDK named nine commands out of a hundred and typed
    /// <c>send</c> as <c>(args?: unknown) =&gt; Promise&lt;unknown&gt;</c>.
    ///
    /// <para><see cref="AllowMultiple"/> is on because one args shape routinely
    /// serves several commands: <see cref="SetEnabledArgs"/> carries six
    /// (<c>setSas</c>/<c>setRcs</c>/<c>setGear</c>/<c>setBrakes</c>/
    /// <c>setLights</c>/<c>setAbort</c>), and a command that took its own
    /// one-field class purely to be enumerable would be a shape invented for the
    /// codegen rather than for the wire.</para>
    ///
    /// <para>What the command ANSWERS is one of three things, and the two
    /// optional properties are how a declaration says which. Neither set (the
    /// common case) means a bare <see cref="CommandResult"/>: success or a typed
    /// refusal, nothing more. <see cref="Payload"/> is the <c>T</c> of a
    /// handler's <c>CommandResult&lt;T&gt;</c>, which the SDK maps to
    /// <c>CommandResultOf&lt;T&gt;</c>. <see cref="Result"/> is for the command
    /// that answers with something that is not a <see cref="CommandResult"/> at
    /// all (<c>vessel.trajectory.forVantage</c> resolves a bare
    /// <see cref="VantagePlanReply"/>), and names that type exactly. Setting
    /// both is a contradiction and stops the build.</para>
    ///
    /// <para>Both are a Type rather than a string, so a result that does not
    /// exist stops the build here, where the mistake is, rather than reaching a
    /// client as a name that resolves to nothing.</para>
    ///
    /// <para>A command with NO arguments still needs somewhere to carry its tag,
    /// and that somewhere is <see cref="NoCommandArgs"/> for core (an Uplink's
    /// own slice declares its own marker). The
    /// alternative, an attribute on some catalog class listing the ids, is a
    /// hand-maintained list in a new place, which is the failure this tag
    /// exists to end.</para>
    ///
    /// <para>Lives IN <c>Sitrep.Contract</c> and is compiled into every build,
    /// not just the codegen one, the same rule
    /// <see cref="SitrepTopicAttribute"/> and
    /// <see cref="SitrepControlChannelAttribute"/> follow: anything reflecting
    /// over it must never have to resolve an external assembly. It is metadata
    /// only and does NOT touch the wire.</para>
    /// </summary>
    [AttributeUsage(AttributeTargets.Class, Inherited = false, AllowMultiple = true)]
    public sealed class SitrepCommandAttribute : Attribute
    {
        /// <summary>The command id as dispatched, e.g. <c>"vessel.control.setThrottle"</c>. Unique across all declared commands.</summary>
        public string CommandId { get; }

        /// <summary>
        /// The type carried in <c>CommandResult.payload</c> on success, or null
        /// when the command answers a bare <see cref="CommandResult"/>.
        /// </summary>
        public Type Payload { get; set; }

        /// <summary>
        /// The exact type the dispatch resolves with, for a command that does
        /// not answer a <see cref="CommandResult"/> at all. Mutually exclusive
        /// with <see cref="Payload"/>.
        /// </summary>
        public Type Result { get; set; }

        /// <summary>
        /// Whether this command rides the Courier's light-time delay. Default
        /// <c>true</c>: an order to a craft crosses the gap like any other
        /// signal, and only a fact with no analogue in flight is instant.
        ///
        /// <para>THIS IS THE ONLY PLACE THE ANSWER IS WRITTEN DOWN. The host
        /// reads it here when it dispatches
        /// (<c>Sitrep.Host.CommandDelayCatalog</c>), and the SDK codegen writes
        /// the same value into <c>GENERATED_COMMAND_RAIL</c>, which is what a
        /// client's delay UX reads. Before this property the mod stated it on
        /// <see cref="CommandDeclaration"/> and the client kept a hand-written
        /// set of ids, and the two disagreed about 52 commands: the mod ran them
        /// instantly while every console drew a countdown and an in-flight queue
        /// row for them.</para>
        ///
        /// <para>Three things earn <c>false</c>, and the rule is the SIMULATION's
        /// point of view rather than one console's. A command that changes the
        /// SCENE (launch, recover, revert, switch vessel, the tracking station)
        /// changes it for every vantage at once, so there is no light-time for it
        /// to ride. A meta-game control (warp, pause) is not a signal to a craft.
        /// A PRESENTATION choice (which frame a readout is in, which vantage a
        /// trajectory is drawn for) sends nothing anywhere at all. Everything
        /// else delays, career and construction orders included: those are orders,
        /// not ground-side facts, and a second command centre can issue them.</para>
        /// </summary>
        public bool Delayed { get; set; } = true;

        public SitrepCommandAttribute(string commandId)
        {
            CommandId = commandId;
        }
    }
}
