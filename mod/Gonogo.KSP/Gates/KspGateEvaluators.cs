using System;
using System.Collections.Generic;
using Contracts;
using Gonogo.KSP.Career;
using Sitrep.Contract;
using Strategies;

namespace Gonogo.KSP.Gates
{
    /// <summary>
    /// The <see cref="ICommandGateEvaluator"/> set, one per authority KSP
    /// actually publishes.
    ///
    /// <para>Every <see cref="CommandRequirement.Kind"/> below names a real
    /// authority and nothing else: <c>HighLogic.CurrentGame.Mode</c>,
    /// <c>HighLogic.LoadedScene</c>, <c>GameVariables</c>'s facility-limit
    /// surface, <c>GameVariables</c>'s <c>Unlocked*</c> switches,
    /// <c>FlightGlobals.ClearToSave()</c>, and the <c>PreFlightTests</c>
    /// namespace. A kind invented here would be a gate with nothing behind
    /// it.</para>
    ///
    /// <para><b>Why a gate rather than another check in the actuator.</b> A
    /// declared requirement is evaluated by the engine BEFORE the handler runs,
    /// and the same declaration evaluated with an empty argument bag is the
    /// addressability answer: whether the control should be live at all. That is
    /// the difference between pressing a button to find out the pad is occupied
    /// and being told before committing. Thirty-eight of the forty refusals this
    /// mod makes are askable that far in advance.</para>
    ///
    /// <para><b>Fail-soft, and never fail-open.</b> A live read that throws or
    /// finds nothing to read comes back <see cref="GateOutcome.Unknown"/>, never
    /// Pass: treating an unreadable limit as no limit is how a gate fails open,
    /// and the contract says so. Unknown also refuses the dispatch, so the
    /// direction of the mistake is the safe one.</para>
    ///
    /// <para><b>An authority that does not exist is not an authority that could
    /// not be read.</b> The facility gates are the one place the two used to be
    /// confused: <c>ScenarioUpgradeableFacilities</c> is absent from a sandbox
    /// save because sandbox HAS no facility tiers, and answering Unknown there
    /// refused capabilities that are maximally available. That is decided by
    /// <see cref="FacilityGateHelp.ReadFacilityTiers"/>, from the game mode, and
    /// it narrows Unknown rather than widening Pass: a career save whose scenario
    /// has not woken up yet still answers Unknown.</para>
    /// </summary>
    internal static class KspGateEvaluators
    {
        public static IEnumerable<ICommandGateEvaluator> All()
        {
            yield return new GameModeGate();
            yield return new SceneGate();
            yield return new FacilityLimitGate();
            yield return new FacilityUnlockedGate();
            yield return new ClearToSaveGate();
            yield return new PreFlightGate();
        }

        /// <summary>Requirement kinds, spelled once so a declaration and its evaluator cannot drift apart on a typo.</summary>
        public static class Kinds
        {
            public const string GameMode = "game-mode";
            public const string Scene = "scene";
            public const string FacilityLimit = "facility-limit";
            public const string FacilityUnlocked = "facility-unlocked";
            public const string ClearToSave = "clear-to-save";
            public const string PreFlight = "preflight";
        }

        /// <summary>Quantities the facility gates understand, spelled once for the same reason.</summary>
        public static class Quantities
        {
            public const string ActiveCrew = "activeCrew";
            public const string ActiveContracts = "activeContracts";
            public const string ActiveStrategies = "activeStrategies";
            public const string FlightPlanning = "flightPlanning";
            public const string FuelTransfer = "fuelTransfer";
            public const string Eva = "eva";
            public const string ManeuverTool = "maneuverTool";
            public const string LaunchSiteClear = "launchSiteClear";
            public const string FacilityOperational = "facilityOperational";

            /// <summary>
            /// Whether <see cref="FacilityLimitGate"/> knows this quantity.
            ///
            /// <para>Asked BEFORE the gate decides anything about facility tiers,
            /// so a declaration naming a limit that does not exist answers
            /// Unknown in every mode rather than passing in the modes where the
            /// tiers happen not to matter. A typo must not be answered
            /// confidently by the one save shape that never reads it.</para>
            /// </summary>
            public static bool IsFacilityLimit(string quantity) =>
                quantity == ActiveCrew || quantity == ActiveContracts || quantity == ActiveStrategies;

