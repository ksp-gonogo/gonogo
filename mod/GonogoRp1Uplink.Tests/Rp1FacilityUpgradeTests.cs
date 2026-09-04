using System;
using System.Collections.Generic;
using System.Linq;
using RP0;
using Sitrep.Contract;
using Xunit;

namespace GonogoRp1Uplink.Tests
{
    /// <summary>
    /// Queueing a facility upgrade the way RP-1 does, against the stand-in object
    /// graph.
    ///
    /// <para>The cases that decide whether this write is safe, each of them a way
    /// to corrupt a career rather than a way to be untidy:</para>
    /// <list type="bullet">
    /// <item><see cref="Prices_and_times_the_project_from_the_live_facility"/>.
    /// <c>SetBP</c> takes the price AND the cumulative prior cost, and the second
    /// is what decides how LONG the build takes. Nothing on the wire would reveal
    /// a wrong one: the project simply completes at the wrong time.</item>
    /// <item><see cref="Refuses_a_facility_whose_last_segment_is_not_a_KSP_facility"/>.
    /// The facility type cannot be derived the way RP-1 derives it, so it is
    /// parsed from the id. RP-1's own fall-through answers the Vehicle Assembly
    /// Building for anything it does not recognise, and a defaulted parse would
    /// queue an upgrade against the WRONG BUILDING.</item>
    /// <item><see cref="Refuses_when_another_centre_already_has_the_facility_queued"/>.
    /// RP-1's guard searches every centre, and it must: a per-centre check lets a
    /// second project appear and two projects then race to set one level.</item>
    /// <item><see cref="Prices_a_tier_identically_from_either_source"/>. The
    /// claim the off-scene arm rests on, and the only place it is checkable: the
    /// live building and RP-1's config table have to hand <c>SetBP</c> the same
    /// two numbers, or an upgrade queued in flight builds for a different length
    /// of time than the same upgrade queued at the space centre.</item>
    /// <item><see cref="Queues_from_the_cost_table_for_an_id_no_live_facility_answers_to"/>.
    /// The key RP-1's own <c>GetFacilityReferencesById</c> answers by THROWING
    /// rather than refusing.</item>
    /// <item><see cref="Refuses_a_building_RP1_does_not_upgrade_off_scene"/>.
    /// RP-1's <c>IsUpgradeable</c> takes a live building and so cannot be called
    /// off-scene; the substring rule inside it is reproduced instead, and an
    /// equality would offer a locked building RP-1's own menu does not.</item>
    /// <item><see cref="Refuses_a_tier_behind_an_unresearched_tech_and_names_it"/>.
    /// The rule RP-1 adds and core does not have, read from RP-1's own private
    /// lookup rather than reproduced.</item>
    /// <item><see cref="Charges_nothing_at_all"/>. The inverse of core's command,
    /// and the easiest thing to get wrong by copying the build commands: RP-1
    /// draws construction funds down incrementally, so a charge here would bill
    /// the career twice.</item>
    /// </list>
    ///
    /// <para>What these cannot do is stated in <c>Rp0Fixture</c>'s own header and
    /// applies unchanged: they prove the handler takes RP-1's steps in RP-1's
    /// order and refuses where it claims to, and nothing whatever about the values
    /// a running RP-1 would hold.</para>
    /// </summary>
    public class Rp1FacilityUpgradeTests : IDisposable
    {
        private const string PadId = "SpaceCenter/LaunchPad";

        private readonly Rp1FacilityUpgradeCommands _commands = new Rp1FacilityUpgradeCommands();

        public Rp1FacilityUpgradeTests() => Reset();

        public void Dispose() => Reset();

        private static void Reset()
        {
            SpaceCenterManagement.Instance = null;
            Funding.Instance = null;
            ScenarioUpgradeableFacilities.Reset();
            ResearchAndDevelopment.Reset();
            HighLogic.Reset();
            global::RP0.Harmony.PatchKSCFacilityContextMenu.Reset();
            SCMEvents.OnFacilityUpgradeQueued.Fired.Clear();
            Database.FacilityLevelCosts.Clear();
            Database.LockedFacilities.Clear();
            KCTUtilities.FacilityLevels.Clear();
        }

