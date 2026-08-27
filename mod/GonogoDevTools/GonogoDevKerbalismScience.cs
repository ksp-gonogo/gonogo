using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text;
using UnityEngine;

namespace Gonogo.DevTools
{
    /// <summary>
    /// DEV-ONLY test tooling. Drives Kerbalism's own science-crediting choke point,
    /// <c>KERBALISM.SubjectData.RetrieveScience</c>, and reports what the currency-delay
    /// subsystem did with the resulting increment.
    ///
    /// <para><b>Why this exists rather than <see cref="GonogoDevCurrency"/>.</b> That tool
    /// awards through <c>ResearchAndDevelopment.AddScience</c>, which fires
    /// <c>OnCurrencyModifierQuery</c>, <c>OnCurrencyModified</c> and <c>OnScienceChanged</c>
    /// and no <c>OnScienceRecieved</c> (decompile-confirmed against the installed
    /// Assembly-CSharp). On an install carrying Kerbalism plus GonogoKerbalismUplink that is
    /// not the path science takes: the Uplink sets
    /// <c>KERBALISM.API.preventScienceCrediting = true</c>, which stops
    /// <c>ScienceDB.CreditScienceBuffers</c> ever calling <c>AddScience</c> at all, leaving
    /// the Harmony postfix on <c>RetrieveScience</c> as the only thing that can credit
    /// science. An award through <c>AddScience</c> therefore measures a path that
    /// structurally cannot delay.</para>
    ///
    /// <para><b>What the installed Kerbalism.dll actually does</b> (decompiled from
    /// <c>GameData/Kerbalism/Kerbalism.dll</c>, not from upstream source):
    /// <c>SubjectData.RetrieveScience(double scienceValue, bool showMessage = false,
    /// ProtoVessel fromVessel = null, File file = null)</c> returns
    /// <c>min(ScienceRemainingToRetrieve, scienceValue)</c> plus whatever its included
    /// subjects return, adds that to <c>ScienceDB.uncreditedScience</c> ONLY when
    /// <c>preventScienceCrediting</c> is false, and advances <c>RnDSubject.science</c>
    /// either way. Its two real callers are the transmission loop
    /// (<c>RetrieveScience(num5, showMessage: true, v.protoVessel, xmitFile.file)</c>) and
    /// recovery (<c>RetrieveScience(num, showMessage: false, pv, data.File)</c>), so the
    /// call this tool makes is the transmission call with the drive file left out.</para>
    ///
    /// <para><b>It has a real, small career cost.</b> A retrieve advances that subject's
    /// <c>RnDSubject.science</c> and <c>PercentRetrieved</c> exactly as a genuine
    /// transmission would, and creates the stock <c>ScienceSubject</c> if it did not exist.
    /// Use <c>mode = probe</c> (the default) to read the whole instrumented state without
    /// touching anything, and <c>mode = subjects</c> to see what is available to retrieve.</para>
    ///
    /// <para>Request format:
    /// <code>
    /// KERBALISM_SCIENCE
    /// {
    ///     id = 2026-08-27-ksm-1     // unique per request; a repeat is ignored
    ///     mode = retrieve           // probe | subjects | retrieve
    ///     subject = crewReport@KerbinInSpaceHigh   // stock subject id
    ///     experiment = crewReport   // alternative to 'subject', with 'situation'
    ///     situation = InSpaceHigh   // KERBALISM.ScienceSituation member name
    ///     body = Kerbin             // body name or flightGlobalsIndex; default: origin's body
    ///     biome = -1                // biome index; -1 is biome-agnostic
    ///     amount = 5                // science value to retrieve
    ///     origin = active           // active | vessel name | vessel GUID
    ///     watchSeconds = 900
    ///     watchIntervalSeconds = 10
    /// }
    /// </code></para>
    ///
    /// <para><b>Every sample reports four independent views</b>, because a single view cannot
    /// distinguish "the delay did not engage" from "the reading is of the wrong object".
    /// KERBALISM says whether the crediting path is the one this tool assumes; DELAY
    /// enumerates EVERY live <c>CurrencyDelayScenario</c> (not just the first one
    /// <c>FindObjectOfType</c> happens to return) with each one's own shadow, ledger identity
    /// and depth; SINK says which of those instances the static
    /// <c>DelayedScienceSink</c> binding actually points at; BUS reads the subscriber list
    /// off <c>GameEvents.OnScienceChanged</c> and names the objects on it. A frozen shadow
    /// beside a bus carrying an interceptor the DELAY block never listed is a blind
    /// instrument, not a broken feature, and the two want opposite fixes.</para>
    ///
    /// <para><b>Not production behaviour.</b> Lives in the Deck-only GonogoDevTools assembly
    /// and is never shipped. With no request file (the production default), this addon does
    /// nothing at all.</para>
    /// </summary>
    [KSPAddon(KSPAddon.Startup.Flight, once: false)]
    public sealed class GonogoDevKerbalismScience : MonoBehaviour
    {
        private const string LogPrefix = "[GonogoDevKerbalismScience] ";

        /// <summary>Process-wide last-applied request id, so writing the same file twice (or a
        /// scene reload re-reading it) never re-retrieves.</summary>
        private static string? _lastAppliedId;

        private const float PollIntervalSeconds = 1f;
        private const double DefaultWatchSeconds = 0.0;
        private const double DefaultWatchIntervalSeconds = 5.0;
        private const double MaxWatchSeconds = 3600.0;

        private const string ScienceDbTypeName = "KERBALISM.ScienceDB";
        private const string SubjectDataTypeName = "KERBALISM.SubjectData";
        private const string ApiTypeName = "KERBALISM.API";
        private const string SituationTypeName = "KERBALISM.Situation";
        private const string ScienceSituationTypeName = "KERBALISM.ScienceSituation";
        private const string RetrieveScienceMethodName = "RetrieveScience";

