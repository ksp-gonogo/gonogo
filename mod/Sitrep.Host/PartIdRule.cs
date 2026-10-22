using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// A part id names one part. A save in which two parts carry the same persistent id (a cloned
    /// save, for one) breaks that, and a command that picks one of them has guessed which part the
    /// operator meant, so it refuses and says why.
    /// </summary>
    public static class PartIdRule
    {
        /// <summary>
        /// The refusal for an id that more than one part carries, or null when it names at most
        /// one part.
        /// </summary>
        /// <param name="partId">The id the command named.</param>
        /// <param name="matches">How many parts on the craft carry it.</param>
        public static CommandResult? AmbiguousRefusal(string partId, int matches)
        {
            if (matches <= 1)
            {
                return null;
            }

            return CommandResult.Fail(
                CommandErrorCode.WrongState,
                "more than one part on the craft carries the id " + partId
                + ", so it is not clear which one is meant; the save has duplicated part ids");
        }
    }
}
