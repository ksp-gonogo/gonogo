using System;
using System.Diagnostics;
using System.IO;

namespace GonogoPrincipiaUplink
{
    /// <summary>One request/reply line channel to a worker.</summary>
    public interface IPrincipiaWorkerChannel : IDisposable
    {
        /// <summary>Send one request and return its reply line, or null if the
        /// worker said nothing.</summary>
        string? Exchange(string request);
    }

    /// <summary>
    /// Runs Principia's own code beside the game, in a process that shares none of
    /// its state.
    ///
    /// <para><b>Why a separate process and not a second in-game instance.</b>
    /// Principia holds process-global state: a journal recorder, logging flags, and
    /// a reopened stderr. A second instance inside KSP would share all of it with
    /// the one the player is flying, and the failure would look like the game
    /// misbehaving rather than like us.</para>
    ///
    /// <para><b>Why this is known to work rather than hoped.</b> KSP runs inside a
    /// pressure-vessel mount namespace, and it already has a child process started
    /// by another mod from its own GameData folder. That child shares KSP's mount
    /// namespace exactly, so a worker sees the same filesystem, finds GameData at
    /// the same path, and can open the very build the game loaded. The container has
    /// python3 with ctypes and has neither mono nor dotnet, which is why the worker
    /// is a script rather than an assembly.</para>
    ///
    /// <para>The channel is injected. Spawning is one line of production code and an
    /// impossible thing to unit test; everything ABOVE it is where a mistake would
    /// be silent, so that half is testable without a process.</para>
    /// </summary>
    public static class PrincipiaWorkerProcess
    {
        /// <summary>
        /// Ask the worker for the CPU feature flags Principia's own loader
        /// dispatches on.
        ///
        /// <para>This is the first thing worth asking, and not a warm-up. The
        /// build's selection turns on the FMA bit, so anything deciding whether a
        /// worker reproduces the game's arithmetic needs that bit as the GAME HOST
        /// reports it. Read anywhere else it answers a different question in the
        /// shape of the right one, which is why it is asked HERE, in a process on
        /// the game's own machine, rather than wherever the asking code happens to
        /// be running.</para>
        ///
        /// <para>It is also the safest call on the whole surface: two out
        /// parameters, a CPUID read, no plugin, no save, no global state. A
        /// handshake that cannot damage anything even if the build is not what we
        /// think it is.</para>
        /// </summary>
        public static PrincipiaHostFacts AskCpuidFeatureFlags(
            IPrincipiaWorkerChannel? channel, string? libraryPath, string osFamily)
        {
            if (channel == null || string.IsNullOrEmpty(libraryPath))
            {
                return new PrincipiaHostFacts(osFamily, null);
            }

            string? reply;
            try
            {
                reply = channel.Exchange(
                    "{\"kind\":\"cpuidFeatureFlags\",\"libraryPath\":"
                        + Quote(libraryPath!) + "}");
            }
            catch (Exception)
            {
                // A worker that died is not a CPU without FMA. Unknown is the only
                // honest answer, and it is the one that makes the decision above
                // refuse rather than proceed on a guess.
                return new PrincipiaHostFacts(osFamily, null);
            }

            var hasFma = BoolField(reply, "hasFma");
            var ok = BoolField(reply, "ok");
            return ok == true && hasFma != null
                ? new PrincipiaHostFacts(osFamily, hasFma)
                : new PrincipiaHostFacts(osFamily, null);
        }

        /// <summary>
        /// Read one boolean out of the worker's reply.
        ///
        /// <para>Hand-parsed rather than deserialized because this Uplink may
        /// reference only the contract, and pulling in a JSON library to read two
        /// booleans would be a dependency taken for a handshake. Returns null for
        /// anything it cannot read, which the caller treats as unknown rather than
        /// as false: those are different facts and the second is a claim.</para>
        /// </summary>
        internal static bool? BoolField(string? json, string field)
        {
            if (string.IsNullOrEmpty(json))
            {
                return null;
            }
            var key = "\"" + field + "\"";
            var at = json!.IndexOf(key, StringComparison.Ordinal);
            if (at < 0)
            {
                return null;
            }
            var colon = json.IndexOf(':', at + key.Length);
            if (colon < 0)
            {
                return null;
            }
            var rest = json.Substring(colon + 1).TrimStart();
            if (rest.StartsWith("true", StringComparison.Ordinal))
            {
                return true;
            }
            return rest.StartsWith("false", StringComparison.Ordinal) ? (bool?)false : null;
        }

        private static string Quote(string value) =>
            "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";

        /// <summary>
        /// A channel to a freshly started worker, or null when one cannot be
        /// started.
        ///
        /// <para>Null rather than an exception: a machine without python, or a
        /// GameData without the worker script, is a reason to do without the
        /// fidelity tier rather than a reason for the Uplink to fail.</para>
        /// </summary>
        public static IPrincipiaWorkerChannel? Spawn(string interpreter, string scriptPath)
        {
            if (!File.Exists(scriptPath))
            {
                return null;
            }
            try
            {
                var process = new Process
                {
                    StartInfo = new ProcessStartInfo(interpreter, Quote(scriptPath))
                    {
                        RedirectStandardInput = true,
                        RedirectStandardOutput = true,
                        UseShellExecute = false,
                        CreateNoWindow = true,
                    },
                };
                return process.Start() ? new ProcessChannel(process) : null;
            }
            catch (Exception)
            {
                return null;
            }
        }

        private sealed class ProcessChannel : IPrincipiaWorkerChannel
        {
            private readonly Process _process;

            public ProcessChannel(Process process) => _process = process;

            public string? Exchange(string request)
            {
                _process.StandardInput.WriteLine(request);
                _process.StandardInput.Flush();
                return _process.StandardOutput.ReadLine();
            }

            public void Dispose()
            {
                try
                {
                    // Closing the input ends the worker's read loop, which is how it
                    // is asked to stop. Killing it first would leave the reply of an
                    // in-flight request half-written down the pipe.
                    _process.StandardInput.Close();
                    if (!_process.WaitForExit(2000))
                    {
                        _process.Kill();
                    }
                }
                catch (Exception)
                {
                    // Disposing must not throw: this runs on the game's own thread.
                }
                finally
                {
                    _process.Dispose();
                }
            }
        }
    }
}
