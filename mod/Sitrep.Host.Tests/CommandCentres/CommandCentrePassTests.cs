using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.CommandCentres;
using Xunit;

namespace Sitrep.Host.Tests.CommandCentres
{
    public class CommandCentrePassTests
    {
        private sealed class CountingSource : ICommandCentreSource
        {
            public int Walks;

            public string ProviderId => "counting";

            public IEnumerable<ICommandCentre> Enumerate()
            {
                Walks++;
                yield return new FakeCommandCentre("ksc", active: true);
            }
        }

        [Fact]
        public void ReadersInsideAPassShareOneWalkOfTheSources()
        {
            var source = new CountingSource();
            var registry = new CommandCentreRegistry();
            registry.RegisterSource(source);

            registry.BeginPass();
            var first = registry.EnumerateActive();
            var second = registry.EnumerateActive();
            registry.EndPass();

            Assert.Same(first, second);
            Assert.Equal(1, source.Walks);
        }

        [Fact]
        public void AReaderOutsideAPassWalksTheSourcesEveryTime()
        {
            var source = new CountingSource();
            var registry = new CommandCentreRegistry();
            registry.RegisterSource(source);

            registry.EnumerateActive();
            registry.EnumerateActive();

            Assert.Equal(2, source.Walks);
        }

        [Fact]
        public void ANewPassWalksTheSourcesAgain()
        {
            var source = new CountingSource();
            var registry = new CommandCentreRegistry();
            registry.RegisterSource(source);

            registry.BeginPass();
            registry.EnumerateActive();
            registry.EndPass();
            registry.BeginPass();
            registry.EnumerateActive();
            registry.EndPass();

            Assert.Equal(2, source.Walks);
        }
    }
}