            /// <summary>Whether <see cref="FacilityUnlockedGate"/> knows this quantity, and why it is asked first.</summary>
            public static bool IsUnlockable(string quantity) =>
                quantity == FlightPlanning || quantity == FuelTransfer
                    || quantity == Eva || quantity == ManeuverTool;
        }
    }

    /// <summary>
    /// Authority: <c>HighLogic.CurrentGame.Mode</c> (<c>Game.Modes</c>).
    ///
    /// <para><see cref="CommandRequirement.Quantity"/> is the mode the command
    /// needs, e.g. <c>CAREER</c>. This is a permanent property of the save
    /// rather than a state that changes, which is precisely why it belongs on a
    /// gate: a career control in a sandbox game should never be live.</para>
    /// </summary>
    internal sealed class GameModeGate : ICommandGateEvaluator
    {
        public string Kind => KspGateEvaluators.Kinds.GameMode;

        public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
        {
            Game.Modes actual;
            try
            {
                var game = HighLogic.CurrentGame;
                if (game == null) return GateVerdict.Unknown("no game is loaded");
                actual = game.Mode;
            }
            catch (Exception ex)
            {
                return GateVerdict.Unknown("could not read the game mode: " + ex.Message);
            }

            var required = requirement.Quantity ?? "";
            if (string.Equals(actual.ToString(), required, StringComparison.OrdinalIgnoreCase))
            {
                return GateVerdict.Pass();
            }
            // Career and science both have an R&D tree and a Mission Control, so
            // a command needing "CAREER" is genuinely refused in SCIENCE_SANDBOX
            // and the mode names say which.
            return GateVerdict.Fail(
                CommandErrorCode.CareerModeRequired,
                $"this save is a {GameWords.Phrase(actual)} game");
        }
    }

    /// <summary>
    /// Authority: <c>HighLogic.LoadedScene</c> (<c>GameScenes</c>).
    ///
    /// <para><see cref="CommandRequirement.Quantity"/> is a <c>|</c>-separated
    /// list of the scenes the command may run from, because several commands
    /// accept more than one and a requirement per scene would AND them into
    /// something unreachable.</para>
    /// </summary>
    internal sealed class SceneGate : ICommandGateEvaluator
    {
        public string Kind => KspGateEvaluators.Kinds.Scene;

        public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
        {
            GameScenes actual;
            try
            {
                actual = HighLogic.LoadedScene;
            }
            catch (Exception ex)
            {
                return GateVerdict.Unknown("could not read the loaded scene: " + ex.Message);
            }

            foreach (var allowed in (requirement.Quantity ?? "").Split('|'))
            {
                if (string.Equals(allowed.Trim(), actual.ToString(), StringComparison.OrdinalIgnoreCase))
                {
                    return GateVerdict.Pass();
                }
            }
            return GateVerdict.Fail(
                CommandErrorCode.WrongScene, $"the game is in the {GameWords.Phrase(actual)} scene");
        }
    }

    /// <summary>
    /// Authority: <c>GameVariables.Get*Limit(ScenarioUpgradeableFacilities.GetFacilityLevel(facility))</c>,
    /// against the live count the game keeps beside it.
    ///
    /// <para>The rules themselves live in <see cref="CareerRefusals"/>, shared
    /// with the actuator so the gate and the handler cannot give different
    /// answers to the same question. They still both exist: the gate is what
    /// makes the control dark before it is pressed, the actuator's check is what
    /// holds when the actuator is called directly.</para>
    /// </summary>
    internal sealed class FacilityLimitGate : ICommandGateEvaluator
    {
        private readonly Func<bool> _scenarioLoaded;
        private readonly Func<Game.Modes?> _gameMode;

        /// <summary>
        /// The two live reads that decide whether the tiers exist arrive as
        /// delegates so a headless test can enter this method at all. Nothing
        /// else in <see cref="Evaluate"/> is reachable outside a running KSP -
        /// <c>GameVariables</c> and <c>ContractSystem</c> are MonoBehaviours and
        /// <c>HighLogic.CurrentGame</c>'s setter is a no-op without one - so an
        /// evaluator written only against the statics has a
        /// <see cref="FacilityTierRead"/> branch nothing can execute, which is
        /// how the sandbox refusal survived being written down twice.
        /// </summary>
        public FacilityLimitGate(
            Func<bool>? scenarioLoaded = null, Func<Game.Modes?>? gameMode = null)
        {
            _scenarioLoaded = scenarioLoaded ?? FacilityGateHelp.FacilitiesScenarioLoaded;
            _gameMode = gameMode ?? FacilityGateHelp.CurrentGameMode;
        }

