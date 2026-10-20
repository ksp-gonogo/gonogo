using System;
using Xunit;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// What <see cref="IScienceRunBackend"/> promises, for an implementer to run
    /// against their own backend.
    /// </summary>
    public static class ScienceRunConformance
    {
        /// <summary>
        /// Asserts what needs no vessel: a start or stop that names no part is
        /// refused as <see cref="CommandErrorCode.NotFound"/> for the experiment and
        /// the lab commands alike, and none of the four throws.
        /// </summary>
        /// <param name="backend">The backend under test.</param>
        public static void AssertRunBackendContract(IScienceRunBackend backend)
        {
            Assert.NotNull(backend);
            var name = backend.GetType().Name;
            var none = new ExperimentActionArgs { PartId = "" };

            AssertRefusedNotFound(name + ".StartExperiment", () => backend.StartExperiment(none));
            AssertRefusedNotFound(name + ".StopExperiment", () => backend.StopExperiment(none));
            AssertRefusedNotFound(name + ".StartLab", () => backend.StartLab(none));
            AssertRefusedNotFound(name + ".StopLab", () => backend.StopLab(none));
        }

        /// <summary>
        /// Asserts that start and stop are idempotent on one instrument or lab the
        /// caller has set up, which is the promise that makes a resent command safe:
        /// the second start (or stop) succeeds, reports <see cref="RunStateChange.Changed"/>
        /// false and leaves <see cref="RunStateChange.Running"/> as it was, and the
        /// first of each reports a change. The target must begin switched off.
        /// </summary>
        /// <param name="start">Sends the start command for the target.</param>
        /// <param name="stop">Sends the stop command for the same target.</param>
        public static void AssertStartAndStopAreIdempotent(
            Func<CommandResult> start, Func<CommandResult> stop)
        {
            AssertChange("first start", start(), changed: true, running: true);
            AssertChange("second start", start(), changed: false, running: true);
            AssertChange("first stop", stop(), changed: true, running: false);
            AssertChange("second stop", stop(), changed: false, running: false);
        }

        /// <summary>
        /// Asserts the refusal a part with several continuous experiments owes: a
        /// start or stop that names the part but no <see cref="ExperimentActionArgs.ExperimentId"/>
        /// is refused as <see cref="CommandErrorCode.NotFound"/> and switches
        /// nothing, because it cannot say which experiment is meant.
        /// </summary>
        /// <param name="backend">The backend under test.</param>
        /// <param name="partIdWithSeveralContinuousExperiments">The id of a part that holds more than one continuous experiment.</param>
        public static void AssertSeveralExperimentsNeedAnExperimentId(
            IScienceRunBackend backend, string partIdWithSeveralContinuousExperiments)
        {
            Assert.NotNull(backend);
            var name = backend.GetType().Name;
            var ambiguous = new ExperimentActionArgs { PartId = partIdWithSeveralContinuousExperiments };

            AssertRefusedNotFound(name + ".StartExperiment without an experiment id", () => backend.StartExperiment(ambiguous));
            AssertRefusedNotFound(name + ".StopExperiment without an experiment id", () => backend.StopExperiment(ambiguous));
        }

        private static void AssertRefusedNotFound(string command, Func<CommandResult> send)
        {
            CommandResult? result = null;
            Exception? thrown = null;
            try
            {
                result = send();
            }
            catch (Exception ex)
            {
                thrown = ex;
            }

            Assert.True(thrown == null, command + " threw " + thrown + ". A command returns a refusal and never throws.");
            Assert.NotNull(result);
            Assert.False(result!.Success, command + " with no part succeeded. It names nothing to switch.");
            Assert.True(
                result.ErrorCode == CommandErrorCode.NotFound,
                command + " with no part was refused as " + result.ErrorCode + ", not notFound.");
        }

        private static void AssertChange(string step, CommandResult result, bool changed, bool running)
        {
            Assert.NotNull(result);
            Assert.True(result.Success, "The " + step + " was refused: " + result.ErrorCode + ".");
            var typed = Assert.IsAssignableFrom<CommandResult<RunStateChange>>(result);
            Assert.NotNull(typed.Payload);
            Assert.True(
                typed.Payload!.Changed == changed,
                "The " + step + " reported changed=" + typed.Payload.Changed
                + ", expected " + changed + ". Start and stop are idempotent: only a press that switched something reports a change.");
            Assert.True(
                typed.Payload.Running == running,
                "The " + step + " reported running=" + typed.Payload.Running + ", expected " + running + ".");
        }
    }
}
