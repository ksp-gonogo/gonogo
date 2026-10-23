using System.Collections.Generic;

namespace Gonogo.KSP.Career
{
    /// <summary>
    /// One part of a saved craft as the control rule sees it: how many kerbals
    /// it seats and, when it carries a command module, the fewest crew that
    /// module needs to fly the craft (0 for a probe core).
    /// </summary>
    internal readonly struct CraftPart
    {
        public CraftPart(int seats, int? minimumCrew)
        {
            Seats = seats;
            MinimumCrew = minimumCrew;
        }

        public int Seats { get; }
        public int? MinimumCrew { get; }
    }

    /// <summary>
    /// What a craft needs before a launch will take it, read from its parts.
    /// </summary>
    internal readonly struct CraftControlFacts
    {
        public CraftControlFacts(int crewSeats, bool canFlyUnmanned, int? minimumCrew)
        {
            CrewSeats = crewSeats;
            CanFlyUnmanned = canFlyUnmanned;
            MinimumCrew = minimumCrew;
        }

        /// <summary>Kerbals the craft seats in all.</summary>
        public int CrewSeats { get; }

        /// <summary>True when a command module needs no crew, as a probe core does.</summary>
        public bool CanFlyUnmanned { get; }

        /// <summary>The fewest crew any command module needs; null when the craft has no command module.</summary>
        public int? MinimumCrew { get; }
    }

    /// <summary>
    /// The control rule behind <c>PreFlightTests.NoControlSources</c>, applied to
    /// a craft before it is launched: a craft flies when a command module needs
    /// no crew, or when the crew assigned meets the smallest crew a command
    /// module needs. Carved out of the saved-craft scan so it carries no KSP type
    /// and a headless test can enter it.
    /// </summary>
    internal static class CraftControl
    {
        public static CraftControlFacts Read(IEnumerable<CraftPart> parts)
        {
            var seats = 0;
            int? fewest = null;
            foreach (var part in parts)
            {
                seats += part.Seats;
                if (part.MinimumCrew is int needed && (fewest == null || needed < fewest))
                {
                    fewest = needed;
                }
            }

            return new CraftControlFacts(seats, fewest == 0, fewest);
        }
    }
}
