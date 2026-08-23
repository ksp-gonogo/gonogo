using Sitrep.Contract;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// A vantage-aware command has to survive the DISPATCH gate, not merely be
    /// registered.
    ///
    /// <para>Written after the live game refused `vessel.trajectory.forVantage` with
    /// the same sentence it gives a command that does not exist. Every unit test
    /// asserted registration and every one passed: the gate reads a different store
    /// from the one the invoke reads, and nothing joined them.</para>
    /// </summary>
    public class VantageCommandDispatchTests
    {
        [Fact]
        public void AVantageAwareCommandIsRecognisedByTheDispatcher()
        {
            // The engine registers exactly one command into the vantage store, so
            // nothing else in the tree would have exposed this.
            // Not started and not disposed: these read registration state only, and
            // Stop() joins a thread Start() never created.
            var engine = new ChannelEngine("ws://127.0.0.1:0");

            Assert.True(
                engine.RecognisesCommandForTests(ChannelEngine.PlanForVantageCommand),
                "the dispatcher must recognise a command registered into the "
                    + "vantage-aware store, or it refuses it as unknown before the "
                    + "handler is reached");
        }

        [Fact]
        public void ACommandNobodyRegisteredIsStillNotRecognised()
        {
            // The control. Without it the assertion above passes against a gate that
            // recognises everything, which refuses nothing and is worse.
            // Not started and not disposed: these read registration state only, and
            // Stop() joins a thread Start() never created.
            var engine = new ChannelEngine("ws://127.0.0.1:0");

            Assert.False(engine.RecognisesCommandForTests("vessel.notAThing"));
        }
    }
}
