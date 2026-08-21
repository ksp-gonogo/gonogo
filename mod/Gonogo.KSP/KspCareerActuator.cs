using System;
using Contracts;
using Gonogo.KSP.Career;
using Sitrep.Contract;
using Sitrep.Host;
using Strategies;
using KSP.UI.Screens;

namespace Gonogo.KSP
{
    /// <summary>
    /// The real <see cref="ICareerActuator"/>: the career-write actuation seam,
    /// wired to <c>StrategySystem</c>/<c>ResearchAndDevelopment</c>/
    /// <c>ContractSystem</c>/<c>ScenarioUpgradeableFacilities</c>/<c>Funding</c>,
    /// each call confirmed against this KSP version's actual API shapes via
    /// decompile (see each method's own comment for the specific call). Every
    /// entity is resolved by the SAME stable id the READ side
    /// (<see cref="KspHost"/>'s career capture) already emits, so a client acts
    /// on exactly what it read.
    ///
    /// <para>Like <see cref="KspVesselActuator"/>, this touches KSP/Unity APIs
    /// directly and runs on the Unity main thread, <see cref="ChannelEngine"/>
    /// is constructed with <c>executeCommandsOnMainThread: true</c>
    /// (<c>GonogoAddon.Awake</c>), so every command handler is marshaled onto the
    /// main-thread pump before it reaches here; no KSP/Unity API below is ever
    /// touched from the Courier thread.</para>
    ///
    /// <para>These are SPEND actions. The two paid paths that KSP does NOT bundle
    /// into a single self-deducting call (tech unlock and facility upgrade)
    /// reproduce the stock spend sequence explicitly (check affordability, deduct
    /// the currency, then apply), returning before any spend on an unaffordable
    /// request. The paths KSP DOES bundle, <c>Strategy.Activate</c>/
    /// <c>Deactivate</c> and <c>Contract.Accept</c>/<c>Decline</c>/<c>Cancel</c>,
    /// are self-gating and self-deducting, so a <c>false</c> return from them
    /// means "not valid in the current state" with no partial spend, surfaced as
    /// <see cref="CommandErrorCode.ModeUnavailable"/>. A crew hire is bundled
    /// too, but through a <c>GameEvents</c> hop rather than inside the call:
    /// see <see cref="HireApplicant"/>.</para>
    /// </summary>
    public sealed class KspCareerActuator : ICareerActuator
    {
        /// <summary>
        /// <c>Strategy.Activate()</c> is self-gating (<c>CanBeActivated</c>) and
        /// self-deducting (its up-front funds/science/reputation cost, each
        /// scaled by <c>Factor</c>), so a <c>false</c> return is a clean
        /// "not eligible" with no partial spend.
        ///
        /// <para><b>Only from the Administration Building, and that is KSP's
        /// rule rather than ours.</b> <c>CanBeActivated</c>'s first three arms
        /// dereference <c>Administration.Instance</c>. The active-strategy count, the
        /// concurrent cap and the commit-level ceiling all live on that
        /// component and nowhere else. It is
        /// <c>KSP.UI.Screens.Administration</c>, a UI <c>MonoBehaviour</c> whose
        /// canvas <c>AdministrationSceneSpawner</c> adds on
        /// <c>onGUIAdministrationFacilitySpawn</c> and removes again on despawn,
        /// so <c>Instance</c> is null everywhere except while the player has
        /// that screen open. <c>Activate()</c> calls <c>CanBeActivated</c>
        /// itself, so with the screen closed BOTH throw: this command used to
        /// raise a <c>NullReferenceException</c> from inside the game, which
        /// <c>ChannelEngine</c> rethrew on the Courier thread as an opaque
        /// error, and the caps the old comment here claimed we honoured were
        /// never reached at all.</para>
        ///
        /// <para>That authority is not substituted for. Nothing here reproduces
        /// the three Administration arms from numbers of our own: with the
        /// screen open the game answers every one of them and the refusal is
        /// quoted verbatim; with it closed the console says so and refuses.
        /// (The concurrent-strategy cap is separately DECLARED on this command
        /// as a gate over <c>GameVariables.GetActiveStrategyLimit</c>, which is
        /// the same method <c>Administration.Start</c> reads it from, so the
        /// control is dark on a full slate either way.)</para>
        ///
        /// <para>The commitment itself is <see cref="StrategyCommit"/>'s: the
        /// factor is written before the gate because the cost scales with it,
        /// and put back if the game refuses.</para>
        /// </summary>
        public CommandResult ActivateStrategy(string strategyId, double factor)
        {
            var system = StrategySystem.Instance;
            if (system == null || system.Strategies == null)
            {
                return CommandResult.Fail(CommandErrorCode.CareerModeRequired);
            }

            var strategy = FindStrategy(system, strategyId);
            if (strategy == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            if (strategy.IsActive)
            {
                return CommandResult.Fail(CommandErrorCode.WrongState, "the strategy is already active");
            }

            if (Administration.Instance == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.NotClearToProceed,
                    "KSP commits a strategy only from the Administration Building, and it is not open");
            }

            return StrategyCommit.Activate(new LiveStrategy(strategy), factor);
        }

