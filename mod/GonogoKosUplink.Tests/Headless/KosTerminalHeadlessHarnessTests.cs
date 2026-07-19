// GonogoKosUplink — GPLv3. See GonogoKosUplink.csproj's header comment for the
// licence/linkage rationale.

using System.Collections.Generic;
using System.Linq;
using Gonogo.KosUplink;
using kOS.Safe.Screen;
using kOS.UserIO;
using Sitrep.Contract;
using Sitrep.Core;
using Xunit;

namespace GonogoKosUplink.Tests.Headless
{
    /// <summary>
    /// The KSP-free, end-to-end terminal harness: it drives a REAL
    /// <c>kOS.Safe.Screen.ScreenBuffer</c> (the same screen type a live kOS CPU
    /// runs), runs its snapshots through the REAL <see cref="ScreenDiffMapper"/>
    /// — real <c>ScreenSnapShot.DiffFrom</c> + real
    /// <c>kOS.UserIO.TerminalXtermMapper</c>, no KSP/Unity process — through the
    /// REAL <see cref="KosTerminalManager"/> and into a REAL
    /// <see cref="Courier"/>/<c>Archive</c> delay engine driven by a
    /// <see cref="ManualClock"/>, then reconstructs the client-side screen from
    /// the delivered chunks and asserts it matches an independent real-pipeline
    /// render of the mod's final screen.
    ///
    /// <para>This closes the gap the pure unit tests structurally can't: they
    /// assert <see cref="KosTerminalManager"/>'s published stamps in isolation
    /// and never model <c>Archive.ReadAtVantage</c>'s "latest sample as of the
    /// light-lagged scene" coalescing (the state re-read lane the terminal is
    /// deliberately NOT on). Here the whole chain runs, so a
    /// same-<c>ValidAt</c> collision doesn't just return a wrong number — it
    /// silently corrupts the reconstructed screen. See
    /// <see cref="Burst_ConstantValidAt_LossyLatestLane_StillCoalescesAndCorruptsTheScreen"/>
    /// for the executable proof that this harness catches the coalescing garble
    /// class the state re-read lane produces, and
    /// <see cref="Burst_ConstantValidAt_ReliableOrderedLane_DeliversEveryFrameAndReconstructsExactScreen"/>
    /// for the proof the ReliableOrdered forward lane fixes it at a constant
    /// ValidAt (making Fix #1's strictly-increasing stamp unnecessary); the harness report
    /// (docs/superpowers/plans/2026-07-13-kos-headless-harness-report.md) pairs
    /// it with an actual git-revert-of-Fix-#1 run of the positive test.</para>
    ///
    /// <para><b>Interpreter vs ScreenBuffer:</b> this drives the ScreenBuffer
    /// directly rather than standing up the full kOS interpreter headlessly —
    /// the sanctioned fallback. It exercises the exact real pipeline the
    /// terminal-garble class lives in (screen state → diff → xterm map → delay
    /// engine); printing to the ScreenBuffer is precisely what a kerboscript
    /// <c>PRINT</c> does to a CPU's screen. A subscriber joins on a blank screen
    /// (its reseed frame is a clean clear) and then watches a burst of PRINTed
    /// lines arrive as cursor-relative incremental diffs — which is exactly the
    /// frame shape that coalesces on ValidAt.</para>
    /// </summary>
    public class KosTerminalHeadlessHarnessTests
    {
        private const int Rows = 12;
        private const int Cols = 40;

        private const string Node = "vessel-1";
        private const string Vantage = "KSC";
        private const int CoreId = 7;

        private static readonly string[] BurstLines =
        {
            "BOOT SEQUENCE COMPLETE",
            "STAGE 1 IGNITION",
            "STAGE 1 SEPARATION",
            "STAGE 2 IGNITION",
            "ORBIT ACHIEVED 80x80KM",
        };

        /// <summary>
        /// Adapts a live <see cref="ScreenBuffer"/> to the manager's
        /// <see cref="IKosTerminalScreen"/> port by delegating to a real
        /// <see cref="ScreenDiffMapper"/> — the same delegation the production
        /// <c>KosProcessorScreen</c> shell does, minus the <c>kOSProcessor</c>
        /// resolution. The test mutates the shared buffer between polls, exactly
        /// as a running kerboscript would mutate a CPU's screen.
        /// </summary>
        private sealed class ScreenBufferTerminal : IKosTerminalScreen
        {
            private readonly ScreenBuffer _buffer;
            private readonly ScreenDiffMapper _mapper = new ScreenDiffMapper();

            public ScreenBufferTerminal(ScreenBuffer buffer) => _buffer = buffer;

            public TerminalReadResult ReadChunk(bool forceReseed) => _mapper.MapNext(_buffer, forceReseed);

            public bool TypeChars(string chars) => true;

            public void Resize(int cols, int rows) => _buffer.SetSize(rows, cols);
        }

