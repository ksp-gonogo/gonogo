using System.Collections.Generic;

namespace GonogoScansatUplink.Tests.Fakes.Good
{
    public enum SCANtype : short
    {
        AltimetryLoRes = 1,
        ResourceHiRes = 256,
    }

    public static class SCANUtil
    {
        public static double GetCoverage(int type, object body) => 0;
        public static bool isCovered(double lon, double lat, object body, int type) => false;
    }

    public class SCANcontroller
    {
        public static SCANcontroller? controller;
        public static object? getData(string name) => null;
        public List<object> Known_Vessels => new();
    }

    public class SCANdata
    {
        public short[,]? Coverage => null;
        public object[]? Anomalies => null;
    }
}

// Mirrors the REAL SCANsat 21.1 public surface (verified by decompiling the
// shipped SCANsat.dll): SCANUtil.isCovered and SCANcontroller.getData each have
// TWO overloads. The pre-fix guard called Type.GetMethod(name) on these, which
// throws AmbiguousMatchException on multiple overloads — the exact drift that
// flipped the uplink Unavailable against 21.1. This fake reproduces the overload
// shape so the guard is proven overload-safe against the real API.
namespace GonogoScansatUplink.Tests.Fakes.Overloaded
{
    public enum SCANtype : short
    {
        AltimetryLoRes = 1,
        ResourceHiRes = 256,
    }

    public static class SCANUtil
    {
        public static double GetCoverage(int type, object body) => 0;
        // Two isCovered overloads, exactly like SCANsat 21.1.
        public static bool isCovered(double lon, double lat, object body, int type) => false;
        public static bool isCovered(int lon, int lat, object body, int type) => false;
    }

    public class SCANcontroller
    {
        public static SCANcontroller? controller;
        // Two getData overloads, exactly like SCANsat 21.1.
        public object? getData(string name) => null;
        public object? getData(int index) => null;
        public List<object> Known_Vessels => new();
    }

    public class SCANdata
    {
        public short[,]? Coverage => null;
        public object[]? Anomalies => null;
    }
}

namespace GonogoScansatUplink.Tests.Fakes.MissingMember
{
    public enum SCANtype : short
    {
        AltimetryLoRes = 1,
        ResourceHiRes = 256,
    }

    public static class SCANUtil
    {
        // isCovered intentionally missing.
        public static double GetCoverage(int type, object body) => 0;
    }

    public class SCANcontroller
    {
        public static SCANcontroller? controller;
        public static object? getData(string name) => null;
        public List<object> Known_Vessels => new();
    }

    public class SCANdata
    {
        public short[,]? Coverage => null;
        public object[]? Anomalies => null;
    }
}

namespace GonogoScansatUplink.Tests.Fakes.RenumberedEnum
{
    public enum SCANtype : short
    {
        AltimetryLoRes = 2, // drifted - should have been 1
        ResourceHiRes = 256,
    }

    public static class SCANUtil
    {
        public static double GetCoverage(int type, object body) => 0;
        public static bool isCovered(double lon, double lat, object body, int type) => false;
    }

    public class SCANcontroller
    {
        public static SCANcontroller? controller;
        public static object? getData(string name) => null;
        public List<object> Known_Vessels => new();
    }

    public class SCANdata
    {
        public short[,]? Coverage => null;
        public object[]? Anomalies => null;
    }
}
