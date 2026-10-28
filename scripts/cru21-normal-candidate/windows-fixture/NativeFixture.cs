// Fixed, isolated Windows test fixture. Never a product/candidate launcher.
// No arbitrary executable, application arguments, PID attachment or network API.
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Reflection;
using System.Collections.Generic;
using System.ComponentModel;
using System.Security.Cryptography;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

internal static class NativeFixture
{
    const string Prefix = "cru21-native-fixture-20261028-";
    const string Product = "807f940e4195153b9c2c83fc2ba0923ec0049203";
    const uint SyncQuery = 0x00101000, DuplicateAccess = 0x40;
    static string Root, Exe;
    static string GuardianPhase = "NOT_ENTERED";
    static FileStream BinaryLease;
    static string BinaryHash;
    static int SpawnCount;
    static readonly List<string> Results = new List<string>();

    static void Require(bool value, string reason) { if (!value) throw new InvalidOperationException(reason); }
    static string Q(string value) { return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n") + "\""; }
    static string Json(params object[] values)
    {
        var b = new StringBuilder("{");
        for (int i = 0; i < values.Length; i += 2)
        {
            if (i != 0) b.Append(','); b.Append(Q((string)values[i])).Append(':'); object v = values[i + 1];
            b.Append(v == null ? "null" : v is bool ? ((bool)v ? "true" : "false") : v is string ? Q((string)v) : Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture));
        }
        return b.Append('}').ToString();
    }
    static void Configure(string root)
    {
        Require(Environment.OSVersion.Platform == PlatformID.Win32NT && IntPtr.Size == 8, "WINDOWS_X64_REQUIRED");
        Root = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
        string temp = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar);
        Require(String.Equals(Path.GetDirectoryName(Root), temp, StringComparison.OrdinalIgnoreCase), "FIXTURE_TEMP_ROOT_REQUIRED");
        string name = Path.GetFileName(Root); Guid id;
        Require(name.StartsWith(Prefix, StringComparison.Ordinal) && Guid.TryParseExact(name.Substring(Prefix.Length), "D", out id), "FIXTURE_ROOT_NAME_INVALID");
        Exe = Path.GetFullPath(Assembly.GetExecutingAssembly().Location);
        Require(String.Equals(Path.GetDirectoryName(Exe), Root, StringComparison.OrdinalIgnoreCase) && Path.GetFileName(Exe) == "native-fixture.exe", "FIXTURE_SELF_EXECUTABLE_REQUIRED");
        using (var dir = Dir.Open(Root)) { }
        BinaryLease = new FileStream(Exe, FileMode.Open, FileAccess.Read, FileShare.Read);
        N.FILE_INFO binary; N.Check(N.GetFileInformationByHandle(BinaryLease.SafeFileHandle.DangerousGetHandle(), out binary));
        Require(binary.Links == 1 && (binary.Attributes & 0x400) == 0, "FIXTURE_BINARY_ALIAS_REJECTED");
        var binaryPath = new StringBuilder(32768);
        uint binaryLength = N.GetFinalPathNameByHandle(BinaryLease.SafeFileHandle.DangerousGetHandle(), binaryPath, binaryPath.Capacity, 0);
        Require(binaryLength > 0 && binaryLength < binaryPath.Capacity && String.Equals(binaryPath.ToString(), "\\\\?\\" + Exe, StringComparison.OrdinalIgnoreCase), "FIXTURE_BINARY_CANONICAL_REJECTED");
        using (var sha = SHA256.Create()) BinaryHash = BitConverter.ToString(sha.ComputeHash(BinaryLease)).Replace("-", "").ToLowerInvariant();
    }
    static string Arg(string value) { Require(value.IndexOf('"') < 0 && value.IndexOf('\0') < 0, "ARGUMENT_INVALID"); return "\"" + value + "\""; }
    static string Args(params string[] values) { var b = new StringBuilder(); foreach (string v in values) { if (b.Length != 0) b.Append(' '); b.Append(Arg(v)); } return b.ToString(); }
    static string AuthorityPath { get { return Path.Combine(Root, "native-authority"); } }
    static long Mono { get { return checked((long)N.GetTickCount64()); } }
    static long Wall { get { return DateTime.UtcNow.Ticks; } }
    static long Number(string value) { long n; Require(Int64.TryParse(value, out n) && n >= 0, "FIXTURE_NUMBER_INVALID"); return n; }
    static IntPtr Handle(string value) { return new IntPtr(Number(value)); }
    static void Write(Dir dir, string name, string data)
    {
        using (FileStream f = dir.CreateFile(name)) { byte[] bytes = Encoding.UTF8.GetBytes(data + "\n"); f.Write(bytes, 0, bytes.Length); f.Flush(true); }
    }
    static string Read(Dir dir, string name) { using (FileStream f = dir.ReadFile(name)) { Require(f.Length < 65536, "FIXTURE_RECEIPT_TOO_LARGE"); using (var r = new StreamReader(f, Encoding.UTF8)) return r.ReadToEnd(); } }
    static bool Exists(Dir dir, string name) { try { using (FileStream f = dir.ReadFile(name)) return true; } catch (IOException) { return false; } }
    static void WaitReceipt(Dir dir, string name, Proc process)
    {
        long end = Mono + 10000;
        while (true)
        {
            if (Exists(dir, name)) return;
            if (process.Exited || Mono >= end)
            {
                // The writer can finish between the first lookup and exit.
                // Exclusive writing makes only a closed, complete file readable.
                if (Exists(dir, name)) return;
                throw new InvalidOperationException("FIXTURE_HANDSHAKE_UNAVAILABLE");
            }
            Thread.Sleep(10);
        }
    }
    static long Budget(string name)
    {
        if (name == "full-budget") return 900000;
        if (name == "normal-short" || name == "parent-suspended" || name == "pid-metadata-collision" || name == "wall-backward" || name == "guardian-suspended") return 3000;
        if (name == "parent-loss" || name == "guardian-loss" || name == "wall-forward" || name == "receipt-failure" || name == "child-exits-early") return 10000;
        throw new InvalidOperationException("FIXTURE_CASE_INVALID");
    }
    static string Nonce(string value) { Guid id; Require(Guid.TryParseExact(value, "D", out id), "FIXTURE_NONCE_INVALID"); return value; }
    static long Creation(IntPtr handle) { N.FT c, e, k, u; N.Check(N.GetProcessTimes(handle, out c, out e, out k, out u)); return c.Value; }
    static long ExitUtc(IntPtr handle) { N.FT c, e, k, u; N.Check(N.GetProcessTimes(handle, out c, out e, out k, out u)); Require(e.Value > 0, "DUMMY_EXIT_TIME_UNAVAILABLE"); return DateTime.FromFileTimeUtc(e.Value).Ticks; }
    static string Ack(string role, string nonce, IntPtr process)
    { return Json("role", role, "nonce", nonce, "binarySha256", BinaryHash, "creationFileTime", Creation(process), "state", "FIXED_DUMMY_ENTERED"); }
    static void VerifyAck(Dir dir, string role, string nonce, IntPtr process)
    { Require(Read(dir, role + "-ack.json").Trim() == Ack(role, nonce, process) && !Exited(process), "DUMMY_ACK_OR_LIVENESS_REJECTED"); }
    static string Intent(long start, long wall, long budget)
    { return Json("mode", "ISOLATED_NATIVE_FIXTURE", "productPinEvidenceOnly", Product, "startMonoMs", start, "startUtcTicks", wall, "budgetMs", budget, "consumed", true, "runtimeAllowed", false); }
    static void ValidateIntent(Dir dir, string name, long start, long wall)
    {
        long budget = Budget(name);
        Require(start <= Mono && wall <= Wall, "FUTURE_INTENT_START_REJECTED");
        Require(Read(dir, "intent.json").Trim() == Intent(start, wall, budget), "IMMUTABLE_INTENT_BINDING_REJECTED");
        Require(Mono - start < budget && Wall < wall + budget * TimeSpan.TicksPerMillisecond, "ORIGINAL_INTENT_EXPIRED");
    }
    static bool Exited(IntPtr handle) { uint result = N.WaitForSingleObject(handle, 0); Require(result == 0 || result == 258, "FIXTURE_WAIT_FAILED"); return result == 0; }
    static void AwaitExit(IntPtr handle, int millis) { Require(N.WaitForSingleObject(handle, (uint)millis) == 0, "FIXTURE_EXIT_UNVERIFIED"); }
    static void Kill(IntPtr handle) { if (!Exited(handle)) N.Check(N.TerminateProcess(handle, 0xc021)); AwaitExit(handle, 5000); }
    static void ExitUnknown() { Environment.Exit(71); throw new InvalidOperationException("FIXTURE_EXIT_DID_NOT_TERMINATE"); }

    // Original handles only. A process ID is evidence and never a control selector.
    sealed class Proc : IDisposable
    {
        internal IntPtr Process, Thread; internal uint Pid;
        internal bool Exited { get { return NativeFixture.Exited(Process); } }
        public void Dispose() { if (Thread != IntPtr.Zero) { N.CloseHandle(Thread); Thread = IntPtr.Zero; } if (Process != IntPtr.Zero) { N.CloseHandle(Process); Process = IntPtr.Zero; } }
    }
    sealed class Attributes : IDisposable
    {
        internal IntPtr List; readonly List<IntPtr> Values = new List<IntPtr>();
        internal Attributes(IntPtr job, IntPtr[] handles)
        {
            int count = handles.Length == 0 ? 1 : 2; IntPtr size = IntPtr.Zero;
            N.InitializeProcThreadAttributeList(IntPtr.Zero, count, 0, ref size);
            Require(size.ToInt64() > 0, "ATTRIBUTE_LIST_UNAVAILABLE"); List = Marshal.AllocHGlobal(size);
            N.Check(N.InitializeProcThreadAttributeList(List, count, 0, ref size));
            Add(new IntPtr(0x2000d), new IntPtr[] { job });
            if (handles.Length != 0) Add(new IntPtr(0x20002), handles);
        }
        void Add(IntPtr attribute, IntPtr[] values)
        {
            IntPtr memory = Marshal.AllocHGlobal(IntPtr.Size * values.Length); Values.Add(memory);
            for (int i = 0; i < values.Length; i++) Marshal.WriteIntPtr(memory, i * IntPtr.Size, values[i]);
            N.Check(N.UpdateProcThreadAttribute(List, 0, attribute, memory, new IntPtr(IntPtr.Size * values.Length), IntPtr.Zero, IntPtr.Zero));
        }
        public void Dispose() { if (List != IntPtr.Zero) { N.DeleteProcThreadAttributeList(List); Marshal.FreeHGlobal(List); List = IntPtr.Zero; } foreach (IntPtr v in Values) Marshal.FreeHGlobal(v); }
    }
    static IntPtr NewJob()
    {
        IntPtr job = N.CreateJobObject(IntPtr.Zero, null); N.Check(job != IntPtr.Zero);
        var limits = new N.JOB_LIMITS(); limits.Basic.LimitFlags = 0x2000; // KILL_ON_JOB_CLOSE only.
        if (!N.SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(N.JOB_LIMITS)))) { int error = Marshal.GetLastWin32Error(); N.CloseHandle(job); throw new Win32Exception(error); }
        return job;
    }
    static Proc Spawn(IntPtr job, IntPtr[] inherit, params string[] args) { return SpawnCore(job, inherit, false, args); }
    static Proc SpawnCore(IntPtr job, IntPtr[] inherit, bool suspended, params string[] args)
    {
        Require(job != IntPtr.Zero, "FIXTURE_JOB_REQUIRED");
        using (var attributes = new Attributes(job, inherit))
        {
            var startup = new N.STARTUPINFOEX(); startup.Startup.cb = Marshal.SizeOf(typeof(N.STARTUPINFOEX)); startup.List = attributes.List;
            N.PI info; IntPtr environment = IntPtr.Zero;
            try
            {
                var windows = new StringBuilder(32768); Require(N.GetWindowsDirectory(windows, windows.Capacity) > 0, "WINDOWS_DIRECTORY_UNAVAILABLE");
                // Do not copy/read the parent's environment or credential variables.
                string originalTemp = Path.GetDirectoryName(Root);
                environment = Marshal.StringToHGlobalUni("SystemRoot=" + windows + "\0TEMP=" + originalTemp + "\0TMP=" + originalTemp + "\0\0");
                var command = new StringBuilder(Arg(Exe) + " " + Args(args));
                N.Check(N.CreateProcess(Exe, command, IntPtr.Zero, IntPtr.Zero, inherit.Length != 0,
                    0x08000000u | 0x00080000u | 0x00000400u | (suspended ? 4u : 0u), environment, Root, ref startup, out info));
                SpawnCount++; return new Proc { Process = info.Process, Thread = info.Thread, Pid = info.Pid };
            }
            finally { if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment); }
        }
    }
    static IntPtr Duplicate(IntPtr source, uint access, bool inherit)
    {
        IntPtr copy; N.Check(N.DuplicateHandle(N.GetCurrentProcess(), source, N.GetCurrentProcess(), out copy, access, inherit, 0)); return copy;
    }

    // Holds directories without DELETE sharing. Record creation is relative to
    // the held directory object via NtCreateFile, not a re-resolved pathname.
    sealed class Dir : IDisposable
    {
        internal IntPtr Handle; internal string PathName;
        internal static Dir Open(string path)
        {
            IntPtr h = N.CreateFile(path, 0x001000a7, 3, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
            N.Check(h != new IntPtr(-1)); var d = new Dir { Handle = h, PathName = path };
            try
            {
                d.Check(); var canonical = new StringBuilder(32768);
                uint length = N.GetFinalPathNameByHandle(h, canonical, canonical.Capacity, 0);
                Require(length > 0 && length < canonical.Capacity, "FIXTURE_CANONICAL_PATH_UNAVAILABLE");
                string final = canonical.ToString(); if (final.StartsWith("\\\\?\\", StringComparison.Ordinal)) final = final.Substring(4);
                Require(String.Equals(final.TrimEnd('\\'), System.IO.Path.GetFullPath(path).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase), "FIXTURE_PATH_ALIAS_REJECTED");
                return d;
            }
            catch { d.Dispose(); throw; }
        }
        void Check()
        {
            N.FILE_INFO info; N.Check(N.GetFileInformationByHandle(Handle, out info));
            Require((info.Attributes & 0x10) != 0 && (info.Attributes & 0x400) == 0, "FIXTURE_DIRECTORY_REPARSE_REJECTED");
        }
        IntPtr OpenRelative(string name, uint access, uint disposition, bool directory)
        {
            Require(name.Length > 0 && name.IndexOfAny(new char[] { '/', '\\', ':', '\0' }) < 0 && name != "." && name != "..", "FIXTURE_FILENAME_INVALID");
            Check(); IntPtr text = Marshal.StringToHGlobalUni(name), unicode = IntPtr.Zero;
            try
            {
                var str = new N.US { Length = checked((ushort)(name.Length * 2)), MaximumLength = checked((ushort)((name.Length + 1) * 2)), Buffer = text };
                unicode = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(N.US))); Marshal.StructureToPtr(str, unicode, false);
                var oa = new N.OA { Length = Marshal.SizeOf(typeof(N.OA)), Root = Handle, Name = unicode, Attributes = 0x1040 };
                IntPtr h; N.IOSB status;
                uint sharing = directory ? 3u : disposition == 2 ? 0u : 1u;
                int nt = N.NtCreateFile(out h, access, ref oa, out status, IntPtr.Zero, 0x80, sharing, disposition,
                    0x00200020 | (directory ? 1u : 0x40u), IntPtr.Zero, 0);
                if (nt < 0) throw new IOException("FIXTURE_NATIVE_IO_" + unchecked((uint)nt).ToString("x8"));
                N.FILE_INFO info; if (!N.GetFileInformationByHandle(h, out info) || (info.Attributes & 0x400) != 0 || (!directory && info.Links != 1)) { N.CloseHandle(h); throw new IOException("FIXTURE_FILE_ALIAS_REJECTED"); }
                return h;
            }
            finally { if (unicode != IntPtr.Zero) Marshal.FreeHGlobal(unicode); Marshal.FreeHGlobal(text); }
        }
        internal Dir NewDirectory(string name) { return new Dir { Handle = OpenRelative(name, 0x001000a7, 2, true), PathName = System.IO.Path.Combine(PathName, name) }; }
        internal Dir ExistingDirectory(string name) { return new Dir { Handle = OpenRelative(name, 0x001000a7, 1, true), PathName = System.IO.Path.Combine(PathName, name) }; }
        internal FileStream CreateFile(string name) { return new FileStream(new SafeFileHandle(OpenRelative(name, 0x40100080, 2, false), true), FileAccess.Write); }
        internal FileStream ReadFile(string name) { return new FileStream(new SafeFileHandle(OpenRelative(name, 0x80100080, 1, false), true), FileAccess.Read); }
        public void Dispose() { if (Handle != IntPtr.Zero) { N.CloseHandle(Handle); Handle = IntPtr.Zero; } }
    }

    static int Guardian(string[] a)
    {
        GuardianPhase = "VALIDATING_ARGUMENTS";
        Require(a.Length == 9, "GUARDIAN_ARGUMENTS_INVALID"); string name = a[2], nonce = Nonce(a[3]); long budget = Budget(name);
        IntPtr parent = Handle(a[4]), driver = Handle(a[6]); long parentCreation = Number(a[5]), start = Number(a[7]), wallStart = Number(a[8]);
        Require(Creation(parent) == parentCreation && !Exited(parent), "PARENT_HANDLE_IDENTITY_REJECTED");
        using (Dir root = Dir.Open(Root)) using (Dir authority = root.ExistingDirectory("native-authority")) using (Dir dir = authority.ExistingDirectory(name))
        {
            Require(Read(dir, "nonce.txt").Trim() == nonce, "GUARDIAN_NONCE_REJECTED");
            Require(Read(authority, "binary-sha256.txt").Trim() == BinaryHash, "FIXTURE_BINARY_CHANGED");
            GuardianPhase = "VALIDATING_INTENT";
            ValidateIntent(dir, name, start, wallStart);
            Write(dir, "guardian-consumed.json", Json("nonce", nonce, "startMonoMs", start, "startUtcTicks", wallStart, "budgetMs", budget, "runtimeAllowed", false));
            IntPtr job = NewJob(); Proc child = null;
            var stop = new ManualResetEvent(false); var monitorDone = new ManualResetEvent(false);
            string stopReason = "UNKNOWN"; long stopAt = 0, stopUtc = 0; Exception monitorError = null; int childActivated = 0, injectClock = 0;
            object admission = new object(); bool stopRequested = false;
            long margin = budget == 900000 ? 1000 : 500;
            // This worker starts before any dummy creation and never performs
            // receipt I/O. It retains the original job handle until joined.
            var monitor = new Thread(delegate()
            {
                try
                {
                    while (true)
                    {
                        long now = Mono, logicalWall = Wall;
                        if (Interlocked.CompareExchange(ref childActivated, 0, 0) == 1 && child.Exited) { stopReason = "DUMMY_UNEXPECTED_EXIT"; break; }
                        if (Interlocked.CompareExchange(ref injectClock, 0, 0) == 1)
                        {
                            if (name == "wall-forward") logicalWall += TimeSpan.TicksPerHour;
                            if (name == "wall-backward") logicalWall -= TimeSpan.TicksPerHour;
                        }
                        if (Exited(parent)) { stopReason = "MONITORED_PARENT_EXIT"; break; }
                        if (now - start >= budget - margin || logicalWall >= wallStart + (budget - margin) * TimeSpan.TicksPerMillisecond) { stopReason = "EARLY_DEADLINE_STOP"; break; }
                        if (monitorDone.WaitOne(10)) return;
                    }
                    lock (admission)
                    {
                        // Admission/resume and stop are linearized together.
                        // A terminated empty Job is not treated as permanently
                        // closed; stopRequested permanently denies new resumes.
                        if (Interlocked.CompareExchange(ref childActivated, 0, 0) == 1 && child.Exited) stopReason = "DUMMY_UNEXPECTED_EXIT";
                        stopRequested = true; stopAt = Mono; stopUtc = Wall;
                        N.Check(N.TerminateJobObject(job, 0xc021));
                    }
                }
                catch (Exception error)
                {
                    monitorError = error; stopReason = "MONITOR_UNVERIFIED";
                    lock (admission) { stopRequested = true; try { N.TerminateJobObject(job, 0xc021); } catch { } }
                }
                finally { stop.Set(); }
            });
            monitor.IsBackground = true; monitor.Start();
            try
            {
                lock (admission)
                {
                    Require(!stopRequested && Mono - start < budget - margin && Wall < wallStart + (budget - margin) * TimeSpan.TicksPerMillisecond && !Exited(parent), "EXPIRED_BEFORE_DUMMY");
                    GuardianPhase = "CREATING_FIXED_DUMMY";
                    child = SpawnCore(job, new IntPtr[0], true, "dummy", Root, name, nonce);
                    // Native creation can itself be slow. Recheck the original
                    // budget before the only resume while still holding admission.
                    if (Mono - start >= budget - margin || Wall >= wallStart + (budget - margin) * TimeSpan.TicksPerMillisecond || Exited(parent))
                    {
                        stopRequested = true; N.Check(N.TerminateJobObject(job, 0xc021));
                        throw new InvalidOperationException("EXPIRED_BEFORE_DUMMY_RESUME");
                    }
                    Require(N.ResumeThread(child.Thread) != UInt32.MaxValue, "DUMMY_RESUME_FAILED");
                }
                GuardianPhase = "WAITING_DUMMY_ACK";
                WaitReceipt(dir, "dummy-ack.json", child);
                VerifyAck(dir, "dummy", nonce, child.Process);
                lock (admission) { Require(!stopRequested && !child.Exited, "DUMMY_EXITED_BEFORE_READY"); Interlocked.Exchange(ref childActivated, 1); }
                IntPtr observer; N.Check(N.DuplicateHandle(N.GetCurrentProcess(), child.Process, driver, out observer, SyncQuery, false, 0));
                Write(dir, "handoff.txt", observer.ToInt64() + "\n" + Creation(child.Process) + "\n" + child.Pid);
                Write(dir, "ready.json", Json("mode", "ISOLATED_NATIVE_FIXTURE", "pidEvidenceOnly", child.Pid, "monitoredParentIsOsParent", false, "budgetMs", budget, "startMonoMs", start, "runtimeAllowed", false));
                // Clock fault injection begins only after both the actual
                // dummy and the observing driver have acknowledged readiness.
                GuardianPhase = "WAITING_DRIVER_READY";
                long readyUntil = Mono + 10000;
                while (!Exists(dir, "driver-ready.json"))
                { Require(!stop.WaitOne(0) && Mono < readyUntil, "DRIVER_READY_UNAVAILABLE"); Thread.Sleep(10); }
                GuardianPhase = "READING_DRIVER_READY";
                Require(Read(dir, "driver-ready.json").Trim() == Json("nonce", nonce, "dummyCreationFileTime", Creation(child.Process)), "DRIVER_READY_INVALID");
                Interlocked.Exchange(ref injectClock, 1);
                GuardianPhase = "WAITING_MONITOR_STOP";
                stop.WaitOne(); if (monitorError != null) { GuardianPhase = "MONITOR_ERROR"; throw new InvalidOperationException("MONITOR_UNVERIFIED", monitorError); }
                GuardianPhase = "TERMINATING_ORIGINAL_DUMMY";
                Kill(child.Process); long exit = Mono; bool timely = exit - start <= budget;
                GuardianPhase = "READING_NATIVE_EXIT_TIME";
                bool early = stopReason == "DUMMY_UNEXPECTED_EXIT" || ExitUtc(child.Process) < stopUtc;
                string terminal = Json("reason", stopReason, "configuredBudgetMs", budget, "earlyStopMarginMs", margin, "stopElapsedMs", stopAt - start, "observedExitElapsedMs", exit - start, "timelyObservedExit", timely, "dummyAckValidated", true, "childExitedBeforeStop", early, "childExited", true, "runtimeAllowed", false);
                GuardianPhase = "WRITING_TERMINAL_RECEIPT";
                try { Write(dir, "terminal.json", terminal); }
                catch (IOException) { GuardianPhase = "WRITING_UNKNOWN_RECEIPT"; Write(dir, "unknown.json", Json("reason", "TERMINAL_RECEIPT_UNCERTAIN", "childExited", true, "runtimeAllowed", false)); return 3; }
                return timely && !early ? 0 : 4;
            }
            finally { monitorDone.Set(); if (!monitor.Join(2000)) ExitUnknown(); if (job != IntPtr.Zero) N.CloseHandle(job); if (child != null) child.Dispose(); N.CloseHandle(parent); N.CloseHandle(driver); }
        }
    }

    sealed class Case : IDisposable
    {
        internal Dir Dir; internal Proc Parent, Guardian; internal IntPtr Child;
        internal long Start, ChildCreation; internal string Name, Nonce;
        public void Dispose()
        {
            // All cleanup targets are native handles created/received this run.
            if (Guardian != null) { Kill(Guardian.Process); Guardian.Dispose(); }
            if (Child != IntPtr.Zero) { AwaitExit(Child, 5000); N.CloseHandle(Child); Child = IntPtr.Zero; }
            if (Parent != null) { Kill(Parent.Process); Parent.Dispose(); }
            if (Dir != null) Dir.Dispose();
        }
    }
    static Case Start(Dir authority, IntPtr outerJob, string name)
    {
        var c = new Case { Name = name, Nonce = Guid.NewGuid().ToString("D"), Dir = authority.NewDirectory(name) };
        try
        {
            long wall = Wall; c.Start = Mono;
            Write(c.Dir, "nonce.txt", c.Nonce);
            Write(c.Dir, "intent.json", Intent(c.Start, wall, Budget(name)));
            if (name == "receipt-failure") Write(c.Dir, "terminal.json", "immutable preexisting terminal blocker");
            c.Parent = Spawn(outerJob, new IntPtr[0], "parent", Root, name, c.Nonce);
            IntPtr parentWait = Duplicate(c.Parent.Process, SyncQuery, true), driverDup = Duplicate(N.GetCurrentProcess(), DuplicateAccess, true);
            try { c.Guardian = Spawn(outerJob, new IntPtr[] { parentWait, driverDup }, "guardian", Root, name, c.Nonce, parentWait.ToInt64().ToString(), Creation(c.Parent.Process).ToString(), driverDup.ToInt64().ToString(), c.Start.ToString(), wall.ToString()); }
            finally { N.CloseHandle(parentWait); N.CloseHandle(driverDup); }
            WaitReceipt(c.Dir, "handoff.txt", c.Guardian);
            string[] data = Read(c.Dir, "handoff.txt").Trim().Split('\n'); Require(data.Length == 3, "HANDOFF_INVALID");
            c.Child = Handle(data[0].Trim()); c.ChildCreation = Number(data[1].Trim());
            Require(Creation(c.Child) == c.ChildCreation, "DUMMY_HANDLE_IDENTITY_REJECTED");
            WaitReceipt(c.Dir, "ready.json", c.Guardian);
            VerifyAck(c.Dir, "dummy", c.Nonce, c.Child);
            Write(c.Dir, "driver-ready.json", Json("nonce", c.Nonce, "dummyCreationFileTime", c.ChildCreation));
            return c;
        }
        catch { c.Dispose(); throw; }
    }
    static void Record(Dir authority, string name, string status, string details)
    {
        string json = Json("test", name, "status", status, "details", details, "runtimeAllowed", false);
        Write(authority, name + ".result.json", json); Results.Add(json); Console.WriteLine(json);
    }
    static void DeadlineCase(Dir authority, IntPtr outerJob, string name)
    {
        using (Case c = Start(authority, outerJob, name))
        {
            if (name == "parent-suspended") Require(N.NtSuspendProcess(c.Parent.Process) >= 0, "PARENT_PROCESS_SUSPEND_UNAVAILABLE");
            AwaitExit(c.Guardian.Process, checked((int)Budget(name) + 5000)); AwaitExit(c.Child, 1000);
            string terminal = Read(c.Dir, "terminal.json"); Require(terminal.Contains("\"timelyObservedExit\":true"), "ORIGINAL_DEADLINE_EXCEEDED");
            Require(terminal.Contains("\"reason\":\"EARLY_DEADLINE_STOP\"") && terminal.Contains("\"dummyAckValidated\":true") && terminal.Contains("\"childExitedBeforeStop\":false"), "EXPECTED_UNCOOPERATIVE_DEADLINE_NOT_PROVEN");
            Record(authority, name, "PASS", terminal.Trim());
        }
    }
    static int Suite(string[] a)
    {
        Require(a.Length == 3 && (a[2] == "full" || a[2] == "short"), "SUITE_ARGUMENTS_INVALID");
        using (Dir root = Dir.Open(Root)) using (Dir authority = root.NewDirectory("native-authority"))
        using (FileStream guard = authority.CreateFile("permanent.guard"))
        {
            byte[] seal = Encoding.UTF8.GetBytes("ISOLATED_NATIVE_FIXTURE_CONSUMED_NO_REUSE\n"); guard.Write(seal, 0, seal.Length); guard.Flush(true);
            Write(authority, "binary-sha256.txt", BinaryHash);
            IntPtr outer = NewJob(); int failed = 0; var completed = new ManualResetEvent(false);
            // Bounded, nonpersistent driver failsafe. It is not evidence of a
            // native hard deadline under driver-wide process suspension.
            var failsafe = new Thread(delegate()
            {
                if (!completed.WaitOne(a[2] == "full" ? 990000 : 90000))
                {
                    N.TerminateJobObject(outer, 0xc021); Environment.Exit(70);
                }
            });
            failsafe.IsBackground = true; failsafe.Start();
            try
            {
                foreach (string name in new string[] { "normal-short", "parent-suspended", "wall-forward", "wall-backward" })
                    Try(authority, name, delegate { DeadlineCase(authority, outer, name); }, ref failed);
                Try(authority, "parent-loss", delegate
                {
                    using (Case c = Start(authority, outer, "parent-loss"))
                    { Kill(c.Parent.Process); AwaitExit(c.Guardian.Process, 5000); AwaitExit(c.Child, 1000); Require(Read(c.Dir, "terminal.json").Contains("MONITORED_PARENT_EXIT"), "PARENT_LOSS_NOT_OBSERVED"); Record(authority, "parent-loss", "PASS", "Original monitored-parent handle signaled; logical parent is not OS parent."); }
                }, ref failed);
                Try(authority, "guardian-loss", delegate
                {
                    using (Case c = Start(authority, outer, "guardian-loss"))
                    { Kill(c.Guardian.Process); AwaitExit(c.Child, 5000); Record(authority, "guardian-loss", "PASS", "Last inner Job handle closed on guardian termination; original dummy observer handle signaled."); }
                }, ref failed);
                Try(authority, "pid-metadata-collision", delegate
                {
                    using (Case c = Start(authority, outer, "pid-metadata-collision"))
                    using (Proc unrelated = Spawn(outer, new IntPtr[0], "unrelated-dummy", Root, "pid-metadata-collision", c.Nonce))
                    {
                        try { WaitReceipt(c.Dir, "unrelated-dummy-ack.json", unrelated); VerifyAck(c.Dir, "unrelated-dummy", c.Nonce, unrelated.Process); Thread.Sleep(100); Require(!unrelated.Exited, "UNRELATED_DUMMY_EXITED_BEFORE_TEST"); Write(c.Dir, "untrusted-pid.txt", unrelated.Pid.ToString()); AwaitExit(c.Guardian.Process, 8000); AwaitExit(c.Child, 1000); Require(!unrelated.Exited, "UNRELATED_DUMMY_MISTAKENLY_STOPPED"); Record(authority, "pid-metadata-collision", "PASS", "Injected numeric PID metadata ignored; independently acknowledged unrelated native dummy stayed alive. Actual OS PID recycling was not forced."); }
                        finally { Kill(unrelated.Process); }
                    }
                }, ref failed);
                Try(authority, "child-exits-early", delegate
                {
                    using (Case c = Start(authority, outer, "child-exits-early"))
                    {
                        AwaitExit(c.Guardian.Process, 5000); AwaitExit(c.Child, 1000);
                        string terminal = Read(c.Dir, "terminal.json");
                        Require(terminal.Contains("\"reason\":\"DUMMY_UNEXPECTED_EXIT\"") && terminal.Contains("\"childExitedBeforeStop\":true"), "EARLY_DUMMY_EXIT_FALSE_DEADLINE_PASS");
                        int before = SpawnCount; bool rejected = false; try { using (Dir duplicate = authority.NewDirectory("child-exits-early")) { } } catch (IOException) { rejected = true; }
                        Require(rejected && SpawnCount == before, "EARLY_DUMMY_EXIT_RETRIED");
                        Record(authority, "child-exits-early", "PASS", "Acknowledged fixed dummy deliberately exited early; guardian rejected it as DUMMY_UNEXPECTED_EXIT, never a normal expiry, and reuse spawned nothing.");
                    }
                }, ref failed);
                Try(authority, "receipt-failure", delegate
                {
                    using (Case c = Start(authority, outer, "receipt-failure"))
                    {
                        // Cause a prompt monitored-parent close; never wait for a retry.
                        Kill(c.Parent.Process); AwaitExit(c.Guardian.Process, 5000); AwaitExit(c.Child, 1000);
                        Require(Read(c.Dir, "terminal.json").Trim() == "immutable preexisting terminal blocker" && Exists(c.Dir, "unknown.json"), "RECEIPT_FAILURE_WAS_NOT_CLOSED");
                        int before = SpawnCount; bool rejected = false; try { using (Dir duplicate = authority.NewDirectory("receipt-failure")) { } } catch (IOException) { rejected = true; }
                        Require(rejected && SpawnCount == before, "CONSUMED_RECEIPT_FAILURE_RETRIED"); Record(authority, "receipt-failure", "PASS", "Terminal CreateNew failure preserved bytes, stopped original child, wrote UNKNOWN and refused reuse.");
                    }
                }, ref failed);
                Try(authority, "duplicate-ticket", delegate
                {
                    int before = SpawnCount; bool rejected = false; try { using (Dir duplicate = authority.NewDirectory("normal-short")) { } } catch (IOException) { rejected = true; }
                    Require(rejected && SpawnCount == before, "DUPLICATE_TICKET_STARTED"); Record(authority, "duplicate-ticket", "PASS", "Existing fixed case authority cannot be recreated; zero additional spawns.");
                }, ref failed);
                Try(authority, "intent-failure", delegate
                {
                    using (Dir dir = authority.NewDirectory("intent-failure"))
                    {
                        Write(dir, "intent.json", "immutable preexisting intent blocker"); int before = SpawnCount; bool rejected = false;
                        try { Write(dir, "intent.json", "must never replace"); } catch (IOException) { rejected = true; }
                        Require(rejected && SpawnCount == before && Read(dir, "intent.json").Trim() == "immutable preexisting intent blocker", "INTENT_FAILURE_STARTED_OR_OVERWROTE");
                        Record(authority, "intent-failure", "PASS", "Exclusive intent failure before any spawn; original bytes preserved.");
                    }
                }, ref failed);
                Try(authority, "intent-binding", delegate
                {
                    using (Dir dir = authority.NewDirectory("intent-binding"))
                    {
                        long start = Mono, wall = Wall; Write(dir, "intent.json", Intent(start, wall, Budget("normal-short")));
                        int before = SpawnCount, rejected = 0;
                        foreach (long[] bad in new long[][] { new long[] { start + 60000, wall }, new long[] { start, wall + TimeSpan.TicksPerMinute }, new long[] { start - 1, wall }, new long[] { start, wall - 1 } })
                        { try { ValidateIntent(dir, "normal-short", bad[0], bad[1]); } catch (InvalidOperationException) { rejected++; } }
                        Require(rejected == 4 && SpawnCount == before && Read(dir, "intent.json").Trim() == Intent(start, wall, Budget("normal-short")), "INTENT_RESET_ACCEPTED");
                        Record(authority, "intent-binding", "PASS", "Future and changed start values rejected against immutable original intent; zero spawns and unchanged bytes.");
                    }
                }, ref failed);
                Try(authority, "guardian-suspended", delegate
                {
                    using (Case c = Start(authority, outer, "guardian-suspended"))
                    {
                        Require(N.NtSuspendProcess(c.Guardian.Process) >= 0, "GUARDIAN_PROCESS_SUSPEND_UNAVAILABLE");
                        long end = c.Start + Budget("guardian-suspended") + 150; while (Mono < end) Thread.Sleep(25);
                        bool alivePastBudget = !Exited(c.Child);
                        Kill(c.Guardian.Process); AwaitExit(c.Child, 5000);
                        Require(alivePastBudget, "GUARDIAN_SUSPEND_COUNTEREXAMPLE_NOT_OBSERVED");
                        Record(authority, "guardian-suspended", "LIMITATION_CONFIRMED", "Suspended guardian cannot enforce elapsed deadline; driver stopped only original guardian handle and Job closed its dummy. HARD_DEADLINE_UNPROVEN; real-window HOLD.");
                    }
                }, ref failed);
                if (a[2] == "full") Try(authority, "full-budget", delegate { DeadlineCase(authority, outer, "full-budget"); }, ref failed);
                else Record(authority, "full-budget", "NOT_RUN", "900000ms configured-budget case omitted in explicitly selected short suite.");
            }
            finally { completed.Set(); if (!failsafe.Join(2000)) ExitUnknown(); N.CloseHandle(outer); }
            Write(authority, "summary.json", Json("status", "HOLD", "functionalTestFailures", failed, "recordedCases", Results.Count, "configuredFullBudgetRequested", a[2] == "full", "hardDeadlineProven", false, "nativeAuthorityIntegrated", false, "actualOsPidRecyclingForced", false, "osSuspendVerified", false, "runtimeAllowed", false));
            Console.WriteLine(Read(authority, "summary.json")); return failed == 0 ? 2 : 1;
        }
    }
    static void Try(Dir authority, string name, Action action, ref int failed)
    {
        try { action(); } catch (Exception error) { failed++; Record(authority, name, "FAIL", error.GetType().Name + ":" + error.Message); }
    }
    static void GuardianErrorReceipt(string[] a, Exception error)
    {
        if (a.Length != 9 || a[0] != "guardian" || Root == null || GuardianPhase == "NOT_ENTERED") return;
        // Called only after Guardian's finally/using scopes have cleaned its
        // owned Job and handles. Diagnostics never control another process.
        try
        {
            Budget(a[2]);
            var native = error as Win32Exception;
            if (native == null) native = error.InnerException as Win32Exception;
            using (Dir root = Dir.Open(Root)) using (Dir authority = root.ExistingDirectory("native-authority")) using (Dir dir = authority.ExistingDirectory(a[2]))
                Write(dir, "guardian-error.json", Json("phase", GuardianPhase, "type", error.GetType().Name, "hresult", error.HResult, "win32code", native == null ? null : (object)native.NativeErrorCode));
        }
        catch { Console.Error.WriteLine("ISOLATED_GUARDIAN_ERROR_RECEIPT_UNAVAILABLE"); }
    }
    static int Main(string[] a)
    {
        try
        {
            Require(a.Length >= 2, "FIXED_FIXTURE_MODE_REQUIRED"); Configure(a[1]);
            if (a[0] == "suite") return Suite(a);
            if (a[0] == "guardian") return Guardian(a);
            Require((a[0] == "dummy" || a[0] == "parent" || a[0] == "unrelated-dummy") && a.Length == 4, "FIXED_FIXTURE_MODE_REQUIRED");
            Budget(a[2]); Nonce(a[3]);
            using (Dir root = Dir.Open(Root)) using (Dir authority = root.ExistingDirectory("native-authority")) using (Dir dir = authority.ExistingDirectory(a[2]))
            {
                Require(Read(authority, "binary-sha256.txt").Trim() == BinaryHash, "FIXTURE_BINARY_CHANGED"); Require(Read(dir, "nonce.txt").Trim() == a[3], "DUMMY_NONCE_REJECTED");
                if (a[0] != "parent")
                {
                    Require(a[0] != "unrelated-dummy" || a[2] == "pid-metadata-collision", "UNRELATED_ROLE_SCOPE_REJECTED");
                    Write(dir, a[0] + "-ack.json", Ack(a[0], a[3], N.GetCurrentProcess()));
                    if (a[2] == "child-exits-early")
                    {
                        long until = Mono + 5000; while (!Exists(dir, "driver-ready.json")) { Require(Mono < until, "EARLY_EXIT_DRIVER_READY_UNAVAILABLE"); Thread.Sleep(10); }
                        Thread.Sleep(150); return 0;
                    }
                }
            }
            while (true) Thread.Sleep(1000); // Fixed uncooperative, non-network test process.
        }
        catch (Exception e) { GuardianErrorReceipt(a, e); Console.Error.WriteLine("ISOLATED_FIXTURE_HOLD " + e.GetType().Name + ":" + e.Message); return 1; }
    }

    internal static class N
    {
        internal static void Check(bool value) { if (!value) throw new Win32Exception(Marshal.GetLastWin32Error()); }
        [StructLayout(LayoutKind.Sequential)] internal struct FT { internal uint Low, High; internal long Value { get { return ((long)High << 32) | Low; } } }
        [StructLayout(LayoutKind.Sequential)] internal struct STARTUPINFO { internal int cb; internal IntPtr Reserved, Desktop, Title; internal uint X,Y,XSize,YSize,XChars,YChars,Fill,Flags; internal ushort Show,ReservedSize; internal IntPtr Reserved2,Input,Output,Error; }
        [StructLayout(LayoutKind.Sequential)] internal struct STARTUPINFOEX { internal STARTUPINFO Startup; internal IntPtr List; }
        [StructLayout(LayoutKind.Sequential)] internal struct PI { internal IntPtr Process, Thread; internal uint Pid, Tid; }
        [StructLayout(LayoutKind.Sequential)] internal struct BASIC_LIMIT { internal long ProcessTime, JobTime; internal uint LimitFlags; internal UIntPtr MinWorking, MaxWorking; internal uint ActiveProcess; internal UIntPtr Affinity; internal uint Priority, Scheduling; }
        [StructLayout(LayoutKind.Sequential)] internal struct IOC { internal ulong ReadOps,WriteOps,OtherOps,ReadBytes,WriteBytes,OtherBytes; }
        [StructLayout(LayoutKind.Sequential)] internal struct JOB_LIMITS { internal BASIC_LIMIT Basic; internal IOC Io; internal UIntPtr ProcessMemory,JobMemory,PeakProcess,PeakJob; }
        [StructLayout(LayoutKind.Sequential)] internal struct FILE_INFO { internal uint Attributes; internal FT Creation,Access,Write; internal uint Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow; }
        [StructLayout(LayoutKind.Sequential)] internal struct US { internal ushort Length, MaximumLength; internal IntPtr Buffer; }
        [StructLayout(LayoutKind.Sequential)] internal struct OA { internal int Length; internal IntPtr Root, Name; internal uint Attributes; internal IntPtr Security,Quality; }
        [StructLayout(LayoutKind.Sequential)] internal struct IOSB { internal IntPtr Status, Information; }
        [DllImport("kernel32.dll")] internal static extern ulong GetTickCount64();
        [DllImport("kernel32.dll")] internal static extern IntPtr GetCurrentProcess();
        [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", SetLastError=true)] internal static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
        [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool TerminateProcess(IntPtr handle, uint code);
        [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target, uint access, bool inherit, uint options);
        [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool GetProcessTimes(IntPtr process, out FT creation, out FT exit, out FT kernel, out FT user);
        [DllImport("kernel32.dll", SetLastError=true)] internal static extern uint SuspendThread(IntPtr thread);
        [DllImport("kernel32.dll", SetLastError=true)] internal static extern uint ResumeThread(IntPtr thread);
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="CreateJobObjectW")] internal static extern IntPtr CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool SetInformationJobObject(IntPtr job, int type, ref JOB_LIMITS value, uint size);
        [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool TerminateJobObject(IntPtr job, uint code);
        [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
        [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returnedSize);
        [DllImport("kernel32.dll")] internal static extern void DeleteProcThreadAttributeList(IntPtr list);
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="CreateProcessW")] internal static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref STARTUPINFOEX startup, out PI info);
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, EntryPoint="GetWindowsDirectoryW")] internal static extern uint GetWindowsDirectory(StringBuilder path, int length);
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="CreateFileW")] internal static extern IntPtr CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool GetFileInformationByHandle(IntPtr file, out FILE_INFO info);
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="GetFinalPathNameByHandleW")] internal static extern uint GetFinalPathNameByHandle(IntPtr file, StringBuilder path, int length, uint flags);
        [DllImport("ntdll.dll")] internal static extern int NtCreateFile(out IntPtr file, uint access, ref OA attributes, out IOSB io, IntPtr allocationSize, uint fileAttributes, uint share, uint disposition, uint options, IntPtr ea, uint eaLength);
        [DllImport("ntdll.dll")] internal static extern int NtSuspendProcess(IntPtr process);
    }
}