        public string Kind => KspGateEvaluators.Kinds.FacilityLimit;

        public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
        {
            // Both first, because a declaration naming a facility or a limit KSP
            // does not have is wrong in every mode and must not be answered by
            // any of them.
            if (!FacilityGateHelp.TryParseFacility(requirement.Facility, out var facility))
            {
                return GateVerdict.Unknown($"KSP has no facility called \"{requirement.Facility}\"");
            }
            if (!KspGateEvaluators.Quantities.IsFacilityLimit(requirement.Quantity))
            {
                return GateVerdict.Unknown($"no facility limit is named \"{requirement.Quantity}\"");
            }

            var tiers = FacilityGateHelp.ReadFacilityTiers(_scenarioLoaded(), _gameMode());
            if (tiers == FacilityTierRead.Unreadable)
            {
                return GateVerdict.Unknown("the facilities scenario is not loaded");
            }
            // No tiers means no tier-imposed cap: GameVariables answers every one
            // of these limits with its unlimited sentinel at the top level, so
            // this is the same verdict a live read would give, reached without
            // needing the career systems that hold the counts.
            if (tiers == FacilityTierRead.AlwaysMax) return GateVerdict.Pass();

            var gameVariables = GameVariables.Instance;
            if (gameVariables == null) return GateVerdict.Unknown("GameVariables is not loaded");

            try
            {
                var norm = ScenarioUpgradeableFacilities.GetFacilityLevel(facility);
                var id = facility.ToString();
                var name = FacilityGateHelp.DisplayName(facility);
                LimitBreach? breach;
                switch (requirement.Quantity)
                {
                    case KspGateEvaluators.Quantities.ActiveCrew:
                        var roster = HighLogic.CurrentGame?.CrewRoster;
                        if (roster == null) return GateVerdict.Unknown("there is no crew roster");
                        breach = CareerRefusals.CrewCapBreach(
                            id, name, norm, roster.GetActiveCrewCount(), gameVariables.GetActiveCrewLimit(norm));
                        break;
                    case KspGateEvaluators.Quantities.ActiveContracts:
                        var contracts = ContractSystem.Instance;
                        if (contracts == null) return GateVerdict.Unknown("there is no contract system");
                        breach = CareerRefusals.ActiveContractsBreach(
                            id, name, norm, contracts.GetActiveContractCount(),
                            gameVariables.GetActiveContractsLimit(norm));
                        break;
                    case KspGateEvaluators.Quantities.ActiveStrategies:
                        var strategies = StrategySystem.Instance;
                        if (strategies == null) return GateVerdict.Unknown("there is no strategy system");
                        breach = CareerRefusals.ActiveStrategiesBreach(
                            id, name, norm, FacilityGateHelp.ActiveStrategyCount(strategies),
                            gameVariables.GetActiveStrategyLimit(norm));
                        break;
                    default:
                        // Unreachable past the guard above, and kept as the arm
                        // that catches a quantity added to one list and not the
                        // other. Unknown is the safe way for that to be wrong.
                        return GateVerdict.Unknown(
                            $"no facility limit is named \"{requirement.Quantity}\"");
                }

                return breach == null
                    ? GateVerdict.Pass()
                    : GateVerdict.Fail(CommandErrorCode.LimitReached, breach);
            }
            catch (Exception ex)
            {
                return GateVerdict.Unknown("could not read the facility limit: " + ex.Message);
            }
        }
    }

    /// <summary>
    /// Authority: <c>GameVariables</c>'s <c>Unlocked*</c> switches, each read at
    /// the owning facility's normalised level. A capability that exists in the
    /// game but not yet in this save.
    ///
    /// <para>"Not yet in this save" is what makes the sandbox answer obvious
    /// once it is said out loud: there is no yet. Flight planning is Mission
    /// Control's, patched conics is the Tracking Station's, and a save with no
    /// facility tiers has both at their ceiling from the first second. Refusing
    /// there refused a capability in the one mode where it is maximally
    /// available, which is the worst direction for the mistake to run.</para>
    /// </summary>
    internal sealed class FacilityUnlockedGate : ICommandGateEvaluator
    {
        private readonly Func<bool> _scenarioLoaded;
        private readonly Func<Game.Modes?> _gameMode;