        /// <summary>
        /// Mirrors kOS.Screen.Interpreter.SetInputLock (kOS.dll, needs
        /// UnityEngine + full SharedObjects wiring, cannot be constructed
        /// headlessly) exactly: LineSubBuffer.Enabled = !isLocked. Confirmed
        /// by decompiling kOS.Safe.Execution.CPU.PushContext/PopContext: input
        /// locks the instant a program context is pushed (contexts.Count > 1,
        /// i.e. a script starts running) and unlocks the instant it's popped
        /// back down to just the interpreter context (contexts.Count == 1) --
        /// including via KOSFixedUpdate's exception-catch cleanup path, which
        /// is exactly the runtime-error case this investigation targets. This
        /// is a plain subclass of the concrete kOS.Safe.Screen.TextEditor
        /// class (not an interface implementation), so it does not touch the
        /// kOS.Safe re-entrant-IDumper-load trap.
        /// </summary>
        private sealed class InterpreterLikeTextEditor : TextEditor
        {
            public void SetInputLock(bool isLocked) => LineSubBuffer.Enabled = !isLocked;
        }

        private static ScreenBuffer NewScreen()
        {
            var buffer = new ScreenBuffer();
            buffer.SetSize(Rows, Cols);
            return buffer;
        }

        /// <summary>Reconstruct a client screen by applying the delivered frames in order (honouring full-repaint clears).</summary>
        private static TerminalEmulator Reconstruct(IEnumerable<KosTerminalFrame> frames)
        {
            var client = new TerminalEmulator(Rows, Cols);
            foreach (var frame in frames)
            {
                if (frame.FullRepaint)
                {
                    client.Clear();
                }
                client.Apply(frame.Chunk);
            }
            return client;
        }

        /// <summary>
        /// The canonical rendered screen for <paramref name="buffer"/>: the REAL
        /// pipeline's one-shot full render (final snapshot diffed against a blank
        /// baseline captured before any content, then xterm-mapped) applied to a
        /// fresh client. Independent of the incremental burst path, so it is a
        /// fair oracle for what the client SHOULD end up showing.
        /// </summary>
        private static string RenderFinalScreen(IScreenBuffer buffer, IScreenSnapShot blankBaseline)
        {
            var mapper = TerminalUnicodeMapper.TerminalMapperFactory("xterm");
            var raw = new ScreenSnapShot(buffer).DiffFrom(blankBaseline);
            var truth = new TerminalEmulator(Rows, Cols);
            truth.Apply(new string(mapper.OutputConvert(raw)));
            return truth.Text;
        }

        [Fact]
        public void Burst_RealPipeline_AllFramesDeliveredInOrder_ReconstructsExactScreen()
        {
            var clock = new ManualClock(startUt: 1000);
            var network = new StubNetwork(delay: 0);
            var courier = new Courier(clock, network);
            var topic = KosChannels.TerminalTopic(CoreId);

            var delivered = new List<KosTerminalFrame>();
            courier.SubscribeStream(Node, topic, Vantage, data =>
            {
                if (data.Payload is KosTerminalFrame frame)
                {
                    delivered.Add(frame);
                }
            });

            var buffer = NewScreen();
            var blankBaseline = new ScreenSnapShot(buffer).DeepCopy();
            var screen = new ScreenBufferTerminal(buffer);

            var publishedUts = new List<double>();
            var publishedChunks = new List<string>();
            var manager = new KosTerminalManager(
                knownCoreIds: () => new[] { CoreId },
                isSubscribed: _ => true,
                publish: (_, frame, ut) =>
                {
                    publishedUts.Add(ut);
                    publishedChunks.Add(frame.Chunk);
                    // The terminal is a Delivery.ReliableOrdered channel (see
                    // KosExtension.Ksp.cs's dynamic-namespace declaration): its
                    // frames ride the per-sample forward lane, not the state
                    // re-read that coalesces same-ValidAt frames.
                    courier.Record(Node, topic, frame, ut, Delivery.ReliableOrdered);
                },
                createScreen: _ => screen,
                nowUt: () => clock.Now(),
                pollIntervalSeconds: 0.05);

            // A viewer subscribes on a blank screen: the first poll is a clean
            // full-repaint reseed.
            manager.Poll(1.0);

            // Then a kerboscript PRINTs a burst of lines: one line per ~20Hz
            // poll, while the Courier clock stays PARKED at a single tick
            // (production: the ~50ms Courier cadence is outrun by the main-thread
            // poll). Each poll is a cursor-relative incremental diff — exactly
            // the frames that collide on ValidAt without Fix #1.
            foreach (var line in BurstLines)
            {
                buffer.Print(line);
                manager.Poll(1.0);
            }

            // Drain every scheduled (zero-delay) delivery.
            clock.AdvanceTo(clock.Now() + 1);

            // Completeness: every published frame was delivered — none dropped
            // or duplicated (1 reseed + one per burst line).
            Assert.Equal(BurstLines.Length + 1, publishedUts.Count);
            Assert.Equal(publishedUts.Count, delivered.Count);

            // Order: the ReliableOrdered lane forwards each captured frame
            // exactly once, in record order — NOT dependent on distinct
            // ValidAt stamps (that was Fix #1's job, now retired: a same-tick
            // burst forwards per-sample rather than re-reading the coalesced
            // latest). ValidAt stays monotonic non-decreasing (the clock never
            // rewinds mid-burst), and the delivered chunk sequence is exactly
            // the published one.
            for (var k = 1; k < publishedUts.Count; k++)
            {
                Assert.True(publishedUts[k] >= publishedUts[k - 1],
                    $"frame {k} ValidAt {publishedUts[k]} must not precede frame {k - 1}'s {publishedUts[k - 1]}");
            }
            Assert.Equal(publishedChunks, delivered.Select(f => f.Chunk).ToList());

            // Exactly one reseed (the first frame) then pure incremental diffs.
            Assert.True(delivered[0].FullRepaint);
            Assert.All(delivered.Skip(1), f => Assert.False(f.FullRepaint));

            // The reconstructed client screen matches the mod's final screen.
            var client = Reconstruct(delivered);
            Assert.Equal(RenderFinalScreen(buffer, blankBaseline), client.Text);
            foreach (var line in BurstLines)
            {
                Assert.Contains(line, client.Text);
            }
        }

