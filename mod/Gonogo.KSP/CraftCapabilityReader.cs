using System;
using System.Collections.Generic;
using Expansions.Serenity;
using ModuleWheels;
using Sitrep.Host.Comms;
using UnityEngine;
using ContractVector = Sitrep.Contract.Vector3d;

namespace Gonogo.KSP
{
    /// <summary>
    /// Reads what each craft could do to leave the path it is reckoned on, for
    /// its contact-plan node. Main thread only.
    ///
    /// <para>Delta-v and thrust can only be read off a loaded craft, whose stock
    /// stage simulation runs. An unloaded craft keeps what it had when it was
    /// last loaded, since nothing spends propellant on rails. A craft with no
    /// thruster, or none holding propellant, is read from its parts whether or
    /// not it is loaded and answers delta-v 0. One not loaded since the save
    /// was opened that does have a thruster with propellant has no delta-v
    /// known, which is not the same as none, but it is known not to be thrusting.</para>
    /// </summary>
    public sealed class CraftCapabilityReader
    {
        private readonly Dictionary<Guid, (double? DeltaV, double? Acceleration, bool Driven)> _lastLoaded =
            new Dictionary<Guid, (double?, double?, bool)>();

        /// <summary>What <paramref name="vessel"/> could do now. Its delta-v and acceleration are null while it has never been read with a ready simulation.</summary>
        public CraftCapability? Read(Vessel vessel)
        {
            if (vessel.loaded)
            {
                ReadLoaded(vessel);
            }
            else
            {
                ReadUnloaded(vessel);
            }
            if (!_lastLoaded.TryGetValue(vessel.id, out var last))
            {
                last = (null, null, vessel.loaded ? Driven(vessel) : DrivenSaved(vessel.protoVessel));
            }
            var thrusting = Thrusting(vessel);
            return new CraftCapability(
                last.DeltaV, last.Acceleration, Airspeed(vessel), last.Driven, thrusting, thrusting == true ? EngineAcceleration(vessel) : null);
        }

        /// <summary>
        /// Whether an engine or a reaction thruster is producing thrust now. An
        /// unloaded craft is on rails and burns nothing; a kerbal on EVA and a
        /// craft with no parts to read give null.
        /// </summary>
        private static bool? Thrusting(Vessel vessel)
        {
            if (!vessel.loaded)
            {
                return false;
            }
            if (vessel.isEVA || vessel.parts == null)
            {
                return null;
            }
            foreach (var part in vessel.parts)
            {
                if (part == null)
                {
                    continue;
                }
                foreach (var engine in part.FindModulesImplementing<ModuleEngines>())
                {
                    if (engine.finalThrust > 0f)
                    {
                        return true;
                    }
                }
                foreach (var rcs in part.FindModulesImplementing<ModuleRCS>())
                {
                    if (rcs.rcsEnabled && rcs.rcs_active)
                    {
                        return true;
                    }
                }
            }
            return false;
        }

        /// <summary>
        /// The acceleration the engines give the loaded craft now, split along its
        /// own prograde, radial and normal. Null when no engine is producing thrust
        /// (reaction thrusters alone are left out) or its mass or motion gives no
        /// frame to split it in.
        /// </summary>
        private static ThrustAcceleration? EngineAcceleration(Vessel vessel)
        {
            var mass = vessel.GetTotalMass();
            if (vessel.parts == null || vessel.mainBody == null || !(mass > 0f))
            {
                return null;
            }
            var force = new Vector3d(0.0, 0.0, 0.0);
            foreach (var part in vessel.parts)
            {
                if (part == null)
                {
                    continue;
                }
                foreach (var engine in part.FindModulesImplementing<ModuleEngines>())
                {
                    if (!(engine.finalThrust > 0f) || engine.thrustTransforms == null)
                    {
                        continue;
                    }
                    for (var i = 0; i < engine.thrustTransforms.Count; i++)
                    {
                        var share = engine.thrustTransformMultipliers != null && i < engine.thrustTransformMultipliers.Count
                            ? engine.thrustTransformMultipliers[i]
                            : 1f / engine.thrustTransforms.Count;
                        force += (Vector3d)(-engine.thrustTransforms[i].forward) * (engine.finalThrust * share);
                    }
                }
            }
            if (force.sqrMagnitude <= 0.0)
            {
                return null;
            }
            // Thrust in kN over mass in tonnes is m/s².
            var thrust = force / mass;
            var height = vessel.CoMD - vessel.mainBody.position;
            var velocity = vessel.obt_velocity;
            return ThrustFrame.Split(
                new ContractVector(height.x, height.y, height.z),
                new ContractVector(velocity.x, velocity.y, velocity.z),
                new ContractVector(thrust.x, thrust.y, thrust.z));
        }

