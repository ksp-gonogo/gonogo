// Stand-ins for the strategy types Rp1StrategyCommands reaches by name, in the
// namespaces RP-1 declares them in, so the production walk resolves these
// exactly as it resolves the real assembly.
//
// What they can and cannot prove is stated in Rp0Fixture's header and holds
// here: a rename on RP-1's side stops production resolving while these go on
// carrying the old name, which is what Rp1ReflectionTargets exists to catch
// against the shipped binary. These prove ORDER and BRANCHING, which the
// manifest cannot see at all.
//
// The recorder is the point. Both defects this command was written around are
// defects of SEQUENCE rather than of value: performing the program half second
// mints an alarm against a deadline that has not been assigned, and performing
// it at all when the screen is open performs it twice. Neither is visible in a
// return value, so the fixture writes down what was called and in what order.
using System.Collections.Generic;

namespace Strategies
{
    /// <summary>Stock's strategy, carrying only what the command reads.</summary>
    public class Strategy
    {
        public string Name { get; set; } = "";

        public bool IsActive { get; set; }

        public double Factor { get; set; }

        public List<string> GroupTags { get; set; } = new List<string>();

        /// <summary>
        /// Arm 8. Virtual on RP-1's side, and where its program slot cap lives.
        /// </summary>
        public virtual bool CanActivate(ref string reason)
        {
            reason = RefuseWith ?? "";
            return RefuseWith == null;
        }

        /// <summary>Set by a test to make arm 8 refuse, with the game's own words.</summary>
        public string? RefuseWith { get; set; }
    }

    public class StrategySystem
    {
        public static StrategySystem? Instance { get; set; }

        public List<Strategy> Strategies { get; set; } = new List<Strategy>();

        /// <summary>Arm 2, and the only arm that reads the system rather than the strategy.</summary>
        public bool HasConflictingActiveStrategies(List<string> groupTags) => Conflicts;

        public bool Conflicts { get; set; }
    }
}

namespace RP0
{
    /// <summary>
    /// RP-1's strategy, carrying the procedure the command calls instead of
    /// <c>ActivateOverride</c>.
    /// </summary>
    public class StrategyRP0 : Strategies.Strategy
    {
        /// <summary>
        /// The whole fresh-activation procedure. Records the call rather than
        /// performing one, and records the deadline it WOULD have minted an alarm
        /// against, which is what the ordering defect corrupts.
        /// </summary>
        public void PerformActivate(bool useCurrency)
        {
            Programs.StrategyCallLog.Calls.Add("PerformActivate");
            IsActive = true;
            if (this is Programs.ProgramStrategy ps)
            {
                Programs.StrategyCallLog.AlarmDeadline = ps.Program?.deadlineUT;
            }
        }
    }
}

namespace RP0.Programs
{
    /// <summary>
    /// The subclass whose activation RP-1 splits across
    /// <c>PerformActivate</c> and <c>OnRegister</c>.
    /// </summary>
    public class ProgramStrategy : StrategyRP0
    {
        public Program? Program { get; set; }
    }
}

namespace RP0.Programs
{
    /// <summary>What the command called, in order, and what it would have used.</summary>
    public static class StrategyCallLog
    {
        public static List<string> Calls { get; } = new List<string>();

        /// <summary>
        /// The deadline <c>PerformActivate</c>'s alarm block saw. Zero means the
        /// template was still in place, which is the silent UT 0 alarm.
        /// </summary>
        public static double? AlarmDeadline { get; set; }

        public static void Reset()
        {
            Calls.Clear();
            AlarmDeadline = null;
        }
    }
}
