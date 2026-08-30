using System;
using System.Collections.Generic;
using System.Linq;
using RP0;
using Sitrep.Contract;
using Xunit;

namespace GonogoRp1Uplink.Tests
{
    /// <summary>
    /// Queuing a tech node for research, against the stand-in RP-1 object graph.
    ///
    /// <para>The cases that decide whether this command is safe, each a way to
    /// lose a career's science rather than a way to be untidy:</para>
    /// <list type="bullet">
    /// <item><see cref="Authors_every_persistent_field_RP1_loads"/>. The whole
    /// case for the <c>Load(ConfigNode)</c> route is that its failure mode is a
    /// checklist; this is the checklist, and the shipped-assembly half of it is in
    /// <c>Rp1InstalledCompatibilityTests</c>.</item>
    /// <item><see cref="Takes_the_nodes_state_from_the_player_not_the_tree"/>. The
    /// tree's own <c>ProtoTechNode</c> carries the config default, so a walk that
    /// read it would persist a state the player is not in.</item>
    /// <item><see cref="Refuses_a_node_already_on_the_queue_without_charging"/>.
    /// The charge happens at enqueue, so a second press of a control an operator
    /// thought had not landed would pay for the same node twice.</item>
    /// <item><see cref="Refuses_when_the_science_is_not_there_without_charging"/>.
    /// RP-1's own <c>AddScience</c> prefix performs no affordability test and
    /// clamps a negative balance to zero, so an unchecked charge silently
    /// confiscates whatever science the career had.</item>
    /// <item><see cref="Queues_through_the_observable_add"/>. RP-1's queue is a
    /// <c>PersistentObservableList</c> whose <c>Add</c> shadows the base one; bind
    /// to the base and the node is queued while every subscriber is told
    /// nothing.</item>
    /// <item><see cref="Refuses_a_save_RP1_does_not_queue_research_in"/>. RP-1's
    /// own prefix lets the stock instant unlock through when its preset says so,
    /// and a project queued in that save is one nothing will work through.</item>
    /// </list>
    ///
    /// <para>What these cannot do is stated in <c>Rp0Fixture</c>'s own header and
    /// applies unchanged: they prove the handler invokes what it claims to and
    /// refuses where it claims to, and nothing whatever about the values a
    /// running RP-1 would hold.</para>
    /// </summary>
    public class Rp1ResearchCommandsTests : IDisposable
    {
        private const string TechId = "start";
        private const string TechTitle = "Start";

        private readonly Rp1ResearchCommands _commands = new Rp1ResearchCommands();

        public Rp1ResearchCommandsTests() => Reset();

        public void Dispose() => Reset();

        private static void Reset()
        {
            SpaceCenterManagement.Instance = null;
            PresetManager.Reset();
            ResearchAndDevelopment.Reset();
            GameVariables.Reset();
            ScenarioUpgradeableFacilities.Reset();
            CurrencyModifierQueryRP0.Reset();
            KCTUtilities.Reset();
            Database.TechNodePeriods.Clear();
            AssetBase.RnDTechTree = null;
        }

        /// <summary>
        /// A career with RP-1 managing it, one researchable node in the tree and
        /// enough science banked to pay for it.
        /// </summary>
        /// <remarks>
        /// The tree's node carries <c>Available</c> deliberately. That is the
        /// CONFIG DEFAULT a real tech tree hands back, the player's own state is
        /// the empty proto-node table beside it, and a walk that took the tree's
        /// answer would report every node already researched.
        /// </remarks>
        private static void Career(int scienceCost = 100, float banked = 500f)
        {
            SpaceCenterManagement.Instance = new SpaceCenterManagement();
            AssetBase.RnDTechTree = new RDTechTree();
            AssetBase.RnDTechTree.Techs.Add(new ProtoTechNode
            {
                techID = TechId,
                scienceCost = scienceCost,
                state = RDTech.State.Available,
            });
            ResearchAndDevelopment.Titles[TechId] = TechTitle;
            ResearchAndDevelopment.Instance!.science = banked;
        }

