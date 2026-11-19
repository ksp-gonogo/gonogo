using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// <see cref="IUplinkHost.RequestSample"/>: a burst of requests before the sampling loop acts asks for
    /// one sample, and the request is consumed by it.
    /// </summary>
    public class RequestSampleTests
    {
        [Fact]
        public void ABurstOfRequestsIsOneSample()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.Start();
            IUplinkHost host = engine;

            host.RequestSample();
            host.RequestSample();
            host.RequestSample();

            Assert.True(engine.TakeSampleRequest());
            Assert.False(engine.TakeSampleRequest());
        }

        [Fact]
        public void ARequestAfterTheSampleIsNotLost()
        {
            using var engine = new ChannelEngine("ws://127.0.0.1:0");
            engine.Start();
            IUplinkHost host = engine;

            host.RequestSample();
            Assert.True(engine.TakeSampleRequest());
            host.RequestSample();

            Assert.True(engine.TakeSampleRequest());
        }
    }
}