        private void ReadLoaded(Vessel vessel)
        {
            var propulsion = Propulsion(vessel);
            if (propulsion != null)
            {
                _lastLoaded[vessel.id] = (propulsion.Value.DeltaV, propulsion.Value.Acceleration, Driven(vessel));
                return;
            }
            if (!vessel.isEVA && CanPushLive(vessel) == false)
            {
                _lastLoaded[vessel.id] = (0.0, null, Driven(vessel));
            }
        }

        private void ReadUnloaded(Vessel vessel)
        {
            if (_lastLoaded.ContainsKey(vessel.id) || vessel.isEVA)
            {
                return;
            }
            if (CanPushSaved(vessel.protoVessel) == false)
            {
                _lastLoaded[vessel.id] = (0.0, null, DrivenSaved(vessel.protoVessel));
            }
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

        /// <summary>Whether the loaded craft's parts hold a thruster with propellant, see <see cref="PartsPropulsion.CanPush"/>.</summary>
        private static bool? CanPushLive(Vessel vessel)
        {
            if (vessel.parts == null)
            {
                return null;
            }
            var thrusters = new List<IReadOnlyList<string>?>();
            var held = new Dictionary<string, double>();
            foreach (var part in vessel.parts)
            {
                if (part == null)
                {
                    continue;
                }
                AddThrusters(part, thrusters);
                if (part.Resources != null)
                {
                    foreach (PartResource resource in part.Resources)
                    {
                        Hold(held, resource.resourceName, resource.amount);
                    }
                }
            }
            return PartsPropulsion.CanPush(thrusters, held);
        }

        /// <summary>
        /// Whether an unloaded craft's saved parts hold a thruster with propellant.
        /// Thrusters are read off each part's prefab, since a saved part keeps only
        /// module values; null when a part's prefab is not available.
        /// </summary>
        private static bool? CanPushSaved(ProtoVessel? saved)
        {
            if (saved?.protoPartSnapshots == null)
            {
                return null;
            }
            var thrusters = new List<IReadOnlyList<string>?>();
            var held = new Dictionary<string, double>();
            foreach (var snapshot in saved.protoPartSnapshots)
            {
                var prefab = snapshot?.partInfo?.partPrefab;
                if (prefab == null)
                {
                    return null;
                }
                AddThrusters(prefab, thrusters);
                if (snapshot!.resources != null)
                {
                    foreach (var resource in snapshot.resources)
                    {
                        Hold(held, resource.resourceName, resource.amount);
                    }
                }
            }
            return PartsPropulsion.CanPush(thrusters, held);
        }

        private static void AddThrusters(Part part, List<IReadOnlyList<string>?> thrusters)
        {
            foreach (var engine in part.FindModulesImplementing<ModuleEngines>())
            {
                thrusters.Add(Names(engine.propellants));
            }
            foreach (var rcs in part.FindModulesImplementing<ModuleRCS>())
            {
                thrusters.Add(Names(rcs.propellants));
            }
        }

        private static IReadOnlyList<string>? Names(List<Propellant>? propellants)
        {
            if (propellants == null)
            {
                return null;
            }
            var names = new List<string>(propellants.Count);
            foreach (var propellant in propellants)
            {
                if (propellant != null)
                {
                    names.Add(propellant.name);
                }
            }
            return names;
        }

        private static void Hold(Dictionary<string, double> held, string name, double amount)
        {
            held.TryGetValue(name, out var total);
            held[name] = total + amount;
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
                if (IsDriving(part))
                {
                    return true;
                }
            }
            return false;
        }

        /// <summary>As <see cref="Driven"/>, for an unloaded craft, read off each saved part's prefab.</summary>
        private static bool DrivenSaved(ProtoVessel? saved)
        {
            if (saved?.protoPartSnapshots == null)
            {
                return false;
            }
            foreach (var snapshot in saved.protoPartSnapshots)
            {
                if (IsDriving(snapshot?.partInfo?.partPrefab))
                {
                    return true;
                }
            }
            return false;
        }

        private static bool IsDriving(Part? part) =>
            part != null && part.Modules != null
            && (part.Modules.Contains<ModuleWheelMotor>() || part.Modules.Contains<ModuleRoboticServoRotor>());

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
