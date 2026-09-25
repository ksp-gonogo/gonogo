using System;
using System.IO;
using System.Linq;
using System.Reflection;
using Xunit;

namespace GonogoKerbalismUplink.Tests
{
    /// <summary>
    /// The plugin's own source files, for the tests that assert over source text
    /// because the code they check reaches a live <c>Vessel</c> and cannot load
    /// here. The directory comes from the build, so a missing file fails the test
    /// rather than reading as a clean scan.
    /// </summary>
    internal static class UplinkSource
    {
        internal static string PathOf(string fileName)
        {
            var dir = typeof(UplinkSource).Assembly
                .GetCustomAttributes<AssemblyMetadataAttribute>()
                .SingleOrDefault(a => a.Key == "UplinkSourceDir")?.Value;
            Assert.False(string.IsNullOrEmpty(dir), "the build stamped no UplinkSourceDir");
            var path = Path.Combine(dir!, fileName);
            Assert.True(File.Exists(path), fileName + " not found at " + path);
            return path;
        }

        internal static string Read(string fileName) => File.ReadAllText(PathOf(fileName));
    }
}