        private static ResearchProject Queued() =>
            SpaceCenterManagement.Instance!.TechList.Single();

        private static CommandResult Research(string? techId = TechId) =>
            new Rp1ResearchCommands().Research(new Rp1TechResearchArgs { TechId = techId });

        // ── the checklist ──────────────────────────────────────────────────

        /// <summary>
        /// Every <c>[Persistent]</c> field RP-1 declares on <c>ResearchProject</c>
        /// arrives with the value it should, through RP-1's own
        /// <c>Load(ConfigNode)</c> and the stand-in
        /// <c>ConfigNode.LoadObjectFromConfig</c> that is driven by the attribute
        /// rather than by a list of keys anyone wrote down.
        ///
        /// <para>A key production forgets to author does not throw here: it leaves
        /// the field at the constructor's default, which is exactly what the
        /// shipped game would persist. So each is asserted against a value that is
        /// NOT that default.</para>
        /// </summary>
        [Fact]
        public void Authors_every_persistent_field_RP1_loads()
        {
            Career(scienceCost: 90);
            Database.TechNodePeriods[TechId] = new TechPeriod { id = TechId, startYear = 1957, endYear = 1962 };

            Assert.True(Research().Success);

            var project = Queued();
            Assert.Equal(90, project.scienceCost);
            Assert.Equal(1957, project.startYear);
            Assert.Equal(1962, project.endYear);
            Assert.Equal(TechTitle, project.techName);
            Assert.Equal(TechId, project.techID);
            Assert.Equal(0.0, project.progress);
            Assert.Equal(1.0, project.workRate);
        }

        /// <summary>
        /// The default the checklist above is measured against is a REAL default,
        /// not one this test asserts twice: a project RP-1 loads from an empty
        /// node keeps its constructor's values, so an unauthored key is silent.
        /// </summary>
        [Fact]
        public void An_unauthored_key_is_silent_rather_than_a_throw()
        {
            var project = new ResearchProject();
            var node = new ConfigNode("Tech");
            node.AddNode("ProtoNode");

            project.Load(node);

            Assert.Equal(0, project.scienceCost);
            Assert.Equal("", project.techName);
            Assert.Equal(1.0, project.workRate);
        }

        /// <summary>
        /// The proto node RP-1's <c>Load</c> rebuilds out of the subnode, which is
        /// the second half of the checklist: id, state and cost. Without the
        /// subnode <c>Load</c> itself throws.
        /// </summary>
        [Fact]
        public void Authors_the_proto_node_RP1_rebuilds()
        {
            Career(scienceCost: 90);

            Assert.True(Research().Success);

            var proto = Queued().ProtoNode;
            Assert.NotNull(proto);
            Assert.Equal(TechId, proto!.techID);
            Assert.Equal(90, proto.scienceCost);
            Assert.Equal(RDTech.State.Unavailable, proto.state);
        }

        /// <summary>
        /// The player's state, never the tree's. The tree node in
        /// <see cref="Career"/> says <c>Available</c> and the player's own table
        /// says nothing at all, which reads as <c>Unavailable</c>: a walk that
        /// took the tree's answer would both refuse the command as already
        /// researched and, if it got past that, persist a researched node onto the
        /// queue.
        /// </summary>
        [Fact]
        public void Takes_the_nodes_state_from_the_player_not_the_tree()
        {
            Career();

            Assert.True(Research().Success);

            Assert.Equal(RDTech.State.Unavailable, Queued().ProtoNode!.state);
        }