        [Fact]
        public void Burst_ConstantValidAt_LossyLatestLane_StillCoalescesAndCorruptsTheScreen()
        {
            // The negative control: proof the harness still CATCHES the
            // coalescing garble class, and pins exactly WHERE it lives — the
            // state re-read lane (Delivery.LossyLatest). Every burst frame is
            // recorded at the SAME constant ValidAt on that lane. Everything
            // else is the REAL pipeline: real ScreenBuffer, real
            // ScreenDiffMapper diffs, real Archive.ReadAtVantage coalescing.
            // Contrast with the ReliableOrdered test below, which records the
            // identical burst at the identical constant ValidAt and does NOT
            // corrupt — the whole point of the reclassify.
            var clock = new ManualClock(startUt: 1000);
            var network = new StubNetwork(delay: 0);
            var courier = new Courier(clock, network);
            var topic = KosChannels.TerminalTopic(CoreId);

            var delivered = new List<KosTerminalFrame>();
            courier.SubscribeStream(Node, topic, Vantage, data =>
            {
                if (data.Payload is KosTerminalFrame frame)
                {
                    delivered.Add(frame);
                }
            });

            var buffer = NewScreen();
            var blankBaseline = new ScreenSnapShot(buffer).DeepCopy();
            var screen = new ScreenBufferTerminal(buffer);

            const double frozenUt = 1000.0; // constant raw UT, never advanced.

            void RecordFrame(bool force)
            {
                var result = screen.ReadChunk(force);
                if (result.HasOutput)
                {
                    // Delivery.LossyLatest (the default) — the state re-read
                    // lane, where same-ValidAt frames coalesce.
                    courier.Record(Node, topic, new KosTerminalFrame
                    {
                        CoreId = CoreId,
                        Chunk = result.Chunk,
                        FullRepaint = result.FullRepaint,
                    }, frozenUt, Delivery.LossyLatest);
                }
            }

            RecordFrame(force: true); // blank reseed
            foreach (var line in BurstLines)
            {
                buffer.Print(line);
                RecordFrame(force: false); // incremental diff
            }

            clock.AdvanceTo(clock.Now() + 1);

            var client = Reconstruct(delivered);
            var truth = RenderFinalScreen(buffer, blankBaseline);

            // With a constant ValidAt on the re-read lane, Archive coalesces the
            // whole burst to a single sample, so the reconstructed screen is NOT
            // the mod's final screen. If this ever became equal, the coalescing
            // bug would have stopped being observable here.
            Assert.NotEqual(truth, client.Text);

            // Concretely: earlier burst lines were dropped from the client — the
            // reader only ever resolved the LATEST same-ValidAt sample.
            Assert.DoesNotContain("STAGE 1 IGNITION", client.Text);
            Assert.DoesNotContain("BOOT SEQUENCE COMPLETE", client.Text);
        }

        [Fact]
        public void Burst_ConstantValidAt_ReliableOrderedLane_DeliversEveryFrameAndReconstructsExactScreen()
        {
            // The heart of the reclassify proof. Same real pipeline, same
            // constant ValidAt as the LossyLatest control above — the exact
            // shape reverting Fix #1 produces (no strictly-increasing stamp) —
            // but on the Delivery.ReliableOrdered lane. Because that
            // lane forwards each captured sample per-frame instead of
            // re-reading the archive at fire time, the constant ValidAt no
            // longer coalesces the burst: every frame is delivered, in order,
            // and the client screen reconstructs EXACTLY. This is the executable
            // evidence that the epsilon-bump (Fix #1) is unnecessary once the
            // channel is on the correct lane.
            var clock = new ManualClock(startUt: 1000);
            var network = new StubNetwork(delay: 0);
            var courier = new Courier(clock, network);
            var topic = KosChannels.TerminalTopic(CoreId);

            var delivered = new List<KosTerminalFrame>();
            courier.SubscribeStream(Node, topic, Vantage, data =>
            {
                if (data.Payload is KosTerminalFrame frame)
                {
                    delivered.Add(frame);
                }
            });

            var buffer = NewScreen();
            var blankBaseline = new ScreenSnapShot(buffer).DeepCopy();
            var screen = new ScreenBufferTerminal(buffer);

            const double frozenUt = 1000.0; // constant raw UT — the reverted-Fix-#1 shape.

            void RecordFrame(bool force)
            {
                var result = screen.ReadChunk(force);
                if (result.HasOutput)
                {
                    courier.Record(Node, topic, new KosTerminalFrame
                    {
                        CoreId = CoreId,
                        Chunk = result.Chunk,
                        FullRepaint = result.FullRepaint,
                    }, frozenUt, Delivery.ReliableOrdered);
                }
            }

            RecordFrame(force: true); // blank reseed
            foreach (var line in BurstLines)
            {
                buffer.Print(line);
                RecordFrame(force: false); // incremental diff
            }

            clock.AdvanceTo(clock.Now() + 1);

            var client = Reconstruct(delivered);
            var truth = RenderFinalScreen(buffer, blankBaseline);

            // Completeness: 1 reseed + one frame per burst line, none coalesced.
            Assert.Equal(BurstLines.Length + 1, delivered.Count);
            // Exactly one reseed then pure incremental diffs, in order.
            Assert.True(delivered[0].FullRepaint);
            Assert.All(delivered.Skip(1), f => Assert.False(f.FullRepaint));
            // Despite every frame sharing a single ValidAt, the reconstructed
            // screen matches the mod's final screen.
            Assert.Equal(truth, client.Text);
            foreach (var line in BurstLines)
            {
                Assert.Contains(line, client.Text);
            }
        }

