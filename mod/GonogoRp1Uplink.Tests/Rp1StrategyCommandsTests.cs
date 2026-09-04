// What rp1.strategy.activate must do, and the two things it must not.
//
// The valuable tests here are the two ORDERING ones. Both defects the command
// was written around are invisible in a return value: performing the program
// half second mints a KAC alarm against a deadline Accept() has not assigned
// yet, and performing it at all while the Administration screen is open
// performs it twice. Both leave a career wrong and report success, so they are
// asserted on the call log rather than on the result.
//
// What these cannot prove is what every fixture-backed test here cannot prove,
// and Rp0Fixture's header says it: these stand-ins carry RP-1's names, so a
// rename stops production resolving while they go on passing. That is
// Rp1ReflectionTargets' job, against the shipped binary.
using System;
using GonogoRp1Uplink;
using RP0.Programs;
using Sitrep.Contract;
using Xunit;

namespace GonogoRp1Uplink.Tests
{
    public class Rp1StrategyCommandsTests : IDisposable
    {
        private readonly Rp1StrategyCommands _commands = new Rp1StrategyCommands();

        public Rp1StrategyCommandsTests() => Reset();

        public void Dispose() => Reset();

        private static void Reset()
        {
            Strategies.StrategySystem.Instance = null;
            RP0.SpaceCenterManagement.Instance = null;
            ProgramHandler.Instance = null;
            StrategyCallLog.Reset();
        }

        /// <summary>A career with one leader on the roster and both singletons live.</summary>
        private static RP0.StrategyRP0 Leader(string name = "leaderKorolevAdmin")
        {
            // Named through Config, because that is where the game keeps a
            // strategy's id and where the command looks for it.
            var leader = new RP0.StrategyRP0
            {
                Config = new Strategies.StrategyConfig { Name = name, Title = name },
            };
            Seed(leader);
            return leader;
        }

        /// <summary>The same, with a program whose template deadline is unassigned.</summary>
        private static ProgramStrategy ProgramFor(string name = "earlyOrbital", bool inAdmin = false)
        {
            var strategy = new ProgramStrategy
            {
                Config = new Strategies.StrategyConfig { Name = name, Title = name },
                Program = new Program { name = name },
            };
            Seed(strategy);
            ProgramHandler.Instance!.IsInAdmin = inAdmin;
            return strategy;
        }

        private static void Seed(Strategies.Strategy strategy)
        {
            var system = new Strategies.StrategySystem();
            system.Strategies.Add(strategy);
            Strategies.StrategySystem.Instance = system;
            RP0.SpaceCenterManagement.Instance = new RP0.SpaceCenterManagement();
            ProgramHandler.Instance = new ProgramHandler();
        }

        private CommandResult Activate(string id, double? factor = null) =>
            _commands.Activate(new Rp1StrategyActivateArgs { StrategyId = id, Factor = factor });

        // ── The two orderings, which are the point of this file ──────────────

        /// <summary>
        /// The program half runs FIRST. In-screen it runs inside Register(),
        /// which is step 2 of PerformActivate and before its alarm block, so
        /// running it second leaves the TEMPLATE in place and the alarm is minted
        /// against a deadline of zero, silently.
        /// </summary>
        [Fact]
        public void Accepts_the_program_before_performing_the_activation()
        {
            var program = ProgramFor();

            var result = Activate(program.Config.Name);

            Assert.True(result.Success);
            Assert.Equal(new[] { "ActivateProgram", "PerformActivate" }, StrategyCallLog.Calls);
        }

        /// <summary>
        /// The consequence of getting that order wrong, asserted directly rather
        /// than only as a sequence: the alarm block must see the ACCEPTED
        /// deadline, never the template's unassigned zero.
        /// </summary>
        [Fact]
        public void The_alarm_sees_the_accepted_deadline_and_never_a_zero()
        {
            var program = ProgramFor();

            Activate(program.Config.Name);

            Assert.Equal(12345.0, StrategyCallLog.AlarmDeadline);
            Assert.NotEqual(0.0, StrategyCallLog.AlarmDeadline);
        }

        /// <summary>
        /// With the Administration screen open, RP-1's own OnRegister performs
        /// the program half inside PerformActivate. Performing it here as well
        /// accepts twice: two Accept()s, two Confidence charges, a duplicate
        /// ActivePrograms entry and a restarted funding schedule.
        ///
        /// <para>The remote console is exactly the case where the screen may be
        /// open, so this is the live path rather than an edge case.</para>
        /// </summary>
        [Fact]
        public void Never_accepts_the_program_itself_when_the_screen_is_open()
        {
            var program = ProgramFor(inAdmin: true);

            var result = Activate(program.Config.Name);

            Assert.True(result.Success);
            Assert.Equal(new[] { "PerformActivate" }, StrategyCallLog.Calls);
            Assert.DoesNotContain("ActivateProgram", StrategyCallLog.Calls);
        }

