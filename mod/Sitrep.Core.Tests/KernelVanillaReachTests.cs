using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// A provider that wins an election can still reach the vanilla it displaced.
    ///
    /// <para>It could not before, and the gap was invisible from the outside:
    /// <c>ctx.Query</c> answers with whatever is ACTIVE, so a winner asking for its
    /// own capability during activation found nothing (its instances are not
    /// published until its factory returns) and afterwards found itself. There was
    /// no third answer, and the only way to get one was to ship a second copy of
    /// the vanilla's maths inside the provider.</para>
    ///
    /// <para>Why a provider wants one: displacing an implementation is not the
    /// same as having no further use for it. The transfer-window search is a
    /// patched-conic tool by design, because that is what mission design is, so a
    /// provider modelling something else still needs conic answers to drive
    /// it.</para>
    /// </summary>
    public class KernelVanillaReachTests
    {
        private const string Capability = "propagation";

        private sealed class Vanilla
        {
            public int Serial { get; }
            public Vanilla(int serial) => Serial = serial;
        }

        private sealed class Winner
        {
            public object? Displaced { get; }
            public Winner(object? displaced) => Displaced = displaced;
        }

        private static Kernel WithVanilla(Func<ProviderContext, object?> vanilla)
        {
            var kernel = new Kernel();
            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = Capability,
                Exclusive = true,
                Vanilla = vanilla,
            });
            return kernel;
        }

        private static void Resolve(Kernel kernel) =>
            kernel.Resolve(new ResolveOptions { KernelVersion = "1.0.0" });

        [Fact]
        public void AWinningProviderReachesTheVanillaItDisplaced()
        {
            var serial = 0;
            var kernel = WithVanilla(_ => new Vanilla(++serial));
            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = Capability,
                Id = "integrated",
                Priority = 10,
                Factory = ctx => new Winner(ctx.Vanilla<Vanilla>(Capability)),
            });

            Resolve(kernel);

            var elected = kernel.Query<Winner>(Capability);
            Assert.IsType<Vanilla>(elected.Displaced);
        }

        /// <summary>
        /// The vanilla is one object per resolution, shared by everyone who asks
        /// and by the fallback path itself. Two instances would mean a stock
        /// install had one vanilla on the wire and a second one some provider was
        /// quietly consulting, which is a difference nothing would report.
        /// </summary>
        [Fact]
        public void EveryoneAskingGetsTheSameVanillaAsTheFallbackPath()
        {
            var built = 0;
            var kernel = WithVanilla(_ => new Vanilla(++built));

            var reached = new List<object?>();
            kernel.RegisterCapability(new CapabilityDescriptor { Id = "observer", Exclusive = true });
            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = "observer",
                Id = "observer",
                Deps = new[] { Capability },
                Factory = ctx =>
                {
                    reached.Add(ctx.Vanilla<Vanilla>(Capability));
                    reached.Add(ctx.Vanilla<Vanilla>(Capability));
                    return "observed";
                },
            });

            Resolve(kernel);

            Assert.Equal(1, built);
            Assert.Same(reached[0], reached[1]);
            Assert.Same(kernel.Query<Vanilla>(Capability), reached[0]);
        }

        [Fact]
        public void AReResolutionBuildsItsOwnVanilla()
        {
            var built = 0;
            var kernel = WithVanilla(_ => new Vanilla(++built));

            Resolve(kernel);
            var first = kernel.Query<Vanilla>(Capability);
            Resolve(kernel);
            var second = kernel.Query<Vanilla>(Capability);

            Assert.NotSame(first, second);
            Assert.Equal(2, built);
        }

        [Fact]
        public void ACapabilityWithNoVanillaSaysSoRatherThanHandingBackNull()
        {
            var kernel = new Kernel();
            kernel.RegisterCapability(new CapabilityDescriptor { Id = Capability, Exclusive = true });
            Exception? thrown = null;
            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = Capability,
                Id = "integrated",
                Factory = ctx =>
                {
                    try
                    {
                        return ctx.Vanilla<object>(Capability);
                    }
                    catch (Exception error)
                    {
                        thrown = error;
                        throw;
                    }
                },
            });

            Resolve(kernel);

            Assert.NotNull(thrown);
            Assert.Contains("declares no vanilla", thrown!.Message);
        }

        /// <summary>
        /// A vanilla factory asking for its own vanilla cannot terminate, and
        /// unguarded it recurses until the stack goes, inside a factory, where the
        /// resulting trace names none of this.
        /// </summary>
        [Fact]
        public void AVanillaAskingForItsOwnVanillaIsNamedRatherThanHanging()
        {
            Exception? thrown = null;
            var kernel = WithVanilla(ctx =>
            {
                try
                {
                    return ctx.Vanilla<object>(Capability);
                }
                catch (Exception error)
                {
                    thrown = error;
                    return new Vanilla(0);
                }
            });

            Resolve(kernel);

            Assert.NotNull(thrown);
            Assert.Contains("cannot terminate", thrown!.Message);
        }
    }
}
