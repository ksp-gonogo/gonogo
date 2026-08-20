using System;
using System.IO;
using System.Reflection;
using Sitrep.Contract;
using Xunit;

namespace Sitrep.Contract.Tests
{
    /// <summary>
    /// `ControlChannelDescriptor` reflects over the contract assembly, and its own
    /// doc states the rule that makes that safe: anything reflecting over the
    /// control-channel attribute "must never have to resolve an external
    /// assembly". The implementation broke that rule, and thirteen tests in this
    /// very suite failed because of it for a month while reading as either
    /// contention or stale build output.
    ///
    /// <para>These are the first tests this type has ever had, which is most of
    /// the explanation for how it survived. They are contract-reflection tests,
    /// not integration tests: the question is whether a consumer that references
    /// `Sitrep.Contract` and NOT the codegen package can reflect over it. This
    /// project exists to be that consumer, and its csproj carries the rule.</para>
    /// </summary>
    public class ControlChannelDescriptorReflectionTests
    {
        /// <summary>
        /// Is the compile-time-only codegen package resolvable in this process?
        /// It should NOT be: `Sitrep.Contract.csproj` references it
        /// `PrivateAssets="all"` with no `runtime` asset, deliberately, because a
        /// deployed net472 assembly carrying Reinforced.Typings attributes would
        /// make Kopernicus fail to resolve them at KSP startup.
        /// </summary>
        private static bool ReinforcedTypingsIsResolvable()
        {
            try
            {
                Assembly.Load("Reinforced.Typings");
                return true;
            }
            catch (Exception ex) when (ex is FileNotFoundException || ex is FileLoadException || ex is BadImageFormatException)
            {
                return false;
            }
        }

        /// <summary>
        /// The environment invariant, asserted rather than assumed.
        ///
        /// <para>The two behavioural tests below can only prove anything where
        /// the package is absent; where it is present they pass vacuously, and a
        /// vacuous pass is exactly how the original defect hid. So the condition
        /// is a test of its own: if this fails, this tree has leftover build
        /// output and the other two are not measuring what they claim. The fix is
        /// to nuke `mod/**/bin` and `mod/**/obj` and rebuild, never to make
        /// anything depend on the DLL being there.</para>
        /// </summary>
        [Fact]
        public void TheCodegenPackageIsNotResolvableInThisProject()
        {
            Assert.False(
                ReinforcedTypingsIsResolvable(),
                "Reinforced.Typings resolved at runtime in the one project whose entire purpose is not "
                    + "having it. Either this tree has leftover build output (nuke mod/**/bin and mod/**/obj "
                    + "and rebuild), or someone added the reference, which this project's csproj says never "
                    + "to do. Until it is gone the other tests here pass vacuously, which is precisely how a "
                    + "month-long bug hid.");
        }

        /// <summary>
        /// The regression. On the netstandard2.0 contract every property carries
        /// Reinforced.Typings' `[TsProperty]`, and asking for ONE attribute type
        /// still makes the runtime materialise the property's whole attribute
        /// list, so the scan had to resolve an assembly that is correctly absent.
        /// It threw `FileNotFoundException` from inside the pending-uplink object
        /// initializer, which aborted `ProcessDispatchCommand` before the command
        /// was handed to the Courier: a delayed command was neither enqueued nor
        /// delivered, which is why the failures split across
        /// `UplinkPendingQueueTests` and the delayed-dispatch tests.
        /// </summary>
        [Fact]
        public void ValueKeyByCommandScansTheContractWithoutResolvingTheCodegenPackage()
        {
            var map = ControlChannelDescriptor.ValueKeyByCommand();

            // Non-empty is the point: pre-fix this threw, and a fail-soft that
            // returned an EMPTY map would look just as green to a test that only
            // asserted "did not throw", while still losing every commanded value
            // on the wire.
            Assert.NotEmpty(map);
        }

        /// <summary>
        /// The negative: the scan must still find real declarations, so the guard
        /// cannot be a blanket catch that quietly skips every property. Without
        /// this, swallowing everything would satisfy the test above.
        /// </summary>
        [Fact]
        public void ValueKeyByCommandStillResolvesADeclaredControlChannelToItsValueKey()
        {
            var map = ControlChannelDescriptor.ValueKeyByCommand();

            // A concrete declaration rather than a count, so a shrinking scan is
            // caught and not merely a total collapse. Camel-cased because that is
            // the wire form the decoded args bag is keyed by.
            Assert.True(
                map.TryGetValue("vessel.control.setSas", out var key),
                "vessel.control.setSas declares a control channel and must be in the map");
            Assert.Equal("enabled", key);
        }
    }
}
