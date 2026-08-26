using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using UnityEngine;

namespace Gonogo.DevTools
{
    /// <summary>
    /// DEV-ONLY test tooling. Polls a request file
    /// (<c>PluginData/currency-request.cfg</c>, next to this assembly) and, on a
    /// new request, awards funds / science / reputation under a caller-chosen
    /// <c>TransactionReasons</c>, optionally attributed to a named vessel so the
    /// award travels the currency-delay subsystem's AWAY path instead of landing
    /// at KSC. It then samples every balance on a timer and writes the whole
    /// series into the result cfg, so a single request measures whether a credit
    /// lands immediately, at reveal, or twice.
    ///
    /// <para><b>Why this exists.</b> Earning currency in a real career needs a
    /// craft with an instrument and a transmitter, in the right situation, with
    /// a comm link. That makes the delay model expensive to exercise and, in
    /// practice, untested. This awards the same currency through the same stock
    /// entry points the game uses, so the delay subsystem, RP-1's currency
    /// handlers, and anything else on those events all see an ordinary award.</para>
    ///
    /// <para><b>Attribution.</b> <c>Gonogo.KSP.CurrencyDelay.StockCurrencyInterceptor</c>
    /// only delays a change whose <c>TransactionReasons</c> is
    /// ScienceTransmission, VesselRecovery or VesselLoss AND for which a vessel
    /// was resolved from a separate KSP event. Of the three vessel-bearing
    /// events, only <c>OnTriggeredDataTransmission</c> (the stock-lab
    /// transmission path) is a pure notification: firing it names a vessel and
    /// nothing else. The other two, <c>onVesselRecoveryProcessing</c> and
    /// <c>onVesselWillDestroy</c>, are lifecycle events that other mods act on
    /// destructively, so this tool does not fire them. That leaves
    /// <c>attribute = lab</c> as the one origin mode, and science as the one
    /// currency that can be attributed to a place - see the report in
    /// <c>local_docs/inbox/</c> for what that means for funds and reputation.</para>
    ///
    /// <para>Request format (mirrors <see cref="GonogoDevTeleport"/>'s TELEPORT node):
    /// <code>
    /// CURRENCY
    /// {
    ///     id = 2026-08-26-sci-away-1   // unique per request; a repeat is ignored
    ///     currency = Science           // Funds | Science | Reputation
    ///     amount = 25                  // signed; a penalty is negative
    ///     reason = ScienceTransmission // any TransactionReasons member name
    ///     attribute = lab              // none | lab (lab is science-only)
    ///     origin = active              // active | ksc | vessel name | vessel GUID
    ///     watchSeconds = 600           // 0 (default) writes one before/after pair
    ///     watchIntervalSeconds = 5
    /// }
    /// </code>
    /// The reason is what decides whether the award delays at all: the
    /// interceptor's away set is ScienceTransmission, VesselRecovery and
    /// VesselLoss, and everything else reveals instantly. The result cfg carries
    /// one SAMPLE node per reading, labelled <c>before</c>, <c>after</c>, then
    /// <c>watch</c>, each with funds / science / reputation and, when RP-1 is
    /// loaded, confidence and confidenceEarned.</para>
    ///
    /// <para><b>Every sample also reports what the delay subsystem itself did</b>,
    /// read off the live <c>CurrencyDelayScenario</c> by reflection: whether the
    /// subsystem is in the loaded Gonogo assembly at all, whether the interceptor
    /// subscribed, how many rows the pending-credit ledger holds, and the
    /// interceptor's shadow science. Balances alone cannot tell a delay that did
    /// not engage from a delay that engaged and revealed instantly, and both look
    /// like "the science landed at once" - the first run of this tool produced
    /// exactly that ambiguity. A neutralised award shows shadowScience below the
    /// live balance and a non-zero pendingRows; an award the interceptor classed
    /// HOME shows shadowScience tracking the live balance and pendingRows at
    /// zero.</para>
    ///
    /// <para><b>Not production behaviour.</b> Lives in the Deck-only
    /// GonogoDevTools assembly and is never shipped. With no request file (the
    /// production default), this addon does nothing at all.</para>
    ///
    /// <c>once: false</c> re-instantiates this every time the flight scene
    /// loads. <see cref="_lastAppliedId"/> is <b>static</b> so a request is
    /// applied once per KSP process even across scene reloads.
    /// </summary>
    [KSPAddon(KSPAddon.Startup.Flight, once: false)]
    public sealed class GonogoDevCurrency : MonoBehaviour
    {
        private const string LogPrefix = "[GonogoDevCurrency] ";

