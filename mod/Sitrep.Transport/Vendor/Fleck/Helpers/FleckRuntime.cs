#nullable disable
using System;
using System.Runtime.InteropServices;

namespace Sitrep.Vendor.Fleck.Helpers
{
    internal static class FleckRuntime
    {
        public static bool IsRunningOnMono()
        {
            return Type.GetType("Mono.Runtime") != null;
        }

        public static bool IsRunningOnWindows()
        {
#if NET45 || NET40
            return true;
#else
            return (RuntimeInformation.IsOSPlatform(OSPlatform.Windows));
#endif
        }
    }
}