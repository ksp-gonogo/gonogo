using System;
using System.Collections.Generic;
using Sitrep.Host.CommandCentres;
using Sitrep.Contract;

namespace Gonogo.KSP.CommandCentres
{
    /// <summary>
    /// Enumerates crewed control-source vessels as command centres: the stock
    /// Probe Control Point mechanic (a crewed part making the vessel a local
    /// control source when qualifying crew reaches its minimum). Dynamic: a vessel
    /// becomes and stops being a centre at runtime, so it is re-enumerated each
    /// pass. Keyed <c>vessel:&lt;guid&gt;</c> so the authority matrix can self-exclude
    /// a crewed centre from its own subject row. The enumerator is injectable for
    /// testability (run at the full-sln fold; this worktree has no KSP refs).
    ///
    /// <para>A control source is not automatically a centre: it must also be
    /// REACHABLE, see <see cref="CommandCentreReach"/>. Nothing stops a config
    /// patch making a part a control point without also giving it an antenna, and
    /// the flag alone then put a node with no possible link on the operator's
    /// vantage list. A crewed craft that carries no antenna is excluded for
    /// exactly the same reason, which is the whole of the rule.</para>
    /// </summary>
    public sealed class CrewedVesselSource : ICommandCentreSource
    {
        private readonly Func<IEnumerable<Vessel>> _vessels;

        public CrewedVesselSource(Func<IEnumerable<Vessel>> vessels) => _vessels = vessels;

        public CrewedVesselSource()
            : this(() => FlightGlobals.Vessels)
        {
        }

        public string ProviderId => "crewed-vessel";

        public IEnumerable<ICommandCentre> Enumerate()
        {
            foreach (var vessel in _vessels())
            {
                if (vessel == null)
                {
                    continue;
                }

                var comm = vessel.connection?.Comm;
                if (comm == null || !comm.isControlSource)
                {
                    continue;
                }

                // isControlSource says a command that ARRIVES here may be obeyed.
                // It says nothing about whether anything can arrive, and a seat
                // CommNet can never route to is not a command centre. See
                // CommandCentreReach for stock's own gate and for why the antenna
                // parts are asked as well as the node's powers.
                if (!CommandCentreReach.CanBeReached(
                        comm.antennaTransmit?.power ?? 0.0,
                        comm.antennaRelay?.power ?? 0.0,
                        AntennaCandidateParts(vessel),
                        CarriesCommAntenna))
                {
                    continue;
                }

                // Coordinates only while the craft is actually ON its body. Off the
                // ground, converting precisePosition gives the sub-vessel ground
                // point, which sweeps at orbital rate and is not a place the centre
                // occupies; between spheres of influence it is a projection onto
                // whatever mainBody happens to be. The contract already says null
                // for a moving vessel centre, so this is where that gets honoured.
                double? latitude = null;
                double? longitude = null;
                if (IsOnSurface(vessel)
                    && SurfaceCoordinates.TryFrom(vessel.mainBody, comm.precisePosition, out var lat, out var lon))
                {
                    latitude = lat;
                    longitude = lon;
                }

                yield return new KspCommandCentre(
                    "vessel:" + vessel.id,
                    string.IsNullOrEmpty(vessel.vesselName) ? "Vessel" : vessel.vesselName,
                    CommandCentreKind.CrewedVessel,
                    BodyIndexOf(vessel.mainBody),
                    comm,
                    comm.precisePosition,
                    active: comm.isControlSource,
                    latitude: latitude,
                    longitude: longitude);
            }
        }

        /// <summary>
        /// The parts the antenna walk should look at, or null when the craft's parts
        /// cannot be read at all. Mirrors what <c>CommNetVessel.UpdateComm</c> itself
        /// walks: the live parts while loaded, and each proto part's PREFAB while on
        /// rails, which is where an unloaded craft's modules are declared.
        /// </summary>
        private static IEnumerable<Part>? AntennaCandidateParts(Vessel vessel)
        {
            if (vessel.loaded)
            {
                return vessel.parts;
            }

            var snapshots = vessel.protoVessel?.protoPartSnapshots;
            return snapshots == null ? null : PrefabsOf(snapshots);
        }

        private static IEnumerable<Part> PrefabsOf(IEnumerable<ProtoPartSnapshot> snapshots)
        {
            foreach (var snapshot in snapshots)
            {
                var prefab = snapshot?.partInfo?.partPrefab;
                if (prefab != null)
                {
                    yield return prefab;
                }
            }
        }

        /// <summary>
        /// Whether one part carries a CommNet antenna. <see cref="ICommAntenna"/> is
        /// the interface CommNet itself counts as an antenna, and the antenna modules
        /// a replacement range model ships derive from <c>ModuleDataTransmitter</c>,
        /// so the question holds across networks; see <see cref="CommandCentreReach"/>.
        ///
        /// <para>Presence, not <c>CanComm()</c>: a retracted or unpowered dish is a
        /// craft that cannot be reached RIGHT NOW, which the roster has no business
        /// reacting to. What is being asked is whether it can ever be reached.</para>
        /// </summary>
        private static bool CarriesCommAntenna(Part part)
        {
            var modules = part?.Modules;
            if (modules == null)
            {
                return false;
            }

            for (var i = 0; i < modules.Count; i++)
            {
                if (modules[i] is ICommAntenna)
                {
                    return true;
                }
            }

            return false;
        }

        /// <summary>
        /// Whether the craft is resting on its body, which is the only state where a
        /// crewed centre has a surface position rather than a groundtrack point.
        /// PRELAUNCH counts: a craft on the pad is as anchored as the pad is.
        /// </summary>
        private static bool IsOnSurface(Vessel vessel) =>
            vessel.situation == Vessel.Situations.LANDED
            || vessel.situation == Vessel.Situations.SPLASHED
            || vessel.situation == Vessel.Situations.PRELAUNCH;

        private static int? BodyIndexOf(CelestialBody body)
        {
            if (body == null)
            {
                return null;
            }

            var index = FlightGlobals.Bodies.IndexOf(body);
            return index >= 0 ? index : (int?)null;
        }
    }
}