        [Fact]
        public void LateSubscriberToBusyCpu_ReseedRepaintsTheFullExistingScreen()
        {
            // Regression for the reseed-against-busy-screen bug the harness
            // surfaced: a CPU already has content BEFORE anyone subscribes, then
            // a viewer joins (the per-subscriber reseed's exact case). The reseed
            // full-repaint must render the CPU's EXISTING screen, not a blank.
            //
            // The bug: ScreenDiffMapper's reseed baseline used
            // ScreenSnapShot.EmptyScreen, whose fresh rows carry the newest
            // LastChangeTick — so ScreenSnapShot.DiffFrom's tick-skip discarded
            // every already-printed row and the reseed emitted only a clear. The
            // fix (FullRepaintBaseline, an empty-buffer baseline) makes DiffFrom
            // emit the full current content regardless of ticks. This runs the
            // REAL pipeline end-to-end, so a blank reseed would fail the screen
            // equality below.
            var clock = new ManualClock(startUt: 1000);
            var network = new StubNetwork(delay: 0);
            var courier = new Courier(clock, network);
            var topic = KosChannels.TerminalTopic(CoreId);

            // The CPU is ALREADY busy before any subscriber exists.
            var buffer = NewScreen();
            var blankBaseline = new ScreenSnapShot(buffer).DeepCopy();
            buffer.Print("EXISTING LINE A");
            buffer.Print("EXISTING LINE B");
            buffer.Print("EXISTING LINE C");
            var screen = new ScreenBufferTerminal(buffer);

            var manager = new KosTerminalManager(
                knownCoreIds: () => new[] { CoreId },
                isSubscribed: _ => true,
                publish: (_, frame, ut) => courier.Record(Node, topic, frame, ut, Delivery.ReliableOrdered),
                createScreen: _ => screen,
                nowUt: () => clock.Now(),
                pollIntervalSeconds: 0.05);

            // A viewer subscribes AFTER the content already exists; its first
            // poll is the reseed full-repaint (GetOrCreateSession seeds
            // PendingReseed for a fresh session).
            var delivered = new List<KosTerminalFrame>();
            courier.SubscribeStream(Node, topic, Vantage, data =>
            {
                if (data.Payload is KosTerminalFrame frame)
                {
                    delivered.Add(frame);
                }
            });
            manager.Poll(1.0);
            clock.AdvanceTo(clock.Now() + 1);

            Assert.Single(delivered);
            Assert.True(delivered[0].FullRepaint);

            var client = Reconstruct(delivered);
            // The reseed rendered the CPU's existing screen, not a blank.
            Assert.Equal(RenderFinalScreen(buffer, blankBaseline), client.Text);
            Assert.Contains("EXISTING LINE A", client.Text);
            Assert.Contains("EXISTING LINE B", client.Text);
            Assert.Contains("EXISTING LINE C", client.Text);
        }

