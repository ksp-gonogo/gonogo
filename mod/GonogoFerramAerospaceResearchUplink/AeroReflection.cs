// Reflection-only bridge to Ferram Aerospace Research. No compile-time reference
// to FerramAerospaceResearch.dll exists anywhere in this project: every FAR
// member is reached by runtime reflection, the same arm's-length pattern
// RaReflection and AvionicsReflection use, and the reason is the same. FAR's
// LICENSE file is not machine-classifiable and the mod is widely understood to
// be copyleft-family, so this assembly USES the running mod rather than
// INCORPORATING any of it. FAR's attribution notice is retained in
// NOTICE-FAR.txt alongside this file.
//
// Member names are RESOLVED, not guessed: every one below was read out of an
// ilspycmd 11.0 disassembly of the installed FerramAerospaceResearch.dll,
// FAR v0.16.1.2. What that reading established, and why the shape here follows
// from it:
//
//   - FlightGUI is a VesselModule, so it is reachable from the vessel's own
//     vesselModules list. FARAPI's VesselFlightInfo(v) goes through a static
//     Dictionary<Vessel, FlightGUI> instead; walking the modules avoids both the
//     generic dictionary lookup and any dependence on that static's lifetime,
//     and gets the same object
//   - FlightGUI.InfoParameters is a public VesselFlightInfo property with a
//     private setter, written unconditionally in FlightGUI.FixedUpdate from
//     PhysicsCalcs.UpdatePhysicsParameters. It is NOT gated on any FAR window
//     being open, so it is current every physics tick whether or not the
//     operator has FAR's own display up. That is what makes a plain read of it
//     legitimate rather than a poll of something only a repaint refreshes
//   - VesselFlightInfo is a plain struct of public double fields. Reading it
//     boxes once per capture and every field read is a field read on the box
//   - FARVesselAero.HasValidVoxelizationCurrently() is the voxelisation
//     qualifier. Its body is three field tests and a negation: no logging, no
//     native call, no allocation
//
// TWO METHODS ARE INVOKED, and both were read before being called, per the rule
// in docs/creating-an-uplink.md ("a field read is safe, a call is safe only once
// you have read its body"):
//
//   AirspeedSettingsGUI.CalculateIAS()
//     -> FARAeroUtil.RayleighPitotTubeStagPressure(mach), pure arithmetic over
//        FARAeroUtil.CurrentAdiabaticIndex
//     -> FARAtmosphere.GetPressure(vessel), a DelegateDispatcher whose Invoke
//        catches every exception and falls back to the stock body pressure,
//        logging at info level. Nothing on the path is fatal
//   AirspeedSettingsGUI.CalculateEAS()
//     -> FARAeroUtil.GetCurrentDensity(vessel), a loop over the vessel's parts
//        reading stock per-part dynamic pressure. No FAR logging at all
//
// Neither reaches FARLogger.Error or any Fatal equivalent, and neither mutates
// anything. Both can still return a non-finite double, and AeroCapture is where
// that is dealt with rather than here.
//
// Fail-soft throughout: a member FAR has moved degrades to absence, never a
// throw. A capture that throws takes its owning Uplink inert from the next tick,
// so a FAR update must cost this Uplink its readings and nothing more.
using System;
using System.Collections;
using System.Reflection;

namespace GonogoFerramAerospaceResearchUplink
{
    /// <summary>
    /// Resolves FAR's per-vessel flight information and reads it into an
    /// <see cref="AeroRaw"/>.
    /// </summary>
    /// <remarks>
    /// Takes the vessel as <c>object</c> and reaches its module list by
    /// reflection, so this class references no KSP type either. That is not
    /// tidiness: it is what lets the whole walk, absence handling included, run
    /// headless against a stand-in object graph in this Uplink's tests, rather
    /// than being the one layer only a live game could exercise.
    /// </remarks>
    public sealed class AeroReflection
    {
        private const string FlightGuiTypeName = "FerramAerospaceResearch.FARGUI.FARFlightGUI.FlightGUI";
        private const string VesselAeroTypeName = "FerramAerospaceResearch.FARAeroComponents.FARVesselAero";

        private readonly Type? _flightGui;
        private readonly Type? _vesselAero;

        private readonly PropertyInfo? _infoParameters;
        private readonly PropertyInfo? _airSpeedGui;
        private readonly MethodInfo? _calculateIas;
        private readonly MethodInfo? _calculateEas;
        private readonly MethodInfo? _hasValidVoxelization;

