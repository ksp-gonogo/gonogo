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
            var airspeed = Airspeed(vessel);
            var measured = airspeed.HasValue ? MeasuredAcceleration(vessel) : null;
            var parts = measured.HasValue ? ReadParts(vessel) : null;
            return new CraftCapability(
                last.DeltaV, last.Acceleration, airspeed, last.Driven, thrusting, thrusting == true ? EngineAcceleration(vessel) : null,
                measured, parts?.EngineChange, parts?.Canopies, parts?.AirDensity, parts?.DeployHeight, parts?.Extent, parts?.LockedEngines);
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

        /// <summary>
        /// What the game measured the loaded craft accelerating at, less gravity's
        /// share (its own <c>perturbation</c>, the smoothed change of its orbital
        /// velocity over the last frames, minus the gravitational acceleration), split
        /// along its prograde, radial and normal. Null for a craft the game is not
        /// simulating (on rails, where the orbit is already right) and for a reading
        /// that is not a number.
        /// </summary>
        private static ThrustAcceleration? MeasuredAcceleration(Vessel vessel)
        {
            if (!vessel.loaded || vessel.packed || vessel.mainBody == null)
            {
                return null;
            }
            var push = vessel.perturbation;
            if (double.IsNaN(push.x) || double.IsNaN(push.y) || double.IsNaN(push.z))
            {
                return null;
            }
            var height = vessel.CoMD - vessel.mainBody.position;
            var velocity = vessel.obt_velocity;
            return ThrustFrame.Split(
                new ContractVector(height.x, height.y, height.z),
                new ContractVector(velocity.x, velocity.y, velocity.z),
                new ContractVector(push.x, push.y, push.z));
        }

        /// <summary>
        /// The canopy of an armed, part open or opening parachute, with the time its
        /// animations leave before it is fully open: the part-open animation's remainder,
        /// then the full opening animation, whose progress sets its drag. Null for a
        /// parachute that is stowed, cut or fully open.
        /// </summary>
        private static CanopyReading? Canopy(ModuleParachute chute, Part part, float mass)
        {
            var state = chute.deploymentState;
            if (state == ModuleParachute.deploymentStates.DEPLOYED && !(chute.animTime < 1f))
            {
                return null;
            }
            if (state != ModuleParachute.deploymentStates.ACTIVE && state != ModuleParachute.deploymentStates.SEMIDEPLOYED && state != ModuleParachute.deploymentStates.DEPLOYED)
            {
                return null;
            }
            var semi = ParachuteDrag.PerPressure(PhysicsGlobals.DragMultiplier, chute.semiDeployedDrag * (double)part.mass, mass);
            var full = ParachuteDrag.PerPressure(PhysicsGlobals.DragMultiplier, chute.fullyDeployedDrag * (double)part.mass, mass);
            var rampSeconds = AnimationSeconds(chute, chute.fullyDeployedAnimation, chute.deploymentSpeed);
            if (state == ModuleParachute.deploymentStates.DEPLOYED)
            {
                return CanopyReading.Opening(semi, full, rampSeconds, chute.animTime, chute.deploymentCurve);
            }
            var armed = state == ModuleParachute.deploymentStates.ACTIVE;
            var semiSeconds = AnimationSeconds(chute, chute.semiDeployedAnimation, chute.semiDeploymentSpeed);
            var openAfter = armed ? semiSeconds : (1.0 - Math.Min(1.0, chute.animTime)) * semiSeconds;
            // An armed canopy opens only while the game's own safety reading is within what its owner allowed.
            var held = armed && (int)chute.deploymentSafeState > chute.automateSafeDeploy;
            return new CanopyReading(semi, full, chute.deployAltitude, held ? chute.maxSafeSpeedAtRef : (double?)null, openAfter, rampSeconds, 0.0, chute.deploymentCurve);
        }

        private static readonly System.Reflection.FieldInfo? ChuteAnimation = typeof(ModuleParachute).GetField("Anim");

        /*
         * The animation is read through reflection so the plugin needs no reference to
         * Unity's animation module, which the build's set of game assemblies does not carry.
         */
        /// <summary>How long a parachute's animation takes at its deployment speed, in seconds; zero where the game has no such clip, which counts as at once.</summary>
        private static double AnimationSeconds(ModuleParachute chute, string clip, float speed)
        {
            if (!(speed > 0f) || string.IsNullOrEmpty(clip) || ChuteAnimation?.GetValue(chute) is not object animation)
            {
                return 0.0;
            }
            try
            {
                var state = animation.GetType().GetProperty("Item", new[] { typeof(string) })?.GetValue(animation, new object[] { clip });
                return state?.GetType().GetProperty("length")?.GetValue(state, null) is float length ? length / speed : 0.0;
            }
            catch (System.Reflection.TargetInvocationException)
            {
                return 0.0;
            }
        }

        /// <summary>How much of each propellant every ignited engine on the craft draws in a second, by resource id.</summary>
        private static Dictionary<int, double> Draw(Vessel vessel)
        {
            var draw = new Dictionary<int, double>();
            var step = (double)TimeWarp.fixedDeltaTime;
            foreach (var part in vessel.parts)
            {
                if (part == null)
                {
                    continue;
                }
                foreach (var engine in part.FindModulesImplementing<ModuleEngines>())
                {
                    if (!engine.EngineIgnited || engine.flameout || !(step > 0.0))
                    {
                        continue;
                    }
                    foreach (var propellant in engine.propellants)
                    {
                        draw.TryGetValue(propellant.id, out var so);
                        draw[propellant.id] = so + propellant.currentRequirement / step;
                    }
                }
            }
            return draw;
        }

        /// <summary>
        /// How long the engine's propellant lasts at the rate every engine draws it now:
        /// the shortest of its propellants. Zero where a draw was not measured, which
        /// counts as burning out at once.
        /// </summary>
        private static double BurnSeconds(ModuleEngines engine, Dictionary<int, double> draw)
        {
            var burn = double.PositiveInfinity;
            foreach (var propellant in engine.propellants)
            {
                if (!draw.TryGetValue(propellant.id, out var rate) || !(rate > 0.0))
                {
                    return 0.0;
                }
                burn = Math.Min(burn, propellant.totalResourceAvailable / rate);
            }
            return double.IsInfinity(burn) ? 0.0 : burn;
        }

        private sealed class PartsReading
        {
            public double EngineChange;
            public List<LockedEngineReading> LockedEngines = new List<LockedEngineReading>();
            public List<CanopyReading> Canopies = new List<CanopyReading>();
            public double AirDensity;
            public double DeployHeight;
            public double Extent;
        }

        /// <summary>
        /// What the craft's own parts can still change, for the loaded craft in an
        /// atmosphere: each ignited engine's change from its thrust now to nothing or
        /// to full, each unignited engine of the next stage to full, over the craft's
        /// mass; and each parachute that is armed or part open, with the drag it would
        /// give part open and fully open and what the game needs before it opens
        /// fully. A solid motor is read as a locked engine with the time its propellant
        /// lasts. A canopy the game calls deployed while its opening animation still
        /// runs counts as opening. A decoupler and a parachute in the next stage are not read. Null when the craft has
        /// no mass or no parts to read.
        /// </summary>
        private static PartsReading? ReadParts(Vessel vessel)
        {
            var mass = vessel.GetTotalMass();
            if (vessel.parts == null || !(mass > 0f))
            {
                return null;
            }
            var reading = new PartsReading { AirDensity = vessel.atmDensity };
            var change = 0.0;
            var draw = Draw(vessel);
            foreach (var part in vessel.parts)
            {
                if (part == null)
                {
                    continue;
                }
                foreach (var engine in part.FindModulesImplementing<ModuleEngines>())
                {
                    if (engine.EngineIgnited && !engine.flameout)
                    {
                        var now = (double)engine.finalThrust;
                        // A locked throttle on a flat thrust curve can only lose thrust, when the propellant is gone.
                        if (engine.throttleLocked && !engine.useThrustCurve)
                        {
                            reading.LockedEngines.Add(new LockedEngineReading(now / mass, BurnSeconds(engine, draw)));
                            continue;
                        }
                        change += Math.Max(now, engine.maxThrust - now);
                        continue;
                    }
                    if (!engine.EngineIgnited && part.inverseStage == vessel.currentStage - 1)
                    {
                        change += engine.maxThrust;
                    }
                }
                foreach (var chute in part.FindModulesImplementing<ModuleParachute>())
                {
                    if (Canopy(chute, part, mass) is CanopyReading canopy)
                    {
                        reading.Canopies.Add(canopy);
                    }
                }
            }
            reading.Extent = Extent(vessel);
            // Thrust in kN over mass in tonnes is m/s².
            reading.EngineChange = change / mass;
            // The game opens a canopy fully below its deploy height above sea level, or with ground that near below the part.
            reading.DeployHeight = vessel.heightFromTerrain >= 0f ? Math.Min(vessel.altitude, vessel.heightFromTerrain) : vessel.altitude;
            return reading;
        }

        /// <summary>
        /// The radius of the sphere round the craft's centre of mass that holds it: half
        /// the diagonal of the box the game measures round its parts, and the far corner
        /// of the bounds of each parachute canopy that is part or fully open, which the
        /// game draws and the craft's own size does not include.
        /// </summary>
        private static double Extent(Vessel vessel)
        {
            var size = vessel.vesselSize;
            var extent = 0.5 * Math.Sqrt((double)size.x * size.x + (double)size.y * size.y + (double)size.z * size.z);
            var centre = vessel.CoMD;
            foreach (var part in vessel.parts)
            {
                if (part == null)
                {
                    continue;
                }
                foreach (var chute in part.FindModulesImplementing<ModuleParachute>())
                {
                    if (chute.deploymentState != ModuleParachute.deploymentStates.SEMIDEPLOYED
                        && chute.deploymentState != ModuleParachute.deploymentStates.DEPLOYED)
                    {
                        continue;
                    }
                    var canopy = part.FindModelTransform(chute.canopyName);
                    if (canopy == null)
                    {
                        continue;
                    }
                    foreach (var renderer in canopy.GetComponentsInChildren<Renderer>())
                    {
                        var box = renderer.bounds;
                        var reach = (box.center - (Vector3)centre).magnitude + box.extents.magnitude;
                        extent = Math.Max(extent, reach);
                    }
                }
            }
            return extent;
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
