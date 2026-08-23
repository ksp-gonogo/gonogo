using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// The container format of a native module, as its own first bytes declare it.
    /// </summary>
    public enum NativeBinaryFormat
    {
        /// <summary>No known magic. The refusing answer.</summary>
        Unknown = 0,

        /// <summary>ELF, what Principia's Linux build is.</summary>
        Elf = 1,

        /// <summary>PE/COFF, what Principia's Windows build is.</summary>
        Pe = 2,

        /// <summary>
        /// Mach-O, what Principia's macOS build is despite being named
        /// <c>principia.so</c>.
        /// </summary>
        MachO = 3,
    }

    /// <summary>
    /// The exported names read out of one native module, or a refusal saying why
    /// none were.
    /// </summary>
    public readonly struct NativeExports
    {
        private static readonly HashSet<string> Nothing = new HashSet<string>(StringComparer.Ordinal);

        private readonly HashSet<string>? _names;

        private NativeExports(NativeBinaryFormat format, HashSet<string>? names, string? reason)
        {
            Format = format;
            _names = names;
            Reason = reason;
        }

        /// <summary>What the file's magic said it was, set even when the read failed.</summary>
        public NativeBinaryFormat Format { get; }

        /// <summary>Why nothing was read. Null once something was.</summary>
        public string? Reason { get; }

        public bool Found => Reason == null;

        /// <summary>
        /// Every exported name, spelled as a C caller writes it. Mach-O's leading
        /// underscore is not part of the name and is gone by the time it lands here.
        /// </summary>
        public IReadOnlyCollection<string> Names => _names ?? Nothing;

        public int Count => (_names ?? Nothing).Count;

        public bool Contains(string? name) =>
            name != null && (_names ?? Nothing).Contains(name);

        internal static NativeExports Refused(NativeBinaryFormat format, string reason) =>
            new NativeExports(format, null, reason);

        internal static NativeExports Of(NativeBinaryFormat format, HashSet<string> names) =>
            new NativeExports(format, names, null);
    }

    /// <summary>
    /// Reads the exported function names out of a native module without loading it.
    ///
    /// <para>The point of not loading it is that this can run before a single call
    /// is made, on a player's machine, against a build nobody here has seen. A
    /// <c>dlopen</c> to ask the same question runs the module's initialisers, and
    /// Principia's native surface aborts the KSP process on a call it does not
    /// like, so the check would be the thing that breaks the game it was meant to
    /// protect.</para>
    ///
    /// <para>Three formats, because Principia ships three: ELF's <c>.dynsym</c>,
    /// PE's export directory, and Mach-O's <c>LC_SYMTAB</c>. Which one a file is
    /// comes from its own first bytes, never its name: Principia's macOS build is
    /// called <c>principia.so</c> and is a Mach-O, so an extension-led guess reads
    /// it as an ELF and fails.</para>
    ///
    /// <para>Reads through a <see cref="Stream"/> in bounded windows. The Linux
    /// builds are around 270 MB because they ship unstripped, and this runs inside
    /// the game process.</para>
    /// </summary>
    public static class NativeExportReader
    {
        /// <summary>
        /// Sliding window over a string table, in bytes. Symbol name tables run to
        /// 13 MB in the shipped macOS build, so they are read in pieces; the pieces
        /// are large enough that lookups sorted by offset mostly hit the one already
        /// held.
        /// </summary>
        private const int StringWindowBytes = 256 * 1024;

        /// <summary>How many symbol table entries are read per stream read.</summary>
        private const int SymbolChunk = 4096;

        /// <summary>
        /// A ceiling on the declared entry counts, so a corrupt or hostile header
        /// cannot make this allocate against a number it never checked. The shipped
        /// builds' largest table is 193,734 entries.
        /// </summary>
        private const int MaxSymbols = 8_000_000;

        private const int MaxSections = 65_536;

        public static NativeExports Read(Stream? stream)
        {
            if (stream == null)
            {
                return NativeExports.Refused(
                    NativeBinaryFormat.Unknown, "No stream was supplied.");
            }
            if (!stream.CanSeek)
            {
                return NativeExports.Refused(
                    NativeBinaryFormat.Unknown,
                    "The stream cannot seek, and every one of these formats stores its symbol "
                        + "table at an offset named in a header near the front.");
            }

            var magic = new byte[4];
            stream.Position = 0;
            if (ReadFully(stream, magic, 0, 4) < 4)
            {
                return NativeExports.Refused(
                    NativeBinaryFormat.Unknown, "The file is too short to carry a format magic.");
            }

            var format = DetectFormat(magic);
            switch (format)
            {
                case NativeBinaryFormat.Elf:
                    return ReadElf(stream);
                case NativeBinaryFormat.Pe:
                    return ReadPe(stream);
                case NativeBinaryFormat.MachO:
                    return ReadMachO(stream, magic);
                default:
                    return NativeExports.Refused(
                        NativeBinaryFormat.Unknown,
                        "The first bytes match no native module format this reads: ELF, PE/COFF "
                            + "and Mach-O.");
            }
        }

        /// <summary>
        /// The format a file declares itself to be. Nothing here consults a file
        /// name, and Principia's macOS build is why: it is a Mach-O called
        /// <c>principia.so</c>.
        /// </summary>
        private static NativeBinaryFormat DetectFormat(byte[] magic)
        {
            if (magic[0] == 0x7F && magic[1] == 'E' && magic[2] == 'L' && magic[3] == 'F')
            {
                return NativeBinaryFormat.Elf;
            }
            if (magic[0] == 'M' && magic[1] == 'Z')
            {
                return NativeBinaryFormat.Pe;
            }
            var word = U32(magic, 0);
            switch (word)
            {
                // 64- and 32-bit Mach-O, each in the two byte orders, plus the two
                // universal-binary wrappers. Only the first is read; the rest are
                // recognised so they refuse by name instead of falling through to
                // "no known magic".
                case 0xFEEDFACF:
                case 0xFEEDFACE:
                case 0xCFFAEDFE:
                case 0xCEFAEDFE:
                case 0xCAFEBABE:
                case 0xBEBAFECA:
                    return NativeBinaryFormat.MachO;
                default:
                    return NativeBinaryFormat.Unknown;
            }
        }

        /// <summary>
        /// Reads <c>.dynsym</c>, found through the section header table and paired
        /// with the string table its <c>sh_link</c> names.
        ///
        /// <para>A symbol counts as exported when it is defined here (its
        /// <c>st_shndx</c> is not <c>SHN_UNDEF</c>, which is what an import looks
        /// like) and its binding is global or weak.</para>
        /// </summary>
        private static NativeExports ReadElf(Stream stream)
        {
            const NativeBinaryFormat format = NativeBinaryFormat.Elf;
            var header = new byte[64];
            stream.Position = 0;
            if (ReadFully(stream, header, 0, header.Length) < header.Length)
            {
                return NativeExports.Refused(format, "The file is too short to hold an ELF header.");
            }
            if (header[4] != 2)
            {
                return NativeExports.Refused(
                    format,
                    "Only 64-bit ELF is read, and this file declares class " + header[4] + ".");
            }
            if (header[5] != 1)
            {
                return NativeExports.Refused(
                    format,
                    "Only little-endian ELF is read, and this file declares byte order "
                        + header[5] + ".");
            }

            var sectionTableOffset = (long)U64(header, 0x28);
            int sectionSize = U16(header, 0x3A);
            long sectionCount = U16(header, 0x3C);
            if (sectionTableOffset <= 0)
            {
                return NativeExports.Refused(
                    format,
                    "The file has no section header table, so .dynsym cannot be located.");
            }
            if (sectionSize < 64)
            {
                return NativeExports.Refused(
                    format,
                    "The section headers are " + sectionSize + " bytes each, and a 64-bit ELF "
                        + "section header is 64.");
            }

            if (sectionCount == 0)
            {
                // A count of zero means the real one did not fit the 16-bit field
                // and lives in the reserved first section's sh_size.
                var first = new byte[sectionSize];
                stream.Position = sectionTableOffset;
                if (ReadFully(stream, first, 0, sectionSize) < sectionSize)
                {
                    return NativeExports.Refused(
                        format, "The section header table runs past the end of the file.");
                }
                sectionCount = (long)U64(first, 32);
            }
            if (sectionCount <= 0 || sectionCount > MaxSections)
            {
                return NativeExports.Refused(
                    format, "The file declares " + sectionCount + " sections, which is not credible.");
            }

            var sections = new byte[(int)sectionCount * sectionSize];
            stream.Position = sectionTableOffset;
            if (ReadFully(stream, sections, 0, sections.Length) < sections.Length)
            {
                return NativeExports.Refused(
                    format, "The section header table runs past the end of the file.");
            }

            const uint ShtDynsym = 11;
            long symbolOffset = -1;
            long symbolBytes = 0;
            long entrySize = 24;
            var stringSection = -1;
            for (var i = 0; i < sectionCount; i++)
            {
                var at = i * sectionSize;
                if (U32(sections, at + 4) != ShtDynsym)
                {
                    continue;
                }
                symbolOffset = (long)U64(sections, at + 24);
                symbolBytes = (long)U64(sections, at + 32);
                stringSection = (int)U32(sections, at + 40);
                var declared = (long)U64(sections, at + 56);
                if (declared != 0)
                {
                    entrySize = declared;
                }
                break;
            }

            if (symbolOffset < 0)
            {
                return NativeExports.Refused(
                    format,
                    "The file has no .dynsym section, so it exports nothing that can be bound at "
                        + "load time.");
            }
            if (entrySize != 24)
            {
                return NativeExports.Refused(
                    format,
                    ".dynsym declares " + entrySize + "-byte entries, and a 64-bit ELF symbol is 24.");
            }
            if (stringSection <= 0 || stringSection >= sectionCount)
            {
                return NativeExports.Refused(
                    format, ".dynsym names section " + stringSection + " as its string table, "
                        + "which does not exist.");
            }

            var stringAt = stringSection * sectionSize;
            var strings = new StringWindow(
                stream,
                (long)U64(sections, stringAt + 24),
                (long)U64(sections, stringAt + 32));

            var count = symbolBytes / entrySize;
            if (count > MaxSymbols)
            {
                return NativeExports.Refused(
                    format, ".dynsym declares " + count + " symbols, which is not credible.");
            }

            var offsets = new List<long>();
            var buffer = new byte[SymbolChunk * 24];
            stream.Position = symbolOffset;
            for (long done = 0; done < count;)
            {
                var wanted = (int)Math.Min(SymbolChunk, count - done) * 24;
                var got = ReadFully(stream, buffer, 0, wanted);
                if (got < wanted)
                {
                    return NativeExports.Refused(
                        format, ".dynsym runs past the end of the file.");
                }
                for (var i = 0; i + 24 <= got; i += 24)
                {
                    var name = U32(buffer, i);
                    var info = buffer[i + 4];
                    var other = buffer[i + 5];
                    var section = U16(buffer, i + 6);
                    var binding = info >> 4;
                    var visibility = other & 3;
                    // SHN_UNDEF is an import, and local binding or hidden
                    // visibility is a symbol the dynamic linker will not hand out.
                    if (name != 0
                        && section != 0
                        && (binding == 1 || binding == 2 || binding == 10)
                        && (visibility == 0 || visibility == 3))
                    {
                        offsets.Add(name);
                    }
                }
                done += got / 24;
            }

            return Collect(format, offsets, strings, null);
        }

        /// <summary>
        /// Reads the export directory named by the first data directory entry,
        /// walking <c>AddressOfNames</c>. Every address in a PE is relative to the
        /// image base, so each one is put back through the section table to find the
        /// byte in the file.
        /// </summary>
        private static NativeExports ReadPe(Stream stream)
        {
            const NativeBinaryFormat format = NativeBinaryFormat.Pe;
            var dos = new byte[64];
            stream.Position = 0;
            if (ReadFully(stream, dos, 0, dos.Length) < dos.Length)
            {
                return NativeExports.Refused(format, "The file is too short to hold a DOS header.");
            }

            long peOffset = U32(dos, 0x3C);
            var coff = new byte[24];
            stream.Position = peOffset;
            if (ReadFully(stream, coff, 0, coff.Length) < coff.Length)
            {
                return NativeExports.Refused(
                    format, "The DOS header points past the end of the file.");
            }
            if (coff[0] != 'P' || coff[1] != 'E' || coff[2] != 0 || coff[3] != 0)
            {
                return NativeExports.Refused(
                    format,
                    "The DOS header does not lead to a PE signature, so this is a DOS executable "
                        + "rather than a Windows module.");
            }

            int sectionCount = U16(coff, 4 + 2);
            int optionalSize = U16(coff, 4 + 16);
            if (optionalSize < 96)
            {
                return NativeExports.Refused(
                    format,
                    "The optional header is " + optionalSize + " bytes, too small to carry a data "
                        + "directory.");
            }
            if (sectionCount <= 0 || sectionCount > MaxSections)
            {
                return NativeExports.Refused(
                    format, "The file declares " + sectionCount + " sections, which is not credible.");
            }

            var optional = new byte[optionalSize];
            var optionalOffset = peOffset + 24;
            stream.Position = optionalOffset;
            if (ReadFully(stream, optional, 0, optionalSize) < optionalSize)
            {
                return NativeExports.Refused(
                    format, "The optional header runs past the end of the file.");
            }

            var magic = U16(optional, 0);
            int directoryAt;
            if (magic == 0x20B)
            {
                directoryAt = 112;
            }
            else if (magic == 0x10B)
            {
                directoryAt = 96;
            }
            else
            {
                return NativeExports.Refused(
                    format,
                    "The optional header's magic is 0x" + magic.ToString("X")
                        + ", which is neither PE32 nor PE32+.");
            }
            if (directoryAt + 8 > optionalSize)
            {
                return NativeExports.Refused(
                    format, "The optional header stops before the export data directory.");
            }

            var exportRva = U32(optional, directoryAt);
            var exportSize = U32(optional, directoryAt + 4);
            if (exportRva == 0 || exportSize == 0)
            {
                return NativeExports.Refused(
                    format, "The module has no export directory, so it exports nothing by name.");
            }

            var sections = new byte[sectionCount * 40];
            stream.Position = optionalOffset + optionalSize;
            if (ReadFully(stream, sections, 0, sections.Length) < sections.Length)
            {
                return NativeExports.Refused(
                    format, "The section table runs past the end of the file.");
            }

            var exportOffset = RvaToOffset(sections, sectionCount, exportRva);
            if (exportOffset < 0)
            {
                return NativeExports.Refused(
                    format,
                    "The export directory sits at an address no section covers, so the file is "
                        + "truncated or its section table is wrong.");
            }

            var directory = new byte[40];
            stream.Position = exportOffset;
            if (ReadFully(stream, directory, 0, directory.Length) < directory.Length)
            {
                return NativeExports.Refused(
                    format, "The export directory runs past the end of the file.");
            }

            var nameCount = U32(directory, 24);
            var nameTableRva = U32(directory, 32);
            if (nameCount == 0 || nameTableRva == 0)
            {
                return NativeExports.Refused(
                    format,
                    "The export directory lists no names, so everything it exports is by ordinal "
                        + "only and cannot be bound by name.");
            }
            if (nameCount > MaxSymbols)
            {
                return NativeExports.Refused(
                    format, "The export directory declares " + nameCount + " names, which is not "
                        + "credible.");
            }

            var nameTableOffset = RvaToOffset(sections, sectionCount, nameTableRva);
            if (nameTableOffset < 0)
            {
                return NativeExports.Refused(
                    format, "The export name table sits at an address no section covers.");
            }

            var rvas = new byte[(int)nameCount * 4];
            stream.Position = nameTableOffset;
            if (ReadFully(stream, rvas, 0, rvas.Length) < rvas.Length)
            {
                return NativeExports.Refused(
                    format, "The export name table runs past the end of the file.");
            }

            var offsets = new List<long>((int)nameCount);
            for (var i = 0; i < nameCount; i++)
            {
                var offset = RvaToOffset(sections, sectionCount, U32(rvas, i * 4));
                if (offset >= 0)
                {
                    offsets.Add(offset);
                }
            }

            // The name strings live wherever the linker put them, so the window is
            // over the whole file rather than one table.
            var strings = new StringWindow(stream, 0, stream.Length);
            return Collect(format, offsets, strings, null);
        }

        private static long RvaToOffset(byte[] sections, int sectionCount, uint rva)
        {
            for (var i = 0; i < sectionCount; i++)
            {
                var at = i * 40;
                var virtualSize = U32(sections, at + 8);
                var virtualAddress = U32(sections, at + 12);
                var rawSize = U32(sections, at + 16);
                var rawOffset = U32(sections, at + 20);
                // A section's in-memory size and its on-disk size differ in both
                // directions: it is padded up to a file alignment, and it is padded
                // out with zeroed pages that have no bytes at all. The larger of the
                // two is the range an address can legitimately fall in.
                var span = Math.Max(virtualSize, rawSize);
                if (rva >= virtualAddress && rva < virtualAddress + span)
                {
                    var delta = rva - virtualAddress;
                    if (delta >= rawSize)
                    {
                        return -1;
                    }
                    return (long)rawOffset + delta;
                }
            }
            return -1;
        }

        /// <summary>
        /// Reads <c>LC_SYMTAB</c>, the only symbol table a Mach-O keeps in a plain
        /// array. A symbol counts as exported when it is external and defined,
        /// which rules out the imports and the debug entries sharing the table.
        ///
        /// <para><b>Every name here carries a leading underscore that is not part of
        /// it.</b> The Mach-O C ABI prefixes one, so the export a caller writes as
        /// <c>principia__FlightPlanInsert</c> is stored as
        /// <c>_principia__FlightPlanInsert</c>. Leaving it on makes every name miss,
        /// and a reader that then counts the ones it wanted reports zero, which is
        /// indistinguishable from a module that exports nothing.</para>
        /// </summary>
        private static NativeExports ReadMachO(Stream stream, byte[] magic)
        {
            const NativeBinaryFormat format = NativeBinaryFormat.MachO;
            var word = U32(magic, 0);
            if (word == 0xCAFEBABE || word == 0xBEBAFECA)
            {
                return NativeExports.Refused(
                    format,
                    "This is a universal binary wrapping several architectures, and only a single "
                        + "architecture Mach-O is read.");
            }
            if (word == 0xCFFAEDFE || word == 0xCEFAEDFE)
            {
                return NativeExports.Refused(
                    format,
                    "This Mach-O is big-endian, and only little-endian ones are read.");
            }
            if (word == 0xFEEDFACE)
            {
                return NativeExports.Refused(
                    format, "This Mach-O is 32-bit, and only 64-bit ones are read.");
            }

            var header = new byte[32];
            stream.Position = 0;
            if (ReadFully(stream, header, 0, header.Length) < header.Length)
            {
                return NativeExports.Refused(format, "The file is too short to hold a Mach-O header.");
            }

            var commandCount = U32(header, 16);
            var commandBytes = U32(header, 20);
            if (commandCount == 0 || commandBytes == 0 || commandBytes > 64 * 1024 * 1024)
            {
                return NativeExports.Refused(
                    format,
                    "The header declares " + commandCount + " load commands over " + commandBytes
                        + " bytes, which is not credible.");
            }

            var commands = new byte[commandBytes];
            stream.Position = 32;
            if (ReadFully(stream, commands, 0, commands.Length) < commands.Length)
            {
                return NativeExports.Refused(
                    format, "The load commands run past the end of the file.");
            }

            const uint LcSymtab = 0x2;
            long symbolOffset = -1;
            long count = 0;
            long stringOffset = 0;
            long stringBytes = 0;
            var at = 0;
            for (var i = 0; i < commandCount && at + 8 <= commands.Length; i++)
            {
                var kind = U32(commands, at);
                var size = (int)U32(commands, at + 4);
                if (size < 8 || at + size > commands.Length)
                {
                    break;
                }
                if (kind == LcSymtab && size >= 24)
                {
                    symbolOffset = U32(commands, at + 8);
                    count = U32(commands, at + 12);
                    stringOffset = U32(commands, at + 16);
                    stringBytes = U32(commands, at + 20);
                    break;
                }
                at += size;
            }

            if (symbolOffset < 0)
            {
                return NativeExports.Refused(
                    format,
                    "The file carries no LC_SYMTAB load command, so it has been stripped of the "
                        + "symbol table this reads.");
            }
            if (count > MaxSymbols)
            {
                return NativeExports.Refused(
                    format, "LC_SYMTAB declares " + count + " symbols, which is not credible.");
            }

            var strings = new StringWindow(stream, stringOffset, stringBytes);
            var offsets = new List<long>();
            var buffer = new byte[SymbolChunk * 16];
            stream.Position = symbolOffset;
            for (long done = 0; done < count;)
            {
                var wanted = (int)Math.Min(SymbolChunk, count - done) * 16;
                var got = ReadFully(stream, buffer, 0, wanted);
                if (got < wanted)
                {
                    return NativeExports.Refused(
                        format, "LC_SYMTAB runs past the end of the file.");
                }
                for (var i = 0; i + 16 <= got; i += 16)
                {
                    var name = U32(buffer, i);
                    var type = buffer[i + 4];
                    // The debug entries share this table and are marked by any bit
                    // of N_STAB; N_EXT is what makes a symbol visible outside; and a
                    // type of N_UNDF or N_PBUD is something the module imports
                    // rather than provides.
                    var kind = type & 0x0E;
                    if (name != 0
                        && (type & 0xE0) == 0
                        && (type & 0x01) != 0
                        && (kind == 0x0E || kind == 0x02 || kind == 0x0A))
                    {
                        offsets.Add(name);
                    }
                }
                done += got / 16;
            }

            return Collect(format, offsets, strings, "_");
        }

        /// <summary>
        /// Turns string-table offsets into the name set, reading them in ascending
        /// order so the window mostly holds the next one already.
        /// <paramref name="strip"/> is the platform's own symbol prefix, dropped
        /// once when present so a name means the same thing on every platform.
        /// </summary>
        private static NativeExports Collect(
            NativeBinaryFormat format,
            List<long> offsets,
            StringWindow strings,
            string? strip)
        {
            offsets.Sort();
            var names = new HashSet<string>(StringComparer.Ordinal);
            long previous = -1;
            foreach (var offset in offsets)
            {
                if (offset == previous)
                {
                    continue;
                }
                previous = offset;
                var name = strings.Read(offset);
                if (string.IsNullOrEmpty(name))
                {
                    continue;
                }
                if (strip != null && name!.Length > strip.Length && name.StartsWith(strip, StringComparison.Ordinal))
                {
                    name = name.Substring(strip.Length);
                }
                names.Add(name!);
            }

            if (names.Count == 0)
            {
                // Reported as a refusal rather than an empty success on purpose. A
                // module exporting literally nothing and a parser that read the
                // wrong bytes produce the same empty set, and the caller cannot tell
                // them apart from a count, so the count is not offered as an answer.
                return NativeExports.Refused(
                    format,
                    "The symbol table was located but held no exported names, which means either "
                        + "the module exports nothing or it was not read correctly.");
            }
            return NativeExports.Of(format, names);
        }

        /// <summary>
        /// Reads NUL-terminated strings out of a region of the file through a
        /// bounded window, so a 13 MB name table is never held whole.
        /// </summary>
        private sealed class StringWindow
        {
            private readonly Stream _stream;
            private readonly long _start;
            private readonly long _length;
            private readonly byte[] _buffer = new byte[StringWindowBytes];
            private long _windowStart = -1;
            private int _windowLength;

            public StringWindow(Stream stream, long start, long length)
            {
                _stream = stream;
                _start = start;
                _length = length;
            }

            public string? Read(long offsetInTable)
            {
                if (offsetInTable < 0 || offsetInTable >= _length)
                {
                    return null;
                }
                var absolute = _start + offsetInTable;
                if (_windowStart < 0 || absolute < _windowStart || absolute >= _windowStart + _windowLength)
                {
                    Fill(absolute);
                }

                var from = (int)(absolute - _windowStart);
                var end = IndexOfNul(from);
                if (end < 0 && _windowStart != absolute)
                {
                    // The string started near the tail of the window. One refill
                    // from its own first byte gives it the whole window to fit in.
                    Fill(absolute);
                    from = 0;
                    end = IndexOfNul(0);
                }
                return end < 0 ? null : Encoding.UTF8.GetString(_buffer, from, end - from);
            }

            private int IndexOfNul(int from)
            {
                for (var i = from; i < _windowLength; i++)
                {
                    if (_buffer[i] == 0)
                    {
                        return i;
                    }
                }
                return -1;
            }

            private void Fill(long absolute)
            {
                var remaining = _start + _length - absolute;
                var wanted = (int)Math.Min(_buffer.Length, Math.Max(0, remaining));
                _stream.Position = absolute;
                _windowStart = absolute;
                _windowLength = ReadFully(_stream, _buffer, 0, wanted);
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

        private static ushort U16(byte[] b, int at) => (ushort)(b[at] | (b[at + 1] << 8));

        private static uint U32(byte[] b, int at) =>
            (uint)(b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24));

        private static ulong U64(byte[] b, int at) => U32(b, at) | ((ulong)U32(b, at + 4) << 32);
    }
}