        /// <summary>Process-wide last-applied request id. Requests whose id
        /// matches this are ignored, so writing the same file twice (or a scene
        /// reload re-reading it) never re-awards.</summary>
        private static string? _lastAppliedId;

        private const float PollIntervalSeconds = 1f;
        private const double DefaultWatchSeconds = 0.0;
        private const double DefaultWatchIntervalSeconds = 5.0;

        /// <summary>An hour of samples is long enough for any light-time inside
        /// the Kerbol/Sol system and for the unroutable case's silence
        /// declaration to be visibly pending, and short enough that the result
        /// file stays readable.</summary>
        private const double MaxWatchSeconds = 3600.0;

        private float _sinceLastPoll;

        private string? _requestPath;
        private string? _resultPath;

        /// <summary>The request currently being watched, held so every sample
        /// rewrites one coherent result file rather than appending to a stale
        /// header.</summary>
        private WatchState? _watch;

        private sealed class WatchState
        {
            public string Id = "";
            public string Summary = "";
            public bool Ok;
            public double StartRealtime;
            public double EndRealtime;
            public double IntervalSeconds;
            public double NextSampleRealtime;
            public readonly List<Sample> Samples = new List<Sample>();
        }

        private readonly struct Sample
        {
            public Sample(string label, double sinceAwardSeconds, double ut, Balances balances, DelaySubsystem delay)
            {
                Label = label;
                SinceAwardSeconds = sinceAwardSeconds;
                Ut = ut;
                Balances = balances;
                Delay = delay;
            }

            public string Label { get; }
            public double SinceAwardSeconds { get; }
            public double Ut { get; }
            public Balances Balances { get; }
            public DelaySubsystem Delay { get; }
        }

        /// <summary>
        /// What the currency-delay subsystem itself is doing, read off the live
        /// <c>CurrencyDelayScenario</c>. <see cref="Fault"/> names the first thing
        /// that could not be read rather than leaving a zero to be misread as a
        /// measurement.
        /// </summary>
        private readonly struct DelaySubsystem
        {
            public DelaySubsystem(bool present, bool scenarioLive, bool subscribed, int pendingRows, double shadowScience, string firstPending, string fault)
            {
                Present = present;
                ScenarioLive = scenarioLive;
                Subscribed = subscribed;
                PendingRows = pendingRows;
                ShadowScience = shadowScience;
                FirstPending = firstPending ?? "";
                Fault = fault ?? "";
            }

            public bool Present { get; }
            public bool ScenarioLive { get; }
            public bool Subscribed { get; }
            public int PendingRows { get; }
            public double ShadowScience { get; }
            public string FirstPending { get; }
            public string Fault { get; }

            public static DelaySubsystem Absent(string fault) =>
                new DelaySubsystem(false, false, false, 0, 0.0, "", fault);
        }

        /// <summary>Every balance the delay model can move, plus RP-1's two
        /// confidence readings, which are the ones the double-credit question
        /// turns on. <see cref="HasConfidence"/> is false on a career with no
        /// RP-1 loaded rather than reporting a fabricated zero.</summary>
        private readonly struct Balances
        {
            public Balances(double funds, double science, double reputation, bool hasConfidence, double confidence, double confidenceEarned)
            {
                Funds = funds;
                Science = science;
                Reputation = reputation;
                HasConfidence = hasConfidence;
                Confidence = confidence;
                ConfidenceEarned = confidenceEarned;
            }

            public double Funds { get; }
            public double Science { get; }
            public double Reputation { get; }
            public bool HasConfidence { get; }
            public double Confidence { get; }
            public double ConfidenceEarned { get; }
        }

        private void Start()
        {
            try
            {
                var assemblyDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                if (string.IsNullOrEmpty(assemblyDir))
                {
                    enabled = false;
                    return;
                }

                var pluginData = Path.Combine(assemblyDir, "PluginData");
                _requestPath = Path.Combine(pluginData, "currency-request.cfg");
                _resultPath = Path.Combine(pluginData, "currency-result.cfg");
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "Start failed: " + ex.Message);
                enabled = false;
            }
        }

