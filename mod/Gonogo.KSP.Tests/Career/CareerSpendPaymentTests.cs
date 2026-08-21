using System;
using System.IO;
using Xunit;

namespace Gonogo.KSP.Tests.Career
{
    /// <summary>
    /// Who pays for a career spend: the console, or KSP's own call.
    ///
    /// <para>Three of the career actuator's spends look identical on the page
    /// and are not. A facility upgrade and a tech unlock leave the debit to
    /// their caller, so we make it. A crew hire does NOT:
    /// <c>KerbalRoster.HireApplicant</c> fires
    /// <c>GameEvents.OnCrewmemberHired</c>, <c>Funding.OnAwake</c> subscribed
    /// <c>onCrewHired</c> to that event, and <c>onCrewHired</c> is
    /// <c>AddFunds(-GameVariables.Instance.GetRecruitHireCost(crewCount), CrewRecruited)</c>.
    /// The event fires BEFORE the applicant becomes crew, so the count it
    /// carries is the same pre-hire count our price was quoted at: the two
    /// debits are equal, and a console hire charged exactly twice.</para>
    ///
    /// <para><b>Why this reads the source.</b> The rule is "do not make this
    /// call", and a call that is not made is only observable where it would
    /// have been. Every runtime route to it is shut: <c>Funding</c> is a
    /// <c>ScenarioModule</c> whose <c>Instance</c> is null headlessly, and
    /// <c>KerbalRoster</c>'s constructor NREs in
    /// <c>GenerateExperienceTraitTypes</c> outside a loaded game, so neither the
    /// actuator nor the game's own hire can be entered by a test. Reading the
    /// method the rule is about is the remaining instrument, and it is the same
    /// shape as <c>UplinkIsolationTests</c>'s file scan.</para>
    ///
    /// <para><b>The scan proves it can see a debit.</b> A source scan that
    /// silently matches nothing reports no violations, which is
    /// indistinguishable from success. So the upgrade path, which genuinely
    /// must debit, is asserted to still contain the call this looks for. If
    /// the extraction breaks, that test fails first and says so, rather than
    /// the hire test passing on an empty string.</para>
    /// </summary>
    public class CareerSpendPaymentTests
    {
        [Fact]
        public void TheHirePathLeavesTheRecruitCostToKspsOwnEventHandler()
        {
            var body = MethodBody("KspCareerActuator.cs", "public CommandResult HireApplicant(");

            Assert.Contains("roster.HireApplicant(applicant)", body);
            Assert.DoesNotContain(
                "AddFunds",
                body);
        }

        /// <summary>
        /// The control. <c>UpgradeableFacility.SetLevel</c> fires the upgrade
        /// events and debits nothing, and stock's own
        /// <c>SpaceCenterBuilding.UpgradeFacility</c> deducts explicitly, so the
        /// console has to. That this scan still FINDS that debit is what says the
        /// hire assertion above is looking at a real method body.
        /// </summary>
        [Fact]
        public void TheFacilityUpgradePathStillDebitsItself()
        {
            var body = MethodBody("KspCareerActuator.cs", "public CommandResult UpgradeFacility(");

            Assert.Contains("funding.AddFunds(-cost, TransactionReasons.StructureConstruction)", body);
        }

        /// <summary>
        /// One method's body, from its signature to the brace that closes it.
        /// Throws rather than returning empty when the signature is not there:
        /// a renamed method must fail loudly, not silently pass every assertion
        /// made about it.
        /// </summary>
        private static string MethodBody(string fileName, string signature)
        {
            var path = Path.Combine(ResolveModDir(), "Gonogo.KSP", fileName);
            var source = File.ReadAllText(path);
            var start = source.IndexOf(signature, StringComparison.Ordinal);
            if (start < 0)
            {
                throw new InvalidOperationException($"{fileName} has no \"{signature}\"");
            }

            var open = source.IndexOf('{', start);
            if (open < 0)
            {
                throw new InvalidOperationException($"{fileName}'s \"{signature}\" has no body");
            }

            var depth = 0;
            for (var i = open; i < source.Length; i++)
            {
                if (source[i] == '{') depth++;
                else if (source[i] == '}')
                {
                    depth--;
                    if (depth == 0) return source.Substring(open, i - open + 1);
                }
            }

            throw new InvalidOperationException($"{fileName}'s \"{signature}\" body never closes");
        }

        /// <summary>Walks up from the test assembly to the checked-out <c>mod/</c> directory.</summary>
        private static string ResolveModDir()
        {
            var directory = new DirectoryInfo(AppContext.BaseDirectory);
            while (directory is not null)
            {
                if (Directory.Exists(Path.Combine(directory.FullName, "mod", "Gonogo.KSP")))
                {
                    return Path.Combine(directory.FullName, "mod");
                }
                directory = directory.Parent;
            }

            throw new InvalidOperationException(
                "Could not locate mod/ walking up from " + AppContext.BaseDirectory);
        }
    }
}
