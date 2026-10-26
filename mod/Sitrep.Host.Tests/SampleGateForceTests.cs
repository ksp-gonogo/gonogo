using Xunit;

namespace Sitrep.Host.Tests
{
    public class SampleGateForceTests
    {
        [Fact]
        public void AForcedSampleBecomesTheLastSample()
        {
            var load = new LoadState();
            load.Seed("FLIGHT");
            var gate = new SampleGate(load);
            Assert.True(gate.Admit(100, 1, 10));
            Assert.False(gate.Admit(100, 1, 10.5));

            Assert.True(gate.TryForce(100, 10.6));

            Assert.False(gate.AdmitFrame(100, 1, 11.2, timeScale: 0));
            Assert.True(gate.AdmitFrame(100, 1, 11.7, timeScale: 0));
        }

        [Fact]
        public void IsRefusedWhileASceneIsLoading()
        {
            var gate = new SampleGate(new LoadState());

            Assert.False(gate.TryForce(100, 10));
        }
    }
}
