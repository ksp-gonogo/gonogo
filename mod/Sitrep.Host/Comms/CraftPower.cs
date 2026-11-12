using System;
using System.Collections.Generic;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// Whether a craft has the electric charge to run its radio. A craft with no
    /// charge left can neither take a command from a command centre nor send
    /// anything home, whatever the comms network says about its antennas; the
    /// crew on board can still fly it.
    ///
    /// <para>Applies only in a save whose "Vessel telemetry requires vessel charge" difficulty
    /// setting is on. Off, which a new save starts with, no craft is read and
    /// every link is the network's, as stock CommNet has it.</para>
    ///
    /// <para>Charge is what the craft can draw: stored electric charge in parts
    /// whose flow is enabled. A craft that carries no electric charge storage at
    /// all (a kerbal on EVA, a deployed surface station, a craft built without a
    /// battery) has no reading here, so its link is left to the network.</para>
    ///
    /// <para>A craft goes unpowered at <see cref="EmptyEc"/> or below and is
    /// powered again only once it holds <see cref="RestoredEc"/>. Without the gap
    /// a craft whose generation and draw are close to even flips its link every
    /// frame as the stored figure crosses one line.</para>
    /// </summary>
    public sealed class CraftPower
    {
        /// <summary>Stored electric charge, in units, at or below which a powered craft goes unpowered.</summary>
        public const double EmptyEc = 0.01;

        /// <summary>Stored electric charge, in units, an unpowered craft must reach to be powered again.</summary>
        public const double RestoredEc = 0.1;

        private readonly HashSet<string> _unpowered = new HashSet<string>(StringComparer.Ordinal);

        /// <summary>
        /// Whether the craft is powered, given what it can draw now and how much
        /// it could hold. Null when either figure was not read or the craft holds
        /// no electric charge storage, which leaves the craft's link alone.
        /// </summary>
        /// <param name="craftId">The craft's id, to remember which side of the gap it is on.</param>
        /// <param name="storedEc">The electric charge it can draw now, in units.</param>
        /// <param name="capacityEc">The most electric charge it can hold, in units.</param>
        public bool? Powered(string craftId, double? storedEc, double? capacityEc)
        {
            if (storedEc is not double stored || capacityEc is not double capacity
                || double.IsNaN(stored) || double.IsNaN(capacity) || capacity <= 0.0)
            {
                _unpowered.Remove(craftId);
                return null;
            }
            if (_unpowered.Contains(craftId))
            {
                if (stored < RestoredEc)
                {
                    return false;
                }
                _unpowered.Remove(craftId);
                return true;
            }
            if (stored <= EmptyEc)
            {
                _unpowered.Add(craftId);
                return false;
            }
            return true;
        }

        /// <summary>Forgets every craft not in <paramref name="present"/>, so a craft that has left does not stay remembered.</summary>
        public void KeepOnly(ICollection<string> present) => _unpowered.RemoveWhere(id => !present.Contains(id));

        /// <summary>
        /// A craft's link as its radio can use it: down when the craft is
        /// unpowered, otherwise the network's own reading.
        /// </summary>
        public static bool? Link(bool? networkConnected, bool? powered) =>
            powered == false ? false : networkConnected;
    }
}
