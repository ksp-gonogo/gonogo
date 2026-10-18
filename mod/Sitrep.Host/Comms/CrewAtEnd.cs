namespace Sitrep.Host.Comms
{
    /// <summary>
    /// What became of a craft's crew when the player ended it from the Tracking Station,
    /// as the game's roster read them after the end: how many are dead and how many
    /// are missing, which the game returns to the roster when their respawn period ends.
    /// A kerbal in any other state is counted in neither.
    /// </summary>
    public sealed class CrewAtEnd
    {
        public CrewAtEnd(int dead, int missing)
        {
            Dead = dead;
            Missing = missing;
        }

        /// <summary>The tally of crew whose roster statuses, named as the game names them, are <c>Dead</c> and <c>Missing</c>.</summary>
        public static CrewAtEnd Of(System.Collections.Generic.IEnumerable<string> rosterStatuses)
        {
            var dead = 0;
            var missing = 0;
            foreach (var status in rosterStatuses)
            {
                switch (status)
                {
                    case "Dead":
                        dead++;
                        break;
                    case "Missing":
                        missing++;
                        break;
                }
            }
            return new CrewAtEnd(dead, missing);
        }

        /// <summary>The crew whose roster status is dead.</summary>
        public int Dead { get; }

        /// <summary>The crew whose roster status is missing.</summary>
        public int Missing { get; }
    }
}