        [Fact]
        public void ErrorPrint_MultiLineScroll_SubsequentPrintsLandBelowIt()
        {
            // Operator live-test report: "Error prints corrupt subsequent
            // prints, lines appear INSIDE error text; subsequent lines print
            // one line too high." None of the tests above ever scroll the
            // buffer: every burst is short enough to fit under Rows (12), so
            // ScreenSnapShot.DiffFrom's TopRow-delta branch (the num > 0 path
            // that prepends the scroll-up private-use chars ScreenDiffMapper
            // relies on kOS.UserIO.TerminalVT100Mapper to turn into ESC[S) has
            // never actually fired in this harness. A real kOS runtime error
            // prints several lines in ONE synchronous Print() call, with no
            // poll between them, so on a screen that's already mostly full,
            // the whole error forces a multi-row scroll within a SINGLE diff
            // (TopRow jumping by more than 1 between two consecutive MapNext
            // calls), which is exactly the untested shape.
            var buffer = NewScreen();
            var blankBaseline = new ScreenSnapShot(buffer).DeepCopy();
            var screen = new ScreenBufferTerminal(buffer);
            var frames = new List<KosTerminalFrame>();

            void Capture(bool force)
            {
                var result = screen.ReadChunk(force);
                if (result.HasOutput)
                {
                    frames.Add(new KosTerminalFrame
                    {
                        CoreId = CoreId,
                        Chunk = result.Chunk,
                        FullRepaint = result.FullRepaint,
                    });
                }
            }

            Capture(force: true); // blank reseed

            // Fill most of the 12-row screen with ordinary prints, one line
            // per poll (the same shape as the passing Burst_* tests above), so
            // the cursor sits near the bottom before the error hits.
            var preErrorLines = new[]
            {
                "BOOT SEQUENCE COMPLETE", "STAGE 1 IGNITION", "STAGE 1 SEPARATION",
                "STAGE 2 IGNITION", "APOAPSIS 74KM", "PERIAPSIS -12KM",
                "CIRCULARISING", "ORBIT LOCKED", "COAST PHASE",
            };
            foreach (var line in preErrorLines)
            {
                buffer.Print(line);
                Capture(force: false);
            }

            // A kOS runtime error: several lines printed in ONE Print() call,
            // synchronously, before the next poll. On this already-9-lines-deep
            // 12-row screen this forces the buffer to scroll multiple rows
            // within the SINGLE diff captured below.
            var errorLines = new[]
            {
                "Program KOSException:",
                "Cannot use TARGET before it is set.",
                "At line 42",
                "In file boot.ks",
            };
            buffer.Print(string.Join("\n", errorLines));
            Capture(force: false); // the one diff spanning the whole multi-row scroll

            // Normal prints resume after the error, one per poll: the
            // operator's literal complaint is about where THESE land.
            var postErrorLines = new[] { "RECOVERING", "TARGET SET", "RESUMING GUIDANCE" };
            foreach (var line in postErrorLines)
            {
                buffer.Print(line);
                Capture(force: false);
            }

            var truth = RenderFinalScreen(buffer, blankBaseline);
            var client = Reconstruct(frames);

            Assert.Equal(truth, client.Text);
            foreach (var line in postErrorLines)
            {
                Assert.Contains(line, client.Text);
            }
        }

        [Fact]
        public void ErrorPrint_MultiLineScroll_OnRealInterpreterScreen_SubsequentPrintsLandBelowIt()
        {
            // The test above drives a plain kOS.Safe.Screen.ScreenBuffer and
            // PASSES: ScreenSnapShot.DiffFrom's TopRow-delta bookkeeping is, by
            // itself, dimensionally sound for an arbitrary multi-row scroll
            // inside one diff. But a live kOSProcessor's Screen is never a
            // plain ScreenBuffer: kOSProcessor.Start sets
            // `shared.Screen = shared.Interpreter`, and kOS.Screen.Interpreter
            // extends kOS.Safe.Screen.TextEditor (this harness cannot construct
            // kOS.Screen.Interpreter itself, it needs UnityEngine, but
            // TextEditor, the class carrying the behaviour under test, is pure
            // kOS.Safe and constructs fine headlessly). TextEditor overlays a
            // SubBuffer (LineSubBuffer, the live not-yet-submitted input line)
            // that is NOT fixed: its PositionRow is reset to AbsoluteCursorRow
            // on every ScreenBuffer.GetBuffer() call (TextEditor.
            // UpdateSubBuffers), so it tracks the cursor down the screen as a
            // script prints and scrolls. Crucially, moving the overlay does
            // NOT retouch its ScreenBufferLine's LastChangeTick (only actually
            // typing into it does, via UpdateLineSubBuffer's ArrayCopyFrom).
            // So after a multi-line error scroll relocates that overlay to a
            // display row it did not occupy last snapshot, ScreenSnapShot.
            // DiffFrom's tick-skip (kOS.Safe code this mapper cannot touch)
            // can compare the overlay's stale tick against a freshly
            // deep-copied "older" row and wrongly conclude nothing changed at
            // that row, leaving the client showing whatever content is left
            // over there. This is the closest headless equivalent of a live
            // kOS terminal's command-line row, and this is the exact case the
            // operator's live test exercised (a real interpreter CPU with the
            // prompt showing while a script printed a runtime error).
            var buffer = new TextEditor();
            buffer.SetSize(Rows, Cols);
            var blankBaseline = new ScreenSnapShot(buffer).DeepCopy();
            var screen = new ScreenBufferTerminal(buffer);
            var frames = new List<KosTerminalFrame>();

            void Capture(bool force)
            {
                var result = screen.ReadChunk(force);
                if (result.HasOutput)
                {
                    frames.Add(new KosTerminalFrame
                    {
                        CoreId = CoreId,
                        Chunk = result.Chunk,
                        FullRepaint = result.FullRepaint,
                    });
                }
            }

            Capture(force: true); // blank reseed

            var preErrorLines = new[]
            {
                "BOOT SEQUENCE COMPLETE", "STAGE 1 IGNITION", "STAGE 1 SEPARATION",
                "STAGE 2 IGNITION", "APOAPSIS 74KM", "PERIAPSIS -12KM",
                "CIRCULARISING", "ORBIT LOCKED", "COAST PHASE",
            };
            foreach (var line in preErrorLines)
            {
                buffer.Print(line);
                Capture(force: false);
            }

            var errorLines = new[]
            {
                "Program KOSException:",
                "Cannot use TARGET before it is set.",
                "At line 42",
                "In file boot.ks",
            };
            buffer.Print(string.Join("\n", errorLines));
            Capture(force: false); // the one diff spanning the whole multi-row scroll

            var postErrorLines = new[] { "RECOVERING", "TARGET SET", "RESUMING GUIDANCE" };
            foreach (var line in postErrorLines)
            {
                buffer.Print(line);
                Capture(force: false);
            }

            var truth = RenderFinalScreen(buffer, blankBaseline);
            var client = Reconstruct(frames);

            Assert.Equal(truth, client.Text);
            foreach (var line in postErrorLines)
            {
                Assert.Contains(line, client.Text);
            }
        }

