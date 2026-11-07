using System;
using System.Collections.Generic;

namespace Sitrep.Host
{
    /// <summary>
    /// The commands a client may send from <see cref="ChannelEngine.MetaVantage"/>, the
    /// vantage that runs a command at once on every path instead of from a command centre.
    /// A command belongs here only when it acts on the game or the program itself, from
    /// the Kerbal Space Center desk, and sending it from a command centre would put a
    /// signal delay on something that has no craft at the other end. A command that
    /// reaches a craft, spends from a command centre's own budget or needs a place to
    /// speak from never qualifies. An Uplink opens one of its own commands the same way
    /// through <see cref="Sitrep.Contract.CommandDeclaration.AllowMetaVantage"/>. The core commands are the ones tagged
    /// with <see cref="Sitrep.Contract.SitrepCommandAttribute.AllowMetaVantage"/>. Every
    /// other command sent with the meta vantage is refused with its reason, so a new
    /// command is delayed by default until its tag or its Uplink's declaration opens it.
    /// </summary>
    public static class MetaVantageCommands
    {
        /// <summary>
        /// The approved core and slice commands, read from the contract assemblies'
        /// <see cref="Sitrep.Contract.SitrepCommandAttribute.AllowMetaVantage"/> tags.
        /// </summary>
        public static IReadOnlyList<string> Approved => CommandDelayCatalog.MetaVantageCommandIds();

        /// <summary>
        /// True when <paramref name="command"/> may be sent from the meta vantage: its
        /// command is tagged <see cref="Sitrep.Contract.SitrepCommandAttribute.AllowMetaVantage"/>, or <paramref name="declaration"/>, its owning
        /// Uplink's declaration, sets <see cref="Sitrep.Contract.CommandDeclaration.AllowMetaVantage"/>.
        /// </summary>
        public static bool IsApproved(string? command, Sitrep.Contract.CommandDeclaration? declaration = null) =>
            command != null && (CommandDelayCatalog.AllowsMetaVantage(command) || declaration?.AllowMetaVantage == true);

        /// <summary>The sentence a refused command is answered with.</summary>
        public static string RefusalFor(string? command) =>
            $"'{command}' cannot be sent from the meta vantage, which only the approved program commands and the commands an Uplink opens to it may use";
    }
}
