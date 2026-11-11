using System;

namespace Sitrep.Host.Commcast
{
    /// <summary>What a command that travelled a lane to a centre carries when it arrives there.</summary>
    public sealed class LaneArrival
    {
        public string MessageId = "";
        public string Sender = "";
        public string Recipient = "";
        public string Command = "";
        public object? Args;
        public double SentUt;
        public double AtUt;
    }

    /// <summary>How a command sent down a lane ended, as its sender's centre learned of it.</summary>
    public enum LaneOutcomeKind
    {
        /// <summary>It ran at the recipient and the reply reached the sender.</summary>
        Delivered,

        /// <summary>A cancel caught it, or the sender cancelled it before it left.</summary>
        Cancelled,

        /// <summary>It passed its lifetime before it could run.</summary>
        Expired,
    }

    /// <summary>One ending of a lane command, said to the sender's side.</summary>
    public sealed class LaneOutcome
    {
        public string MessageId = "";
        public string Sender = "";
        public string Recipient = "";
        public string Command = "";
        public object? Args;
        public LaneOutcomeKind Kind;
        public double AtUt;
    }

    /// <summary>
    /// What the messaging Uplink asks of the engine beyond addressed delivery: to
    /// send a command from one centre to another down a lane, through the same
    /// store-and-forward delivery and the same uplink queue any command uses,
    /// and to keep its own record with the game.
    ///
    /// <para>Implemented by the engine and reached by casting the
    /// <c>IUplinkHost</c> handed to <c>Register</c>, like
    /// <see cref="IAddressedStreamHost"/>.</para>
    /// </summary>
    public interface ILaneHost
    {
        /// <summary>
        /// Runs <paramref name="arrives"/> on the Courier thread when a command named
        /// <paramref name="command"/> reaches its recipient. The command is internal:
        /// no client can send it, only <see cref="SendLaneCommand"/> can.
        /// </summary>
        void RegisterLaneHandler(string command, Func<LaneArrival, object?> arrives);

        /// <summary>Calls <paramref name="ended"/> on the Courier thread when a command named <paramref name="command"/> ends at its sender's centre.</summary>
        void RegisterLaneOutcome(string command, Action<LaneOutcome> ended);

        /// <summary>
        /// Sends <paramref name="command"/> from <paramref name="sender"/> to
        /// <paramref name="recipient"/>, both centres or craft: it waits for a path,
        /// shows in the sender's uplink queue under <paramref name="label"/>, can be
        /// cancelled there, and is deleted after <paramref name="lifetimeSeconds"/>.
        /// Courier thread only. Returns the message id. A command that is not
        /// <paramref name="listed"/> carries a notice nobody waits on, takes no place
        /// in the uplink queue and cannot be cancelled.
        /// </summary>
        string SendLaneCommand(string sender, string recipient, string command, object? args, string label, double lifetimeSeconds, bool listed = true);

        /// <summary>
        /// Keeps one string of the caller's own with each save of the game and gives
        /// it back when a save is loaded. <paramref name="now"/> may be called from
        /// any thread and returns null when there is nothing to keep;
        /// <paramref name="restoreAtReset"/> is called on the Courier thread when a
        /// timeline is reset, with the string the loaded save held, or null when it
        /// held none or no save is being restored.
        /// </summary>
        void RegisterSaveSection(string name, Func<string?> now, Action<string?> restoreAtReset);
    }
}
