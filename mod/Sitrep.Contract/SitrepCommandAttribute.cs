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
    /// own slice declares its own marker, e.g. <c>MechJebNoArgs</c>). The
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

        public SitrepCommandAttribute(string commandId)
        {
            CommandId = commandId;
        }
    }
}