        /// <summary>
        /// A node the table has no era for gets RP-1's own miss behaviour, zero
        /// and zero, rather than an invented pair. <c>startYear</c> below 1 is
        /// what <c>CalculateYearBasedRateMult</c> reads as "no era model", so any
        /// substitute would change how fast the node researches.
        /// </summary>
        [Fact]
        public void Leaves_the_era_at_zero_for_a_node_the_table_does_not_mention()
        {
            Career();
            Database.TechNodePeriods["somethingElse"] =
                new TechPeriod { id = "somethingElse", startYear = 1970, endYear = 1980 };

            Assert.True(Research().Success);

            var project = Queued();
            Assert.Equal(0, project.startYear);
            Assert.Equal(0, project.endYear);
        }

        /// <summary>
        /// A node with no title in the tree gets its id rather than an empty
        /// <c>techName</c>. Persisting a nameless project is the exact failure the
        /// mint route would have shipped, so this route has to be seen not to.
        /// </summary>
        [Fact]
        public void Falls_back_to_the_id_when_the_tree_has_no_title()
        {
            Career();
            ResearchAndDevelopment.Titles.Clear();

            Assert.True(Research().Success);

            Assert.Equal(TechId, Queued().techName);
        }

        /// <summary>
        /// Parts already bought off the node travel with it, read from the LIVE
        /// proto node rather than invented. RP-1's own constructor reaches the
        /// same list.
        /// </summary>
        [Fact]
        public void Carries_the_parts_already_purchased_off_the_node()
        {
            Career();
            var live = new ProtoTechNode { techID = TechId, state = RDTech.State.Unavailable, scienceCost = 100 };
            live.partsPurchased.Add(new AvailablePart("liquidEngine"));
            live.partsPurchased.Add(new AvailablePart("fuelTankSmall"));
            ResearchAndDevelopment.Instance!.SetTechState(TechId, live);

            Assert.True(Research().Success);

            Assert.Equal(
                new[] { "liquidEngine", "fuelTankSmall" },
                Queued().ProtoNode!.partsPurchased.Select(p => p.name).ToArray());
        }

        // ── the money ──────────────────────────────────────────────────────

        /// <summary>
        /// The charge is the node's own integer cost, under RP-1's research
        /// reason, and it happens once.
        /// </summary>
        [Fact]
        public void Charges_the_science_at_enqueue()
        {
            Career(scienceCost: 90, banked: 500f);

            Assert.True(Research().Success);

            var charge = Assert.Single(ResearchAndDevelopment.Instance!.Charges);
            Assert.Equal(-90f, charge.Key);
            Assert.Equal(TransactionReasons.RnDTechResearch, charge.Value);
            Assert.Equal(410f, ResearchAndDevelopment.Instance.Science);
        }

        /// <summary>
        /// Not enough science refuses, takes nothing and queues nothing, and the
        /// refusal carries both figures so a client can say how short.
        /// </summary>
        [Fact]
        public void Refuses_when_the_science_is_not_there_without_charging()
        {
            Career(scienceCost: 900, banked: 100f);

            var result = Research();

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.InsufficientScience, result.ErrorCode);
            Assert.Equal(900.0, result.Breach!.Actual);
            Assert.Equal(100.0, result.Breach.Limit);
            Assert.Equal(Units.Science, result.Breach.Unit);
            Assert.Empty(ResearchAndDevelopment.Instance!.Charges);
            Assert.Empty(SpaceCenterManagement.Instance!.TechList);
        }