        private readonly FieldInfo? _aoA;
        private readonly FieldInfo? _sideslipAngle;
        private readonly FieldInfo? _stallFraction;
        private readonly FieldInfo? _liftCoeff;
        private readonly FieldInfo? _dragCoeff;
        private readonly FieldInfo? _liftToDragRatio;
        private readonly FieldInfo? _refArea;
        private readonly FieldInfo? _liftForce;
        private readonly FieldInfo? _dragForce;
        private readonly FieldInfo? _dynPres;
        private readonly FieldInfo? _termVelEst;
        private readonly FieldInfo? _ballisticCoeff;
        private readonly FieldInfo? _specExcessPower;

        /// <summary>
        /// Whether this Uplink can read a FAR reading at all.
        /// </summary>
        /// <remarks>
        /// Deliberately a TYPE probe and not an assembly-name one. An assembly
        /// called <c>FerramAerospaceResearch</c> whose internals have moved
        /// answers true to a name probe and then misses every member, so the
        /// Uplink reports itself healthy while publishing nothing. The three
        /// members named here are the ones without which there is no reading:
        /// the vessel module that holds it, the property that exposes it, and one
        /// field off it that proves the struct's shape still matches.
        /// </remarks>
        public bool IsAvailable => _flightGui != null && _infoParameters != null && _aoA != null;

        /// <summary>Name and version of the assembly FlightGUI resolved from, for the health row.</summary>
        public string AssemblyIdentity
        {
            get
            {
                var name = _flightGui?.Assembly?.GetName();
                return name == null ? "not loaded" : name.Name + " " + name.Version;
            }
        }

        /// <summary>Whether the indicated/equivalent airspeed pair is reachable on this FAR build.</summary>
        public bool AirspeedAvailable => _calculateIas != null && _calculateEas != null;

        /// <summary>Whether the voxelisation qualifier is reachable on this FAR build.</summary>
        public bool VoxelizationAvailable => _hasValidVoxelization != null;

        public AeroReflection()
        {
            _flightGui = FindType(FlightGuiTypeName);
            _vesselAero = FindType(VesselAeroTypeName);

            _infoParameters = _flightGui?.GetProperty("InfoParameters", BindingFlags.Public | BindingFlags.Instance);
            _airSpeedGui = _flightGui?.GetProperty("airSpeedGUI", BindingFlags.Public | BindingFlags.Instance);

            var airspeedType = _airSpeedGui?.PropertyType;
            _calculateIas = airspeedType?.GetMethod("CalculateIAS", BindingFlags.Public | BindingFlags.Instance, null, Type.EmptyTypes, null);
            _calculateEas = airspeedType?.GetMethod("CalculateEAS", BindingFlags.Public | BindingFlags.Instance, null, Type.EmptyTypes, null);

            _hasValidVoxelization = _vesselAero?.GetMethod(
                "HasValidVoxelizationCurrently", BindingFlags.Public | BindingFlags.Instance, null, Type.EmptyTypes, null);

            var info = _infoParameters?.PropertyType;
            _aoA = Field(info, "aoA");
            _sideslipAngle = Field(info, "sideslipAngle");
            _stallFraction = Field(info, "stallFraction");
            _liftCoeff = Field(info, "liftCoeff");
            _dragCoeff = Field(info, "dragCoeff");
            _liftToDragRatio = Field(info, "liftToDragRatio");
            _refArea = Field(info, "refArea");
            _liftForce = Field(info, "liftForce");
            _dragForce = Field(info, "dragForce");
            _dynPres = Field(info, "dynPres");
            _termVelEst = Field(info, "termVelEst");
            _ballisticCoeff = Field(info, "ballisticCoeff");
            _specExcessPower = Field(info, "specExcessPower");
        }

