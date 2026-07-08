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