        /// <summary>
        /// Affordability is RP-1's question, not ours: the modified total is what
        /// decides it and what a refusal quotes, because that is the figure the
        /// R&amp;D screen's own tooltip shows. At a multiplier of 1 a handler
        /// reading the list price passes either way, which is why this one is not.
        /// </summary>
        [Fact]
        public void Prices_the_refusal_at_RP1s_modified_total()
        {
            Career(scienceCost: 100, banked: 150f);
            CurrencyModifierQueryRP0.ScienceMultiplier = 2.0;

            var result = Research();

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.InsufficientScience, result.ErrorCode);
            Assert.Equal(200.0, result.Breach!.Actual);
        }

        /// <summary>
        /// The debit itself is the UNMODIFIED integer, because
        /// <c>RDTech.ResearchTech</c>'s own <c>AddScience(-scienceCost, ...)</c>
        /// is: the modifier chain decides affordability there and does not decide
        /// the charge.
        /// </summary>
        [Fact]
        public void Charges_the_unmodified_cost_even_when_modifiers_move_the_total()
        {
            Career(scienceCost: 100, banked: 500f);
            CurrencyModifierQueryRP0.ScienceMultiplier = 2.0;

            Assert.True(Research().Success);

            Assert.Equal(-100f, Assert.Single(ResearchAndDevelopment.Instance!.Charges).Key);
        }

        /// <summary>
        /// An unreadable price refuses rather than proceeding, for the reason
        /// <see cref="Rp1Pricing"/> gives about its own: RP-1's science charge
        /// performs no affordability test of its own.
        /// </summary>
        [Fact]
        public void Refuses_a_node_it_cannot_price()
        {
            Career();
            CurrencyModifierQueryRP0.ThrowOnQuery = true;

            var result = Research();

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
            Assert.Empty(ResearchAndDevelopment.Instance!.Charges);
            Assert.Empty(SpaceCenterManagement.Instance!.TechList);
        }

        /// <summary>
        /// The R&amp;D complex's own ceiling, in <c>ResearchTech</c>'s order:
        /// after affordability and before the charge, so a node over the limit
        /// costs a press and never a currency.
        /// </summary>
        [Fact]
        public void Refuses_a_node_over_the_science_cost_limit_without_charging()
        {
            Career(scienceCost: 900, banked: 5000f);
            GameVariables.Instance!.ScienceCostLimit = 500f;
            ScenarioUpgradeableFacilities.Levels["ResearchAndDevelopment"] = 0.5f;

            var result = Research();

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.LimitReached, result.ErrorCode);
            Assert.Equal(900.0, result.Breach!.Actual);
            Assert.Equal(500.0, result.Breach.Limit);
            Assert.Equal(0.5, result.Breach.FacilityLevel);
            Assert.Equal("ResearchAndDevelopment", result.Breach.Facility);
            Assert.Empty(ResearchAndDevelopment.Instance!.Charges);
            Assert.Empty(SpaceCenterManagement.Instance!.TechList);
        }

        /// <summary>
        /// The ceiling is read through the STRING overload, chosen by parameter
        /// type. KSP declares <c>GetFacilityLevel(SpaceCenterFacility)</c> beside
        /// it at the same arity, and an arity-only lookup takes whichever
        /// reflection lists first: bind to the enum one and the invoke throws on
        /// the string, which reads back as an unreadable ceiling and refuses every
        /// research command in the game with no member renamed anywhere.
        /// </summary>
        [Fact]
        public void Reads_the_ceiling_through_the_overload_that_takes_a_facility_name()
        {
            Career(scienceCost: 900, banked: 5000f);
            GameVariables.Instance!.ScienceCostLimit = 500f;
            ScenarioUpgradeableFacilities.Levels["ResearchAndDevelopment"] = 0.5f;

            var result = Research();

            Assert.Equal(CommandErrorCode.LimitReached, result.ErrorCode);
            Assert.Equal(0.5, result.Breach!.FacilityLevel);
            Assert.Equal(0, ScenarioUpgradeableFacilities.EnumOverloadCalls);
        }

        // ── the queue ──────────────────────────────────────────────────────

        /// <summary>
        /// The node goes in through the SHADOWING <c>Add</c>, which is the one
        /// that fires RP-1's list events. A handler bound to
        /// <c>List&lt;T&gt;.Add</c> leaves the queue looking identical and every
        /// subscriber untold, so the count alone cannot see the difference and
        /// this asserts the observation.
        /// </summary>
        [Fact]
        public void Queues_through_the_observable_add()
        {
            Career();

            Assert.True(Research().Success);

            Assert.Equal(SpaceCenterManagement.Instance!.TechList.Single(),
                SpaceCenterManagement.Instance.TechList.Observed.Single());
        }

        /// <summary>
        /// The build rate is recomputed at the position the node actually landed
        /// at, which is what decides how fast it researches behind the queue ahead
        /// of it.
        /// </summary>
        [Fact]
        public void Costs_the_new_node_at_its_own_queue_position()
        {
            Career();
            SpaceCenterManagement.Instance!.TechList.Add(new ResearchProject { techID = "ahead" });
            SpaceCenterManagement.Instance.TechList.Add(new ResearchProject { techID = "alsoAhead" });

            Assert.True(Research().Success);

            Assert.Equal(2, SpaceCenterManagement.Instance.TechList.Last().BuildRateIndex);
        }

        /// <summary>The node's parts are offered as experimental, as RP-1's own prefix does last.</summary>
        [Fact]
        public void Offers_the_nodes_parts_as_experimental()
        {
            Career();

            Assert.True(Research().Success);

            Assert.Equal(TechId, Assert.Single(KCTUtilities.ExperimentalNodes));
        }

        /// <summary>
        /// The experimental-parts offer is a convenience RP-1 performs after the
        /// node is queued. A career that does not get the offer has still queued
        /// the node it paid for, and telling an operator otherwise would send them
        /// to press again and pay twice.
        /// </summary>
        [Fact]
        public void Still_succeeds_when_the_experimental_parts_offer_fails()
        {
            Career();
            KCTUtilities.ThrowOnExperimental = true;

            Assert.True(Research().Success);

            Assert.Single(SpaceCenterManagement.Instance!.TechList);
        }

        /// <summary>
        /// The one place the science can be gone with nothing queued. It is said
        /// rather than reported as a plain refusal, because an operator reading
        /// "refused" would expect their science back.
        /// </summary>
        [Fact]
        public void Says_so_when_the_queue_refuses_a_node_already_paid_for()
        {
            Career();
            SpaceCenterManagement.Instance!.TechList.ThrowOnAdd = true;

            var result = Research();

            Assert.False(result.Success);
            Assert.Contains("has been spent", result.Detail);
            Assert.Single(ResearchAndDevelopment.Instance!.Charges);
        }

        // ── the refusals ───────────────────────────────────────────────────

        [Fact]
        public void Refuses_a_command_that_named_no_node()
        {
            Career();

            var result = Research(techId: null);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Empty(ResearchAndDevelopment.Instance!.Charges);
        }

        [Fact]
        public void Refuses_a_node_the_tree_does_not_have()
        {
            Career();

            var result = Research(techId: "noSuchNode");

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotFound, result.ErrorCode);
            Assert.Empty(SpaceCenterManagement.Instance!.TechList);
        }

        [Fact]
        public void Refuses_a_node_the_player_has_already_researched()
        {
            Career();
            ResearchAndDevelopment.Instance!.SetTechState(
                TechId, new ProtoTechNode { techID = TechId, state = RDTech.State.Available });

            var result = Research();

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.WrongState, result.ErrorCode);
            Assert.Contains(TechTitle, result.Detail);
            Assert.Empty(ResearchAndDevelopment.Instance.Charges);
        }

        /// <summary>
        /// Asked BEFORE the charge, deliberately: the science leaves at enqueue,
        /// so a second press of a control an operator thought had not landed would
        /// pay for the same node twice.
        /// </summary>
        [Fact]
        public void Refuses_a_node_already_on_the_queue_without_charging()
        {
            Career();
            Assert.True(Research().Success);
            ResearchAndDevelopment.Instance!.Charges.Clear();

            var result = Research();

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.WrongState, result.ErrorCode);
            Assert.Empty(ResearchAndDevelopment.Instance.Charges);
            Assert.Single(SpaceCenterManagement.Instance!.TechList);
        }

        /// <summary>
        /// RP-1's own prefix returns TRUE, letting the stock instant unlock
        /// through, unless all three of its general settings hold. A project
        /// queued in that save is one nothing will work through.
        /// </summary>
        [Theory]
        [InlineData(false, true, true)]
        [InlineData(true, false, true)]
        [InlineData(true, true, false)]
        public void Refuses_a_save_RP1_does_not_queue_research_in(bool enabled, bool techTimes, bool buildTimes)
        {
            Career();
            PresetManager.Instance!.ActivePreset.GeneralSettings.Enabled = enabled;
            PresetManager.Instance.ActivePreset.GeneralSettings.TechUnlockTimes = techTimes;
            PresetManager.Instance.ActivePreset.GeneralSettings.BuildTimes = buildTimes;

            var result = Research();

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
            Assert.Empty(ResearchAndDevelopment.Instance!.Charges);
            Assert.Empty(SpaceCenterManagement.Instance!.TechList);
        }

        /// <summary>
        /// An unreadable preset refuses, the same direction
        /// <see cref="Rp1CareerProjectGate"/> takes: this is the branch that
        /// decides whether RP-1 models research at all.
        /// </summary>
        [Fact]
        public void Refuses_when_the_preset_cannot_be_read()
        {
            Career();
            PresetManager.Instance = null;

            var result = Research();

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
            Assert.Empty(ResearchAndDevelopment.Instance!.Charges);
        }

        [Fact]
        public void Refuses_a_save_RP1_is_not_managing()
        {
            Career();
            SpaceCenterManagement.Instance!.enabledForSave = false;

            var result = Research();

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
            Assert.Empty(ResearchAndDevelopment.Instance!.Charges);
        }

        /// <summary>
        /// A save with no R&amp;D at all. Checked BEFORE the state read for a
        /// reason worth keeping: stock's <c>GetTechnologyState</c> answers
        /// <c>Available</c> when its instance is null, so a handler that asked it
        /// first would tell an operator on a sandbox save that every node was
        /// already researched.
        /// </summary>
        [Fact]
        public void Refuses_a_save_with_no_research_and_development()
        {
            Career();
            ResearchAndDevelopment.Instance = null;

            var result = Research();

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.CareerModeRequired, result.ErrorCode);
        }

        [Fact]
        public void Refuses_when_the_tech_tree_cannot_be_read()
        {
            Career();
            AssetBase.RnDTechTree!.ThrowOnGet = true;

            var result = Research();

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
            Assert.Empty(SpaceCenterManagement.Instance!.TechList);
        }

        [Fact]
        public void Refuses_when_RP1s_space_centre_is_not_loaded()
        {
            Career();
            SpaceCenterManagement.Instance = null;

            var result = Research();

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.ModeUnavailable, result.ErrorCode);
        }

        // ── availability and diagnosis ─────────────────────────────────────

        /// <summary>
        /// Availability turns on the TYPES, so the command is declared wherever
        /// RP-1 and KSP are, and every narrower condition is answered at the press
        /// with a sentence.
        /// </summary>
        [Fact]
        public void Is_available_when_the_types_resolve()
        {
            Assert.True(_commands.IsAvailable);
            Assert.Equal("every invoked member resolved", _commands.MethodDiagnosis());
        }

        /// <summary>
        /// The draft is the checklist as data, and it is public for that reason:
        /// this and the shipped-assembly check in
        /// <c>Rp1InstalledCompatibilityTests</c> read the same list.
        /// </summary>
        [Fact]
        public void Draft_names_the_seven_persistent_keys_and_the_proto_node()
        {
            var draft = Rp1ResearchCommands.Draft(
                "nodeA", "Node A", 42, "Unavailable", 1955, 1960, new List<string> { "part" });

            Assert.Equal(
                new[] { "scienceCost", "startYear", "endYear", "techName", "techID", "progress", "workRate" },
                draft.Values.Select(v => v.Key).ToArray());
            Assert.Equal(new[] { "id", "state", "cost" }, draft.ProtoValues.Select(v => v.Key).ToArray());
            Assert.Equal(new[] { "part" }, draft.ProtoParts.ToArray());
        }
    }
}