        private float _sinceLastPoll;
        private string? _requestPath;
        private string? _resultPath;
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
            public readonly List<string> Notes = new List<string>();
            public readonly List<Sample> Samples = new List<Sample>();
        }

        private readonly struct Sample
        {
            public Sample(string label, double sinceRetrieveSeconds, double ut,
                double funds, double science, double reputation,
                KerbalismView kerbalism, DelayView delay, BusView bus)
            {
                Label = label;
                SinceRetrieveSeconds = sinceRetrieveSeconds;
                Ut = ut;
                Funds = funds;
                Science = science;
                Reputation = reputation;
                Kerbalism = kerbalism;
                Delay = delay;
                Bus = bus;
            }

            public string Label { get; }
            public double SinceRetrieveSeconds { get; }
            public double Ut { get; }
            public double Funds { get; }
            public double Science { get; }
            public double Reputation { get; }
            public KerbalismView Kerbalism { get; }
            public DelayView Delay { get; }
            public BusView Bus { get; }
        }

        /// <summary>
        /// Whether the crediting path this tool drives is the one actually in force.
        /// <c>PreventScienceCrediting</c> false means Kerbalism still credits its own buffer
        /// through <c>AddScience</c> and our postfix is not the sole crediting route, which
        /// changes what a science movement means.
        /// </summary>
        private readonly struct KerbalismView
        {
            public KerbalismView(bool loaded, bool haveFlag, bool preventCrediting,
                double uncreditedScience, string hookPatch, string fault)
            {
                Loaded = loaded;
                HaveFlag = haveFlag;
                PreventCrediting = preventCrediting;
                UncreditedScience = uncreditedScience;
                HookPatch = hookPatch ?? "";
                Fault = fault ?? "";
            }

            public bool Loaded { get; }
            public bool HaveFlag { get; }
            public bool PreventCrediting { get; }
            public double UncreditedScience { get; }
            public string HookPatch { get; }
            public string Fault { get; }

            public static KerbalismView Absent(string fault) =>
                new KerbalismView(false, false, false, 0.0, "", fault);
        }

        /// <summary>One live <c>CurrencyDelayScenario</c>. Several may exist; the whole point
        /// of carrying them as a list is that a reading taken from the wrong one is
        /// indistinguishable from a feature that never engaged.</summary>
        private readonly struct ScenarioView
        {
            public ScenarioView(int scenarioHash, int interceptorHash, bool subscribed,
                double shadowScience, int ledgerHash, int ledgerRows, string firstPending,
                int aggregatorHash, string aggregatorWindows, string fault)
            {
                ScenarioHash = scenarioHash;
                InterceptorHash = interceptorHash;
                Subscribed = subscribed;
                ShadowScience = shadowScience;
                LedgerHash = ledgerHash;
                LedgerRows = ledgerRows;
                FirstPending = firstPending ?? "";
                AggregatorHash = aggregatorHash;
                AggregatorWindows = aggregatorWindows ?? "";
                Fault = fault ?? "";
            }

            public int ScenarioHash { get; }
            public int InterceptorHash { get; }
            public bool Subscribed { get; }
            public double ShadowScience { get; }
            public int LedgerHash { get; }
            public int LedgerRows { get; }
            public string FirstPending { get; }
            public int AggregatorHash { get; }
            public string AggregatorWindows { get; }
            public string Fault { get; }
        }

        /// <summary>The currency-delay subsystem across every instance of it, plus which one
        /// the static sink binding points at.</summary>
        private readonly struct DelayView
        {
            public DelayView(bool present, IReadOnlyList<ScenarioView> scenarios,
                bool sinkBound, int sinkAggregatorHash, int sinkLedgerHash, string fault)
            {
                Present = present;
                Scenarios = scenarios ?? Array.Empty<ScenarioView>();
                SinkBound = sinkBound;
                SinkAggregatorHash = sinkAggregatorHash;
                SinkLedgerHash = sinkLedgerHash;
                Fault = fault ?? "";
            }

            public bool Present { get; }
            public IReadOnlyList<ScenarioView> Scenarios { get; }
            public bool SinkBound { get; }
            public int SinkAggregatorHash { get; }
            public int SinkLedgerHash { get; }
            public string Fault { get; }

            public static DelayView Absent(string fault) =>
                new DelayView(false, Array.Empty<ScenarioView>(), false, 0, 0, fault);
        }

        /// <summary>Who is actually subscribed to <c>GameEvents.OnScienceChanged</c>, read off
        /// the event's own subscriber list rather than inferred from any object we found by
        /// another route.</summary>
        private readonly struct BusView
        {
            public BusView(int subscriberCount, IReadOnlyList<string> interceptors, string fault)
            {
                SubscriberCount = subscriberCount;
                Interceptors = interceptors ?? Array.Empty<string>();
                Fault = fault ?? "";
            }

            public int SubscriberCount { get; }

            /// <summary>One entry per StockCurrencyInterceptor on the bus, as
            /// "hash=N" so it can be compared against each scenario's own interceptor hash.</summary>
            public IReadOnlyList<string> Interceptors { get; }

            public string Fault { get; }
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
                _requestPath = Path.Combine(pluginData, "kerbalism-science-request.cfg");
                _resultPath = Path.Combine(pluginData, "kerbalism-science-result.cfg");
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
            watch.Samples.Add(TakeSample("watch", RoundSeconds(now - watch.StartRealtime)));
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
            var node = root?.GetNode("KERBALISM_SCIENCE");
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

            if (string.Equals(id, _lastAppliedId, StringComparison.Ordinal))
            {
                return;
            }

            ApplyRequest(id!, node);
        }

