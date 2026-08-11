using Gonogo.KerbalismUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoKerbalismUplink.Tests
{
    /// <summary>
    /// The elected instance itself, as opposed to its mapper
    /// (<see cref="ScienceExtensionWireTests"/>): that it satisfies the capability
    /// interface, answers under the provider id its namespaces are keyed by, serves
    /// the stash it was handed, and refuses the two commands it cannot honestly
    /// perform.
    ///
    /// <para>The election MECHANICS (a provider above vanilla wins, vanilla wins
    /// when absent, discovery order cannot lose a provider) are proven against the
    /// real <c>Kernel</c> in <c>Sitrep.Host.Tests.ScienceElectionTests</c>. They
    /// cannot be proven HERE with the real backend, because this project deliberately
    /// compiles only the KSP-free files of a KSP-referencing Uplink and never
    /// references <c>Sitrep.Host</c>. What is provable here is the half that the
    /// election then hands the topics to, which is what this file does.</para>
    /// </summary>
    public class KerbalismScienceBackendTests
    {
        private static ScienceRaw Modeled() => new ScienceRaw
        {
            Modeled = true,
            Sensors =
            {
                new ScienceSensorRaw
                {
                    PartId = "400", PartName = "2HOT Thermometer",
                    Type = "temperature", Readout = "293.1 K", Active = true,
                },
            },
        };

        /// <summary>
        /// The id the Kernel elects it under IS the key its extension namespaces live
        /// at. If those two ever diverged, the election would work and every client
        /// reader would return undefined, which is the quietest possible failure.
        /// </summary>
        [Fact]
        public void TheBackendIdIsTheProviderIdItsNamespacesAreKeyedBy()
        {
            IScienceBackend backend = new KerbalismScienceBackend();

            Assert.Equal(KerbalismScienceMap.ProviderId, backend.BackendId);
        }

        /// <summary>
        /// Before the first main-thread capture lands, every read is null rather than
        /// an empty list: the channels stay unborn and silent instead of publishing
        /// "this vessel has no science" during the window between Register and the
        /// first tick.
        /// </summary>
        [Fact]
        public void BeforeTheFirstCaptureEveryReadIsNull()
        {
            IScienceBackend backend = new KerbalismScienceBackend();

            Assert.Null(backend.Experiments(null));
            Assert.Null(backend.Instruments(null));
            Assert.Null(backend.Sensors(null));
            Assert.Null(backend.Lab(null));
            Assert.Null(backend.ExperimentBreakdown(null));
        }

        /// <summary>
        /// A stashed capture is what the reads serve, and it serves the LATEST one:
        /// the whole point of the stash is that the Courier-thread mapper answers
        /// from the most recent main-thread read rather than reaching for live KSP
        /// itself.
        /// </summary>
        [Fact]
        public void TheReadsServeTheLatestStash()
        {
            var backend = new KerbalismScienceBackend();

            backend.Stash(Modeled());
            Assert.NotNull(backend.Sensors(null));

            backend.Stash(new ScienceRaw { Modeled = false });
            Assert.Null(backend.Sensors(null));
        }

        /// <summary>
        /// Both commands refuse with a typed error rather than reporting a success
        /// that changed nothing. Kerbalism has no fire-once run (running is a
        /// continuous state its own machine owns) and no send-now transmit (files
        /// drain highest-value-first whenever link and EC allow), so an OK here would
        /// be a lie the operator acts on.
        /// </summary>
        [Fact]
        public void BothCommandsRefuseInsteadOfClaimingASuccessTheyCannotDeliver()
        {
            IScienceBackend backend = new KerbalismScienceBackend();
            var args = new ExperimentActionArgs { PartId = "102" };

            var deploy = backend.DeployExperiment(args);
            var transmit = backend.TransmitExperiment(args);

            Assert.False(deploy.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, deploy.ErrorCode);
            Assert.False(transmit.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, transmit.ErrorCode);
        }
    }
}