        /// <summary>
        /// The real <c>Strategies.Strategy</c> behind
        /// <see cref="IStrategyCommitTarget"/>. Four one-line members, so the
        /// commitment ORDER is testable without one.
        /// </summary>
        private sealed class LiveStrategy : IStrategyCommitTarget
        {
            private readonly Strategy _strategy;

            public LiveStrategy(Strategy strategy) => _strategy = strategy;

            public bool HasFactorSlider => _strategy.HasFactorSlider;

            public float Factor
            {
                get => _strategy.Factor;
                set => _strategy.Factor = value;
            }

            public bool CanBeActivated(out string reason) => _strategy.CanBeActivated(out reason);

            public bool Activate() => _strategy.Activate();
        }

        /// <summary><c>Strategy.Deactivate()</c> is self-gating (<c>CanBeDeactivated</c>, which includes a minimum elapsed commitment), a <c>false</c> return means it wasn't deactivatable right now.</summary>
        public CommandResult DeactivateStrategy(string strategyId)
        {
            var system = StrategySystem.Instance;
            if (system == null || system.Strategies == null)
            {
                return CommandResult.Fail(CommandErrorCode.CareerModeRequired);
            }

            var strategy = FindStrategy(system, strategyId);
            if (strategy == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }
            if (!strategy.IsActive)
            {
                return CommandResult.Fail(CommandErrorCode.WrongState, "the strategy is not active");
            }

            return strategy.Deactivate()
                ? CommandResult.Ok()
                : CommandResult.Fail(
                    CommandErrorCode.WrongState,
                    "the strategy cannot be deactivated yet");
        }

