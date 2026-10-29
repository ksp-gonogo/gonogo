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

        [Fact]
        public void ADeclinedTickGivesItsSlotBackSoTheNextTickIsAdmitted()
        {
            var load = new LoadState();
            load.Seed("FLIGHT");
            var gate = new SampleGate(load);
            Assert.True(gate.Admit(100, 1, 10));

            Assert.True(gate.Admit(101.0, 1, 11));
            gate.Decline();

            Assert.True(gate.Admit(101.02, 1, 11.02));
            Assert.False(gate.Admit(101.5, 1, 11.5));
        }

        [Fact]
        public void DecliningTwiceGivesBackOnlyTheLastAdmission()
        {
            var load = new LoadState();
            load.Seed("FLIGHT");
            var gate = new SampleGate(load);
            Assert.True(gate.Admit(100, 1, 10));
            Assert.True(gate.Admit(101.0, 1, 11));
            gate.Decline();
            gate.Decline();

            Assert.True(gate.Admit(101.02, 1, 11.02));
            Assert.False(gate.Admit(101.5, 1, 11.5));
        }

        [Fact]
        public void ADeclinedForcedSampleGivesItsSlotBack()
        {
            var load = new LoadState();
            load.Seed("FLIGHT");
            var gate = new SampleGate(load);
            Assert.True(gate.Admit(100, 1, 10));
            Assert.True(gate.TryForce(100.5, 10.5));
            gate.Decline();

            Assert.False(gate.Admit(100.6, 1, 10.6));
            Assert.True(gate.Admit(101.0, 1, 11));
        }
    }
}