        /// <summary>
        /// A career with one centre and one live launch pad, at tier 0 of a
        /// three-tier ladder costing 100 / 400 / 900.
        /// </summary>
        private static LCSpaceCenter Career(int tier = 0, double funds = 50_000)
        {
            var centre = new LCSpaceCenter { KSCName = "Cape" };
            var scm = new SpaceCenterManagement { ActiveSC = centre };
            scm.KSCs.Add(centre);
            SpaceCenterManagement.Instance = scm;
            Funding.Instance = new Funding { Funds = funds };
            Register(PadId, tier);
            return centre;
        }

        /// <summary>Puts a live facility behind an id, the way the space centre scene does.</summary>
        private static UpgradeableFacility Register(string id, int tier, params float[] levelCosts)
        {
            var costs = levelCosts.Length > 0 ? levelCosts : new[] { 100f, 400f, 900f };
            var facility = new UpgradeableFacility
            {
                id = id,
                UpgradeLevels = costs.Select(c => new UpgradeableObject.UpgradeLevel { levelCost = c }).ToArray(),
            };
            facility.SetLevelForTest(tier);
            var proto = new ScenarioUpgradeableFacilities.ProtoUpgradeable();
            proto.facilityRefs.Add(facility);
            ScenarioUpgradeableFacilities.protoUpgradeables[id] = proto;
            return facility;
        }

        /// <summary>Registers an id with the dictionary entry but no live facility, which is every scene but SPACECENTER.</summary>
        private static void RegisterWithoutLiveFacility(string id) =>
            ScenarioUpgradeableFacilities.protoUpgradeables[id] = new ScenarioUpgradeableFacilities.ProtoUpgradeable();

        /// <summary>
        /// Puts a building in RP-1's own config table instead of in the scene: the
        /// per-tier prices RP-1 parses out of CustomBarnKit, and the tier its own
        /// denormaliser answers with. Together these are what a career has to price
        /// an upgrade from in the editor, in flight and at the tracking station.
        /// </summary>
        private static void RegisterInConfigOnly(
            SpaceCenterFacility facility, int tier, params int[] tierCosts)
        {
            var costs = tierCosts.Length > 0 ? tierCosts : new[] { 100, 400, 900 };
            Database.FacilityLevelCosts[facility] = costs.ToList();
            KCTUtilities.FacilityLevels[facility] = tier;
        }

        /// <summary>
        /// A career with a launch pad RP-1 prices and KSP has NOT built: the state
        /// of every scene but the space centre.
        /// </summary>
        private static LCSpaceCenter OffSceneCareer(int tier = 0, params int[] tierCosts)
        {
            var centre = Career();
            ScenarioUpgradeableFacilities.Reset();
            RegisterWithoutLiveFacility(PadId);
            RegisterInConfigOnly(SpaceCenterFacility.LaunchPad, tier, tierCosts);
            return centre;
        }

        private static FacilityUpgradeProject Queued(LCSpaceCenter centre) =>
            Assert.Single(centre.FacilityUpgrades);

        [Fact]
        public void Queues_the_next_tier_as_a_construction_project()
        {
            var centre = Career();

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" });

            Assert.True(result.Success);
            var project = Queued(centre);
            Assert.Equal(PadId, project.id);
            Assert.Equal(0, project.currentLevel);
            Assert.Equal(1, project.upgradeLevel);
            Assert.Equal(SpaceCenterFacility.LaunchPad, project.FacilityType);
            // The last id segment, which is what ProcessUpgrade passes and
            // therefore what RP-1's own construction window shows.
            Assert.Equal("LaunchPad", project.name);
        }

        /// <summary>
        /// A bare facility name and the full id it normalises to are the SAME
        /// press, and the project records the normalised form either way.
        /// </summary>
        /// <remarks>
        /// The asymmetry this closes is real and would fire exactly once, on the
        /// rig: KSP's <c>GetFacilityLevel</c> sanitizes before it looks up and
        /// RP-1's <c>GetFacilityReferencesById</c> does neither, so an id that
        /// works with one throws in the other. Sanitizing once, up front, is what
        /// stops the project, the duplicate check and the dictionary from
        /// disagreeing about which id this is.
        /// </remarks>
        [Theory]
        [InlineData("LaunchPad")]
        [InlineData(PadId)]
        public void Accepts_a_bare_facility_name_and_a_full_id_as_the_same_facility(string named)
        {
            var centre = Career();

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = named });

