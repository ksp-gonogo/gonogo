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
    /// speak from never qualifies. Every other command sent with the meta vantage is
    /// refused with its reason, so a new command is delayed by default until it is
    /// added here.
    /// </summary>
    public static class MetaVantageCommands
    {
        /// <summary>The approved commands, each with why it is exempt from the delay.</summary>
        public static readonly IReadOnlyDictionary<string, string> Approved = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["time.setWarpIndex"] = "the game clock belongs to the program, not to any craft",
            ["time.setPaused"] = "the game clock belongs to the program, not to any craft",
            ["ksp.recover"] = "a scene change made at the space centre",
            ["ksp.recoverVessel"] = "recovery is a space centre action on a craft that is already home",
            ["ksp.revertToLaunch"] = "a scene change made at the space centre",
            ["ksp.revertToEditor"] = "a scene change made at the space centre",
            ["ksp.toSpaceCenter"] = "a scene change made at the space centre",
            ["ksp.toTrackingStation"] = "a scene change made at the space centre",
            ["ksp.switchVessel"] = "changes which craft the game focuses on, and sends nothing to it",
            ["career.contract.accept"] = "a space centre desk action on the career's own contract book",
            ["career.contract.decline"] = "a space centre desk action on the career's own contract book",
            ["career.contract.cancel"] = "a space centre desk action on the career's own contract book",
            ["career.crew.hire"] = "an astronaut complex action on the career's own roster",
            ["career.crew.fire"] = "an astronaut complex action on the career's own roster",
            ["career.facility.upgrade"] = "a space centre building upgrade, made on the ground",
            ["career.strategy.activate"] = "an administration building action on the career's own strategies",
            ["career.strategy.deactivate"] = "an administration building action on the career's own strategies",
            ["career.tech.unlock"] = "a research and development desk action on the career's own tech tree",
            ["settings.save"] = "writes the program's own settings",
            ["settings.mod.write"] = "writes the program's own settings",
        };

        /// <summary>True when <paramref name="command"/> may be sent from the meta vantage.</summary>
        public static bool IsApproved(string? command) =>
            command != null && Approved.ContainsKey(command);

        /// <summary>The sentence a refused command is answered with.</summary>
        public static string RefusalFor(string? command) =>
            $"'{command}' cannot be sent from the meta vantage, which only the approved program commands may use";
    }
}
