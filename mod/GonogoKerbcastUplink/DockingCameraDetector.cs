using System;

namespace Gonogo.KerbcastUplink
{
    /// <summary>
    /// Answers "is this camera a DOCKING camera?" — the operator-facing
    /// question kerbcast itself cannot answer.
    ///
    /// <para><b>Why this lives here and not in kerbcast.</b> kerbcast has no
    /// docking concept anywhere on its wire: not in <c>CameraInfo</c>, not in
    /// <c>CameraState</c>, not in its data-channel protocol. Its only nod to
    /// docking is a Hullcam *visual filter mode* called "DockingCam", which is
    /// a reticle overlay, not a fact about the craft. So today the ONLY way a
    /// client can guess is to sniff <c>partTitle</c> for the word "Docking" or
    /// match <c>cameraName == "NavCam"</c> — which is exactly what kerbcast's
    /// own client-side labeller resorts to.</para>
    ///
    /// <para>That sniffing is wrong in both directions: it false-POSITIVES on
    /// any part someone named "Docking Bay Floodlight", and it false-NEGATIVES
    /// on every modded docking port that doesn't happen to have "Docking" in
    /// its title. It also can't tell a mated port from a free one.</para>
    ///
    /// <para><b>The Uplink can do better for free.</b> kerbcast's control facade
    /// already hands out the owning stock KSP <c>Part</c> on every camera view.
    /// A <c>Part</c> is stock KSP — gonogo references <c>Assembly-CSharp</c>
    /// freely, no licence entanglement — so this uplink simply reads the part's
    /// own <c>ModuleDockingNode</c> and answers from the craft's actual module
    /// list. Ground truth, not a string guess, and it needs ZERO changes to
    /// kerbcast.</para>
    ///
    /// <para><b>The definition, stated precisely:</b> a docking camera is a
    /// camera whose OWN part carries a <c>ModuleDockingNode</c>. A camera
    /// merely mounted *near* a port is NOT reported as a docking camera —
    /// proximity would be a heuristic with a made-up radius, and this contract
    /// does not fabricate confidence it doesn't have. In practice the stock
    /// docking-port cameras (Hullcam's docking-port patch) all satisfy the
    /// strict definition, because the camera module is added to the port part
    /// itself.</para>
    /// </summary>
    public static class DockingCameraDetector
    {
        /// <summary>
        /// Reads the docking facts off a camera's part handle. The handle is
        /// passed as <c>object</c> (it arrives from reflection as one) and is
        /// expected to be a stock KSP <see cref="Part"/>; anything else reads
        /// as "could not determine".
        ///
        /// <para>MAIN-THREAD ONLY: touches live KSP part modules.</para>
        /// </summary>
        public static DockingCameraFacts Detect(object? partHandle)
        {
            if (partHandle is not Part part)
            {
                // Typed absence: we never saw the part, so we do not know.
                return default;
            }

            try
            {
                var modules = part.Modules;
                if (modules == null)
                {
                    return default;
                }

                for (int i = 0; i < modules.Count; i++)
                {
                    if (modules[i] is not ModuleDockingNode node)
                    {
                        continue;
                    }
                    return new DockingCameraFacts
                    {
                        IsDockingCamera = true,
                        NodeType = Blank(node.nodeType) ? null : node.nodeType,
                        State = Blank(node.state) ? null : node.state,
                    };
                }

                // Read the part's modules successfully and found no docking
                // node — a definite "no", not an "unknown".
                return new DockingCameraFacts { IsDockingCamera = false };
            }
            catch (Exception)
            {
                return default;
            }
        }

        // R7: an empty string is not a real nodeType/state — report absence.
        private static bool Blank(string? value) => string.IsNullOrEmpty(value);
    }
}