        /// <summary>
        /// Reproduces the stock research spend, in <c>RDTech.ResearchTech</c>'s
        /// own order: state, affordability, science-cost limit, deduct, unlock.
        ///
        /// <para>The node's science cost lives on the STATIC tech tree:
        /// <c>ResearchAndDevelopment.GetTechState</c> only returns a node once
        /// it's already been researched/started, so it can't price a
        /// not-yet-unlocked tech; the cost is read off
        /// <c>AssetBase.RnDTechTree.GetTreeTechs()</c>'s <c>ProtoTechNode[]</c>
        /// (the same proto shape <c>UnlockProtoTechNode</c> consumes). Science is
        /// deducted here because <c>UnlockProtoTechNode</c> itself does not, the
        /// free progress-reward path in stock KSP calls it directly with no
        /// deduction: so on an unaffordable request this returns before any
        /// spend.</para>
        /// </summary>
        public CommandResult UnlockTech(string techId)
        {
            var rnd = ResearchAndDevelopment.Instance;
            var tree = AssetBase.RnDTechTree;
            if (rnd == null || tree == null)
            {
                return CommandResult.Fail(CommandErrorCode.CareerModeRequired);
            }

            if (ResearchAndDevelopment.GetTechnologyState(techId) == RDTech.State.Available)
            {
                return CommandResult.Fail(
                    CommandErrorCode.WrongState,
                    $"the node is already {GameWords.Phrase(RDTech.State.Available)}");
            }

            ProtoTechNode? node = null;
            var treeTechs = tree.GetTreeTechs();
            if (treeTechs != null)
            {
                foreach (var candidate in treeTechs)
                {
                    if (candidate != null && string.Equals(candidate.techID, techId, StringComparison.Ordinal))
                    {
                        node = candidate;
                        break;
                    }
                }
            }
            if (node == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }

            var rndFacility = SpaceCenterFacility.ResearchAndDevelopment;
            var rndNorm = ScenarioUpgradeableFacilities.Instance != null
                ? ScenarioUpgradeableFacilities.GetFacilityLevel(rndFacility)
                : 0f;

            var query = CareerAffordability.Price(
                TransactionReasons.RnDTechResearch, Currency.Science, node.scienceCost);
            if (!CareerAffordability.CanAfford(query, Currency.Science))
            {
                return CommandResult.Fail(
                    CommandErrorCode.InsufficientScience,
                    CareerRefusals.ShortfallBreach(
                        rndFacility.ToString(), FacilityDisplayName(rndFacility), rndNorm,
                        "science", CareerAffordability.PriceOf(query, Currency.Science),
                        rnd.Science, Units.Science));
            }

            // The R&D tier's ceiling on a node's cost, which stock refuses past
            // with OperationResult.ScienceCostLimitExceeded. Read AFTER
            // affordability, which is the order RDTech.ResearchTech uses, so an
            // operator who is both short and over the limit is told the same
            // thing the game would have told them.
            var gameVariables = GameVariables.Instance;
            if (gameVariables != null)
            {
                var overLimit = CareerRefusals.ScienceCostBreach(
                    rndFacility.ToString(), FacilityDisplayName(rndFacility), rndNorm,
                    node.scienceCost, gameVariables.GetScienceCostLimit(rndNorm));
                if (overLimit != null)
                {
                    return CommandResult.Fail(CommandErrorCode.LimitReached, overLimit);
                }
            }

            rnd.AddScience(-(float)node.scienceCost, TransactionReasons.RnDTechResearch);
            rnd.UnlockProtoTechNode(node);
            ResearchAndDevelopment.RefreshTechTreeUI();
            // Stock fires this from RDTech.ResearchTech and we never did, so
            // anything downstream of a tech unlock (ContractSystem reloads its
            // craft definitions off it, and every mod that watches the tree)
            // silently never learned. Fired with a null host because an RDTech is
            // a MonoBehaviour that exists only while the R&D screen has spawned
            // its nodes, and this command is answered from anywhere; stock's own
            // listener ignores the argument entirely, and EventData.Fire catches
            // per listener, so a third-party listener that does dereference it
            // logs rather than taking the command down.
            GameEvents.OnTechnologyResearched.Fire(
                new GameEvents.HostTargetAction<RDTech, RDTech.OperationResult>(
                    null, RDTech.OperationResult.Successful));
            return CommandResult.Ok();
        }

        /// <summary>
        /// <c>Contract.Accept()</c> is self-gating on state (valid only when
        /// Offered) and applies its own funds advance, so a <c>false</c> return
        /// means the contract wasn't in an acceptable state.
        ///
        /// <para>Mission Control's active-contract cap is checked HERE because
        /// nothing else will. Stock enforces it only in
        /// <c>MissionControl.RefreshUIControls</c>, which greys its own Accept
        /// button; <c>Contract.Accept()</c> gates on state alone, so any caller
        /// that is not that screen walks straight past the cap. We are that
        /// caller.</para>
        /// </summary>
        public CommandResult AcceptContract(string contractId) =>
            WithContract(contractId, (system, contract) =>
            {
                var capped = ActiveContractCapBreach(system);
                if (capped != null)
                {
                    return CommandResult.Fail(CommandErrorCode.LimitReached, capped);
                }
                return contract.Accept()
                    ? CommandResult.Ok()
                    : CommandResult.Fail(CommandErrorCode.WrongState, ContractStateName(contract));
            });

        /// <summary><c>Contract.Decline()</c> is self-gating on state (valid only when Offered) and applies its own reputation penalty, a <c>false</c> return means it wasn't declinable.</summary>
        public CommandResult DeclineContract(string contractId) =>
            WithContract(contractId, (_, contract) => contract.Decline()
                ? CommandResult.Ok()
                : CommandResult.Fail(CommandErrorCode.WrongState, ContractStateName(contract)));

        /// <summary><c>Contract.Cancel()</c> is self-gating on state (valid only when Active) and applies its own penalty, a <c>false</c> return means it wasn't cancellable.</summary>
        public CommandResult CancelContract(string contractId) =>
            WithContract(contractId, (_, contract) => contract.Cancel()
                ? CommandResult.Ok()
                : CommandResult.Fail(CommandErrorCode.WrongState, ContractStateName(contract)));