        /// <summary>Same test seam, and for the same reason, as <see cref="FacilityLimitGate"/>'s.</summary>
        public FacilityUnlockedGate(
            Func<bool>? scenarioLoaded = null, Func<Game.Modes?>? gameMode = null)
        {
            _scenarioLoaded = scenarioLoaded ?? FacilityGateHelp.FacilitiesScenarioLoaded;
            _gameMode = gameMode ?? FacilityGateHelp.CurrentGameMode;
        }

        public string Kind => KspGateEvaluators.Kinds.FacilityUnlocked;

        public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
        {
            // Both first, for the same reason as in FacilityLimitGate above.
            if (!FacilityGateHelp.TryParseFacility(requirement.Facility, out var facility))
            {
                return GateVerdict.Unknown($"KSP has no facility called \"{requirement.Facility}\"");
            }
            if (!KspGateEvaluators.Quantities.IsUnlockable(requirement.Quantity))
            {
                return GateVerdict.Unknown($"no unlockable capability is named \"{requirement.Quantity}\"");
            }

            var tiers = FacilityGateHelp.ReadFacilityTiers(_scenarioLoaded(), _gameMode());
            if (tiers == FacilityTierRead.Unreadable)
            {
                return GateVerdict.Unknown("the facilities scenario is not loaded");
            }
            // Every facility at its ceiling unlocks every switch read off one, so
            // the answer is yes without asking GameVariables which yes it is.
            if (tiers == FacilityTierRead.AlwaysMax) return GateVerdict.Pass();

            var gameVariables = GameVariables.Instance;
            if (gameVariables == null) return GateVerdict.Unknown("GameVariables is not loaded");

            try
            {
                var norm = ScenarioUpgradeableFacilities.GetFacilityLevel(facility);
                bool unlocked;
                switch (requirement.Quantity)
                {
                    case KspGateEvaluators.Quantities.FlightPlanning:
                        unlocked = gameVariables.UnlockedFlightPlanning(norm);
                        break;
                    case KspGateEvaluators.Quantities.FuelTransfer:
                        unlocked = gameVariables.UnlockedFuelTransfer(norm);
                        break;
                    case KspGateEvaluators.Quantities.Eva:
                        unlocked = gameVariables.UnlockedEVA(norm);
                        break;
                    case KspGateEvaluators.Quantities.ManeuverTool:
                        unlocked = gameVariables.ManeuverToolAvailable(norm);
                        break;
                    default:
                        // Unreachable past the guard above; same backstop, same
                        // reason, as FacilityLimitGate's.
                        return GateVerdict.Unknown(
                            $"no unlockable capability is named \"{requirement.Quantity}\"");
                }

                return unlocked
                    ? GateVerdict.Pass()
                    : GateVerdict.Fail(
                        CommandErrorCode.NotUnlocked,
                        $"the {FacilityGateHelp.DisplayName(facility)} has not unlocked it yet");
            }
            catch (Exception ex)
            {
                return GateVerdict.Unknown("could not read the facility capability: " + ex.Message);
            }
        }
    }

    /// <summary>
    /// Authority: <c>FlightGlobals.ClearToSave()</c>, which returns one of five
    /// named refusals. The arm rides on the
    /// verdict's detail, which is the part an operator acts on: "throttled up"
    /// and "about to crash" want opposite responses.
    /// </summary>
    internal sealed class ClearToSaveGate : ICommandGateEvaluator
    {
        public string Kind => KspGateEvaluators.Kinds.ClearToSave;

        public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
        {
            try
            {
                // Deliberately NOT ActiveVesselScope: this only guards the
                // FlightGlobals.ClearToSave() call below, which judges whatever KSP
                // itself has active. Asking about the ship while stock answers about
                // the kerbal would make the gate disagree with the thing it quotes.
                if (FlightGlobals.fetch == null || FlightGlobals.ActiveVessel == null)
                {
                    return GateVerdict.Unknown("there is no flight to judge");
                }
                var status = FlightGlobals.ClearToSave();
                return status == ClearToSaveStatus.CLEAR
                    ? GateVerdict.Pass()
                    : GateVerdict.Fail(CommandErrorCode.NotClearToProceed, GameWords.Phrase(status));
            }
            catch (Exception ex)
            {
                return GateVerdict.Unknown("could not ask whether the flight is clear: " + ex.Message);
            }
        }
    }

