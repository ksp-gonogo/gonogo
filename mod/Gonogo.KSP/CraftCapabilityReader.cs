using System;
using System.Collections.Generic;
using Expansions.Serenity;
using ModuleWheels;
using Sitrep.Host.Comms;

namespace Gonogo.KSP
{
    /// <summary>
    /// Reads what each craft could do to leave the path it is reckoned on, for
    /// its contact-plan node. Main thread only.
    ///
    /// <para>Delta-v and thrust can only be read off a loaded craft, whose stock
    /// stage simulation runs. An unloaded craft keeps what it had when it was
    /// last loaded, since nothing spends propellant on rails; one not loaded
    /// since the save was opened has none.</para>
    /// </summary>
    public sealed class CraftCapabilityReader
    {
        private readonly Dictionary<Guid, (double? DeltaV, double? Acceleration, bool Driven)> _lastLoaded =
            new Dictionary<Guid, (double?, double?, bool)>();

        /// <summary>What <paramref name="vessel"/> could do now, or null when it has never been read loaded.</summary>
        public CraftCapability? Read(Vessel vessel)
        {
            if (vessel.loaded)
            {
                var propulsion = Propulsion(vessel);
                if (propulsion != null)
                {
                    _lastLoaded[vessel.id] = (propulsion.Value.DeltaV, propulsion.Value.Acceleration, Driven(vessel));
                }
            }
            if (!_lastLoaded.TryGetValue(vessel.id, out var last))
            {
                return null;
            }
            return new CraftCapability(last.DeltaV, last.Acceleration, Airspeed(vessel), last.Driven);
        }

        /// <summary>Forgets every craft not in <paramref name="listed"/>, by bare guid.</summary>
        public void KeepOnly(ICollection<string> listed)
        {
            var leaving = new List<Guid>();
            foreach (var id in _lastLoaded.Keys)
            {
                if (!listed.Contains(id.ToString()))
                {
                    leaving.Add(id);
                }
            }
            foreach (var id in leaving)
            {
                _lastLoaded.Remove(id);
            }
        }

        /// <summary>
        /// Vacuum delta-v and the largest stage acceleration from the stock stage
        /// simulation, or null while it has no answer. A stage's acceleration is
        /// highest at its end, with its propellant spent.
        /// </summary>
        private static (double DeltaV, double? Acceleration)? Propulsion(Vessel vessel)
        {
            var dv = vessel.VesselDeltaV;
            if (dv == null || !dv.IsReady)
            {
                return null;
            }
            double? most = null;
            var stages = dv.OperatingStageInfo;
            if (stages != null)
            {
                foreach (var stage in stages)
                {
                    if (stage == null || stage.endMass <= 0)
                    {
                        continue;
                    }
                    // Thrust in kN over mass in tonnes is m/s².
                    var acceleration = stage.thrustVac / (double)stage.endMass;
                    if (most == null || acceleration > most)
                    {
                        most = acceleration;
                    }
                }
            }
            return (Math.Max(0.0, dv.TotalDeltaVVac), most);
        }

        /// <summary>Whether a wheel motor or a rotor is fitted: either moves the craft without spending delta-v.</summary>
        private static bool Driven(Vessel vessel)
        {
            if (vessel.parts == null)
            {
                return false;
            }
            foreach (var part in vessel.parts)
            {
                if (part != null && part.Modules != null
                    && (part.Modules.Contains<ModuleWheelMotor>() || part.Modules.Contains<ModuleRoboticServoRotor>()))
                {
                    return true;
                }
            }
            return false;
        }

        /// <summary>
        /// The craft's speed through the air, for one inside an atmosphere, or
        /// null for one above it. An unloaded craft's own surface speed is not
        /// kept up to date, so it is taken from its orbit against the body's turn.
        /// </summary>
        private static double? Airspeed(Vessel vessel)
        {
            var body = vessel.mainBody;
            if (body == null || !body.atmosphere)
            {
                return null;
            }
            if (vessel.loaded)
            {
                return vessel.altitude < body.atmosphereDepth ? vessel.srfSpeed : (double?)null;
            }
            var orbit = vessel.orbit;
            if (orbit == null || orbit.altitude >= body.atmosphereDepth)
            {
                return null;
            }
            return (orbit.GetVel() - body.getRFrmVelOrbit(orbit)).magnitude;
        }
    }
}
