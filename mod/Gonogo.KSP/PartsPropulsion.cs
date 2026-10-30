using System.Collections.Generic;

namespace Gonogo.KSP
{
    /// <summary>
    /// Whether a craft can push itself at all, decided from its parts alone: the
    /// propellants each engine or thruster draws and how much of each the craft
    /// holds. Carries no KSP type, so a loaded craft's parts and an unloaded
    /// craft's saved parts feed it the same way.
    /// </summary>
    public static class PartsPropulsion
    {
        /// <summary>Intake air is drawn from the atmosphere, never stored, so an engine that burns it is never out of it.</summary>
        private const string IntakeAir = "IntakeAir";

        private const double EmptyBelow = 1e-6;

        /// <summary>
        /// False when the craft provably has nothing to push with: no thruster,
        /// or every thruster draws only propellants the craft holds none of.
        /// True when some thruster has propellant, so its delta-v is not zero but
        /// is not known from parts alone. Null when a thruster's propellants could
        /// not be read and no other thruster has any, so nothing can be said.
        /// </summary>
        /// <param name="thrusters">One entry per engine or thruster module: the propellant names it draws, or null when they could not be read.</param>
        /// <param name="held">Total amount of each resource across the craft, by resource name.</param>
        public static bool? CanPush(IReadOnlyList<IReadOnlyList<string>?> thrusters, IReadOnlyDictionary<string, double> held)
        {
            var unreadable = false;
            foreach (var propellants in thrusters)
            {
                if (propellants == null || propellants.Count == 0)
                {
                    unreadable = true;
                    continue;
                }
                foreach (var name in propellants)
                {
                    if (name == IntakeAir || (held.TryGetValue(name, out var amount) && amount > EmptyBelow))
                    {
                        return true;
                    }
                }
            }
            return unreadable ? (bool?)null : false;
        }
    }
}
