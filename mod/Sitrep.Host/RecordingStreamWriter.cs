using System;
using System.Collections.Concurrent;
using System.IO;
using System.Text;
using System.Threading;

namespace Sitrep.Host
{
    /// <summary>
    /// Appends recorded entries to a line-delimited session file on its own thread.
    /// <see cref="Enqueue"/> only queues, so a frame never waits on serialisation or the disk,
    /// and each drain serialises and writes just the entries queued since the last one, so
    /// what a flush costs does not depend on how much is already in the file.
    /// </summary>
    internal sealed class RecordingStreamWriter : IDisposable
    {
        private static readonly UTF8Encoding Utf8NoBom = new UTF8Encoding(false);

        private readonly ConcurrentQueue<RecordedEntry> _queue = new ConcurrentQueue<RecordedEntry>();
        private readonly object _drainLock = new object();
        private readonly StreamWriter _writer;
        private readonly Thread _thread;
        private readonly AutoResetEvent _wake = new AutoResetEvent(false);
        private readonly TimeSpan _interval;
        private volatile bool _stopping;
        private long _bytesWritten;
        private long _entriesWritten;
        private int _lastDrainCount;

        public RecordingStreamWriter(string path, int schemaVersion, double startUt, TimeSpan interval)
        {
            _interval = interval;
            _writer = new StreamWriter(new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.Read), Utf8NoBom)
            {
                NewLine = "\n",
            };
            WriteLine(RecordedSessionCodec.WriteHeaderLine(schemaVersion, startUt));
            _writer.Flush();

            _thread = new Thread(Run) { IsBackground = true, Name = "Gonogo recording writer" };
            _thread.Start();
        }

        /// <summary>Bytes appended to the file so far, header included.</summary>
        public long BytesWritten => Interlocked.Read(ref _bytesWritten);

        public long EntriesWritten => Interlocked.Read(ref _entriesWritten);

        /// <summary>How many entries the most recent <see cref="Drain"/> serialised.</summary>
        public int LastDrainCount => _lastDrainCount;

        public void Enqueue(RecordedEntry entry)
        {
            _queue.Enqueue(entry);
        }

        /// <summary>Serialises and appends every queued entry, then flushes the file.</summary>
        public void Drain()
        {
            lock (_drainLock)
            {
                var count = 0;
                while (_queue.TryDequeue(out var entry))
                {
                    WriteLine(RecordedSessionCodec.WriteEntryLine(entry));
                    count++;
                }
                _lastDrainCount = count;
                Interlocked.Add(ref _entriesWritten, count);
                if (count > 0)
                {
                    _writer.Flush();
                }
            }
        }

        private void WriteLine(string line)
        {
            _writer.Write(line);
            _writer.Write('\n');
            Interlocked.Add(ref _bytesWritten, Utf8NoBom.GetByteCount(line) + 1);
        }

        private void Run()
        {
            while (!_stopping)
            {
                _wake.WaitOne(_interval);
                if (_stopping)
                {
                    break;
                }
                try
                {
                    Drain();
                }
                catch (IOException)
                {
                    // A full disk or a locked file loses this interval's entries, not the game's frame.
                }
            }
        }

        /// <summary>Stops the thread, writes whatever is still queued and closes the file.</summary>
        public void Dispose()
        {
            if (_stopping)
            {
                return;
            }
            _stopping = true;
            _wake.Set();
            _thread.Join();
            try
            {
                Drain();
            }
            finally
            {
                _writer.Dispose();
                _wake.Dispose();
            }
        }
    }
}
