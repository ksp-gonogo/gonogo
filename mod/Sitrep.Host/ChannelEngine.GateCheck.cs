using System;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// <c>system.gate.check</c>: the gate a call would meet, answered before the
    /// call is sent.
    /// </summary>
    public sealed partial class ChannelEngine
    {
        /// <summary>The engine-owned command that answers a <see cref="GateCheckRequest"/>.</summary>
        internal const string GateCheckCommand = "system.gate.check";

        /// <summary>
        /// Soft cap on gate checks per second across every connection.
        ///
        /// <para>A check is one evaluation on the main thread, asked when an
        /// operator changes a choice and debounced by the client, so steady state
        /// is a few a second at most. It is not recorded against
        /// <see cref="GateEvaluationBudget"/>, which is sized for the sampler's
        /// roughly constant load and would lose its meaning if an operator's
        /// bursts shared it. Twenty a second is several people dragging a rate
        /// slider at once; more than that is a client asking per keystroke or per
        /// frame.</para>
        /// </summary>
        internal const double GateCheckBudgetPerSec = 20;

        private PerfBudget? _gateCheckBudget;

        private void DeclareGateCheck()
        {
            _commandDeclarations[GateCheckCommand] = new CommandDeclaration { Command = GateCheckCommand };
            _commandArgTypes[GateCheckCommand] = typeof(GateCheckRequest);
            _gateCheckBudget = new PerfBudget(
                "ChannelEngine system.gate.check/sec",
                threshold: GateCheckBudgetPerSec,
                windowSec: 1.0,
                unit: "checks",
                warn: LogHost);
        }

        /// <summary>
        /// Answers a gate check ahead of any handler lookup, since it has none.
        /// True when the job was one.
        /// </summary>
        private bool TryHandleGateCheck(DispatchCommandJob job)
        {
            if (!string.Equals(job.Command, GateCheckCommand, StringComparison.Ordinal))
            {
                return false;
            }
            var request = BindCommandArgs(job.Args, typeof(GateCheckRequest)) as GateCheckRequest;
            var inner = request == null ? null : UnfittingCheckedArgsReason(request);
            if (inner != null)
            {
                if (job.OnMalformed != null) job.OnMalformed(inner);
                else job.OnRefused?.Invoke(FaultCode.InvalidEnvelope, inner);
                job.Done?.Set();
                return true;
            }

            job.OnResult(GateCheck(request, job.Vantage));
            job.Done?.Set();
            return true;
        }

        /// <summary>
        /// Why the arguments a check asks about could not be sent to the command
        /// it names, or null. Only names and types are held to the command's
        /// declared arguments: a check may leave arguments out, since asking
        /// about a command with nothing chosen yet is what it is for.
        /// </summary>
        private string? UnfittingCheckedArgsReason(GateCheckRequest request)
        {
            if (!_commandArgTypes.TryGetValue(request.Command, out var argsType))
            {
                return null;
            }

            var shape = CommandArgsShape.Violation(request.Command, request.Args, argsType, requireAll: false);
            if (shape != null)
            {
                return shape;
            }

            try
            {
                BindCommandArgs(request.Args, argsType);
                return null;
            }
            catch (Exception ex)
            {
                return $"args of \"{request.Command}\" do not bind to {argsType.Name}: {SafeExceptionMessage(ex)}";
            }
        }

        private object GateCheck(GateCheckRequest? request, string vantage)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.Command))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound, "This check could not be read.");
            }
            if (!_commandDeclarations.ContainsKey(request.Command) && !_commandOwner.ContainsKey(request.Command))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound, $"No command is named '{request.Command}'.");
            }

            _gateCheckBudget?.Record(1, _nowRealSec());
            var subject = GateSubject(request.Command, request.Args);
            var verdict = EvaluateGates(request.Command, new GateArguments(subject), vantage);
            return CommandResult<GateVerdict>.Ok(verdict);
        }
    }
}