        [Fact]
        public void ErrorPrint_WhileOperatorIsTyping_SubsequentPromptTracksCorrectly()
        {
            // The one behavioural path the two tests above structurally cannot
            // exercise: TextEditor.CursorRowShow/CursorColumnShow only diverge
            // from the raw print-cursor (base.CursorRow/CursorColumn) once the
            // operator has actually typed into the not-yet-submitted command
            // line (TextEditor.Type / UpdateLineSubBuffer set cursorRowBuffer /
            // cursorColumnBuffer; both tests above never call Type, so those
            // stayed at their zero default the whole run). A live operator is
            // realistically mid-keystroke, cursor sitting in a partially typed
            // command, at the exact moment a background trigger's runtime
            // error interrupts and PRINTs to the screen: script Print() always
            // targets the raw base.CursorRow (the interpreter's line editor
            // never moves it, only the overlay), so the error text lands
            // exactly where the live input line was displayed. This exercises
            // both the SubBuffer overlay relocation AND the CursorRowShow/
            // CursorColumnShow offset in the same run.
            var buffer = new TextEditor();
            buffer.SetSize(Rows, Cols);
            var blankBaseline = new ScreenSnapShot(buffer).DeepCopy();
            var screen = new ScreenBufferTerminal(buffer);
            var frames = new List<KosTerminalFrame>();

            void Capture(bool force)
            {
                var result = screen.ReadChunk(force);
                if (result.HasOutput)
                {
                    frames.Add(new KosTerminalFrame
                    {
                        CoreId = CoreId,
                        Chunk = result.Chunk,
                        FullRepaint = result.FullRepaint,
                    });
                }
            }

            Capture(force: true); // blank reseed

            var preErrorLines = new[]
            {
                "BOOT SEQUENCE COMPLETE", "STAGE 1 IGNITION", "STAGE 1 SEPARATION",
                "STAGE 2 IGNITION", "APOAPSIS 74KM", "PERIAPSIS -12KM",
                "CIRCULARISING", "ORBIT LOCKED", "COAST PHASE",
            };
            foreach (var line in preErrorLines)
            {
                buffer.Print(line);
                Capture(force: false);
            }

            // The operator starts typing a command but hasn't pressed enter.
            foreach (var ch in "PRINT SHIP:ALT")
            {
                buffer.Type(ch);
            }
            Capture(force: false); // the prompt overlay showing the partial command

            // A background WHEN trigger throws, mid-keystroke. Script Print()
            // targets the raw print cursor, not the line-editor's virtual one.
            var errorLines = new[]
            {
                "Program KOSException:",
                "Cannot use TARGET before it is set.",
                "At line 42",
                "In file boot.ks",
            };
            buffer.Print(string.Join("\n", errorLines));
            Capture(force: false); // the one diff spanning the whole multi-row scroll

            // The operator keeps typing, then submits, then a couple more
            // script prints land (e.g. a recovery handler).
            foreach (var ch in "ITUDE.")
            {
                buffer.Type(ch);
            }
            Capture(force: false);
            buffer.Type('\r'); // submit: NewLine() re-prints "PRINT SHIP:ALTITUDE." via Print()
            Capture(force: false);

            var postErrorLines = new[] { "RECOVERING", "TARGET SET", "RESUMING GUIDANCE" };
            foreach (var line in postErrorLines)
            {
                buffer.Print(line);
                Capture(force: false);
            }

            var truth = RenderFinalScreen(buffer, blankBaseline);
            var client = Reconstruct(frames);

            Assert.Equal(truth, client.Text);
            foreach (var line in postErrorLines)
            {
                Assert.Contains(line, client.Text);
            }
        }

