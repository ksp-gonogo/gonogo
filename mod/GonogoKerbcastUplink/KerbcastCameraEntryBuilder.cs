using System.Collections.Generic;

namespace Gonogo.KerbcastUplink
{
    /// <summary>
    /// Builds the <c>kerbcast.cameras</c> wire shape — one
    /// <see cref="Sitrep.Contract.KerbcastCameraEntry"/>-shaped dictionary per
    /// camera.
    ///
    /// <para>Hand-built (rather than serialising the contract POCO) to match how
    /// every other uplink sources its channels: the contract type is the TYPING
    /// mirror, and <c>JsonWriter</c> walks this value tree to make the actual
    /// bytes. Keys are camelCase to match <c>RtConfig.CamelCaseForProperties</c>,
    /// so this dictionary and the generated TS interface agree field for field.</para>
    ///
    /// <para>KSP-free by construction, so it is exercised headless — see
    /// <c>GonogoKerbcastUplink.Tests</c>. That matters more than it looks: the
    /// clean-name mapping below (<c>fieldOfView</c> not kerbcast's <c>fov</c>,
    /// <c>panYawMinimum</c> not <c>panYawMin</c>) is exactly the kind of thing
    /// that silently drifts from the contract, and a test pins it.</para>
    /// </summary>
    public static class KerbcastCameraEntryBuilder
    {
        /// <summary>
        /// Maps one kerbcast camera view plus this uplink's derived docking
        /// facts onto the wire shape. Every value stays nullable — an
        /// unreadable member travels as absent, never as a 0 a consumer would
        /// misread as a real measurement.
        /// </summary>
        public static Dictionary<string, object?> Build(
            KerbcastView view, DockingCameraFacts docking, string? vesselId) =>
            new Dictionary<string, object?>
            {
                ["cameraId"] = view.FlightId,
                ["partId"] = view.PartFlightId,
                ["cameraName"] = view.CameraName,
                ["partName"] = view.PartName,
                ["partTitle"] = view.PartTitle,
                ["vesselId"] = vesselId,
                ["supportsZoom"] = view.SupportsZoom,
                ["supportsPan"] = view.SupportsPan,
                ["fieldOfView"] = view.Fov,
                ["fieldOfViewMinimum"] = view.FovMin,
                ["fieldOfViewMaximum"] = view.FovMax,
                ["panYaw"] = view.PanYaw,
                ["panPitch"] = view.PanPitch,
                ["panYawMinimum"] = view.PanYawMin,
                ["panYawMaximum"] = view.PanYawMax,
                ["panPitchMinimum"] = view.PanPitchMin,
                ["panPitchMaximum"] = view.PanPitchMax,
                ["isDockingCamera"] = docking.IsDockingCamera,
                ["dockingPortNodeType"] = docking.NodeType,
                ["dockingPortState"] = docking.State,
            };
    }
}