        /// <summary>
        /// Reads the vessel's FAR flight information, or null when FAR holds none
        /// for it. Null is the honest answer for an unloaded craft, a craft in a
        /// scene FAR does not run in, and a craft whose FlightGUI has not woken
        /// yet: in every one of those there is no reading rather than a zero one.
        /// </summary>
        public AeroRaw? Read(object? vessel, double ut)
        {
            if (!IsAvailable || vessel == null)
            {
                return null;
            }

            var flightGui = FindVesselModule(vessel, _flightGui!);
            if (flightGui == null)
            {
                return null;
            }

            object? info;
            try
            {
                info = _infoParameters!.GetValue(flightGui);
            }
            catch (Exception)
            {
                return null;
            }
            if (info == null)
            {
                return null;
            }

            var raw = new AeroRaw
            {
                Ut = ut,
                AngleOfAttackDeg = ReadDouble(_aoA, info),
                SideslipDeg = ReadDouble(_sideslipAngle, info),
                StallFraction = ReadDouble(_stallFraction, info),
                LiftCoefficient = ReadDouble(_liftCoeff, info),
                DragCoefficient = ReadDouble(_dragCoeff, info),
                LiftToDragRatio = ReadDouble(_liftToDragRatio, info),
                ReferenceAreaSqM = ReadDouble(_refArea, info),
                LiftForceKn = ReadDouble(_liftForce, info),
                DragForceKn = ReadDouble(_dragForce, info),
                DynamicPressureKpa = ReadDouble(_dynPres, info),
                TerminalVelocity = ReadDouble(_termVelEst, info),
                BallisticCoefficient = ReadDouble(_ballisticCoeff, info),
                SpecificExcessPower = ReadDouble(_specExcessPower, info),
                IndicatedAirspeed = double.NaN,
                EquivalentAirspeed = double.NaN,
                AeroModelValid = ReadVoxelizationValid(vessel),
            };

            // The airspeed pair lives on a sibling object FAR only constructs once
            // the vessel's aero modules have been handed over, and nulls again on
            // teardown, so it is absent for real stretches of a normal flight and
            // is read separately from the struct above rather than beside it.
            var airspeed = ReadObject(_airSpeedGui, flightGui);
            if (airspeed != null)
            {
                raw.IndicatedAirspeed = Invoke(_calculateIas, airspeed);
                raw.EquivalentAirspeed = Invoke(_calculateEas, airspeed);
            }

            return raw;
        }

        /// <summary>
        /// Whether FAR's voxelisation of this vessel is current. False rather than
        /// absent when the module or the method is missing: this qualifies the
        /// readings beside it, and "we cannot confirm the model is current" and
        /// "the model is not current" call for the same caution from an operator.
        /// </summary>
        private bool ReadVoxelizationValid(object vessel)
        {
            if (_vesselAero == null || _hasValidVoxelization == null)
            {
                return false;
            }
            var aero = FindVesselModule(vessel, _vesselAero);
            if (aero == null)
            {
                return false;
            }
            try
            {
                return _hasValidVoxelization.Invoke(aero, null) is bool valid && valid;
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>
        /// The vessel's module of the given type, or null. Reaches
        /// <c>Vessel.vesselModules</c> by reflection so this class names no KSP
        /// type; the list is a plain <c>List&lt;VesselModule&gt;</c>, so walking it
        /// as an <see cref="IEnumerable"/> needs no knowledge of its element type.
        /// </summary>
        private static object? FindVesselModule(object vessel, Type moduleType)
        {
            try
            {
                var field = vessel.GetType().GetField("vesselModules", BindingFlags.Public | BindingFlags.Instance);
                if (field?.GetValue(vessel) is not IEnumerable modules)
                {
                    return null;
                }
                foreach (var module in modules)
                {
                    if (module != null && moduleType.IsInstanceOfType(module))
                    {
                        return module;
                    }
                }
            }
            catch (Exception)
            {
                // A moved member degrades to absence, never a throw.
            }
            return null;
        }

        private static FieldInfo? Field(Type? owner, string name) =>
            owner?.GetField(name, BindingFlags.Public | BindingFlags.Instance);

        /// <summary>
        /// A struct field as a double, or NaN. NaN rather than a nullable because
        /// FAR's own arithmetic already produces NaN for the same reason (a
        /// quantity that is not defined), so one absence path covers both and
        /// <c>AeroCapture</c> has one rule to apply rather than two.
        /// </summary>
        private static double ReadDouble(FieldInfo? field, object owner)
        {
            if (field == null)
            {
                return double.NaN;
            }
            try
            {
                return field.GetValue(owner) switch
                {
                    double d => d,
                    float f => f,
                    _ => double.NaN,
                };
            }
            catch (Exception)
            {
                return double.NaN;
            }
        }

        private static object? ReadObject(PropertyInfo? property, object owner)
        {
            if (property == null)
            {
                return null;
            }
            try
            {
                return property.GetValue(owner);
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static double Invoke(MethodInfo? method, object target)
        {
            if (method == null)
            {
                return double.NaN;
            }
            try
            {
                return method.Invoke(target, null) switch
                {
                    double d => d,
                    float f => f,
                    _ => double.NaN,
                };
            }
            catch (Exception)
            {
                return double.NaN;
            }
        }

        /// <summary>
        /// Resolves a type by full name across the loaded assemblies. FAR splits
        /// itself across FerramAerospaceResearch.dll and its .Base sibling, and a
        /// future split would move a type without renaming it, so this asks every
        /// assembly rather than picking one by name and hoping.
        /// </summary>
        private static Type? FindType(string fullName)
        {
            foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
            {
                try
                {
                    var type = assembly.GetType(fullName);
                    if (type != null)
                    {
                        return type;
                    }
                }
                catch (Exception)
                {
                    // An assembly that cannot be queried is skipped, not fatal.
                }
            }
            return null;
        }
    }
}
