using System;
using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// The <see cref="LaunchAuthority"/> rule as a gate on <c>ksp.launch</c>:
    /// whether the command centre sending the launch is in the launch site's
    /// planetary system.
    ///
    /// <para>A dispatch and a <c>system.gate.check</c> run this same evaluator,
    /// so the answer an operator reads before pressing is the one the press
    /// meets. It needs the sender and the <c>site</c> argument, which the
    /// published gate set has neither of, so there it abstains.</para>
    /// </summary>
    public sealed class LaunchAuthorityGate : IVantageGateEvaluator
    {
        /// <summary>The requirement kind this evaluator resolves.</summary>
        public const string GateKind = "launch-authority";

        /// <summary>The argument that names the launch site.</summary>
        public const string SiteArgument = "site";

        private readonly Func<string, string, LaunchReach> _reachOf;

        /// <param name="reachOf">Reads where a sending centre and a site are, as <see cref="IFlightOpsActuator.ReachOf"/> does.</param>
        public LaunchAuthorityGate(Func<string, string, LaunchReach> reachOf)
        {
            _reachOf = reachOf ?? throw new ArgumentNullException(nameof(reachOf));
        }

        /// <summary>The requirement a launch declares: the site it names, judged from the centre sending it.</summary>
        public static CommandRequirement Requirement() => new CommandRequirement
        {
            Kind = GateKind,
            Needs = new[] { SiteArgument },
            NeedsVantage = true,
        };

        public string Kind => GateKind;

        public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments) =>
            GateVerdict.Unknown("a launch's authority is decided from the sending command centre, and none was supplied");

        public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments, string vantage)
        {
            arguments.TryGet(SiteArgument, out var named);
            var site = named as string;
            var refusal = LaunchAuthority.Refusal(vantage, site, () => _reachOf(vantage, site ?? ""));
            if (refusal == null)
            {
                return GateVerdict.Pass();
            }

            // A system that could not be read says nothing about the launch, so it
            // is the unreadable answer rather than a refusal.
            return Equals(refusal.ErrorCode, CommandErrorCode.Unreadable)
                ? GateVerdict.Unknown(refusal.Detail ?? "")
                : GateVerdict.Fail(refusal.ErrorCode!, refusal.Detail ?? "");
        }
    }
}
