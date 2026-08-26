using System.Collections.Generic;

// A stand-in for the FAR object graph, declared in FAR's own namespaces with
// FAR's own type and member names, so the production reflection walk resolves it
// exactly as it resolves the real thing: same AppDomain type lookup by full
// name, same property and field reads, same enumeration of the vessel's module
// list as a bare IEnumerable.
//
// Every name, accessibility and shape below was taken from an ilspycmd 11.0
// disassembly of the SHIPPED FerramAerospaceResearch.dll, FAR v0.16.1.2, so a
// rename on FAR's side makes these tests wrong in the same direction it makes
// production wrong, and a typo here fails as loudly as a typo there.
//
// What this CANNOT do is stated plainly rather than implied: it proves the walk
// reads the members it claims to and that absence is derived where FAR leaves a
// placeholder, and it proves nothing whatever about the VALUES a running FAR
// would hold.
namespace FerramAerospaceResearch.FARGUI.FARFlightGUI
{
    /// <summary>FAR's per-vessel flight information: a plain struct of public double fields.</summary>
    public struct VesselFlightInfo
    {
        public double liftForce;
        public double dragForce;
        public double sideForce;
        public double dynPres;
        public double liftCoeff;
        public double dragCoeff;
        public double sideCoeff;
        public double refArea;
        public double liftToDragRatio;
        public double velocityLiftToDragRatio;
        public double aoA;
        public double sideslipAngle;
        public double pitchAngle;
        public double headingAngle;
        public double rollAngle;
        public double dryMass;
        public double fullMass;
        public double tSFC;
        public double intakeAirFrac;
        public double specExcessPower;
        public double range;
        public double endurance;
        public double ballisticCoeff;
        public double termVelEst;
        public double stallFraction;
    }

    /// <summary>
    /// The airspeed helper FAR hangs off FlightGUI. Both methods are
    /// parameterless public doubles on the real one, which is the shape the
    /// production code resolves and invokes.
    /// </summary>
    public class AirspeedSettingsGUI
    {
        public double Ias;
        public double Eas;

        public double CalculateIAS() => Ias;

        public double CalculateEAS() => Eas;
    }

    /// <summary>
    /// FAR's per-vessel module. On the real one <c>InfoParameters</c> and
    /// <c>airSpeedGUI</c> are public properties with private setters, written
    /// from FixedUpdate; the private setter is why production reads them as
    /// properties rather than fields.
    /// </summary>
    public class FlightGUI
    {
        public VesselFlightInfo InfoParameters { get; set; }

        public AirspeedSettingsGUI? airSpeedGUI { get; set; }
    }
}

namespace FerramAerospaceResearch.FARAeroComponents
{
    /// <summary>FAR's aero vessel module, carrying the voxelisation qualifier.</summary>
    public class FARVesselAero
    {
        public bool Valid;

        public bool HasValidVoxelizationCurrently() => Valid;
    }
}

namespace GonogoFerramAerospaceResearchUplink.Tests
{
    /// <summary>
    /// A stand-in vessel: the production walk reaches the module list through the
    /// public <c>vesselModules</c> field KSP's own <c>Vessel</c> carries, and
    /// enumerates it without naming its element type, so a plain list of objects
    /// is resolved the same way the game's is.
    /// </summary>
    public sealed class FakeVessel
    {
        public List<object> vesselModules = new();
    }
}