    /// <summary>
    /// Authority: the <c>PreFlightTests</c> namespace, KSP's own launch refusal
    /// vocabulary. <c>IPreFlightTest</c> is designed to be enumerated:
    /// <c>Test()</c> is a pure query and <c>GetWarningTitle()</c> /
    /// <c>GetWarningDescription()</c> are the game's own words for the answer,
    /// so this gate quotes rather than composes.
    ///
    /// <para>Only the two tests that need no <c>ShipConstruct</c> are run here:
    /// <c>LaunchSiteClear</c> and <c>FacilityOperational</c>. The mass, size,
    /// part-count and experimental-part tests all take the built ship, which
    /// this mod does not have at gate time. They are the natural next
    /// requirement, and they need the craft loaded first.</para>
    ///
    /// <para>The site is read from the call's own <c>site</c> argument when there
    /// is one, and falls back to the declared
    /// <see cref="CommandRequirement.Facility"/>. Deliberately NOT through
    /// <see cref="CommandRequirement.Needs"/>: needing the argument would make
    /// the requirement abstain with an empty bag, which is exactly the
    /// addressability answer we want it to give. Same question, answered with
    /// whatever is known.</para>
    /// </summary>
    internal sealed class PreFlightGate : ICommandGateEvaluator
    {
        public string Kind => KspGateEvaluators.Kinds.PreFlight;

        public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
        {
            var site = requirement.Facility ?? "";
            if (arguments.TryGet("site", out var supplied) && supplied is string suppliedSite &&
                !string.IsNullOrEmpty(suppliedSite))
            {
                site = suppliedSite;
            }

            try
            {
                PreFlightTests.IPreFlightTest test;
                CommandErrorCode code;
                switch (requirement.Quantity)
                {
                    case KspGateEvaluators.Quantities.LaunchSiteClear:
                        test = new PreFlightTests.LaunchSiteClear(site, site);
                        code = CommandErrorCode.SiteOccupied;
                        break;
                    case KspGateEvaluators.Quantities.FacilityOperational:
                        test = new PreFlightTests.FacilityOperational(site, site);
                        code = CommandErrorCode.FacilityDamaged;
                        break;
                    default:
                        return GateVerdict.Unknown(
                            $"no pre-flight test is named \"{requirement.Quantity}\"");
                }

                if (test.Test()) return GateVerdict.Pass();
                return GateVerdict.Fail(code, PreFlightWords(test));
            }
            catch (Exception ex)
            {
                return GateVerdict.Unknown("could not run the pre-flight test: " + ex.Message);
            }
        }

        /// <summary>
        /// The game's own sentence for this refusal: the description if it has
        /// one, else the title. Both go through <c>Localizer</c>, so they arrive
        /// in the player's language.
        /// </summary>
        private static string PreFlightWords(PreFlightTests.IPreFlightTest test)
        {
            try
            {
                var description = test.GetWarningDescription();
                if (!string.IsNullOrWhiteSpace(description)) return description;
                return test.GetWarningTitle() ?? "";
            }
            catch (Exception)
            {
                return "";
            }
        }
    }

    /// <summary>
    /// What a facility gate can learn about this save's facility tiers.
    /// </summary>
    internal enum FacilityTierRead
    {
        /// <summary><c>ScenarioUpgradeableFacilities</c> is there; read it.</summary>
        Live,

        /// <summary>
        /// This save has no facility tiers at all, so every one of them is at
        /// its ceiling and nothing tier-gated is short.
        /// </summary>
        AlwaysMax,

        /// <summary>
        /// The scenario should be there and is not, which is a scene mid-load,
        /// not a fact about the save.
        /// </summary>
        Unreadable,
    }

