using System.Collections.Generic;

namespace GonogoAvionicsUplink
{
    /// <summary>
    /// Pure mapper: turns the reflected <see cref="AvionicsRaw"/> reading plus the
    /// vessel's stock total mass into the <c>avionics.status</c> dict. KSP-free +
    /// side-effect-free so it is unit-tested headless. The go/no-go mirrors
    /// <c>RP0.ControlLockerUtils.ShouldLock</c>: control is LOST only when the
    /// vessel mass strictly EXCEEDS the limit, so mass == limit is still GO.
    /// </summary>
    public static class AvionicsCapture
    {
        public static Dictionary<string, object?> Build(AvionicsRaw? raw, double vesselMassTons)
        {
            if (raw == null)
            {
                return new Dictionary<string, object?>
                {
                    ["avionicsActive"] = false,
                    ["controllableMassTons"] = null,
                    ["vesselMassTons"] = vesselMassTons,
                    ["controllable"] = false,
                };
            }
            return new Dictionary<string, object?>
            {
                ["avionicsActive"] = raw.AvionicsActive,
                ["controllableMassTons"] = raw.ControllableMassTons,
                ["vesselMassTons"] = vesselMassTons,
                ["controllable"] = vesselMassTons <= raw.ControllableMassTons,
            };
        }
    }
}