        /// <summary>
        /// Runs the real pipeline under NONZERO signal delay while dropping
        /// exactly one incremental diff in transit — the exact class the
        /// reveal-gate discards on a comms blip / quickload — and returns the
        /// mod's final screen (truth) next to the client's reconstruction.
        /// Parameterised by the periodic-keyframe interval so the pair of tests
        /// below can contrast "keyframes off" (permanent corruption) with
        /// "keyframes on" (self-heals).
        /// </summary>
        private static (string truth, string client) RunWithOneDroppedDiff(double keyframeIntervalSeconds)
        {
            const double delay = 2.0; // nonzero signal delay — the untested path.
            const string droppedLine = "STAGE 1 SEPARATION";
            var clock = new ManualClock(startUt: 1000);
            var network = new StubNetwork(delay: delay);
            var courier = new Courier(clock, network);
            var topic = KosChannels.TerminalTopic(CoreId);

            var buffer = NewScreen();
            var blankBaseline = new ScreenSnapShot(buffer).DeepCopy();
            var screen = new ScreenBufferTerminal(buffer);

            // Model a single lost frame in transit: the client applies every
            // delivered frame EXCEPT the first incremental diff that renders one
            // specific line. A non-idempotent diff lost this way leaves the
            // screen permanently wrong unless a later self-contained frame
            // (a periodic keyframe) repaints it.
            var applied = new List<KosTerminalFrame>();
            var dropped = false;
            courier.SubscribeStream(Node, topic, Vantage, data =>
            {
                if (data.Payload is KosTerminalFrame frame)
                {
                    if (!dropped && !frame.FullRepaint && frame.Chunk.Contains(droppedLine))
                    {
                        dropped = true;
                        return; // lost in transit
                    }
                    applied.Add(frame);
                }
            });

            var manager = new KosTerminalManager(
                knownCoreIds: () => new[] { CoreId },
                isSubscribed: _ => true,
                publish: (_, frame, ut) => courier.Record(Node, topic, frame, ut, Delivery.ReliableOrdered),
                createScreen: _ => screen,
                nowUt: () => clock.Now(),
                pollIntervalSeconds: 0.05,
                keyframeIntervalSeconds: keyframeIntervalSeconds);

            // Viewer subscribes on a blank screen (reseed), then a kerboscript
            // PRINTs the burst, one line per poll, the clock advancing between
            // lines so frames carry distinct ValidAts and keyframes can mature.
            manager.Poll(1.0);
            foreach (var line in BurstLines)
            {
                buffer.Print(line);
                clock.AdvanceTo(clock.Now() + 0.3);
                manager.Poll(1.0);
            }

            // Idle well past the keyframe interval so a periodic full repaint can
            // fire AFTER the dropped diff (when keyframes are enabled).
            for (var i = 0; i < 12; i++)
            {
                clock.AdvanceTo(clock.Now() + 0.3);
                manager.Poll(1.0);
            }

            // Drain every delayed delivery.
            clock.AdvanceTo(clock.Now() + delay + 1);

            Assert.True(dropped, "precondition: exactly one incremental diff carrying the dropped line was lost");
            var client = Reconstruct(applied);
            return (RenderFinalScreen(buffer, blankBaseline), client.Text);
        }

        [Fact]
        public void DroppedDiff_WithoutPeriodicKeyframes_LeavesScreenPermanentlyCorrupted()
        {
            // Negative control (pre-fix behaviour: reseed only on subscribe). A
            // single lost incremental diff under signal delay is never resent,
            // so the client screen is missing that line forever — the exact
            // "the terminals are not the same / not 100% reliable" divergence.
            var (truth, client) = RunWithOneDroppedDiff(keyframeIntervalSeconds: double.PositiveInfinity);
            Assert.NotEqual(truth, client);
            Assert.DoesNotContain("STAGE 1 SEPARATION", client);
        }

        [Fact]
        public void DroppedDiff_HealsAtNextPeriodicKeyframe()
        {
            // The fix: a periodic full repaint after the drop re-syncs the client
            // from a self-contained frame, so the lost line reappears and the
            // reconstructed screen matches the mod's final screen despite the
            // transit loss.
            var (truth, client) = RunWithOneDroppedDiff(keyframeIntervalSeconds: 1.0);
            Assert.Equal(truth, client);
            Assert.Contains("STAGE 1 SEPARATION", client);
        }

        [Fact]
        public void Rewind_RealPipeline_AfterQuickload_TracksTheRewoundClock()
        {
            // A modest F9-quickload case through the REAL ScreenBuffer +
            // ScreenDiffMapper + manager: publish a burst at a high UT, then
            // rewind the clock far back and publish again. Post-reclassify the
            // manager publishes at the raw clock UT (no baseline tracking, no
            // epsilon bump), so a quickload is handled by the manager for free:
            // the post-rewind stamp simply IS the rewound clock read, well
            // below the pre-rewind peak. The Courier's own ResetTimeline (driven
            // separately on a real quickload) drops the abandoned scheduled
            // deliveries; here we assert the manager's published stamps track
            // the clock across the rewind.
            var clock = new ManualClock(startUt: 5000);
            var network = new StubNetwork(delay: 0);
            var courier = new Courier(clock, network);
            var topic = KosChannels.TerminalTopic(CoreId);
            courier.SubscribeStream(Node, topic, Vantage, _ => { });

            var buffer = NewScreen();
            var screen = new ScreenBufferTerminal(buffer);

            var publishedUts = new List<double>();
            var manager = new KosTerminalManager(
                knownCoreIds: () => new[] { CoreId },
                isSubscribed: _ => true,
                publish: (_, frame, ut) =>
                {
                    publishedUts.Add(ut);
                    courier.Record(Node, topic, frame, ut, Delivery.ReliableOrdered);
                },
                createScreen: _ => screen,
                nowUt: () => clock.Now(),
                pollIntervalSeconds: 0.05);

            // Pre-quickload burst at the parked high UT (~5000).
            manager.Poll(1.0);
            foreach (var line in new[] { "ASCENT GUIDANCE ON", "APOAPSIS 74KM", "CIRCULARISING" })
            {
                buffer.Print(line);
                manager.Poll(1.0);
            }
            var prePeak = publishedUts.Max();
            Assert.True(prePeak >= 5000);

            // F9 quickload: the clock jumps far back.
            clock.Reset(200);
            buffer.Print("POST-QUICKLOAD LINE");
            manager.Poll(1.0);

            // The post-rewind stamp is the new, lower clock UT — never a ghost
            // stamp pinned above the stale pre-rewind peak.
            var postStamp = publishedUts.Last();
            Assert.True(postStamp < prePeak,
                $"post-rewind ValidAt {postStamp} must track the rewound clock, below the stale peak {prePeak}");
            Assert.Equal(200.0, postStamp);
        }

