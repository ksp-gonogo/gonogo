using Sitrep.Contract;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// A refused command carries both halves of a refined refusal on the wire:
    /// the root a client classifies it by, and the refinement that says which of
    /// the root's cases it was.
    /// </summary>
    public class RefinedRefusalWireTests
    {
        private static readonly RefusalCode NoSuchThing =
            CommandErrorCode.NotFound.Refine("planted.noSuchThing", "no such thing aboard");

        /// <summary>
        /// Two refusals that share a root are told apart only by <c>reason</c>, so
        /// a result that dropped it would read as the bare root to every client.
        /// </summary>
        [Fact]
        public void ARefusedCommandCarriesItsRootAndItsReasonOnTheWire()
        {
            var json = Sitrep.Contract.Serialization.EnvelopeCodec.WriteCommandResponse(new CommandResponse<object?>
            {
                RequestId = "r1",
                Result = CommandResult<ScienceTransmission>.Fail(NoSuchThing),
                Meta = new Meta { Source = "system", Vantage = "v" },
            });

            Assert.Contains("\"success\":false", json);
            Assert.Contains("\"errorCode\":\"notFound\"", json);
            Assert.Contains("\"reason\":\"planted.noSuchThing\"", json);
        }
    }
}
