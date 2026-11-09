using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>What <see cref="CrewTransferRule"/> needs to know about one requested move.</summary>
    public sealed class CrewMoveFacts
    {
        /// <summary>A crew transfer is open in the game, or an earlier move is still finishing.</summary>
        public string? Busy { get; set; }
        public bool KerbalAboard { get; set; }
        /// <summary>The part the kerbal is actually in.</summary>
        public string? KerbalPartId { get; set; }
        public PartSeats? Source { get; set; }
        public bool DestinationExists { get; set; }
        public PartSeats? Destination { get; set; }
        public int DestinationCrew { get; set; }
    }

    /// <summary>
    /// The refusals for <c>vessel.crew.transfer</c> that depend only on the game's
    /// own rules, in the order the game meets them. What a mod decides comes after,
    /// from the game's transfer events.
    /// </summary>
    public static class CrewTransferRule
    {
        public const string Command = "vessel.crew.transfer";

        /// <summary>Why the move cannot go ahead, or null when it can.</summary>
        public static (RefusalCode Code, string? Detail)? Refusal(CrewTransferArgs args, CrewMoveFacts facts)
        {
            if (facts.Busy != null)
            {
                return (CommandErrorCode.WrongState, facts.Busy);
            }
            if (!facts.KerbalAboard)
            {
                return (CommandErrorCode.NotFound, null);
            }
            if (facts.KerbalPartId != args.FromPartId)
            {
                return (CommandErrorCode.WrongState, "has moved");
            }
            if (facts.Source == null || !facts.Source.TransferAvailable || facts.Source.IsExternalSeat)
            {
                return (CommandErrorCode.CapabilityMismatch, "cannot leave this seat");
            }
            if (!facts.DestinationExists)
            {
                return (CommandErrorCode.NotFound, null);
            }
            if (args.ToPartId == args.FromPartId)
            {
                return (CommandErrorCode.WrongState, "already in this part");
            }
            if (facts.Destination == null || !facts.Destination.TransferAvailable || facts.Destination.IsExternalSeat)
            {
                return (CommandErrorCode.CapabilityMismatch, "crew cannot move into this part");
            }
            if (facts.DestinationCrew >= facts.Destination.Capacity)
            {
                return (CommandErrorCode.LimitReached, "no free seat");
            }
            return null;
        }
    }
}