        /// <summary>
        /// Mission Control's cap on simultaneously accepted contracts, or null
        /// when there is room (or nothing to read it from, which fails OPEN: a
        /// gate we cannot evaluate must not refuse something stock allows).
        /// </summary>
        private static LimitBreach? ActiveContractCapBreach(ContractSystem system)
        {
            var gameVariables = GameVariables.Instance;
            if (gameVariables == null || ScenarioUpgradeableFacilities.Instance == null) return null;
            var norm = ScenarioUpgradeableFacilities.GetFacilityLevel(SpaceCenterFacility.MissionControl);
            return CareerRefusals.ActiveContractsBreach(
                SpaceCenterFacility.MissionControl.ToString(),
                FacilityDisplayName(SpaceCenterFacility.MissionControl),
                norm,
                system.GetActiveContractCount(),
                gameVariables.GetActiveContractsLimit(norm));
        }

        /// <summary>The contract's state as the GAME names it: <c>Contract.State</c>'s ten members are each <c>[Description]</c>-tagged.</summary>
        private static string ContractStateName(Contract contract) =>
            $"the contract is {GameWords.Phrase(contract.ContractState)}";

        /// <summary>
        /// Reproduces the stock <c>UpgradeFacilityDialog</c> spend: resolve the
        /// live facility exactly as the read side does
        /// (<c>ScenarioUpgradeableFacilities.protoUpgradeables[SlashSanitize(id)]</c>
        /// → <c>facilityRefs[0]</c>), guard against already-max, read
        /// <c>GetUpgradeCost()</c> (the cost to the next tier), check funds,
        /// deduct, then raise the level. <c>SetLevel</c> fires the upgrade
        /// GameEvents but does NOT deduct, the level increment and the fund
        /// deduction are separate steps, so an unaffordable request returns
        /// before any spend.
        /// </summary>
        public CommandResult UpgradeFacility(string facilityId)
        {
            if (ScenarioUpgradeableFacilities.Instance == null)
            {
                return CommandResult.Fail(CommandErrorCode.CareerModeRequired);
            }

            var sanitizedId = ScenarioUpgradeableFacilities.SlashSanitize(facilityId);
            if (!ScenarioUpgradeableFacilities.protoUpgradeables.TryGetValue(sanitizedId, out var proto) ||
                proto?.facilityRefs == null || proto.facilityRefs.Count == 0 || proto.facilityRefs[0] == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }

            var live = proto.facilityRefs[0];
            var maxTier = CareerRefusals.MaxTierBreach(
                facilityId, FacilityDisplayName(facilityId), live.GetNormLevel(), live.FacilityLevel, live.MaxLevel);
            if (maxTier != null)
            {
                return CommandResult.Fail(CommandErrorCode.AlreadyAtMaximum, maxTier);
            }

            var funding = Funding.Instance;
            if (funding == null)
            {
                return CommandResult.Fail(CommandErrorCode.CareerModeRequired);
            }

            var cost = live.GetUpgradeCost();
            var query = CareerAffordability.Price(
                TransactionReasons.StructureConstruction, Currency.Funds, cost);
            if (!CareerAffordability.CanAfford(query, Currency.Funds))
            {
                return CommandResult.Fail(
                    CommandErrorCode.InsufficientFunds,
                    CareerRefusals.ShortfallBreach(
                        facilityId, FacilityDisplayName(facilityId), live.GetNormLevel(),
                        "funds", CareerAffordability.PriceOf(query, Currency.Funds),
                        funding.Funds, Units.Funds));
            }

            funding.AddFunds(-cost, TransactionReasons.StructureConstruction);
            live.SetLevel(live.FacilityLevel + 1);
            return CommandResult.Ok();
        }