        [Fact]
        public void ErrorPrint_WithInputLockToggleAroundScriptRun_SubsequentPrintsLandBelowIt()
        {
            // The closest-to-production shape this headless harness can drive:
            // kOSProcessor.InitObjects sets `shared.Interpreter = new
            // ConnectivityInterpreter(shared); shared.Screen = shared.Interpreter;`
            // unconditionally (decompiled from kOS.dll) -- ConnectivityInterpreter
            // extends Interpreter extends TextEditor, and it cannot be
            // constructed here (needs UnityEngine + a live SharedObjects: CPU,
            // Window, ScriptHandler...). But the ONE behaviour of that stack
            // most plausibly tied to "error corrupts subsequent prints" is
            // input-locking: kOS.Safe.Execution.CPU.PushContext locks input
            // the instant a program starts running (contexts.Count > 1), and
            // PopContext unlocks it the instant that program's context is
            // popped back to just the interpreter (contexts.Count == 1) --
            // including via KOSFixedUpdate's exception-catch cleanup, i.e.
            // exactly the runtime-error path. Locked means TextEditor's
            // LineSubBuffer.Enabled = false, so the live-input-line overlay
            // stops compositing into GetBuffer() entirely for the run's
            // duration, then re-enables the instant the error is caught and
            // the context pops. This test reproduces that exact lock/unlock
            // timing around the error print using InterpreterLikeTextEditor
            // (a thin subclass exposing the same LineSubBuffer.Enabled toggle
            // Interpreter.SetInputLock performs).
            var buffer = new InterpreterLikeTextEditor();
            buffer.SetSize(Rows, Cols);
            var blankBaseline = new ScreenSnapShot(buffer).DeepCopy();
            var screen = new ScreenBufferTerminal(buffer);
            var frames = new List<KosTerminalFrame>();

            void Capture(bool force)
            {
                var result = screen.ReadChunk(force);
                if (result.HasOutput)
                {
                    frames.Add(new KosTerminalFrame
                    {
                        CoreId = CoreId,
                        Chunk = result.Chunk,
                        FullRepaint = result.FullRepaint,
                    });
                }
            }

            Capture(force: true); // blank reseed, interpreter idle (unlocked)

            var preErrorLines = new[]
            {
                "BOOT SEQUENCE COMPLETE", "STAGE 1 IGNITION", "STAGE 1 SEPARATION",
                "STAGE 2 IGNITION", "APOAPSIS 74KM", "PERIAPSIS -12KM",
                "CIRCULARISING", "ORBIT LOCKED", "COAST PHASE",
            };

            // "run boot.ks." submitted: CPU.PushContext locks input for the
            // run's duration (contexts.Count > 1).
            buffer.SetInputLock(true);
            foreach (var line in preErrorLines)
            {
                buffer.Print(line);
                Capture(force: false);
            }

            // The running script throws. KOSFixedUpdate's catch logs the
            // exception (Shared.Screen.Print, the multi-line error text) while
            // STILL locked, then PopFirstContext runs and (contexts.Count==1
            // again) input unlocks -- all synchronous, same tick, before the
            // terminal manager's next poll.
            var errorLines = new[]
            {
                "Program KOSException:",
                "Cannot use TARGET before it is set.",
                "At line 42",
                "In file boot.ks",
            };
            buffer.Print(string.Join("\n", errorLines));
            buffer.SetInputLock(false);
            Capture(force: false); // the one diff spanning the scroll AND the re-enabled overlay

            var postErrorLines = new[] { "RECOVERING", "TARGET SET", "RESUMING GUIDANCE" };
            foreach (var line in postErrorLines)
            {
                buffer.Print(line);
                Capture(force: false);
            }

            var truth = RenderFinalScreen(buffer, blankBaseline);
            var client = Reconstruct(frames);

            Assert.Equal(truth, client.Text);
            foreach (var line in postErrorLines)
            {
                Assert.Contains(line, client.Text);
            }
        }
    }
}