            Assert.True(result.Success);
            Assert.Equal(PadId, Queued(centre).id);
        }

        /// <summary>
        /// The price and the DURATION, both taken off the live facility and both
        /// handed to RP-1's own formula.
        /// </summary>
        /// <remarks>
        /// The second argument is the half nothing else would reveal. It is the
        /// sum of every level cost up to and including the tier the facility
        /// stands at, scaled by the career's funds multiplier, and a wrong one
        /// produces a project that finishes at the wrong time with nothing on any
        /// surface saying so.
        /// </remarks>
        [Fact]
        public void Prices_and_times_the_project_from_the_live_facility()
        {
            var centre = Career(tier: 1);
            HighLogic.CurrentGame.Parameters.Career.FundsLossMultiplier = 2f;

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" });

            Assert.True(result.Success);
            var project = Queued(centre);
            // Tier 1 to tier 2: the next tier's 900, doubled by the multiplier.
            Assert.Equal(1800.0, project.BpCostArgument);
            // What it has cost so far: 100 + 400, doubled by the same multiplier.
            Assert.Equal(1000.0, project.BpOldCostArgument);
            Assert.Equal(1, project.BpCalls);
            // Written AFTER SetBP has read it, in RP-1's own order.
            Assert.Equal(1800.0, project.cost);
        }

        /// <summary>
        /// The funds multiplier is applied only while a game is loaded, which is
        /// the condition <c>ProcessUpgrade</c> puts on it.
        /// </summary>
        [Fact]
        public void Leaves_the_cumulative_cost_unscaled_when_no_game_is_loaded()
        {
            var centre = Career(tier: 1);
            HighLogic.CurrentGame.Parameters.Career.FundsLossMultiplier = 2f;
            HighLogic.LoadedSceneIsGame = false;

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" });

            Assert.True(result.Success);
            Assert.Equal(500.0, Queued(centre).BpOldCostArgument);
        }

        /// <summary>
        /// The house rule, on the answer: what this press committed, and what the
        /// career has to meet it with.
        /// </summary>
        [Fact]
        public void Answers_with_the_price_and_the_balance()
        {
            Career(funds: 12_345);

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" });

            Assert.True(result.Success);
            var payload = Assert.IsType<Dictionary<string, object?>>(result.Payload);
            Assert.Equal(400.0, payload["cost"]);
            Assert.Equal(12_345.0, payload["funds"]);
            Assert.Equal("LaunchPad", payload["facility"]);
            Assert.Equal(PadId, payload["facilityId"]);
            Assert.Equal(0, payload["currentLevel"]);
            Assert.Equal(1, payload["targetLevel"]);
            Assert.Equal(500.0, payload["buildPoints"]);
        }

        /// <summary>
        /// Nothing is charged, and that is the inverse of what core's own facility
        /// command does.
        /// </summary>
        /// <remarks>
        /// RP-1 draws a construction's funds down incrementally as it progresses,
        /// and throttles the progress to what the career can afford at the time.
        /// A charge here would bill the whole price twice over, and an
        /// affordability refusal would refuse something the game permits.
        /// </remarks>
        [Fact]
        public void Charges_nothing_at_all()
        {
            Career(funds: 100);

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" });

            Assert.True(result.Success);
            Assert.Equal(100.0, Funding.Instance!.Funds);
        }

        [Fact]
        public void Announces_the_queued_project_once()
        {
            var centre = Career();

            _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" });

            Assert.Same(Queued(centre), Assert.Single(SCMEvents.OnFacilityUpgradeQueued.Fired));
        }

        [Fact]
        public void Refuses_a_command_that_named_no_facility()
        {
            Career();

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs());

            Refused(result, CommandErrorCode.NotFound);
        }

        /// <summary>
        /// The trap that would queue an upgrade against the wrong building.
        /// </summary>
        /// <remarks>
        /// RP-1 derives the <c>SpaceCenterFacility</c> from the clickable scene
        /// object, not from the id, and falls through to the Vehicle Assembly
        /// Building for anything it does not recognise. This command starts from
        /// an id, so it parses the last segment, and a failed parse must REFUSE:
        /// a modded or KSCSwitcher site whose id ends in something else is exactly
        /// the case where a default would be silently wrong.
        /// </remarks>
        [Fact]
        public void Refuses_a_facility_whose_last_segment_is_not_a_KSP_facility()
        {
            var centre = Career();
            Register("SpaceCenter/WoomeraPad", 0);

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "SpaceCenter/WoomeraPad" });

            Refused(result, CommandErrorCode.NotFound);
            Assert.Contains("WoomeraPad", result.Detail);
            Assert.Empty(centre.FacilityUpgrades);
        }

        /// <summary>
        /// The refusal the settled design arrived without, found on the rig.
        /// </summary>
        /// <remarks>
        /// RP-1 gives the VAB, the SPH, the Launch Pad, the Runway and R&amp;D a
        /// <c>1, 1, 1</c> upgrade ladder its own config calls "cosmetic only", and
        /// then DRIVES their level itself from the mean of the buildings it does
        /// upgrade. A project queued against one would cost a single fund, finish
        /// almost at once, and have the level it set overwritten by RP-1's own
        /// averaging: the same "state RP-1's model has no way to produce" that
        /// <see cref="Rp1CareerProjectGate"/> keeps the STOCK command out of,
        /// arriving through this command instead.
        /// </remarks>
        [Fact]
        public void Refuses_a_facility_RP1_does_not_upgrade_as_a_building()
        {
            var centre = Career();
            global::RP0.Harmony.PatchKSCFacilityContextMenu.LockedFacilities.Add(SpaceCenterFacility.LaunchPad);

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" });

            Refused(result, CommandErrorCode.ModeUnavailable);
            Assert.Contains("LaunchPad", result.Detail);
            Assert.Empty(centre.FacilityUpgrades);
        }

        /// <summary>
        /// A locked facility is refused BEFORE the tier and the tech gate are
        /// considered, which is the order RP-1's own menu takes: the button is
        /// disabled outright rather than shown with a price nobody can act on.
        /// </summary>
        [Fact]
        public void Refuses_a_locked_facility_even_when_every_other_condition_is_met()
        {
            Career();
            global::RP0.Harmony.PatchKSCFacilityContextMenu.LockedFacilities.Add(SpaceCenterFacility.LaunchPad);
            Gate(PadId, level: 1, tech: "start_rocketry");
            ResearchAndDevelopment.Researched.Add("start_rocketry");

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" });

            Refused(result, CommandErrorCode.ModeUnavailable);
            Assert.DoesNotContain("start_rocketry", result.Detail);
        }

        /// <summary>
        /// A facility RP-1 does not lock is queued as normal, so the refusal above
        /// is a real discrimination rather than a blanket one.
        /// </summary>
        [Fact]
        public void Queues_a_facility_RP1_does_upgrade()
        {
            var centre = Career();
            Register("SpaceCenter/MissionControl", 0);
            global::RP0.Harmony.PatchKSCFacilityContextMenu.LockedFacilities.Add(SpaceCenterFacility.LaunchPad);

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "MissionControl" });

            Assert.True(result.Success);
            Assert.Equal("SpaceCenter/MissionControl", Queued(centre).id);
        }

        /// <summary>
        /// The same trap wearing a number. <c>Enum.Parse</c> accepts an ORDINAL as
        /// readily as a name, so an id ending in "2" would come back as
        /// <c>LaunchPad</c> from a segment that names no building at all: the
        /// wrong-building bug in a second costume, and the reason the facility is
        /// matched to a NAME rather than parsed outright.
        /// </summary>
        [Fact]
        public void Refuses_a_facility_whose_last_segment_is_an_enum_ordinal()
        {
            var centre = Career();
            Register("SpaceCenter/2", 0);

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "SpaceCenter/2" });

            Refused(result, CommandErrorCode.NotFound);
            Assert.Empty(centre.FacilityUpgrades);
        }

        /// <summary>
        /// The case this command used to refuse: the dictionary answers and the
        /// live list inside it is empty, which is the ordinary state in every
        /// scene but the space centre. RP-1's own cost table prices it instead.
        /// </summary>
        [Fact]
        public void Queues_from_RP1s_own_cost_table_when_the_building_is_not_in_the_scene()
        {
            var centre = OffSceneCareer();

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" });

            Assert.True(result.Success);
            var project = Queued(centre);
            Assert.Equal(PadId, project.id);
            Assert.Equal(0, project.currentLevel);
            Assert.Equal(1, project.upgradeLevel);
            Assert.Equal(SpaceCenterFacility.LaunchPad, project.FacilityType);
        }

        /// <summary>
        /// The same, for a key that is not in the dictionary at all, which is what
        /// RP-1's own <c>GetFacilityReferencesById</c> answers by throwing
        /// <c>KeyNotFoundException</c>. The registry is not consulted for a price
        /// on this arm, so an absent entry is no different from an empty one.
        /// </summary>
        [Fact]
        public void Queues_from_the_cost_table_for_an_id_no_live_facility_answers_to()
        {
            var centre = Career();
            ScenarioUpgradeableFacilities.Reset();
            RegisterInConfigOnly(SpaceCenterFacility.LaunchPad, tier: 0);

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" });

            Assert.True(result.Success);
            Assert.Equal(PadId, Queued(centre).id);
        }

        /// <summary>
        /// The two price sources produce the SAME two arguments to <c>SetBP</c>,
        /// which is the whole claim this change rests on.
        /// </summary>
        /// <remarks>
        /// Both halves matter and only one of them is visible anywhere else. The
        /// cost is what an operator reads back; the cumulative term is what decides
        /// how LONG the build takes, and a wrong one produces a project that
        /// finishes at the wrong time with nothing on any surface saying so. The
        /// same tier, the same ladder and the same multiplier are fed to each arm
        /// and the outputs are compared, rather than either being compared to a
        /// constant that could be wrong twice.
        /// </remarks>
        [Fact]
        public void Prices_a_tier_identically_from_either_source()
        {
            var scene = Career(tier: 1);
            HighLogic.CurrentGame.Parameters.Career.FundsLossMultiplier = 2f;
            Assert.True(_commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" }).Success);
            var live = Queued(scene);

            Reset();
            var centre = OffSceneCareer(tier: 1);
            HighLogic.CurrentGame.Parameters.Career.FundsLossMultiplier = 2f;
            Assert.True(_commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" }).Success);
            var config = Queued(centre);

            Assert.Equal(live.BpCostArgument, config.BpCostArgument);
            Assert.Equal(live.BpOldCostArgument, config.BpOldCostArgument);
            Assert.Equal(live.cost, config.cost);
            Assert.Equal(live.currentLevel, config.currentLevel);
            Assert.Equal(live.upgradeLevel, config.upgradeLevel);
        }

        /// <summary>
        /// The live building WINS where both answer, which is what keeps the space
        /// centre at literal parity with RP-1's own button.
        /// </summary>
        /// <remarks>
        /// The two are fed deliberately different ladders, because agreeing
        /// sources cannot show which one was read. In a running game they hold the
        /// same numbers, CustomBarnKit writing <c>upgradeLevels[i].levelCost</c>
        /// from the same <c>upgrades</c> list RP-1 parses its table out of.
        /// </remarks>
        [Fact]
        public void Prefers_the_live_building_where_both_sources_answer()
        {
            var centre = Career();
            RegisterInConfigOnly(SpaceCenterFacility.LaunchPad, tier: 0, 7, 7, 7);

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" });

            Assert.True(result.Success);
            // The live ladder's second tier, not the config ladder's 7.
            Assert.Equal(400.0, Queued(centre).cost);
        }

        /// <summary>
        /// A tier past the top of the config ladder is refused off-scene the same
        /// way it is refused at the space centre: the ladder's Count - 1 is the top
        /// tier's own index, which is what <c>UpgradeableObject.MaxLevel</c> is.
        /// </summary>
        [Fact]
        public void Refuses_a_facility_at_its_top_tier_off_scene()
        {
            var centre = OffSceneCareer(tier: 2);

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" });

            Refused(result, CommandErrorCode.AlreadyAtMaximum);
            Assert.Empty(centre.FacilityUpgrades);
        }

        /// <summary>
        /// RP-1's locked buildings are refused off-scene too, matched the way
        /// <c>IsUpgradeable</c> matches them: a case-insensitive SUBSTRING of the
        /// facility id, not an equality against its last segment.
        /// </summary>
        /// <remarks>
        /// The substring is the half a reproduction gets wrong. The id here is
        /// "SpaceCenter/LaunchPad" and the locked name is "LaunchPad", so an
        /// equality test against the whole id would offer a building RP-1's own
        /// menu does not.
        /// </remarks>
        [Fact]
        public void Refuses_a_building_RP1_does_not_upgrade_off_scene()
        {
            var centre = OffSceneCareer();
            Database.LockedFacilities.Add(SpaceCenterFacility.LaunchPad);

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" });

            Refused(result, CommandErrorCode.ModeUnavailable);
            Assert.Empty(centre.FacilityUpgrades);
        }

        /// <summary>
        /// Neither source answers, which is the one state left that refuses. It is
        /// a cold or broken install rather than a place: RP-1 loads its cost table
        /// once with the game database.
        /// </summary>
        [Fact]
        public void Refuses_when_no_source_can_price_the_building()
        {
            var centre = Career();
            ScenarioUpgradeableFacilities.Reset();
            RegisterWithoutLiveFacility(PadId);

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" });

            Refused(result, CommandErrorCode.ModeUnavailable);
            Assert.Empty(centre.FacilityUpgrades);
        }

        [Fact]
        public void Refuses_a_facility_already_at_its_top_tier()
        {
            var centre = Career(tier: 2);

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" });

            Refused(result, CommandErrorCode.AlreadyAtMaximum);
            Assert.Equal(2.0, result.Breach!.Limit);
            Assert.Equal(3.0, result.Breach!.Actual);
            Assert.Empty(centre.FacilityUpgrades);
        }

        /// <summary>
        /// RP-1's own rule, named rather than silent: its own path returns early
        /// here and posts no message, so a player pressing the in-game button sees
        /// nothing happen at all.
        /// </summary>
        [Fact]
        public void Refuses_a_tier_behind_an_unresearched_tech_and_names_it()
        {
            var centre = Career();
            Gate(PadId, level: 1, tech: "start_rocketry");

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" });

            Refused(result, CommandErrorCode.NotUnlocked);
            Assert.Contains("start_rocketry", result.Detail);
            Assert.Empty(centre.FacilityUpgrades);
        }

        [Fact]
        public void Queues_a_gated_tier_once_its_tech_is_researched()
        {
            var centre = Career();
            Gate(PadId, level: 1, tech: "start_rocketry");
            ResearchAndDevelopment.Researched.Add("start_rocketry");

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" });

            Assert.True(result.Success);
            Assert.Single(centre.FacilityUpgrades);
        }

        /// <summary>
        /// A gate on a DIFFERENT tier is not this tier's gate. The lookup is keyed
        /// on the target level, so reading it with the wrong one would block an
        /// upgrade that is perfectly available.
        /// </summary>
        [Fact]
        public void Ignores_a_tech_gate_declared_for_another_tier()
        {
            var centre = Career();
            Gate(PadId, level: 2, tech: "start_rocketry");

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" });

            Assert.True(result.Success);
            Assert.Single(centre.FacilityUpgrades);
        }

        /// <summary>
        /// An unreadable gate refuses, per this Uplink's existing Unknown rule.
        /// The operator loses a queueing they can still do in game, which is the
        /// safe direction for the most fragile pin in the manifest.
        /// </summary>
        [Fact]
        public void Refuses_when_the_tech_gate_itself_cannot_be_read()
        {
            var centre = Career();
            global::RP0.Harmony.PatchKSCFacilityContextMenu.ThrowOnLookup = true;

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" });

            Refused(result, CommandErrorCode.ModeUnavailable);
            Assert.Empty(centre.FacilityUpgrades);
        }

        /// <summary>
        /// RP-1's duplicate guard searches EVERY centre, so a project queued at
        /// another KSC refuses this one. A per-centre check would let a second
        /// project appear and the two would race to set one level.
        /// </summary>
        [Fact]
        public void Refuses_when_another_centre_already_has_the_facility_queued()
        {
            var active = Career();
            var other = new LCSpaceCenter { KSCName = "Woomera" };
            other.FacilityUpgrades.Add(new FacilityUpgradeProject { id = PadId });
            SpaceCenterManagement.Instance!.KSCs.Add(other);

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" });

            Refused(result, CommandErrorCode.WrongState);
            Assert.Empty(active.FacilityUpgrades);
        }

        [Fact]
        public void Refuses_a_second_press_for_the_same_facility()
        {
            var centre = Career();

            Assert.True(_commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" }).Success);
            var second = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" });

            Refused(second, CommandErrorCode.WrongState);
            Assert.Single(centre.FacilityUpgrades);
        }

        /// <summary>
        /// A save RP-1 declines to run in has no construction queue at all, and
        /// the stock purchase is the whole of what happens. Refusing here is what
        /// makes the two commands complementary rather than both refusing:
        /// <see cref="Rp1CareerProjectGate"/> PASSES in exactly this case.
        /// </summary>
        [Fact]
        public void Refuses_a_save_RP1_does_not_manage_and_the_stock_gate_passes_it()
        {
            var centre = Career();
            SpaceCenterManagement.Instance!.enabledForSave = false;

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" });

            Refused(result, CommandErrorCode.ModeUnavailable);
            Assert.Empty(centre.FacilityUpgrades);

            var stock = new Rp1CareerProjectGate().Evaluate(
                Rp1CareerProjectGate.FacilityRequirement(), new NoArguments());
            Assert.Equal(GateOutcome.Pass, stock.Outcome);
        }

        [Fact]
        public void Refuses_when_RP1s_space_centre_is_not_loaded()
        {
            SpaceCenterManagement.Instance = null;

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" });

            Refused(result, CommandErrorCode.ModeUnavailable);
        }

        [Fact]
        public void Refuses_when_no_space_centre_is_active()
        {
            Career();
            SpaceCenterManagement.Instance!.ActiveSC = null;

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" });

            Refused(result, CommandErrorCode.ModeUnavailable);
        }

        /// <summary>
        /// A facility whose level table does not reach the tier it claims to stand
        /// at. Refused rather than summed part-way, because a partial sum is a
        /// shorter build for no stated reason.
        /// </summary>
        [Fact]
        public void Refuses_a_facility_whose_level_table_is_shorter_than_its_tier()
        {
            var centre = Career();
            var facility = ScenarioUpgradeableFacilities.protoUpgradeables[PadId].facilityRefs[0];
            facility.SetLevelForTest(1);
            facility.UpgradeLevels = new[] { new UpgradeableObject.UpgradeLevel { levelCost = 100f } };

            var result = _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" });

            // Tier 1 with a one-entry table is already at its maximum, which is
            // the arm that fires first and is the honest answer to it.
            Refused(result, CommandErrorCode.AlreadyAtMaximum);
            Assert.Empty(centre.FacilityUpgrades);
        }

        /// <summary>
        /// The requirement is answerable with no arguments, which is the only way
        /// a control can be dark BEFORE anyone presses it.
        /// </summary>
        [Fact]
        public void Pricing_requirement_is_answerable_with_no_arguments()
        {
            var requirement = Rp1FacilityUpgradeCommands.FacilitiesRequirement();

            Assert.Equal(Rp1FacilityUpgradeCommands.GateKind, requirement.Kind);
            Assert.Empty(requirement.Needs);
        }

        /// <summary>
        /// The gate passes exactly where the command works, because it reads the
        /// two things the command prices from rather than a scene name standing in
        /// for either.
        /// </summary>
        [Fact]
        public void Gate_passes_where_the_buildings_are_in_the_scene()
        {
            Career();

            Assert.Equal(GateOutcome.Pass, Gate().Outcome);
        }

        /// <summary>
        /// And passes with nothing in the scene at all, as long as RP-1's cost
        /// table answers. This is the case the gate used to fail, and failing it
        /// is what held the control dark in flight.
        /// </summary>
        [Fact]
        public void Gate_passes_off_scene_where_RP1s_cost_table_answers()
        {
            OffSceneCareer();

            Assert.Equal(GateOutcome.Pass, Gate().Outcome);
        }

        /// <summary>
        /// A cost table that EXISTS and prices nothing is a cold start, not an
        /// answer. It is created at type load and filled by a coroutine, so a
        /// non-null empty table is the state during loading.
        /// </summary>
        [Fact]
        public void Gate_refuses_a_cost_table_that_prices_nothing()
        {
            Career();
            ScenarioUpgradeableFacilities.Reset();
            RegisterWithoutLiveFacility(PadId);
            Database.FacilityLevelCosts[SpaceCenterFacility.LaunchPad] = new List<int>();

            var verdict = Gate();

            Assert.Equal(GateOutcome.Fail, verdict.Outcome);
            Assert.Equal(CommandErrorCode.ModeUnavailable, verdict.ErrorCode);
        }

        [Fact]
        public void Gate_refuses_where_neither_source_answers()
        {
            Career();
            ScenarioUpgradeableFacilities.Reset();
            RegisterWithoutLiveFacility(PadId);

            var verdict = Gate();

            Assert.Equal(GateOutcome.Fail, verdict.Outcome);
            Assert.Equal(CommandErrorCode.ModeUnavailable, verdict.ErrorCode);
        }

        /// <summary>
        /// The refusal names the condition and never a place, which is the whole
        /// correction: an operator standing in flight is not being told they are in
        /// the wrong scene, because they are not.
        /// </summary>
        [Fact]
        public void Gate_refusal_names_the_cost_table_and_not_the_space_centre()
        {
            Career();
            ScenarioUpgradeableFacilities.Reset();
            RegisterWithoutLiveFacility(PadId);

            var detail = Gate().Detail ?? "";

            Assert.Contains("cost table", detail);
            Assert.DoesNotContain("only at the space centre", detail);
        }

        /// <summary>
        /// The gate and the handler give the SAME answer for the same state,
        /// which is what stops a live control refusing every press, and equally
        /// what stops a dark control hiding a press that would have worked.
        /// </summary>
        [Fact]
        public void Gate_and_handler_agree_about_whether_a_tier_can_be_priced()
        {
            Career();
            Assert.Equal(GateOutcome.Pass, Gate().Outcome);
            Assert.True(_commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" }).Success);

            Reset();
            OffSceneCareer();
            Assert.Equal(GateOutcome.Pass, Gate().Outcome);
            Assert.True(_commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" }).Success);

            Reset();
            Career();
            ScenarioUpgradeableFacilities.Reset();
            RegisterWithoutLiveFacility(PadId);
            Assert.Equal(GateOutcome.Fail, Gate().Outcome);
            Refused(
                _commands.Upgrade(new Rp1FacilityUpgradeArgs { Facility = "LaunchPad" }),
                CommandErrorCode.ModeUnavailable);
        }

        private GateVerdict Gate() =>
            _commands.Evaluate(Rp1FacilityUpgradeCommands.FacilitiesRequirement(), new NoArguments());

        private static void Gate(string facilityId, int level, string tech)
        {
            var gatings = global::RP0.Harmony.PatchKSCFacilityContextMenu.Gatings;
            if (!gatings.TryGetValue(facilityId, out var levels))
            {
                levels = new Dictionary<int, string>();
                gatings[facilityId] = levels;
            }
            levels[level] = tech;
        }

        private static void Refused(CommandResult<Dictionary<string, object?>> result, CommandErrorCode code)
        {
            Assert.False(result.Success);
            Assert.Equal(code, result.ErrorCode);
            Assert.Null(result.Payload);
        }

        /// <summary>An empty argument bag, which is what a static gate is evaluated with.</summary>
        private sealed class NoArguments : IGateArguments
        {
            public bool TryGet(string path, out object value)
            {
                value = null!;
                return false;
            }
        }
    }
}