    /// <summary>Shared reads the facility gates both need.</summary>
    internal static class FacilityGateHelp
    {
        /// <summary>
        /// Whether the facility tiers are readable, absent because the save has
        /// none, or merely missing.
        ///
        /// <para><b>Both of the last two present identically</b> - a null
        /// <c>ScenarioUpgradeableFacilities.Instance</c> - and they want opposite
        /// answers, so the discriminator has to come from somewhere else. It is
        /// the game MODE, which is what KSP itself decides scenario existence
        /// from: <c>Game.CreateNew</c> and <c>Game.UpdateScenarioModules</c> both
        /// switch on <c>Game.Mode</c> and add a scenario only when its
        /// <c>[KSPScenario]</c> options name that mode.
        /// <c>ScenarioUpgradeableFacilities</c> is declared
        /// <c>(ScenarioCreationOptions)1056</c>, which is
        /// <c>AddToNewMissionGames | AddToNewCareerGames</c> and names neither
        /// sandbox. So in <c>SANDBOX</c> and <c>SCIENCE_SANDBOX</c> the scenario
        /// is never created and a null Instance is permanent; in <c>CAREER</c> it
        /// is created, so a null Instance is a load that has not finished and
        /// Unknown is still the honest answer. <c>Game.Mode</c> is a plain field
        /// on the save, set before any scenario module exists, so it is readable
        /// in exactly the window where the scenario is not.</para>
        ///
        /// <para><b>Max is not a fail-open guess, it is what stock already
        /// answers.</b> <c>ScenarioUpgradeableFacilities.GetFacilityLevel(string)</c>
        /// is a STATIC that starts its result at <c>1f</c> and only lowers it
        /// when <c>protoUpgradeables</c> has an entry for the facility, so a
        /// sandbox save already reads every facility at its top tier through
        /// KSP's own code path, with or without an Instance. The refusal came
        /// from our null-Instance guard, never from anything the game declined
        /// to tell us.</para>
        ///
        /// <para>The training-scenario modes are deliberately NOT in the max
        /// list. <c>SCENARIO</c>, <c>SCENARIO_NON_RESUMABLE</c> and
        /// <c>MISSION_BUILDER</c> get neither arm of KSP's own dispatch, so
        /// whether they carry the scenario depends on the file they were built
        /// from and we genuinely do not know.</para>
        /// </summary>
        public static FacilityTierRead ReadFacilityTiers(bool scenarioLoaded, Game.Modes? mode)
        {
            if (scenarioLoaded) return FacilityTierRead.Live;
            if (mode == Game.Modes.SANDBOX || mode == Game.Modes.SCIENCE_SANDBOX)
            {
                return FacilityTierRead.AlwaysMax;
            }
            return FacilityTierRead.Unreadable;
        }

        /// <summary>Whether the facilities scenario is in this game.</summary>
        public static bool FacilitiesScenarioLoaded()
        {
            try
            {
                return ScenarioUpgradeableFacilities.Instance != null;
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>
        /// This save's mode, or null when there is no game to ask. Null lands on
        /// <see cref="FacilityTierRead.Unreadable"/>, which is right: no game
        /// loaded is not a sandbox game.
        /// </summary>
        public static Game.Modes? CurrentGameMode()
        {
            try
            {
                return HighLogic.CurrentGame?.Mode;
            }
            catch (Exception)
            {
                return null;
            }
        }

        public static bool TryParseFacility(string name, out SpaceCenterFacility facility)
        {
            foreach (SpaceCenterFacility candidate in Enum.GetValues(typeof(SpaceCenterFacility)))
            {
                if (string.Equals(candidate.ToString(), name, StringComparison.Ordinal))
                {
                    facility = candidate;
                    return true;
                }
            }
            facility = SpaceCenterFacility.LaunchPad;
            return false;
        }

        /// <summary>The facility as the GAME names it, through <c>Localizer</c>.</summary>
        public static string DisplayName(SpaceCenterFacility facility)
        {
            try
            {
                return ScenarioUpgradeableFacilities.GetFacilityName(facility) ?? "";
            }
            catch (Exception)
            {
                return "";
            }
        }

        /// <summary>
        /// How many strategies are active right now.
        /// <c>Administration.Instance.ActiveStrategyCount</c> is what stock
        /// reads, and it is a UI MonoBehaviour that is null anywhere but the
        /// Administration screen, so the roster is counted directly instead.
        /// </summary>
        public static int ActiveStrategyCount(StrategySystem system)
        {
            var count = 0;
            if (system.Strategies == null) return 0;
            foreach (var strategy in system.Strategies)
            {
                if (strategy != null && strategy.IsActive) count++;
            }
            return count;
        }
    }
}