        private void ApplyRequest(string id, ConfigNode node)
        {
            // Claim the id up-front: a request that throws must not be retried every second,
            // and a retrieve advances real career subject progress.
            _lastAppliedId = id;

            var watch = new WatchState { Id = id };
            _watch = null;

            try
            {
                var mode = (node.GetValue("mode") ?? "probe").Trim().ToLowerInvariant();
                if (mode != "probe" && mode != "subjects" && mode != "retrieve")
                {
                    Finish(watch, ok: false, "unrecognised 'mode' '" + mode + "' (want probe|subjects|retrieve)");
                    return;
                }

                var watchSeconds = TryGetDouble(node, "watchSeconds", out var ws)
                    ? Math.Max(0.0, Math.Min(MaxWatchSeconds, ws))
                    : DefaultWatchSeconds;
                var watchInterval = TryGetDouble(node, "watchIntervalSeconds", out var wi) && wi > 0.0
                    ? wi
                    : DefaultWatchIntervalSeconds;

                watch.Samples.Add(TakeSample("before", 0.0));

                if (mode == "subjects")
                {
                    ListSubjects(watch);
                    Finish(watch, ok: true, "listed available experiments and persisted subjects");
                    return;
                }

                if (mode == "probe")
                {
                    watch.Ok = true;
                    watch.Summary = "probe only, nothing retrieved";
                }
                else if (!TryRetrieve(watch, node))
                {
                    return;
                }

                watch.Samples.Add(TakeSample("after", 0.0));
                Debug.Log(LogPrefix + "request id=" + id + ": " + watch.Summary);

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

        /// <summary>
        /// Resolves the SubjectData and origin vessel, then calls Kerbalism's own
        /// <c>RetrieveScience</c> on it with the transmission call's argument shape. Returns
        /// false (and finishes the watch) when anything could not be resolved, so a failure
        /// names what was missing rather than reading as a delay that did not fire.
        /// </summary>
        private bool TryRetrieve(WatchState watch, ConfigNode node)
        {
            if (!TryGetDouble(node, "amount", out var amount) || amount <= 0.0)
            {
                Finish(watch, ok: false, "missing/non-positive 'amount'");
                return false;
            }

            var origin = ResolveVessel(node.GetValue("origin"));
            if (origin == null)
            {
                Finish(watch, ok: false, "'origin' must resolve to a LIVE vessel ("
                    + Describe(node.GetValue("origin")) + " matched nothing). DelayedScienceSink "
                    + "resolves light-time only against FlightGlobals, so an unloaded origin is unroutable");
                return false;
            }

            var subject = ResolveSubject(node, origin, out var subjectFault);
            if (subject == null)
            {
                Finish(watch, ok: false, "could not resolve a SubjectData: " + subjectFault);
                return false;
            }

            var subjectType = subject.GetType();
            var remainingBefore = ReadDouble(subject, subjectType, "ScienceRemainingToRetrieve");
            var maxValue = ReadDouble(subject, subjectType, "ScienceMaxValue");
            var retrievedBefore = ReadDouble(subject, subjectType, "ScienceRetrievedInKSC");
            var subjectId = ReadString(subject, subjectType, "Id");

            watch.Notes.Add("subjectId = " + subjectId);
            watch.Notes.Add("subjectType = " + subjectType.Name);
            watch.Notes.Add("scienceMaxValue = " + Fixed(maxValue));
            watch.Notes.Add("scienceRetrievedInKSC = " + Fixed(retrievedBefore));
            watch.Notes.Add("scienceRemainingToRetrieve = " + Fixed(remainingBefore));

            var method = subjectType.GetMethod(RetrieveScienceMethodName,
                BindingFlags.Public | BindingFlags.Instance);
            if (method == null || method.GetParameters().Length != 4)
            {
                Finish(watch, ok: false, "SubjectData.RetrieveScience(double, bool, ProtoVessel, File) not found on "
                    + subjectType.FullName + " - the installed Kerbalism's signature has changed");
                return false;
            }

            object? returned;
            try
            {
                returned = method.Invoke(subject, new object?[] { amount, false, origin.protoVessel, null });
            }
            catch (TargetInvocationException ex)
            {
                Finish(watch, ok: false, "RetrieveScience threw: " + (ex.InnerException ?? ex).Message);
                return false;
            }

            var credited = Convert.ToDouble(returned ?? 0.0, CultureInfo.InvariantCulture);
            watch.Notes.Add("retrieveScienceReturned = " + Fixed(credited));

            if (credited <= 0.0)
            {
                // The postfix bails on a non-positive result, so nothing was handed to the
                // sink. That is the subject being exhausted, not the delay failing, and the
                // two must not read alike.
                watch.Ok = true;
                watch.Summary = "RetrieveScience returned 0 - subject '" + subjectId
                    + "' has nothing left to retrieve (remaining was " + Fixed(remainingBefore)
                    + "); no increment reached the sink";
                return true;
            }

            watch.Ok = true;
            watch.Summary = string.Format(CultureInfo.InvariantCulture,
                "retrieved {0:0.###} science on '{1}' from {2} [{3}] (asked {4:0.###})",
                credited, subjectId, origin.vesselName, origin.id, amount);
            return true;
        }

        /// <summary>
        /// Finds a SubjectData by stock subject id, or by experiment + situation. The stock-id
        /// route goes through <c>GetSubjectDataFromStockId</c>, which is what Kerbalism itself
        /// uses for a subject it has not seen before; the experiment route builds a
        /// <c>Situation</c> and asks <c>GetSubjectData</c>, which returns null rather than
        /// inventing one.
        /// </summary>
        private static object? ResolveSubject(ConfigNode node, Vessel origin, out string fault)
        {
            fault = "";
            var scienceDb = ResolveType(ScienceDbTypeName);
            if (scienceDb == null)
            {
                fault = "KERBALISM.ScienceDB not in any loaded assembly (Kerbalism not installed?)";
                return null;
            }

            var stockId = (node.GetValue("subject") ?? "").Trim();
            if (stockId.Length > 0)
            {
                var fromStock = scienceDb.GetMethod("GetSubjectDataFromStockId",
                    BindingFlags.Public | BindingFlags.Static);
                if (fromStock == null)
                {
                    fault = "ScienceDB.GetSubjectDataFromStockId not found";
                    return null;
                }
                var subject = fromStock.Invoke(null, new object?[] { stockId, null, null });
                if (subject == null)
                {
                    fault = "no SubjectData for stock subject id '" + stockId + "'";
                }
                return subject;
            }

            var experimentId = (node.GetValue("experiment") ?? "").Trim();
            if (experimentId.Length == 0)
            {
                fault = "give either 'subject' (a stock subject id) or 'experiment' + 'situation'";
                return null;
            }

            var expInfo = scienceDb.GetMethod("GetExperimentInfo", BindingFlags.Public | BindingFlags.Static)
                ?.Invoke(null, new object?[] { experimentId });
            if (expInfo == null)
            {
                fault = "no ExperimentInfo for experiment id '" + experimentId + "' (mode=subjects lists them)";
                return null;
            }

            var situation = BuildSituation(node, origin, out fault);
            if (situation == null)
            {
                return null;
            }

            var situationType = situation.GetType();
            var getSubject = scienceDb.GetMethod("GetSubjectData", BindingFlags.Public | BindingFlags.Static,
                binder: null, types: new[] { expInfo.GetType(), situationType }, modifiers: null);
            if (getSubject == null)
            {
                fault = "ScienceDB.GetSubjectData(ExperimentInfo, Situation) not found";
                return null;
            }

            var resolved = getSubject.Invoke(null, new[] { expInfo, situation });
            if (resolved == null)
            {
                fault = "no SubjectData for experiment '" + experimentId + "' at " + situation;
            }
            return resolved;
        }

        /// <summary>Builds a <c>KERBALISM.Situation</c> from the request's situation/body/biome,
        /// defaulting the body to the origin vessel's own.</summary>
        private static object? BuildSituation(ConfigNode node, Vessel origin, out string fault)
        {
            fault = "";
            var situationType = ResolveType(SituationTypeName);
            var scienceSituationType = ResolveType(ScienceSituationTypeName);
            if (situationType == null || scienceSituationType == null)
            {
                fault = "KERBALISM.Situation / KERBALISM.ScienceSituation not found";
                return null;
            }

            var situationName = (node.GetValue("situation") ?? "").Trim();
            if (situationName.Length == 0)
            {
                fault = "'experiment' needs a 'situation' too (e.g. InSpaceHigh, SrfLanded, FlyingHigh)";
                return null;
            }

            object scienceSituation;
            try
            {
                scienceSituation = Enum.Parse(scienceSituationType, situationName, ignoreCase: true);
            }
            catch (Exception)
            {
                fault = "unrecognised 'situation' '" + situationName + "' (want a KERBALISM.ScienceSituation member)";
                return null;
            }

            if (!TryResolveBodyIndex(node.GetValue("body"), origin, out var bodyIndex))
            {
                fault = "unrecognised 'body' " + Describe(node.GetValue("body"));
                return null;
            }

            var biomeIndex = TryGetDouble(node, "biome", out var biome) ? (int)biome : -1;

            try
            {
                return Activator.CreateInstance(situationType, bodyIndex, scienceSituation, biomeIndex);
            }
            catch (Exception ex)
            {
                fault = "could not construct Situation: " + ex.Message;
                return null;
            }
        }

        private static bool TryResolveBodyIndex(string? raw, Vessel origin, out int bodyIndex)
        {
            var wanted = (raw ?? "").Trim();
            if (wanted.Length == 0)
            {
                bodyIndex = origin.mainBody != null ? origin.mainBody.flightGlobalsIndex : 1;
                return true;
            }

            if (int.TryParse(wanted, NumberStyles.Integer, CultureInfo.InvariantCulture, out bodyIndex))
            {
                return true;
            }

            var bodies = FlightGlobals.Bodies;
            if (bodies != null)
            {
                foreach (var body in bodies)
                {
                    if (body != null && string.Equals(body.bodyName, wanted, StringComparison.OrdinalIgnoreCase))
                    {
                        bodyIndex = body.flightGlobalsIndex;
                        return true;
                    }
                }
            }

            bodyIndex = 0;
            return false;
        }

        /// <summary>Writes the experiment ids Kerbalism knows and the subjects already
        /// persisted in this save, so a retrieve request can name one that exists instead of
        /// guessing at a stock id.</summary>
        private static void ListSubjects(WatchState watch)
        {
            var scienceDb = ResolveType(ScienceDbTypeName);
            if (scienceDb == null)
            {
                watch.Notes.Add("fault = KERBALISM.ScienceDB not in any loaded assembly");
                return;
            }

            try
            {
                var infos = scienceDb.GetProperty("ExperimentInfos", BindingFlags.Public | BindingFlags.Static)
                    ?.GetValue(null, null) as IEnumerable;
                if (infos != null)
                {
                    var ids = new List<string>();
                    foreach (var info in infos)
                    {
                        ids.Add(ReadString(info, info.GetType(), "ExperimentId"));
                    }
                    ids.Sort(StringComparer.Ordinal);
                    watch.Notes.Add("experimentIds = " + string.Join(", ", ids.ToArray()));
                }
                else
                {
                    watch.Notes.Add("fault = could not read ScienceDB.ExperimentInfos");
                }
            }
            catch (Exception ex)
            {
                watch.Notes.Add("fault = listing experiments threw: " + ex.Message);
            }

            try
            {
                var persisted = scienceDb.GetField("persistedSubjects", BindingFlags.Public | BindingFlags.Static)
                    ?.GetValue(null);
                var enumerator = persisted?.GetType()
                    .GetMethod("GetEnumerator", BindingFlags.Public | BindingFlags.Instance)
                    ?.Invoke(persisted, null) as IEnumerator;
                if (enumerator == null)
                {
                    watch.Notes.Add("fault = could not read ScienceDB.persistedSubjects");
                    return;
                }

                var count = 0;
                while (enumerator.MoveNext() && count < 60)
                {
                    var subject = enumerator.Current;
                    if (subject == null)
                    {
                        continue;
                    }
                    count++;
                    var type = subject.GetType();
                    watch.Notes.Add("persistedSubject = " + ReadString(subject, type, "StockSubjectId")
                        + " remaining=" + Fixed(ReadDouble(subject, type, "ScienceRemainingToRetrieve"))
                        + " max=" + Fixed(ReadDouble(subject, type, "ScienceMaxValue")));
                }
            }
            catch (Exception ex)
            {
                watch.Notes.Add("fault = listing persisted subjects threw: " + ex.Message);
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

        // ---- Sampling ----

        private static Sample TakeSample(string label, double sinceRetrieveSeconds)
        {
            return new Sample(
                label,
                sinceRetrieveSeconds,
                CurrentUt(),
                Funding.Instance != null ? Funding.Instance.Funds : 0.0,
                ResearchAndDevelopment.Instance != null ? ResearchAndDevelopment.Instance.Science : 0.0,
                Reputation.Instance != null ? Reputation.Instance.reputation : 0.0,
                ReadKerbalism(),
                ReadDelay(),
                ReadBus());
        }

        /// <summary>
        /// Reads Kerbalism's own crediting state, plus whether anything has a Harmony postfix
        /// on <c>SubjectData.RetrieveScience</c>. The patch check goes through
        /// <c>Harmony.GetPatchInfo</c> rather than through our own hook object, so it stays a
        /// different kind of measurement from everything else in this file: it can report a
        /// patch we did not apply, and can report OUR patch missing even if every Gonogo object
        /// looks healthy.
        /// </summary>
        private static KerbalismView ReadKerbalism()
        {
            var subjectDataType = ResolveType(SubjectDataTypeName);
            if (subjectDataType == null)
            {
                return KerbalismView.Absent("KERBALISM.SubjectData not in any loaded assembly");
            }

            var fault = "";
            var haveFlag = false;
            var preventCrediting = false;
            var uncredited = 0.0;

            try
            {
                var apiType = ResolveType(ApiTypeName);
                var flag = apiType?.GetField("preventScienceCrediting", BindingFlags.Public | BindingFlags.Static);
                if (flag == null)
                {
                    fault = "could not read KERBALISM.API.preventScienceCrediting";
                }
                else
                {
                    haveFlag = true;
                    preventCrediting = (bool)flag.GetValue(null);
                }
            }
            catch (Exception ex)
            {
                fault = Append(fault, "reading preventScienceCrediting threw: " + ex.Message);
            }

            try
            {
                var field = ResolveType(ScienceDbTypeName)
                    ?.GetField("uncreditedScience", BindingFlags.Public | BindingFlags.Static);
                if (field == null)
                {
                    fault = Append(fault, "could not read ScienceDB.uncreditedScience");
                }
                else
                {
                    uncredited = Convert.ToDouble(field.GetValue(null), CultureInfo.InvariantCulture);
                }
            }
            catch (Exception ex)
            {
                fault = Append(fault, "reading uncreditedScience threw: " + ex.Message);
            }

            return new KerbalismView(true, haveFlag, preventCrediting, uncredited,
                DescribeRetrieveSciencePatches(subjectDataType), fault);
        }

        private static string DescribeRetrieveSciencePatches(Type subjectDataType)
        {
            try
            {
                var harmonyType = ResolveType("HarmonyLib.Harmony");
                if (harmonyType == null)
                {
                    return "(HarmonyLib not loaded)";
                }

                var target = subjectDataType.GetMethod(RetrieveScienceMethodName,
                    BindingFlags.Public | BindingFlags.Instance);
                if (target == null)
                {
                    return "(RetrieveScience not found)";
                }

                var info = harmonyType.GetMethod("GetPatchInfo", BindingFlags.Public | BindingFlags.Static)
                    ?.Invoke(null, new object?[] { target });
                if (info == null)
                {
                    return "unpatched";
                }

                var postfixes = info.GetType().GetProperty("Postfixes", BindingFlags.Public | BindingFlags.Instance)
                    ?.GetValue(info, null) as IEnumerable;
                if (postfixes == null)
                {
                    return "(could not read Postfixes)";
                }

                var owners = new List<string>();
                foreach (var patch in postfixes)
                {
                    var owner = patch.GetType().GetField("owner", BindingFlags.Public | BindingFlags.Instance)
                        ?.GetValue(patch) as string;
                    owners.Add(owner ?? "(unnamed owner)");
                }

                return owners.Count == 0 ? "no postfix" : "postfix owners: " + string.Join(", ", owners.ToArray());
            }
            catch (Exception ex)
            {
                return "(patch probe threw: " + ex.Message + ")";
            }
        }

        /// <summary>
        /// Enumerates EVERY live <c>CurrencyDelayScenario</c> through
        /// <c>Resources.FindObjectsOfTypeAll</c>, which unlike <c>FindObjectOfType</c> returns
        /// all of them and does not skip an inactive one, and reads each instance's own
        /// interceptor, shadow, ledger and aggregator identity. It then reads the static
        /// <c>DelayedScienceSink</c> binding separately, so the two can be compared: a sink
        /// bound to a ledger no listed scenario owns is the whole subsystem talking to an
        /// object nothing else can see.
        /// </summary>
        private static DelayView ReadDelay()
        {
            try
            {
                var scenarioType = ResolveType("Gonogo.KSP.CurrencyDelay.CurrencyDelayScenario");
                if (scenarioType == null)
                {
                    return DelayView.Absent("CurrencyDelayScenario not in any loaded assembly");
                }

                var scenarios = new List<ScenarioView>();
                foreach (var found in Resources.FindObjectsOfTypeAll(scenarioType))
                {
                    if (found != null)
                    {
                        scenarios.Add(ReadScenario(scenarioType, found));
                    }
                }

                var fault = "";
                var sinkBound = false;
                var sinkAggregatorHash = 0;
                var sinkLedgerHash = 0;

                var sinkType = ResolveType("Gonogo.KSP.CurrencyDelay.DelayedScienceSink");
                if (sinkType == null)
                {
                    fault = "DelayedScienceSink not in the loaded assembly";
                }
                else
                {
                    const BindingFlags Static = BindingFlags.NonPublic | BindingFlags.Static;
                    var aggregator = sinkType.GetField("_aggregator", Static)?.GetValue(null);
                    var ledger = sinkType.GetField("_ledger", Static)?.GetValue(null);
                    sinkAggregatorHash = HashOf(aggregator);
                    sinkLedgerHash = HashOf(ledger);
                    sinkBound = aggregator != null && ledger != null;
                }

                return new DelayView(true, scenarios, sinkBound, sinkAggregatorHash, sinkLedgerHash, fault);
            }
            catch (Exception ex)
            {
                return DelayView.Absent("probe threw: " + ex.Message);
            }
        }

        private static ScenarioView ReadScenario(Type scenarioType, object scenario)
        {
            const BindingFlags Instance = BindingFlags.NonPublic | BindingFlags.Instance;

            var fault = "";
            var subscribed = false;
            var shadowScience = double.NaN;
            var interceptorHash = 0;

            var interceptor = scenarioType.GetField("_interceptor", Instance)?.GetValue(scenario);
            if (interceptor == null)
            {
                fault = "could not read _interceptor";
            }
            else
            {
                interceptorHash = HashOf(interceptor);
                var interceptorType = interceptor.GetType();

                var subscribedField = interceptorType.GetField("_subscribed", Instance);
                if (subscribedField == null)
                {
                    fault = Append(fault, "could not read _subscribed");
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

            var ledgerRows = -1;
            var firstPending = "";
            var ledger = scenarioType.GetField("_ledger", Instance)?.GetValue(scenario);
            var pending = ledger?.GetType()
                .GetProperty("Pending", BindingFlags.Public | BindingFlags.Instance)?.GetValue(ledger, null);
            if (pending is IEnumerable rows)
            {
                ledgerRows = 0;
                foreach (var row in rows)
                {
                    ledgerRows++;
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

            var aggregator = scenarioType.GetField("_aggregator", Instance)?.GetValue(scenario);
            return new ScenarioView(HashOf(scenario), interceptorHash, subscribed, shadowScience,
                HashOf(ledger), ledgerRows, firstPending, HashOf(aggregator),
                DescribeAggregatorWindows(aggregator, ref fault), fault);
        }

        /// <summary>
        /// The aggregator's open per-vessel windows. An increment that reached the sink but has
        /// neither crossed the 0.1 threshold nor aged past the flush cadence sits here and
        /// nowhere else: invisible in the ledger, invisible in the balances, and easily misread
        /// as an increment that never arrived.
        /// </summary>
        private static string DescribeAggregatorWindows(object? aggregator, ref string fault)
        {
            if (aggregator == null)
            {
                fault = Append(fault, "could not read _aggregator");
                return "";
            }

            try
            {
                var windows = aggregator.GetType()
                    .GetField("_windows", BindingFlags.NonPublic | BindingFlags.Instance)
                    ?.GetValue(aggregator) as IDictionary;
                if (windows == null)
                {
                    fault = Append(fault, "could not read the aggregator windows");
                    return "";
                }

                if (windows.Count == 0)
                {
                    return "none";
                }

                var parts = new List<string>();
                foreach (DictionaryEntry entry in windows)
                {
                    var window = entry.Value;
                    var type = window?.GetType();
                    var amount = type?.GetField("AccumulatedAmount", BindingFlags.Public | BindingFlags.Instance)
                        ?.GetValue(window);
                    var startUt = type?.GetField("WindowStartUt", BindingFlags.Public | BindingFlags.Instance)
                        ?.GetValue(window);
                    var lightTime = type?.GetField("LatestLightTimeSeconds", BindingFlags.Public | BindingFlags.Instance)
                        ?.GetValue(window);
                    parts.Add(string.Format(CultureInfo.InvariantCulture,
                        "{0} amount={1} startUt={2} lightTime={3}", entry.Key, amount, startUt, lightTime));
                }
                return string.Join(" | ", parts.ToArray());
            }
            catch (Exception ex)
            {
                fault = Append(fault, "reading aggregator windows threw: " + ex.Message);
                return "";
            }
        }

        /// <summary>
        /// Reads the subscriber list off <c>GameEvents.OnScienceChanged</c> itself. This is the
        /// only reading here that does not start from an object we found some other way, so it
        /// is the one that can contradict the rest: an interceptor on the bus whose hash
        /// appears against no listed scenario means the DELAY block above is describing a
        /// different object than the one receiving the events.
        /// </summary>
        private static BusView ReadBus()
        {
            try
            {
                object bus = GameEvents.OnScienceChanged;
                var events = bus.GetType().GetField("events", BindingFlags.NonPublic | BindingFlags.Instance)
                    ?.GetValue(bus) as IEnumerable;
                if (events == null)
                {
                    return new BusView(-1, Array.Empty<string>(), "could not read the OnScienceChanged subscriber list");
                }

                var count = 0;
                var interceptors = new List<string>();
                foreach (var entry in events)
                {
                    count++;
                    var type = entry.GetType();
                    var originator = type.GetField("originator", BindingFlags.Public | BindingFlags.Instance)
                        ?.GetValue(entry);
                    var originatorType = type.GetField("originatorType", BindingFlags.Public | BindingFlags.Instance)
                        ?.GetValue(entry) as string;
                    if (originatorType == "StockCurrencyInterceptor")
                    {
                        interceptors.Add("hash=" + HashOf(originator).ToString(CultureInfo.InvariantCulture));
                    }
                }

                return new BusView(count, interceptors, "");
            }
            catch (Exception ex)
            {
                return new BusView(-1, Array.Empty<string>(), "bus probe threw: " + ex.Message);
            }
        }

        // ---- Reflection helpers ----

        private static int HashOf(object? value) =>
            value == null ? 0 : RuntimeHelpers.GetHashCode(value);

        private static double ReadDouble(object target, Type type, string propertyName)
        {
            try
            {
                var value = type.GetProperty(propertyName, BindingFlags.Public | BindingFlags.Instance)
                    ?.GetValue(target, null);
                return value == null ? double.NaN : Convert.ToDouble(value, CultureInfo.InvariantCulture);
            }
            catch (Exception)
            {
                return double.NaN;
            }
        }

        private static string ReadString(object target, Type type, string propertyName)
        {
            try
            {
                return type.GetProperty(propertyName, BindingFlags.Public | BindingFlags.Instance)
                    ?.GetValue(target, null)?.ToString() ?? "(null)";
            }
            catch (Exception ex)
            {
                return "(unreadable: " + ex.Message + ")";
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
                var description = type.GetProperty("OriginDescription")?.GetValue(row, null);
                return string.Format(CultureInfo.InvariantCulture,
                    "{0} {1} revealUt={2} origin={3} from={4}", currency, amount, revealUt, origin, description);
            }
            catch (Exception ex)
            {
                return "unreadable row: " + ex.Message;
            }
        }

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
                    continue;
                }
                if (found != null)
                {
                    return found;
                }
            }
            return null;
        }

        private static Vessel? ResolveVessel(string? origin)
        {
            var wanted = (origin ?? "active").Trim();
            if (wanted.Length == 0 || string.Equals(wanted, "active", StringComparison.OrdinalIgnoreCase))
            {
                return FlightGlobals.ActiveVessel;
            }

            var vessels = FlightGlobals.Vessels;
            if (vessels == null)
            {
                return null;
            }

            foreach (var vessel in vessels)
            {
                if (vessel != null && string.Equals(vessel.id.ToString(), wanted, StringComparison.OrdinalIgnoreCase))
                {
                    return vessel;
                }
            }

            foreach (var vessel in vessels)
            {
                if (vessel != null && string.Equals(vessel.vesselName, wanted, StringComparison.OrdinalIgnoreCase))
                {
                    return vessel;
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

        private static string Describe(string? raw) =>
            string.IsNullOrEmpty(raw) ? "(absent)" : "'" + raw + "'";

        private static string Append(string existing, string addition) =>
            existing.Length == 0 ? addition : existing + "; " + addition;

        private static double RoundSeconds(double seconds) => Math.Round(seconds, 1);

        private static string Fixed(double value) =>
            double.IsNaN(value) ? "(unreadable)" : value.ToString("F3", CultureInfo.InvariantCulture);

        private static bool TryGetDouble(ConfigNode node, string key, out double value)
        {
            value = 0.0;
            var raw = node.GetValue(key);
            return !string.IsNullOrEmpty(raw)
                && double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out value);
        }

        // ---- Result file ----

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
                foreach (var note in watch.Notes)
                {
                    sb.AppendLine("\t" + note);
                }
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
            sb.AppendLine("\tSAMPLE");
            sb.AppendLine("\t{");
            sb.AppendLine("\t\tat = " + sample.Label);
            sb.AppendLine("\t\tsinceRetrieveSeconds = " + sample.SinceRetrieveSeconds.ToString("F1", CultureInfo.InvariantCulture));
            sb.AppendLine("\t\tut = " + sample.Ut.ToString("F3", CultureInfo.InvariantCulture));
            sb.AppendLine("\t\tfunds = " + Fixed(sample.Funds));
            sb.AppendLine("\t\tscience = " + Fixed(sample.Science));
            sb.AppendLine("\t\treputation = " + Fixed(sample.Reputation));
            AppendKerbalism(sb, sample.Kerbalism);
            AppendDelay(sb, sample.Delay);
            AppendBus(sb, sample.Bus, sample.Delay);
            sb.AppendLine("\t}");
        }

        private static void AppendKerbalism(StringBuilder sb, KerbalismView view)
        {
            sb.AppendLine("\t\tKERBALISM");
            sb.AppendLine("\t\t{");
            sb.AppendLine("\t\t\tloaded = " + (view.Loaded ? "True" : "False"));
            sb.AppendLine("\t\t\tpreventScienceCrediting = "
                + (view.HaveFlag ? (view.PreventCrediting ? "True" : "False") : "(unreadable)"));
            sb.AppendLine("\t\t\tuncreditedScience = " + Fixed(view.UncreditedScience));
            sb.AppendLine("\t\t\tretrieveSciencePatch = " + view.HookPatch);
            if (view.Fault.Length > 0)
            {
                sb.AppendLine("\t\t\tfault = " + view.Fault);
            }
            sb.AppendLine("\t\t}");
        }

        private static void AppendDelay(StringBuilder sb, DelayView view)
        {
            sb.AppendLine("\t\tDELAY");
            sb.AppendLine("\t\t{");
            sb.AppendLine("\t\t\tsubsystemPresent = " + (view.Present ? "True" : "False"));
            sb.AppendLine("\t\t\tscenarioInstances = " + view.Scenarios.Count.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("\t\t\tsinkBound = " + (view.SinkBound ? "True" : "False"));
            sb.AppendLine("\t\t\tsinkLedgerHash = " + view.SinkLedgerHash.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("\t\t\tsinkAggregatorHash = " + view.SinkAggregatorHash.ToString(CultureInfo.InvariantCulture));

            var sinkMatchesAScenario = false;
            foreach (var scenario in view.Scenarios)
            {
                if (scenario.LedgerHash == view.SinkLedgerHash && view.SinkLedgerHash != 0)
                {
                    sinkMatchesAScenario = true;
                }
                AppendScenario(sb, scenario, view.SinkLedgerHash);
            }

            // The reading that makes this instrument able to report its own blindness: a bound
            // sink whose ledger belongs to no listed scenario means every ledger depth above is
            // being read off an object the crediting path does not use.
            sb.AppendLine("\t\t\tsinkLedgerBelongsToAListedScenario = "
                + (view.SinkBound ? (sinkMatchesAScenario ? "True" : "False") : "(sink unbound)"));
            if (view.Fault.Length > 0)
            {
                sb.AppendLine("\t\t\tfault = " + view.Fault);
            }
            sb.AppendLine("\t\t}");
        }

        private static void AppendScenario(StringBuilder sb, ScenarioView scenario, int sinkLedgerHash)
        {
            sb.AppendLine("\t\t\tSCENARIO");
            sb.AppendLine("\t\t\t{");
            sb.AppendLine("\t\t\t\tscenarioHash = " + scenario.ScenarioHash.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("\t\t\t\tinterceptorHash = " + scenario.InterceptorHash.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("\t\t\t\tinterceptorSubscribed = " + (scenario.Subscribed ? "True" : "False"));
            sb.AppendLine("\t\t\t\tshadowScience = " + Fixed(scenario.ShadowScience));
            sb.AppendLine("\t\t\t\tledgerHash = " + scenario.LedgerHash.ToString(CultureInfo.InvariantCulture));
            // -1 means the ledger could not be read; a plain 0 would read as "measured,
            // nothing pending", which is the opposite conclusion.
            sb.AppendLine("\t\t\t\tpendingRows = "
                + (scenario.LedgerRows < 0 ? "(unreadable)" : scenario.LedgerRows.ToString(CultureInfo.InvariantCulture)));
            sb.AppendLine("\t\t\t\tisSinkLedger = "
                + (scenario.LedgerHash != 0 && scenario.LedgerHash == sinkLedgerHash ? "True" : "False"));
            sb.AppendLine("\t\t\t\taggregatorWindows = " + scenario.AggregatorWindows);
            if (scenario.FirstPending.Length > 0)
            {
                sb.AppendLine("\t\t\t\tfirstPending = " + scenario.FirstPending);
            }
            if (scenario.Fault.Length > 0)
            {
                sb.AppendLine("\t\t\t\tfault = " + scenario.Fault);
            }
            sb.AppendLine("\t\t\t}");
        }

        private static void AppendBus(StringBuilder sb, BusView bus, DelayView delay)
        {
            sb.AppendLine("\t\tBUS");
            sb.AppendLine("\t\t{");
            sb.AppendLine("\t\t\tonScienceChangedSubscribers = "
                + (bus.SubscriberCount < 0 ? "(unreadable)" : bus.SubscriberCount.ToString(CultureInfo.InvariantCulture)));
            sb.AppendLine("\t\t\tinterceptorsOnBus = " + bus.Interceptors.Count.ToString(CultureInfo.InvariantCulture));
            foreach (var interceptor in bus.Interceptors)
            {
                sb.AppendLine("\t\t\tinterceptorOnBus = " + interceptor);
            }

            var everyBusInterceptorIsListed = true;
            foreach (var interceptor in bus.Interceptors)
            {
                var matched = false;
                foreach (var scenario in delay.Scenarios)
                {
                    if ("hash=" + scenario.InterceptorHash.ToString(CultureInfo.InvariantCulture) == interceptor)
                    {
                        matched = true;
                    }
                }
                if (!matched)
                {
                    everyBusInterceptorIsListed = false;
                }
            }

            // The contradiction test. False here says the DELAY block above is reading an
            // interceptor that is not the one receiving OnScienceChanged, which makes every
            // shadow figure in this file untrustworthy rather than merely disappointing.
            sb.AppendLine("\t\t\teveryBusInterceptorIsALocatedScenario = "
                + (bus.Interceptors.Count == 0 ? "(none on bus)" : (everyBusInterceptorIsListed ? "True" : "False")));
            if (bus.Fault.Length > 0)
            {
                sb.AppendLine("\t\t\tfault = " + bus.Fault);
            }
            sb.AppendLine("\t\t}");
        }
    }
}