        private void Update()
        {
            try
            {
                PollWatch();
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "sampling failed: " + ex.Message);
                _watch = null;
            }

            // Modest cadence - NOT every frame, matching the other dev addons.
            _sinceLastPoll += Time.unscaledDeltaTime;
            if (_sinceLastPoll < PollIntervalSeconds)
            {
                return;
            }
            _sinceLastPoll = 0f;

            try
            {
                Poll();
            }
            catch (Exception ex)
            {
                // Never throw out of the poll.
                Debug.LogError(LogPrefix + "poll failed: " + ex.Message);
            }
        }

        private void PollWatch()
        {
            var watch = _watch;
            if (watch == null)
            {
                return;
            }

            var now = Time.realtimeSinceStartup;
            if (now < watch.NextSampleRealtime)
            {
                return;
            }

            watch.NextSampleRealtime = now + (float)watch.IntervalSeconds;
            watch.Samples.Add(new Sample("watch", RoundSeconds(now - watch.StartRealtime), CurrentUt(), ReadBalances(), ReadDelaySubsystem()));
            WriteResult(watch);

            if (now >= watch.EndRealtime)
            {
                Debug.Log(LogPrefix + "watch complete for id=" + watch.Id + " (" + watch.Samples.Count + " samples)");
                _watch = null;
            }
        }

        private void Poll()
        {
            if (string.IsNullOrEmpty(_requestPath) || !File.Exists(_requestPath))
            {
                // No request file is the PRODUCTION-SAFE default.
                return;
            }

            var root = ConfigNode.Load(_requestPath);
            var node = root?.GetNode("CURRENCY");
            if (node == null)
            {
                return;
            }

            var id = node.GetValue("id");
            if (string.IsNullOrEmpty(id))
            {
                Debug.LogError(LogPrefix + "request has no 'id'; ignoring");
                return;
            }

            // Already applied this exact request - nothing to do.
            if (string.Equals(id, _lastAppliedId, StringComparison.Ordinal))
            {
                return;
            }

            ApplyRequest(id!, node);
        }

        private void ApplyRequest(string id, ConfigNode node)
        {
            // Claim the id up-front: a request that throws must not be retried
            // every second, and a currency award is not something to retry.
            _lastAppliedId = id;

            var watch = new WatchState { Id = id };
            _watch = null;

            try
            {
                var currencyRaw = node.GetValue("currency");
                if (!TryParseCurrency(currencyRaw, out var currency))
                {
                    Finish(watch, ok: false, "unrecognised 'currency' " + Describe(currencyRaw) + " (want Funds|Science|Reputation)");
                    return;
                }

                if (!TryGetDouble(node, "amount", out var amount) || amount == 0.0)
                {
                    Finish(watch, ok: false, "missing/zero 'amount'");
                    return;
                }

                var reasonRaw = node.GetValue("reason");
                if (!TryParseReason(reasonRaw, out var reason))
                {
                    Finish(watch, ok: false, "unrecognised 'reason' " + Describe(reasonRaw) + " (want a TransactionReasons member name, e.g. ScienceTransmission)");
                    return;
                }

                var attribute = (node.GetValue("attribute") ?? "none").Trim().ToLowerInvariant();
                if (attribute != "none" && attribute != "lab")
                {
                    Finish(watch, ok: false, "unrecognised 'attribute' '" + attribute + "' (want none|lab)");
                    return;
                }

                Vessel? origin = null;
                var originRaw = node.GetValue("origin");
                if (attribute == "lab")
                {
                    if (currency != Currency.Science)
                    {
                        Finish(watch, ok: false, "attribute=lab attributes a science transmission and cannot carry " + currency
                            + "; the interceptor's lab correlation is science-only");
                        return;
                    }

                    origin = ResolveVessel(originRaw);
                    if (origin == null)
                    {
                        Finish(watch, ok: false, "attribute=lab needs a resolvable 'origin' vessel; " + Describe(originRaw) + " matched nothing");
                        return;
                    }
                }

                var watchSeconds = TryGetDouble(node, "watchSeconds", out var ws)
                    ? Math.Max(0.0, Math.Min(MaxWatchSeconds, ws))
                    : DefaultWatchSeconds;
                var watchInterval = TryGetDouble(node, "watchIntervalSeconds", out var wi) && wi > 0.0
                    ? wi
                    : DefaultWatchIntervalSeconds;

                var before = ReadBalances();
                watch.Samples.Add(new Sample("before", 0.0, CurrentUt(), before, ReadDelaySubsystem()));

                if (origin != null)
                {
                    NameLabTransmissionOrigin(origin);
                }

                Award(currency, amount, reason);

                var after = ReadBalances();
                watch.Samples.Add(new Sample("after", 0.0, CurrentUt(), after, ReadDelaySubsystem()));

                var summary = string.Format(CultureInfo.InvariantCulture,
                    "awarded {0:+0.###;-0.###} {1} reason={2} attribute={3} origin={4}",
                    amount, currency, reason, attribute,
                    origin != null ? origin.vesselName + " [" + origin.id + "]" : "(none)");
                Debug.Log(LogPrefix + "request id=" + id + ": " + summary);

                watch.Summary = summary;
                watch.Ok = true;

                if (watchSeconds <= 0.0)
                {
                    WriteResult(watch);
                    return;
                }

                watch.StartRealtime = Time.realtimeSinceStartup;
                watch.EndRealtime = watch.StartRealtime + watchSeconds;
                watch.IntervalSeconds = watchInterval;
                watch.NextSampleRealtime = watch.StartRealtime + watchInterval;
                WriteResult(watch);
                _watch = watch;
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "request id=" + id + " failed: " + ex);
                Finish(watch, ok: false, "exception: " + ex.Message);
            }
        }

        private void Finish(WatchState watch, bool ok, string message)
        {
            watch.Ok = ok;
            watch.Summary = message;
            if (!ok)
            {
                Debug.LogError(LogPrefix + "id=" + watch.Id + ": " + message);
            }
            WriteResult(watch);
        }

        /// <summary>
        /// Fires <c>OnTriggeredDataTransmission</c> with a <c>sciencelab@</c>
        /// subject, which is the signature the currency-delay interceptor keys
        /// its lab-vessel correlation on. The event exists purely to name the
        /// vessel the science came from; the value actually credited is the
        /// separate AddScience call that follows.
        ///
        /// <para><b>The zero <c>dataAmount</c> is load-bearing.</b> Every other
        /// subscriber to this event in the installed GameData is stock
        /// (decompile-checked: CelestialBodyScience, Contracts.Parameters'
        /// CollectScience, FinePrint's CometScienceParameter,
        /// ModuleOrbitalSurveyor - no third-party assembly references it at
        /// all), and the first two bail on <c>dataAmount &lt;= 0f</c> before
        /// completing anything, while the surveyor additionally requires a
        /// <c>survey@</c> subject in its own part's container and the comet
        /// parameter matches its subject id exactly. A zero-data transmission
        /// with a marker subject therefore reaches the interceptor and nothing
        /// else.</para>
        /// </summary>
        private static void NameLabTransmissionOrigin(Vessel origin)
        {
            var data = new ScienceData(
                amount: 0f,
                xmitValue: 1f,
                xmitBonus: 0f,
                id: "sciencelab@GonogoDevCurrencyProbe",
                dataName: "Gonogo dev currency award");

            GameEvents.OnTriggeredDataTransmission.Fire(data, origin, false);
        }

        private static void Award(Currency currency, double amount, TransactionReasons reason)
        {
            switch (currency)
            {
                case Currency.Funds:
                    if (Funding.Instance == null)
                    {
                        throw new InvalidOperationException("no Funding instance (not a career game?)");
                    }
                    Funding.Instance.AddFunds(amount, reason);
                    break;
                case Currency.Science:
                    if (ResearchAndDevelopment.Instance == null)
                    {
                        throw new InvalidOperationException("no ResearchAndDevelopment instance (not a career/science game?)");
                    }
                    ResearchAndDevelopment.Instance.AddScience((float)amount, reason);
                    break;
                default:
                    if (Reputation.Instance == null)
                    {
                        throw new InvalidOperationException("no Reputation instance (not a career game?)");
                    }
                    Reputation.Instance.AddReputation((float)amount, reason);
                    break;
            }
        }

        /// <summary>
        /// Matches <c>origin</c> against every vessel KSP knows about, by id
        /// first (a GUID is unambiguous) then by name. <c>active</c> names the
        /// active vessel; an empty or <c>ksc</c> value means no origin at all.
        /// Unloaded vessels are included: the interceptor resolves light-time
        /// from a live <c>Vessel</c> object, which an unloaded craft still has.
        /// </summary>
        private static Vessel? ResolveVessel(string? origin)
        {
            var wanted = (origin ?? "").Trim();
            if (wanted.Length == 0 || string.Equals(wanted, "ksc", StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }
            if (string.Equals(wanted, "active", StringComparison.OrdinalIgnoreCase))
            {
                return FlightGlobals.ActiveVessel;
            }

            var vessels = FlightGlobals.Vessels;
            if (vessels == null)
            {
                return null;
            }

            foreach (var v in vessels)
            {
                if (v != null && string.Equals(v.id.ToString(), wanted, StringComparison.OrdinalIgnoreCase))
                {
                    return v;
                }
            }
            foreach (var v in vessels)
            {
                if (v != null && string.Equals(v.vesselName, wanted, StringComparison.OrdinalIgnoreCase))
                {
                    return v;
                }
            }
            return null;
        }

        private static Balances ReadBalances()
        {
            var funds = Funding.Instance != null ? Funding.Instance.Funds : 0.0;
            var science = ResearchAndDevelopment.Instance != null ? ResearchAndDevelopment.Instance.Science : 0.0;
            var reputation = Reputation.Instance != null ? Reputation.Instance.reputation : 0.0;
            var (hasConfidence, confidence, earned) = ReadRp1Confidence();
            return new Balances(funds, science, reputation, hasConfidence, confidence, earned);
        }

        /// <summary>
        /// Reads RP-1's <c>Confidence.CurrentConfidence</c> and
        /// <c>AllConfidenceEarned</c> by reflection. GonogoDevTools references
        /// only KSP/Unity, so RP0.dll cannot be a compile-time dependency, and
        /// on a career without RP-1 the type simply is not there.
        /// </summary>
        private static (bool has, double confidence, double earned) ReadRp1Confidence()
        {
            try
            {
                var type = ResolveType("RP0.Confidence");
                if (type == null)
                {
                    return (false, 0.0, 0.0);
                }

                var confidence = type.GetProperty("CurrentConfidence", BindingFlags.Public | BindingFlags.Static);
                var earned = type.GetProperty("AllConfidenceEarned", BindingFlags.Public | BindingFlags.Static);
                if (confidence == null || earned == null)
                {
                    return (false, 0.0, 0.0);
                }

                return (true,
                    Convert.ToDouble(confidence.GetValue(null, null), CultureInfo.InvariantCulture),
                    Convert.ToDouble(earned.GetValue(null, null), CultureInfo.InvariantCulture));
            }
            catch (Exception ex)
            {
                Debug.LogWarning(LogPrefix + "could not read RP-1 confidence: " + ex.Message);
                return (false, 0.0, 0.0);
            }
        }

        /// <summary>
        /// Reads the live <c>CurrencyDelayScenario</c>'s own state by reflection:
        /// the interceptor's subscription flag and shadow science, and the
        /// pending-credit ledger's depth. GonogoDevTools references only
        /// KSP/Unity, so Gonogo.dll cannot be a compile-time dependency, and on a
        /// build without the subsystem the type simply is not there.
        ///
        /// <para>Field names are private implementation detail of the production
        /// assembly, so each miss is reported in <c>Fault</c> rather than
        /// degrading to a zero. A renamed field must read as "could not measure",
        /// never as "measured nothing pending".</para>
        /// </summary>
        private static DelaySubsystem ReadDelaySubsystem()
        {
            try
            {
                var scenarioType = ResolveType("Gonogo.KSP.CurrencyDelay.CurrencyDelayScenario");
                if (scenarioType == null)
                {
                    return DelaySubsystem.Absent("CurrencyDelayScenario not in any loaded assembly");
                }

                var scenario = UnityEngine.Object.FindObjectOfType(scenarioType);
                if (scenario == null)
                {
                    return new DelaySubsystem(true, false, false, 0, 0.0, "", "scenario type present but no live instance");
                }

                const BindingFlags Instance = BindingFlags.NonPublic | BindingFlags.Instance;

                var subscribed = false;
                var shadowScience = 0.0;
                var fault = "";

                var interceptor = scenarioType.GetField("_interceptor", Instance)?.GetValue(scenario);
                if (interceptor == null)
                {
                    fault = "could not read _interceptor";
                }
                else
                {
                    var interceptorType = interceptor.GetType();
                    var subscribedField = interceptorType.GetField("_subscribed", Instance);
                    if (subscribedField == null)
                    {
                        fault = "could not read _subscribed";
                    }
                    else
                    {
                        subscribed = (bool)subscribedField.GetValue(interceptor);
                    }

                    var state = interceptorType.GetField("_state", Instance)?.GetValue(interceptor);
                    var shadow = state?.GetType().GetProperty("ShadowScience", BindingFlags.Public | BindingFlags.Instance);
                    if (shadow == null)
                    {
                        fault = Append(fault, "could not read ShadowScience");
                    }
                    else
                    {
                        shadowScience = Convert.ToDouble(shadow.GetValue(state, null), CultureInfo.InvariantCulture);
                    }
                }

                var pendingRows = -1;
                var firstPending = "";
                var ledger = scenarioType.GetField("_ledger", Instance)?.GetValue(scenario);
                var pending = ledger?.GetType().GetProperty("Pending", BindingFlags.Public | BindingFlags.Instance)?.GetValue(ledger, null);
                if (pending is System.Collections.IEnumerable rows)
                {
                    pendingRows = 0;
                    foreach (var row in rows)
                    {
                        pendingRows++;
                        if (firstPending.Length == 0)
                        {
                            firstPending = DescribePendingRow(row);
                        }
                    }
                }
                else
                {
                    fault = Append(fault, "could not read the pending ledger");
                }

                return new DelaySubsystem(true, true, subscribed, pendingRows, shadowScience, firstPending, fault);
            }
            catch (Exception ex)
            {
                return DelaySubsystem.Absent("probe threw: " + ex.Message);
            }
        }

        private static string DescribePendingRow(object row)
        {
            try
            {
                var type = row.GetType();
                var currency = type.GetProperty("Currency")?.GetValue(row, null);
                var amount = type.GetProperty("BaseAmount")?.GetValue(row, null);
                var revealUt = type.GetProperty("RevealUt")?.GetValue(row, null);
                var origin = type.GetProperty("OriginVesselId")?.GetValue(row, null);
                return string.Format(CultureInfo.InvariantCulture,
                    "{0} {1} revealUt={2} origin={3}", currency, amount, revealUt, origin);
            }
            catch (Exception ex)
            {
                return "unreadable row: " + ex.Message;
            }
        }

        private static string Append(string existing, string addition) =>
            existing.Length == 0 ? addition : existing + "; " + addition;

        private static Type? ResolveType(string fullName)
        {
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                Type? found;
                try
                {
                    found = asm.GetType(fullName, throwOnError: false);
                }
                catch (Exception)
                {
                    // A reflection-only or partially-loaded assembly is not
                    // grounds for giving up on the rest of the list.
                    continue;
                }
                if (found != null)
                {
                    return found;
                }
            }
            return null;
        }

        private static double CurrentUt()
        {
            try
            {
                return Planetarium.GetUniversalTime();
            }
            catch (Exception)
            {
                return 0.0;
            }
        }

        private static bool TryParseCurrency(string? raw, out Currency currency)
        {
            currency = Currency.Funds;
            var wanted = (raw ?? "").Trim();
            if (wanted.Length == 0)
            {
                return false;
            }
            return Enum.TryParse(wanted, ignoreCase: true, result: out currency);
        }

        private static bool TryParseReason(string? raw, out TransactionReasons reason)
        {
            reason = TransactionReasons.None;
            var wanted = (raw ?? "").Trim();
            if (wanted.Length == 0)
            {
                return false;
            }
            return Enum.TryParse(wanted, ignoreCase: true, result: out reason);
        }

        private static string Describe(string? raw) =>
            string.IsNullOrEmpty(raw) ? "(absent)" : "'" + raw + "'";

        private static double RoundSeconds(double seconds) => Math.Round(seconds, 1);

        private static bool TryGetDouble(ConfigNode node, string key, out double value)
        {
            value = 0.0;
            var raw = node.GetValue(key);
            return !string.IsNullOrEmpty(raw)
                && double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out value);
        }

        private void WriteResult(WatchState watch)
        {
            if (string.IsNullOrEmpty(_resultPath))
            {
                return;
            }

            try
            {
                var dir = Path.GetDirectoryName(_resultPath);
                if (!string.IsNullOrEmpty(dir))
                {
                    Directory.CreateDirectory(dir!);
                }

                var sb = new StringBuilder();
                sb.AppendLine("RESULT");
                sb.AppendLine("{");
                sb.AppendLine("\tapplied = " + watch.Id);
                sb.AppendLine("\tok = " + (watch.Ok ? "True" : "False"));
                sb.AppendLine("\tmessage = " + watch.Summary);
                sb.AppendLine("\ttime = " + DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture));
                foreach (var sample in watch.Samples)
                {
                    AppendSample(sb, sample);
                }
                sb.AppendLine("}");
                File.WriteAllText(_resultPath, sb.ToString());
            }
            catch (Exception ex)
            {
                Debug.LogError(LogPrefix + "failed writing result: " + ex.Message);
            }
        }

        private static void AppendSample(StringBuilder sb, Sample sample)
        {
            var b = sample.Balances;
            sb.AppendLine("\tSAMPLE");
            sb.AppendLine("\t{");
            sb.AppendLine("\t\tat = " + sample.Label);
            sb.AppendLine("\t\tsinceAwardSeconds = " + sample.SinceAwardSeconds.ToString("F1", CultureInfo.InvariantCulture));
            sb.AppendLine("\t\tut = " + sample.Ut.ToString("F3", CultureInfo.InvariantCulture));
            sb.AppendLine("\t\tfunds = " + b.Funds.ToString("F3", CultureInfo.InvariantCulture));
            sb.AppendLine("\t\tscience = " + b.Science.ToString("F3", CultureInfo.InvariantCulture));
            sb.AppendLine("\t\treputation = " + b.Reputation.ToString("F3", CultureInfo.InvariantCulture));
            if (b.HasConfidence)
            {
                sb.AppendLine("\t\tconfidence = " + b.Confidence.ToString("F3", CultureInfo.InvariantCulture));
                sb.AppendLine("\t\tconfidenceEarned = " + b.ConfidenceEarned.ToString("F3", CultureInfo.InvariantCulture));
            }
            else
            {
                sb.AppendLine("\t\tconfidence = (RP-1 not loaded)");
            }
            AppendDelaySubsystem(sb, sample.Delay);
            sb.AppendLine("\t}");
        }

        private static void AppendDelaySubsystem(StringBuilder sb, DelaySubsystem delay)
        {
            sb.AppendLine("\t\tDELAY");
            sb.AppendLine("\t\t{");
            sb.AppendLine("\t\t\tsubsystemPresent = " + (delay.Present ? "True" : "False"));
            sb.AppendLine("\t\t\tscenarioLive = " + (delay.ScenarioLive ? "True" : "False"));
            sb.AppendLine("\t\t\tinterceptorSubscribed = " + (delay.Subscribed ? "True" : "False"));
            // -1 means the ledger could not be read; a plain 0 would read as
            // "measured, nothing pending", which is the opposite conclusion.
            sb.AppendLine("\t\t\tpendingRows = " + (delay.PendingRows < 0 ? "(unreadable)" : delay.PendingRows.ToString(CultureInfo.InvariantCulture)));
            sb.AppendLine("\t\t\tshadowScience = " + delay.ShadowScience.ToString("F3", CultureInfo.InvariantCulture));
            if (delay.FirstPending.Length > 0)
            {
                sb.AppendLine("\t\t\tfirstPending = " + delay.FirstPending);
            }
            if (delay.Fault.Length > 0)
            {
                sb.AppendLine("\t\t\tfault = " + delay.Fault);
            }
            sb.AppendLine("\t\t}");
        }
    }
}
