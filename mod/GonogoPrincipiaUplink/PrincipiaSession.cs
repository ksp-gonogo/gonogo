using System;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Thrown when a read was attempted outside the frame that licensed it, or
    /// through a gate that was never licensed at all.
    ///
    /// <para>It is thrown INSTEAD of making the call, which is the point: the
    /// alternative to this exception is not a wrong number, it is the player's
    /// running KSP disappearing. An Uplink's sampled source is already wrapped in
    /// the host's fail-soft, so the cost of being loud here is one skipped sample
    /// and a log line.</para>
    /// </summary>
    public sealed class PrincipiaProtocolException : InvalidOperationException
    {
        public PrincipiaProtocolException(string message)
            : base(message)
        {
        }
    }

    /// <summary>
    /// The bound, version-gated connection to Principia's plugin, and the only
    /// thing that can open a frame.
    ///
    /// <para><b>Why this exists as a type rather than as a rule in a comment.</b>
    /// The protocol that keeps these calls from aborting KSP is four preconditions
    /// deep and every step of it is invisible at the call site: a plan read on a
    /// vessel that was recovered one tick ago looks exactly like a plan read on a
    /// vessel that is still there. Written as documentation it would be followed
    /// until the first hurried change and then not, and the symptom would be a
    /// player's game vanishing rather than a test going red. So the preconditions
    /// are types. <see cref="TryBeginFrame"/> is the only source of a
    /// <see cref="PrincipiaFrame"/>, a frame is the only source of a
    /// <see cref="PrincipiaVesselGate"/> and it hands one out only when
    /// <c>HasVessel</c> has just said yes, a vessel is the only source of a
    /// <see cref="PrincipiaFlightPlanGate"/> and likewise, and the burn reads exist
    /// only on tokens the plan's own cursor yields from bounds it read this
    /// frame. Forgetting a precondition is not a mistake you can make; there is no
    /// expression for it.</para>
    ///
    /// <para><b>Generation is what stops a token outliving its frame.</b> Every
    /// gate carries the generation it was minted in, and every read compares that
    /// against the session's current one before touching the plugin. Opening a
    /// frame bumps it and so does closing one, so a gate stashed in a field is
    /// dead the moment its frame ends. This is the case the protocol is really
    /// about: the guid was valid, the burn index was in range, and then the player
    /// deleted the burn or recovered the craft between two of our ticks.</para>
    ///
    /// <para><b>The handle is re-read on every single access</b>, not once per
    /// frame, and compared against the one the frame opened on. Principia replaces
    /// it on deserialise and on a plugin reset, and a replaced handle mid-frame
    /// means everything the frame proved is about a plugin that no longer
    /// exists.</para>
    /// </summary>
    public sealed partial class PrincipiaSession
    {
        /// <summary>
        /// The exact build the per-call abort analysis was carried out against,
        /// as Principia's own <c>GetVersion</c> reports it.
        ///
        /// <para>This is the native library's git description, which pins the
        /// COMMIT: the trailing sha is the revision whose C++ bodies were read to
        /// decide which calls in <see cref="PrincipiaCalls.Allowed"/> are safe. It
        /// is not the managed assembly's file version (<c>2026.08.12.215</c>,
        /// carried separately by <see cref="PrincipiaVersionGuard"/>), and gating
        /// on that string instead is a mistake that fails CLOSED and therefore
        /// looks like caution while being a permanent outage. The two are checked
        /// against the shipped binaries rather than inferred from each other.</para>
        /// </summary>
        public const string AnalysedPluginVersion =
            "2026081218-Levi-Civita-0-gc6615048e8fc76722b081bb3f1f4536afcf66870";

        private readonly IPrincipiaPlugin _plugin;
        private readonly IPrincipiaPluginHandle _handle;

        private int _generation;
        private bool _frameOpen;
        private IntPtr _frameHandle;

        private PrincipiaSession(
            IPrincipiaPlugin plugin,
            IPrincipiaPluginHandle handle,
            PrincipiaWriteAuthority writes)
        {
            _plugin = plugin;
            _handle = handle;
            Writes = writes;
        }

        /// <summary>The build string this session bound against, for the roster's detail line.</summary>
        public string Version { get; private set; } = string.Empty;

        /// <summary>
        /// Whether this session may CHANGE a flight plan, which is a narrower
        /// permission than reading one and is decided on its own terms.
        ///
        /// <para>Always present, frequently closed. A session binds whenever the
        /// reads are safe; the write surface then answers separately, so a build
        /// this Uplink can read and must not write fails to read-only rather than
        /// failing to nothing.</para>
        /// </summary>
        public PrincipiaWriteAuthority Writes { get; }

        /// <summary>
        /// Version-gates once and returns a session, or fails closed with a reason
        /// that names what was actually found.
        ///
        /// <para>Anything other than the analysed build publishes nothing. The
        /// refusal is total rather than partial because the thing that varies
        /// between builds is which calls abort, and a surface that is safe in one
        /// release and fatal in the next gives no signal in between.</para>
        ///
        /// <para>The failure reason carries all three of Principia's version
        /// out-params, not just the one compared. A gate keyed to the wrong field
        /// would refuse every build forever and report it as ordinary caution, and
        /// the only thing that would ever say otherwise is the first live run
        /// being able to show what the fields held.</para>
        /// </summary>
        internal static bool TryBind(
            IPrincipiaPlugin plugin,
            IPrincipiaPluginHandle handle,
            out PrincipiaSession? session,
            out string reason)
        {
            session = null;

            string? buildDate;
            string? version;
            string? platform;
            try
            {
                if (!plugin.GetVersion(out buildDate, out version, out platform))
                {
                    reason = "Principia's version could not be read";
                    return false;
                }
            }
            catch (Exception ex)
            {
                reason = "Principia's version could not be read: " + ex.Message;
                return false;
            }

            if (!string.Equals(version, AnalysedPluginVersion, StringComparison.Ordinal))
            {
                reason =
                    "Principia build not analysed for call safety. Expected version '"
                    + AnalysedPluginVersion + "'; found version '" + (version ?? "<null>")
                    + "', build date '" + (buildDate ?? "<null>") + "', platform '"
                    + (platform ?? "<null>") + "'. Publishing nothing: on this surface an "
                    + "unanalysed build is not a degraded reading, it is a call that may abort "
                    + "the game.";
                return false;
            }

            // The write surface's own gate, evaluated here and never again: it
            // compares the SAME build string against its OWN constant, and asks the
            // port whether the write entry points bound. Both answers are recorded
            // rather than acted on, because a closed write surface is not a reason to
            // stop reading.
            var writesBound = plugin.WritesBound(out var writeReason);
            var writes = new PrincipiaWriteAuthority(version!, writesBound, writeReason);

            session = new PrincipiaSession(plugin, handle, writes) { Version = version! };
            reason = string.Empty;
            return true;
        }

        /// <summary>
        /// Opens the one frame every read of this tick must happen inside, or
        /// answers false when there is no plugin to read.
        ///
        /// <para><b>Everything between this call and the frame's disposal runs on
        /// the main thread with no yield, no await and no thread hop.</b> The gates
        /// a frame hands out are statements about the plugin's state at the instant
        /// they were minted, and the only thing that keeps them true is that
        /// nothing else got to run in between. A frame carried across a yield is
        /// not a weaker guarantee, it is none at all.</para>
        ///
        /// <para>A frame left undisposed does not leave a hole: the next
        /// <see cref="TryBeginFrame"/> bumps the generation too, so the previous
        /// frame's gates die at the frame boundary either way. Disposal is what
        /// makes them die at the end of the CALLBACK rather than at the start of
        /// the next one.</para>
        /// </summary>
        public bool TryBeginFrame(out PrincipiaFrame? frame)
        {
            frame = null;
            var handle = _handle.Current();
            if (handle == IntPtr.Zero)
            {
                return false;
            }

            unchecked
            {
                _generation++;
            }
            _frameOpen = true;
            _frameHandle = handle;
            frame = new PrincipiaFrame(this, _generation);
            return true;
        }

        internal IPrincipiaPlugin Plugin => _plugin;

        internal int Generation => _generation;

        /// <summary>
        /// Validates a gate and returns the handle to make the call with, or
        /// throws rather than letting the call happen.
        ///
        /// <para>Three things are checked, and the order matters only in what the
        /// message says. The gate must have been minted (a <c>default</c> struct
        /// has no session and is not a licence); it must belong to the frame that
        /// is open now; and the plugin handle must still be the one the frame
        /// opened on.</para>
        /// </summary>
        internal IntPtr Enter(int generation, string what)
        {
            if (!_frameOpen)
            {
                throw new PrincipiaProtocolException(
                    "Refusing to read " + what + ": no frame is open. Every Principia read "
                    + "happens inside one main-thread frame, because the preconditions that keep "
                    + "these calls from aborting the game are only true for the frame they were "
                    + "evaluated in.");
            }

            if (generation != _generation)
            {
                throw new PrincipiaProtocolException(
                    "Refusing to read " + what + ": this gate was minted in an earlier frame. "
                    + "Whatever it proved is no longer proved. The vessel may have been recovered, "
                    + "the flight plan deleted, or the burn removed between the two frames, and "
                    + "each of those is a process abort rather than an error return.");
            }

            var handle = _handle.Current();
            if (handle == IntPtr.Zero)
            {
                throw new PrincipiaProtocolException(
                    "Refusing to read " + what + ": the plugin handle is now null. The plugin was "
                    + "reset or torn down partway through this frame.");
            }

            if (handle != _frameHandle)
            {
                throw new PrincipiaProtocolException(
                    "Refusing to read " + what + ": the plugin handle was replaced partway through "
                    + "this frame. Principia swaps it on deserialise and on a plugin reset, so the "
                    + "handle this frame opened on is now a dangling pointer and everything the "
                    + "frame established is about a plugin that no longer exists.");
            }

            return handle;
        }

        /// <summary>Ends the open frame and kills every gate it handed out.</summary>
        internal void EndFrame(int generation)
        {
            if (generation != _generation)
            {
                return;
            }
            unchecked
            {
                _generation++;
            }
            _frameOpen = false;
            _frameHandle = IntPtr.Zero;
        }
    }
}