        /// <summary>A leader has no program half at all, whatever the screen is doing.</summary>
        [Fact]
        public void A_leader_is_one_call()
        {
            var leader = Leader();

            var result = Activate(leader.Config.Name);

            Assert.True(result.Success);
            Assert.Equal(new[] { "PerformActivate" }, StrategyCallLog.Calls);
        }

        // ── Refusals, none of which may reach the procedure ──────────────────

        /// <summary>
        /// Arm 8, where RP-1 puts the real program slot cap. Its words are the
        /// game's, quoted rather than replaced.
        /// </summary>
        [Fact]
        public void Refuses_with_the_games_own_reason_when_the_strategy_refuses()
        {
            var leader = Leader();
            leader.RefuseWith = "Program slots are full.";

            var result = Activate(leader.Config.Name);

            Assert.False(result.Success);
            Assert.Equal("Program slots are full.", result.Detail);
            Assert.Empty(StrategyCallLog.Calls);
        }

        /// <summary>
        /// Arm 9, and the reason it matters: <c>StrategyEffect.CanActivate</c> is
        /// virtual, so a mod's effect refuses for reasons we cannot enumerate.
        /// The semantics are "refuse if ANY effect refuses", which is NOT what
        /// the decompiler renders for that loop.
        /// </summary>
        [Fact]
        public void Refuses_when_any_effect_refuses()
        {
            var leader = Leader();
            leader.Effects.Add(new Strategies.StrategyEffect());
            leader.Effects.Add(new Strategies.StrategyEffect { RefuseWith = "Requires an orbital rendezvous first." });

            var result = Activate(leader.Config.Name);

            Assert.False(result.Success);
            Assert.Equal("Requires an orbital rendezvous first.", result.Detail);
            Assert.Empty(StrategyCallLog.Calls);
        }

        /// <summary>Effects that all permit must not block the commitment.</summary>
        [Fact]
        public void Proceeds_when_every_effect_permits()
        {
            var leader = Leader();
            leader.Effects.Add(new Strategies.StrategyEffect());
            leader.Effects.Add(new Strategies.StrategyEffect());

            var result = Activate(leader.Config.Name);

            Assert.True(result.Success);
            Assert.Equal(new[] { "PerformActivate" }, StrategyCallLog.Calls);
        }

        /// <summary>Arm 2, on the system rather than the strategy.</summary>
        [Fact]
        public void Refuses_a_strategy_that_conflicts_with_an_active_one()
        {
            var leader = Leader();
            Strategies.StrategySystem.Instance!.Conflicts = true;

            var result = Activate(leader.Config.Name);

            Assert.False(result.Success);
            Assert.Empty(StrategyCallLog.Calls);
        }

        [Fact]
        public void Refuses_a_strategy_that_is_already_active()
        {
            var leader = Leader();
            leader.IsActive = true;

            var result = Activate(leader.Config.Name);

            Assert.False(result.Success);
            Assert.Empty(StrategyCallLog.Calls);
        }

        [Fact]
        public void Refuses_a_strategy_it_cannot_find()
        {
            Leader();

            var result = Activate("leaderNobody");

            Assert.False(result.Success);
            Assert.Empty(StrategyCallLog.Calls);
        }

        /// <summary>
        /// PerformActivate dereferences the space centre unguarded, AFTER the
        /// currency charge. So it is checked before anything is written and
        /// refused on, rather than discovered part-way through.
        /// </summary>
        [Fact]
        public void Refuses_when_the_space_centre_is_not_loaded()
        {
            var leader = Leader();
            RP0.SpaceCenterManagement.Instance = null;

            var result = Activate(leader.Config.Name);

            Assert.False(result.Success);
            Assert.Empty(StrategyCallLog.Calls);
        }

        [Fact]
        public void Refuses_when_the_program_handler_is_not_loaded()
        {
            var leader = Leader();
            ProgramHandler.Instance = null;

            var result = Activate(leader.Config.Name);

            Assert.False(result.Success);
            Assert.Empty(StrategyCallLog.Calls);
        }

        // ── Factor, which is persisted and must not survive a refusal ────────

        /// <summary>
        /// Strategy.Factor is a plain persisted setter, so a refused activation
        /// that left it written would change the commitment level on the save
        /// with nothing to show for it. That was the second defect in c82fa8af2
        /// and it must not come back through this path.
        /// </summary>
        [Fact]
        public void Puts_the_commitment_level_back_when_the_game_refuses()
        {
            var leader = Leader();
            leader.Factor = 0.05;
            leader.RefuseWith = "Not eligible.";

            var result = Activate(leader.Config.Name, factor: 0.75);

            Assert.False(result.Success);
            Assert.Equal(0.05, leader.Factor);
        }

        [Fact]
        public void Keeps_the_commitment_level_when_the_game_accepts()
        {
            var leader = Leader();
            leader.Factor = 0.05;

            var result = Activate(leader.Config.Name, factor: 0.5);

            Assert.True(result.Success);
            Assert.Equal(0.5, leader.Factor);
        }
    }
}