        /// <summary>
        /// Reproduces the stock Astronaut Complex hire. Resolves the applicant by
        /// the SAME <c>ProtoCrewMember.name</c> the read side emits, against the
        /// live pool (<c>KerbalRoster.Applicants</c>); a name that no longer
        /// resolves (a stale pool: hired since, or KSP refreshed it) fails
        /// <see cref="CommandErrorCode.NotFound"/>. Guards the Astronaut Complex
        /// active-crew cap (<c>GameVariables.GetActiveCrewLimit</c> over the
        /// facility's normalised level) before spending, since a hire adds an
        /// active crew member. Outside career (no <c>Funding</c>) it fails
        /// <see cref="CommandErrorCode.CareerModeRequired"/>.
        ///
        /// <para><b>The hire pays for itself, so this must not.</b>
        /// <c>KerbalRoster.HireApplicant</c> fires
        /// <c>GameEvents.OnCrewmemberHired.Fire(ap, GetActiveCrewCount())</c>,
        /// <c>Funding.OnAwake</c> subscribed <c>onCrewHired</c> to that event,
        /// and <c>onCrewHired</c> is
        /// <c>AddFunds(-GameVariables.Instance.GetRecruitHireCost(crewCount), CrewRecruited)</c>.
        /// Stock's own Astronaut Complex calls <c>HireApplicant</c> and nothing
        /// else, for exactly this reason. The event fires BEFORE the applicant
        /// becomes crew, so the count it carries is the same pre-hire count the
        /// price below was quoted at, and a console hire that also debited was
        /// charged precisely double.</para>
        ///
        /// <para>This comment used to assert the opposite, citing a decompile
        /// that only moved the applicant into the crew list. That read was of
        /// the direct call alone: the debit is one <c>GameEvents</c> hop past
        /// the end of the method, and stopping at the call boundary is how a
        /// confirmed-by-decompile note came to say the reverse of what the game
        /// does. The affordability check above stays: it is what stock's own
        /// Vbutton asks, and it is the only thing standing between an operator
        /// and a negative balance, since <c>Funding.OnCurrenciesModified</c> has
        /// no floor at zero.</para>
        /// </summary>
        public CommandResult HireApplicant(string applicantName)
        {
            var roster = HighLogic.CurrentGame?.CrewRoster;
            var funding = Funding.Instance;
            if (roster == null || funding == null)
            {
                return CommandResult.Fail(CommandErrorCode.CareerModeRequired);
            }

            ProtoCrewMember? applicant = null;
            foreach (var pcm in roster.Applicants)
            {
                if (pcm != null && string.Equals(pcm.name, applicantName, StringComparison.Ordinal))
                {
                    applicant = pcm;
                    break;
                }
            }
            if (applicant == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }

            var gameVariables = GameVariables.Instance;
            var activeCrew = roster.GetActiveCrewCount();
            var complexNorm = 0f;
            if (gameVariables != null && ScenarioUpgradeableFacilities.Instance != null)
            {
                complexNorm = ScenarioUpgradeableFacilities.GetFacilityLevel(SpaceCenterFacility.AstronautComplex);
                var crewCap = CareerRefusals.CrewCapBreach(
                    SpaceCenterFacility.AstronautComplex.ToString(),
                    FacilityDisplayName(SpaceCenterFacility.AstronautComplex),
                    complexNorm,
                    activeCrew,
                    gameVariables.GetActiveCrewLimit(complexNorm));
                if (crewCap != null)
                {
                    return CommandResult.Fail(CommandErrorCode.LimitReached, crewCap);
                }
            }

            var cost = gameVariables != null ? gameVariables.GetRecruitHireCost(activeCrew) : 0f;
            var query = CareerAffordability.Price(
                TransactionReasons.CrewRecruited, Currency.Funds, cost);
            if (!CareerAffordability.CanAfford(query, Currency.Funds))
            {
                return CommandResult.Fail(
                    CommandErrorCode.InsufficientFunds,
                    CareerRefusals.ShortfallBreach(
                        SpaceCenterFacility.AstronautComplex.ToString(),
                        FacilityDisplayName(SpaceCenterFacility.AstronautComplex),
                        complexNorm, "funds",
                        CareerAffordability.PriceOf(query, Currency.Funds),
                        funding.Funds, Units.Funds));
            }

            // No debit here: the hire fires OnCrewmemberHired and Funding's own
            // handler pays the recruit cost. See this method's doc comment.
            roster.HireApplicant(applicant);
            return CommandResult.Ok();
        }

