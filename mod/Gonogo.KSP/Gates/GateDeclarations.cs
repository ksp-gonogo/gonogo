using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host;

namespace Gonogo.KSP.Gates
{
    /// <summary>
    /// What each gated command requires, in one table.
    ///
    /// <para>Held here rather than inline in each Uplink's manifest so the
    /// declarations can be paired with their evaluators by a headless test. The
    /// Uplinks that own these commands cannot be constructed outside a running
    /// KSP (their discovery constructors build the real actuators), and a
    /// mismatched <see cref="CommandRequirement.Kind"/> would otherwise be found
    /// only by the mod refusing to start.</para>
    ///
    /// <para>Every requirement below is STATIC:
    /// <see cref="CommandRequirement.Needs"/> is empty, so the engine can decide
    /// it with no arguments at all. That is what turns a refusal into an
    /// askable-in-advance fact, which is the difference between pressing a
    /// button to find out the pad is occupied and being told first.</para>
    /// </summary>
    internal static class GateDeclarations
    {
        private static readonly Dictionary<string, CommandRequirement[]> Table = Build();

        /// <summary>The requirements for one command, or none if it is ungated.</summary>
        public static CommandRequirement[] For(string command) =>
            Table.TryGetValue(command, out var requires) ? requires : new CommandRequirement[0];

        /// <summary>Every gated command and its requirements, for a test to walk.</summary>
        public static IEnumerable<KeyValuePair<string, CommandRequirement[]>> All() => Table;

        private static Dictionary<string, CommandRequirement[]> Build()
        {
            var table = new Dictionary<string, CommandRequirement[]>();

            // Every career-write command needs a career save. That is a
            // permanent property of the game rather than a state that changes,
            // and undeclared it arrives as the same ModeUnavailable as "the
            // crew cap is full", leaving an operator unable to tell a control
            // that will never work here from one that might in a minute.
            foreach (var command in new[]
            {
                CareerCommandProvider.ActivateStrategyCommand,
                CareerCommandProvider.DeactivateStrategyCommand,
                CareerCommandProvider.UnlockTechCommand,
                CareerCommandProvider.AcceptContractCommand,
                CareerCommandProvider.DeclineContractCommand,
                CareerCommandProvider.CancelContractCommand,
                CareerCommandProvider.UpgradeFacilityCommand,
                CareerCommandProvider.HireApplicantCommand,
                CareerCommandProvider.FireCrewCommand,
            })
            {
                table[command] = new[] { CareerGates.CareerMode };
            }

            // The Administration Building's cap: Strategy.CanBeActivated's own
            // first arm, asked here because that method dereferences
            // Administration.Instance and so cannot be called off-screen.
            table[CareerCommandProvider.ActivateStrategyCommand] = new[]
            {
                CareerGates.CareerMode,
                CareerGates.FacilityLimit(
                    SpaceCenterFacility.Administration, KspGateEvaluators.Quantities.ActiveStrategies),
            };

            // Mission Control's active-contract cap, which stock enforces only
            // by greying its own Accept button, so every caller that is not that
            // screen walks past it.
            table[CareerCommandProvider.AcceptContractCommand] = new[]
            {
                CareerGates.CareerMode,
                CareerGates.FacilityLimit(
                    SpaceCenterFacility.MissionControl, KspGateEvaluators.Quantities.ActiveContracts),
            };

            table[CareerCommandProvider.HireApplicantCommand] = new[]
            {
                CareerGates.CareerMode,
                CareerGates.FacilityLimit(
                    SpaceCenterFacility.AstronautComplex, KspGateEvaluators.Quantities.ActiveCrew),
            };

            // Recovery is destructive and KSP will not do it while the craft is
            // throttled up, on a ladder, or about to hit something.
            // ClearToSaveStatus names all seven arms and needs no arguments, so
            // the control goes dark WITH the arm.
            table[FlightOpsCommandProvider.RecoverCommand] = new[]
            {
                CareerGates.ClearToSave,
            };

            // Launch's scene rule, plus the two PreFlightTests that need no
            // built ship. The pad being occupied is the case that used to wedge
            // KSP, and the game has always known it in advance. The mass, size,
            // part-count and experimental-part tests all take the built
            // ShipConstruct, which this mod does not have at gate time; they are
            // the natural next requirement.
            table[FlightOpsCommandProvider.LaunchCommand] = new[]
            {
                CareerGates.Scene(GameScenes.SPACECENTER, GameScenes.EDITOR),
                CareerGates.PreFlight(
                    SpaceCenterFacility.LaunchPad.ToString(),
                    KspGateEvaluators.Quantities.FacilityOperational),
                CareerGates.PreFlight(
                    SpaceCenterFacility.LaunchPad.ToString(),
                    KspGateEvaluators.Quantities.LaunchSiteClear),
            };

            return table;
        }
    }
}
