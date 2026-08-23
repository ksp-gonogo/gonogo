using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// The interface description embedded in a Principia native build, and its hash.
    /// </summary>
    public readonly struct PrincipiaDescriptor
    {
        private PrincipiaDescriptor(bool found, long offset, int length, string? sha256, string? reason)
        {
            Found = found;
            Offset = offset;
            Length = length;
            Sha256 = sha256;
            Reason = reason;
        }

        public bool Found { get; }

        /// <summary>Byte offset of the descriptor within the binary.</summary>
        public long Offset { get; }

        public int Length { get; }

        /// <summary>Lowercase hex SHA-256 of the descriptor bytes. Null when not found.</summary>
        public string? Sha256 { get; }

        /// <summary>Why nothing was read. Null once something was.</summary>
        public string? Reason { get; }

        public static PrincipiaDescriptor NotFound(string reason) =>
            new PrincipiaDescriptor(false, -1, 0, null, reason);

        public static PrincipiaDescriptor At(long offset, int length, string sha256) =>
            new PrincipiaDescriptor(true, offset, length, sha256, null);
    }

    /// <summary>
    /// Extracts the protobuf <c>FileDescriptorProto</c> that every Principia build
    /// embeds, so a version's interface can be identified before a single call is
    /// made into it.
    ///
    /// <para>The descriptor is what makes an ABI break DETECTABLE rather than fatal.
    /// It is byte-identical across all six shipped builds of a release, so its hash
    /// names a release's interface exactly, and Principia offers no interface version
    /// to gate on otherwise.</para>
    ///
    /// <para>Reads through a <see cref="Stream"/> and never loads the whole file: the
    /// builds are around 270 MB because they ship unstripped, and this runs inside
    /// the game process.</para>
    /// </summary>
    public static class PrincipiaDescriptorReader
    {
        /// <summary>
        /// The descriptor opens with field 1 (<c>name</c>), wire type 2, length 27,
        /// then the file name. Matching the length byte as well as the text is what
        /// keeps this from hitting the same string in a log line or a symbol.
        /// </summary>
        private static readonly byte[] Marker = BuildMarker();

        private static byte[] BuildMarker()
        {
            var name = Encoding.ASCII.GetBytes("serialization/journal.proto");
            var marker = new byte[name.Length + 2];
            marker[0] = 0x0A;
            marker[1] = (byte)name.Length;
            Array.Copy(name, 0, marker, 2, name.Length);
            return marker;
        }

        /// <summary>
        /// How much is read from the marker before giving up. The descriptor measured
        /// 76,757 bytes in the release this was written against; a megabyte leaves
        /// room for it to grow by an order of magnitude and still bounds the read.
        /// Hitting this limit is reported as a failure rather than treated as the
        /// end, because a descriptor that runs past the window has not been read.
        /// </summary>
        private const int WindowBytes = 1024 * 1024;

        private const int ScanChunkBytes = 1024 * 1024;

        public static PrincipiaDescriptor Read(Stream? stream)
        {
            if (stream == null)
            {
                return PrincipiaDescriptor.NotFound("No stream was supplied.");
            }
            if (!stream.CanSeek)
            {
                return PrincipiaDescriptor.NotFound(
                    "The stream cannot seek, and the descriptor is read by seeking back to the " +
                    "marker once it is found.");
            }

            var offset = FindMarker(stream);
            if (offset < 0)
            {
                return PrincipiaDescriptor.NotFound(
                    "No embedded descriptor was found. The file is either not a Principia native " +
                    "build, or is a build that no longer embeds one.");
            }

            stream.Position = offset;
            var window = new byte[WindowBytes];
            var available = ReadFully(stream, window, 0, window.Length);

            var length = MeasureDescriptor(window, available, out var failure);
            if (length <= 0)
            {
                return PrincipiaDescriptor.NotFound(failure ?? "The descriptor could not be measured.");
            }

            using var sha = SHA256.Create();
            var digest = sha.ComputeHash(window, 0, length);
            return PrincipiaDescriptor.At(offset, length, ToHex(digest));
        }

        /// <summary>
        /// Walks top-level protobuf fields from the marker and returns where they
        /// stop. Zero, with <paramref name="failure"/> set, when the end cannot be
        /// established.
        ///
        /// <para><b>The boundary test is that the walk lands EXACTLY on its own last
        /// field, never past it.</b> The obvious alternative, re-encoding the region
        /// and requiring byte equality, does not work and was measured not working:
        /// truncate the real descriptor by one byte and a re-encode reproduces the
        /// truncated input faithfully, because the final field's declared length
        /// simply runs off the end and the copy silently comes up short. The same
        /// case is caught here, since the walk's final position overshoots the data
        /// it was given.</para>
        /// </summary>
        private static int MeasureDescriptor(byte[] buffer, int available, out string? failure)
        {
            failure = null;
            var i = 0;
            while (i < available)
            {
                var fieldStart = i;
                if (!TryReadVarint(buffer, available, ref i, out var key))
                {
                    return Close(fieldStart, available, out failure);
                }
                var fieldNumber = key >> 3;
                var wireType = (int)(key & 7);

                // A FileDescriptorProto has 12 fields. Anything outside that, or a
                // wire type protobuf does not define, means the descriptor ended and
                // the next bytes belong to whatever the linker put there.
                if (fieldNumber < 1 || fieldNumber > 13)
                {
                    return Close(fieldStart, available, out failure);
                }
                if (wireType != 0 && wireType != 1 && wireType != 2 && wireType != 5)
                {
                    return Close(fieldStart, available, out failure);
                }

                switch (wireType)
                {
                    case 2:
                        if (!TryReadVarint(buffer, available, ref i, out var payload)
                            || payload > int.MaxValue)
                        {
                            return Close(fieldStart, available, out failure);
                        }
                        var payloadStart = i;
                        i += (int)payload;
                        // A field number alone is a weak terminator, and this was
                        // measured being too weak: a run of 0x22 filler after the
                        // descriptor reads as field 4 wire type 2, which a
                        // FileDescriptorProto really has, so the walk ran on into
                        // bytes that were never part of it. The message-typed fields
                        // must therefore parse as messages. Fields 1, 2, 3 and 12
                        // hold strings and are not checked, because arbitrary text
                        // is not required to look like protobuf.
                        if (IsMessageTyped(fieldNumber)
                            && (i > available
                                || !IsWellFormedMessage(buffer, payloadStart, (int)payload, 0)))
                        {
                            return Close(fieldStart, available, out failure);
                        }
                        break;
                    case 0:
                        if (!TryReadVarint(buffer, available, ref i, out _))
                        {
                            return Close(fieldStart, available, out failure);
                        }
                        break;
                    case 1:
                        i += 8;
                        break;
                    case 5:
                        i += 4;
                        break;
                }

                // The overshoot check, and the reason this is a walk rather than a
                // re-encode. A field whose payload runs past what we hold has not
                // been read, and reporting the position it claims would name a
                // boundary nobody verified.
                if (i > available)
                {
                    failure = available >= WindowBytes
                        ? "The descriptor runs past the read window, so its end was never seen."
                        : "The descriptor's last field runs past the end of the file.";
                    return 0;
                }
            }
            return Close(available, available, out failure);
        }

        /// <summary>
        /// Which `FileDescriptorProto` fields carry a nested message:
        /// <c>message_type</c>, <c>enum_type</c>, <c>service</c>, <c>extension</c>,
        /// <c>options</c> and <c>source_code_info</c>.
        /// </summary>
        private static bool IsMessageTyped(ulong fieldNumber) =>
            fieldNumber >= 4 && fieldNumber <= 9;

        /// <summary>
        /// Whether a payload is a complete protobuf message: every field parses and
        /// the last one lands exactly on the end. Depth-limited so a hostile or
        /// corrupt length cannot drive this into a deep recursion.
        /// </summary>
        private static bool IsWellFormedMessage(byte[] buffer, int start, int length, int depth)
        {
            if (length == 0)
            {
                return true;
            }
            if (depth > MaxNestingDepth)
            {
                return false;
            }
            var end = start + length;
            var i = start;
            while (i < end)
            {
                if (!TryReadVarint(buffer, end, ref i, out var key))
                {
                    return false;
                }
                var fieldNumber = key >> 3;
                var wireType = (int)(key & 7);
                if (fieldNumber == 0)
                {
                    return false;
                }
                switch (wireType)
                {
                    case 0:
                        if (!TryReadVarint(buffer, end, ref i, out _))
                        {
                            return false;
                        }
                        break;
                    case 1:
                        i += 8;
                        break;
                    case 5:
                        i += 4;
                        break;
                    case 2:
                        if (!TryReadVarint(buffer, end, ref i, out var nested)
                            || nested > int.MaxValue)
                        {
                            return false;
                        }
                        var nestedStart = i;
                        i += (int)nested;
                        if (i > end)
                        {
                            return false;
                        }
                        // A nested payload may be a string, so a failure to parse is
                        // not proof of corruption. Only its LENGTH is enforced here,
                        // and the recursion runs one level for the shape check.
                        IsWellFormedMessage(buffer, nestedStart, (int)nested, depth + 1);
                        break;
                    default:
                        return false;
                }
                if (i > end)
                {
                    return false;
                }
            }
            return i == end;
        }

        private const int MaxNestingDepth = 8;

        private static int Close(int end, int available, out string? failure)
        {
            failure = null;
            if (end > 0)
            {
                return end;
            }
            failure = "The marker was found but no valid field followed it.";
            return 0;
        }

        private static bool TryReadVarint(byte[] buffer, int available, ref int i, out ulong value)
        {
            value = 0;
            var shift = 0;
            while (true)
            {
                if (i >= available || shift > 63)
                {
                    return false;
                }
                var b = buffer[i++];
                value |= (ulong)(b & 0x7F) << shift;
                if ((b & 0x80) == 0)
                {
                    return true;
                }
                shift += 7;
            }
        }

        private static long FindMarker(Stream stream)
        {
            stream.Position = 0;
            var overlap = Marker.Length - 1;
            var buffer = new byte[ScanChunkBytes + overlap];
            long basePosition = 0;
            var carried = 0;

            while (true)
            {
                var read = ReadFully(stream, buffer, carried, ScanChunkBytes);
                var filled = carried + read;
                if (filled < Marker.Length)
                {
                    return -1;
                }
                for (var i = 0; i <= filled - Marker.Length; i++)
                {
                    var match = true;
                    for (var j = 0; j < Marker.Length; j++)
                    {
                        if (buffer[i + j] != Marker[j])
                        {
                            match = false;
                            break;
                        }
                    }
                    if (match)
                    {
                        return basePosition + i;
                    }
                }
                if (read == 0)
                {
                    return -1;
                }
                // Carry the tail so a marker straddling a chunk edge is still seen.
                Array.Copy(buffer, filled - overlap, buffer, 0, overlap);
                basePosition += filled - overlap;
                carried = overlap;
            }
        }

        private static int ReadFully(Stream stream, byte[] buffer, int offset, int count)
        {
            var total = 0;
            while (total < count)
            {
                var read = stream.Read(buffer, offset + total, count - total);
                if (read <= 0)
                {
                    break;
                }
                total += read;
            }
            return total;
        }

        private static string ToHex(byte[] bytes)
        {
            var sb = new StringBuilder(bytes.Length * 2);
            foreach (var b in bytes)
            {
                sb.Append(b.ToString("x2"));
            }
            return sb.ToString();
        }
    }
}