        /// <summary>
        /// Reproduces the stock Astronaut Complex fire (the inverse of <see cref="HireApplicant"/>).
        /// Resolves the kerbal by the SAME <c>ProtoCrewMember.name</c> the read
        /// side emits, against the live hired-crew roster (<c>KerbalRoster.Crew</c>);
        /// a name that doesn't resolve there fails
        /// <see cref="CommandErrorCode.NotFound"/>. <c>KerbalRoster.SackAvailable</c>
        /// is itself self-gating (decompile-confirmed: it silently no-ops, logging
        /// an error, on anything other than an Available crew kerbal) rather than
        /// throwing or reporting failure, so the <c>rosterStatus</c> check happens
        /// HERE first, before ever calling it, so an Assigned/Dead/Missing kerbal
        /// comes back a typed <see cref="CommandErrorCode.WrongState"/> naming
        /// their standing, instead of a silent no-op. No funds change hands
        /// either way, this is a free, reversible action.
        /// </summary>
        public CommandResult FireCrew(string kerbalName)
        {
            var roster = HighLogic.CurrentGame?.CrewRoster;
            if (roster == null)
            {
                return CommandResult.Fail(CommandErrorCode.CareerModeRequired);
            }

            ProtoCrewMember? kerbal = null;
            foreach (var pcm in roster.Crew)
            {
                if (pcm != null && string.Equals(pcm.name, kerbalName, StringComparison.Ordinal))
                {
                    kerbal = pcm;
                    break;
                }
            }
            if (kerbal == null)
            {
                return CommandResult.Fail(CommandErrorCode.NotFound);
            }

            if (kerbal.rosterStatus != ProtoCrewMember.RosterStatus.Available)
            {
                // RosterStatus is [Description]-tagged, so the game names the
                // standing itself and an operator reads "Assigned" rather than
                // an arm that could have meant five things.
                return CommandResult.Fail(
                    CommandErrorCode.WrongState,
                    $"the kerbal is {GameWords.Phrase(kerbal.rosterStatus)}");
            }

            roster.SackAvailable(kerbal);
            return CommandResult.Ok();
        }

        /// <summary>
        /// The facility's name as the game writes it, for the sentence an
        /// operator reads on a refusal. <c>ScenarioUpgradeableFacilities.GetFacilityName</c>
        /// goes through <c>Localizer</c>, so this is the player's own language
        /// rather than an English string composed here.
        /// </summary>
        private static string FacilityDisplayName(SpaceCenterFacility facility)
        {
            try
            {
                return ScenarioUpgradeableFacilities.GetFacilityName(facility) ?? "";
            }
            catch (Exception)
            {
                // A missing display name loses part of a sentence. Failing the
                // whole command over it would lose the refusal, which is the part
                // that matters.
                return "";
            }
        }

        /// <summary>
        /// Same, from the <c>facilityId</c> a command carries. That id is the
        /// <c>SpaceCenterFacility</c> member name (the read side publishes the
        /// facilities keyed by it), so anything that does not parse is a
        /// modded facility this build has no display name for, and an empty
        /// name is the honest answer rather than the id dressed up as one.
        /// </summary>
        private static string FacilityDisplayName(string facilityId)
        {
            foreach (SpaceCenterFacility candidate in Enum.GetValues(typeof(SpaceCenterFacility)))
            {
                if (string.Equals(candidate.ToString(), facilityId, StringComparison.Ordinal))
                {
                    return FacilityDisplayName(candidate);
                }
            }
            return "";
        }

        /// <summary>Resolve a strategy by its stable <c>StrategyConfig.Name</c> (the read-side id) against the live roster.</summary>
        private static Strategy? FindStrategy(StrategySystem system, string strategyId)
        {
            foreach (var strategy in system.Strategies)
            {
                if (strategy?.Config != null && string.Equals(strategy.Config.Name, strategyId, StringComparison.Ordinal))
                {
                    return strategy;
                }
            }
            return null;
        }

        /// <summary>
        /// Resolve a contract by its stringified <c>ContractID</c> (the read-side
        /// id: <c>ContractID</c>, not <c>ContractGuid</c>) against the live
        /// not-yet-finished list (<c>ContractSystem.Instance.Contracts</c>, which
        /// holds both Offered and Active), then run <paramref name="action"/> on
        /// it. Fails <see cref="CommandErrorCode.NotFound"/> when nothing carries
        /// the id, <see cref="CommandErrorCode.ModeUnavailable"/> when there's no
        /// live contract system at all.
        /// </summary>
        private static CommandResult WithContract(string contractId, Func<ContractSystem, Contract, CommandResult> action)
        {
            var system = ContractSystem.Instance;
            if (system == null || system.Contracts == null)
            {
                return CommandResult.Fail(CommandErrorCode.CareerModeRequired);
            }

            foreach (var contract in system.Contracts)
            {
                if (contract != null && string.Equals(contract.ContractID.ToString(), contractId, StringComparison.Ordinal))
                {
                    return action(system, contract);
                }
            }
            return CommandResult.Fail(CommandErrorCode.NotFound);
        }
    }
}
