// Fixed, isolated normal-application integration. Never a production controller.
// No arbitrary executable/script/arguments, PID attachment or ACL setter.
// The dormant normal close probe can only bind IPv4 loopback18722 without Listen.
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Reflection;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Security.Cryptography;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

internal static class CandidateHost
{
    const string Prefix = "cru21-candidate-integration-20261028-";
    const string ProductHead = "4ae16de9a5af0166744626d44a49cb5bcebed675";
    const string ProductTree = "ac2d522e6d42934dbb563599a04df61f56fc9145";
    const string NodePath = @"C:\Program Files\nodejs\node.exe";
    const string GitPath = @"C:\Program Files\Git\cmd\git.exe";
    const string NormalSourceManifestSHA256 = "b1391d7e3a971d72741053c159ea95acf772ca2a9d8f3970a4af098408fa947a";
    // The coordinating reviewer freezes these after the application artifacts.
    // An unfrozen build cannot prepare, consume or spawn a window.
    const string ExpectedRunnerSHA256 = "9868a913e43342145da2ea54a43689c193ecc27c8475139c993c6c86bb89be39";
    const string ExpectedIsolationSHA256 = "9442959e74dce51de9fed82021bcd91a31cd79e00cc7673b099ff4d796e2cdaf";
    const string ExpectedBundleSHA256 = "44cef1c049569d38508c9b3e0abbcfd824c0b8278cc42f7c85f2b4805ad74961";
    const string ExpectedNormalEntrySHA256 = "fce3af4f3dbafd0c6bb851ea384b8b09ac9674164c94eb57bdc9e6e8b56d908a";
    const string ExpectedEntrySHA256 = "170afc0c9af5c68155eacf963a44948519803f469f99e1b0a7a291a036ba334f";
    const string Mode = "ISOLATED_NORMAL_APPLICATION";
    const string AiDisabledProductHead = "613ebf321e9986bfd9e366339719414836d1dc66";
    const string AiDisabledProductTree = "6e1cc5b828998a1ed77435cc052ed71551546168";
    const string AiDisabledSourceManifestSHA256 = "1f0eb4f41e1f80b21b855c046b1944ce4254ea06f05bf693ce2e6989af8954ae";
    const int AiDisabledSourceFileCount = 360;
    static bool AiDisabledCandidate { get { return NormalCandidate && NormalCandidateMetadata != null; } }
    static string CurrentProductHead { get { return AiDisabledCandidate ? AiDisabledProductHead : ProductHead; } }
    static string CurrentProductTree { get { return AiDisabledCandidate ? AiDisabledProductTree : ProductTree; } }
    static string CurrentNormalSourceManifestSHA256 { get { return AiDisabledCandidate ? AiDisabledSourceManifestSHA256 : NormalSourceManifestSHA256; } }
    static int CurrentNormalSourceFileCount { get { return AiDisabledCandidate ? AiDisabledSourceFileCount : 356; } }
    static string NormalSourceMarker { get { return AiDisabledCandidate ? "export const AI_DISABLED_SOURCE_FILES = Object.freeze(" : "export const NORMAL_SOURCE_FILES = Object.freeze("; } }
    const string ExpectedNormalOwnerApprovalSHA256 = "NOT_APPROVED";
    static bool NormalCandidate;
    static Dictionary<string, object> NormalRequest;
    static long NormalNotBeforeTicks, NormalExpiresTicks;
    static Dir NormalPermanentAuthority;
    static bool NormalCloseProbeApproved;
    static string CurrentMode { get { return NormalCandidate ? "NORMAL_CANDIDATE" : Mode; } }
    const uint SyncQuery = 0x00101000, DuplicateAccess = 0x40;
    static readonly JavaScriptSerializer JSON = new JavaScriptSerializer { MaxJsonLength = 16777216 };
    static readonly List<IDisposable> Leases = new List<IDisposable>();
    static readonly Dictionary<string, Dir> Directories = new Dictionary<string, Dir>(StringComparer.OrdinalIgnoreCase);
    static readonly Dictionary<string, byte[]> OwnedRecords = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
    static string Root, Exe, ManifestSHA256, WindowId, Nonce, NodeSHA256, HostSHA256;
    static long Duration;
    static Dir RootDir, Authority, Windows, Window;
    static byte[] ManifestBytes, RunnerBytes, IsolationBytes, BundleBytes;
    static FileStream NodeLease;
    static int SpawnCount;

    static void Require(bool value, string reason) { if (!value) throw new InvalidOperationException(reason); }
    static string Q(string value)
    {
        var b = new StringBuilder("\"");
        foreach (char c in value)
        {
            if (c == '\\') b.Append("\\\\"); else if (c == '"') b.Append("\\\"");
            else if (c == '\r') b.Append("\\r"); else if (c == '\n') b.Append("\\n"); else if (c == '\t') b.Append("\\t");
            else if (c == '\b') b.Append("\\b"); else if (c == '\f') b.Append("\\f");
            else if (c < 32) b.Append("\\u").Append(((int)c).ToString("x4")); else b.Append(c);
        }
        return b.Append('"').ToString();
    }
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
    static bool HashShape(string value) { return value != null && System.Text.RegularExpressions.Regex.IsMatch(value, "^[a-f0-9]{64}$"); }
    static bool Uuid(string value) { Guid id; return value != null && Guid.TryParseExact(value, "D", out id); }
    static long Mono { get { return checked((long)N.GetTickCount64()); } }
    static long Wall { get { return DateTime.UtcNow.Ticks; } }
    static string Hash(byte[] bytes) { using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(); }
    static byte[] Bytes(string value) { return new UTF8Encoding(false, true).GetBytes(value + "\n"); }
    static string HashFile(FileStream file) { file.Position = 0; string hash; using (var sha = SHA256.Create()) hash = BitConverter.ToString(sha.ComputeHash(file)).Replace("-", "").ToLowerInvariant(); file.Position = 0; return hash; }
    static string Text(byte[] bytes) { return new UTF8Encoding(false, true).GetString(bytes); }
    static string Arg(string value) { Require(value.IndexOf('"') < 0 && value.IndexOf('\0') < 0, "ARGUMENT_REJECTED"); return "\"" + value + "\""; }
    static string Args(params string[] values) { var b = new StringBuilder(); foreach (string v in values) { if (b.Length != 0) b.Append(' '); b.Append(Arg(v)); } return b.ToString(); }
    static Dictionary<string, object> Object(byte[] bytes)
    {
        Require(bytes.Length > 0 && bytes.Length < 16777216 && !(bytes.Length >= 3 && bytes[0] == 239 && bytes[1] == 187 && bytes[2] == 191), "JSON_BYTES_REJECTED");
        var value = JSON.DeserializeObject(Text(bytes)) as Dictionary<string, object>;
        Require(value != null, "JSON_OBJECT_REQUIRED"); return value;
    }
    static string String(Dictionary<string, object> value, string key) { object item; Require(value.TryGetValue(key, out item) && item is string, "STRING_FIELD_REJECTED"); return (string)item; }
    static long Number(Dictionary<string, object> value, string key) { object item; Require(value.TryGetValue(key, out item) && (item is int || item is long), "NUMBER_FIELD_REJECTED"); long n = Convert.ToInt64(item); Require(n >= 0, "NUMBER_FIELD_REJECTED"); return n; }
    static bool IsBool(Dictionary<string, object> value, string key, bool expected) { object item; return value.TryGetValue(key, out item) && item is bool && (bool)item == expected; }
    static void ExactKeys(Dictionary<string, object> value, params string[] keys) { Require(value.Count == keys.Length, "MANIFEST_FIELDS_REJECTED"); foreach (string key in keys) Require(value.ContainsKey(key), "MANIFEST_FIELDS_REJECTED"); }
    static long Creation(IntPtr handle) { N.FT c, e, k, u; N.Check(N.GetProcessTimes(handle, out c, out e, out k, out u)); return c.Value; }
    static bool Exited(IntPtr handle) { uint result = N.WaitForSingleObject(handle, 0); Require(result == 0 || result == 258, "PROCESS_WAIT_UNVERIFIED"); return result == 0; }
    static void AwaitExit(IntPtr handle, int timeout) { Require(N.WaitForSingleObject(handle, (uint)timeout) == 0, "OWNED_CHILD_EXIT_UNVERIFIED"); }
    static void StopProcess(IntPtr handle)
    {
        if (Exited(handle)) return;
        if (!N.TerminateProcess(handle, 0xc021))
        {
            int error = Marshal.GetLastWin32Error();
            if (N.WaitForSingleObject(handle, 5000) != 0) throw new Win32Exception(error);
            return;
        }
        AwaitExit(handle, 5000);
    }

    // Read leases deny concurrent writes and deletion until the owned child exits.
    static FileStream ReadLease(Dir dir, string name, int maximum)
    {
        FileStream file = dir.ReadFile(name); Leases.Add(file);
        Require(file.Length <= maximum, "ARTIFACT_SIZE_REJECTED"); return file;
    }
    static byte[] ReadAll(FileStream file)
    {
        Require(file.Length <= 16777216, "FILE_SIZE_REJECTED"); file.Position = 0;
        byte[] bytes = new byte[(int)file.Length]; int offset = 0, count;
        while (offset < bytes.Length && (count = file.Read(bytes, offset, bytes.Length - offset)) > 0) offset += count;
        Require(offset == bytes.Length, "FILE_READ_UNVERIFIED"); file.Position = 0; return bytes;
    }
    static void Write(Dir dir, string name, string body)
    {
        string key = Path.Combine(dir.PathName, name);
        Require(!OwnedRecords.ContainsKey(key), "RECEIPT_ALREADY_WRITTEN");
        FileStream file = dir.CreateFile(name); Leases.Add(file);
        byte[] bytes = Bytes(body); file.Write(bytes, 0, bytes.Length); file.Flush(true); file.Position = 0;
        Require(Hash(ReadAll(file)) == Hash(bytes), "RECEIPT_READBACK_UNVERIFIED");
        OwnedRecords.Add(key, bytes);
    }
    static byte[] Read(Dir dir, string name, int maximum)
    {
        byte[] owned;
        if (OwnedRecords.TryGetValue(Path.Combine(dir.PathName, name), out owned)) return owned;
        return ReadAll(ReadLease(dir, name, maximum));
    }
    static Dir HoldDirectory(string path, bool writable)
    {
        RequireLocalFixedPath(path);
        path = Path.GetFullPath(path); if (path != Path.GetPathRoot(path)) path = path.TrimEnd(Path.DirectorySeparatorChar); Dir prior;
        if (Directories.TryGetValue(path, out prior)) return prior;
        var d = Dir.Open(path, writable); Directories.Add(path, d); Leases.Add(d); return d;
    }
    static void HoldParents(string path)
    {
        string current = Path.GetFullPath(path); var chain = new List<string>();
        while (true) { chain.Add(current); string parent = Path.GetDirectoryName(current); if (parent == null || parent == current) break; current = parent; }
        chain.Reverse(); foreach (string dir in chain) HoldDirectory(dir, false);
    }
    static Dir Child(Dir parent, string name, bool create)
    {
        var d = create ? parent.NewDirectory(name) : parent.ExistingDirectory(name); Leases.Add(d);
        Directories[d.PathName] = d; return d;
    }
    static void Configure(string root, bool normal = false)
    {
        NormalCandidate = normal;
        Require(Environment.OSVersion.Platform == PlatformID.Win32NT && IntPtr.Size == 8, "WINDOWS_X64_REQUIRED");
        Require(HashShape(ExpectedRunnerSHA256) && HashShape(ExpectedIsolationSHA256) && HashShape(ExpectedBundleSHA256), "APPLICATION_ARTIFACTS_NOT_FROZEN");
        Root = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);
        RequireLocalFixedPath(Root); RequireLocalFixedPath(NodePath);
        string temp = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar);
        string rootName = Path.GetFileName(Root);
        Require(System.String.Equals(Path.GetDirectoryName(Root), temp, StringComparison.OrdinalIgnoreCase) && rootName.StartsWith(Prefix, StringComparison.Ordinal) && Uuid(rootName.Substring(Prefix.Length)), "ISOLATED_TEMP_ROOT_REQUIRED");
        HoldParents(Path.GetDirectoryName(Root)); RootDir = HoldDirectory(Root, true);
        Exe = Path.GetFullPath(Assembly.GetExecutingAssembly().Location);
        Require(System.String.Equals(Path.GetDirectoryName(Exe), Root, StringComparison.OrdinalIgnoreCase) && Path.GetFileName(Exe) == "candidate-host.exe", "FIXED_HOST_EXECUTABLE_REQUIRED");
        HostSHA256 = HashFile(ReadLease(RootDir, "candidate-host.exe", 16777216));
        var manifest = ReadLease(RootDir, normal ? "normal-request.json" : "integration-manifest.json", 2097152); ManifestBytes = ReadAll(manifest); ManifestSHA256 = Hash(ManifestBytes);
        var m = Object(ManifestBytes);
        var artifacts = Child(RootDir, "artifacts", false);
        if (normal)
        {
            NormalRequest = m; ValidateNormalRequest(m);
            WindowId = String(m, "windowId"); Nonce = String(m, "nonce"); Duration = 900000; NodeSHA256 = String(Bag(m, "node"), "sha256");
            Require(Hash(ReadAll(ReadLease(artifacts, "application-normal-entry.mjs", 1048576))) == ExpectedNormalEntrySHA256, "NORMAL_ENTRY_HASH_REJECTED");
        }
        else
        {
            ExactKeys(m, "schema", "mode", "runtimeAllowed", "productHead", "productTree", "windowId", "nonce", "durationMs", "nodeSha256", "runnerSha256", "isolationSha256", "bundleSha256");
            Require(String(m, "schema") == "cru21-candidate-integration-manifest-v1" && String(m, "mode") == Mode && IsBool(m, "runtimeAllowed", false), "ISOLATED_MODE_REQUIRED");
            Require(String(m, "productHead") == ProductHead && String(m, "productTree") == ProductTree, "PRODUCT_IDENTITY_REJECTED");
            WindowId = String(m, "windowId"); Nonce = String(m, "nonce"); Duration = Number(m, "durationMs"); NodeSHA256 = String(m, "nodeSha256");
            Require(Uuid(WindowId) && HashShape(Nonce) && HashShape(NodeSHA256) && Duration >= 1000 && Duration <= 900000, "MANIFEST_BINDING_REJECTED");
            Require(String(m, "runnerSha256") == ExpectedRunnerSHA256 && String(m, "isolationSha256") == ExpectedIsolationSHA256 && String(m, "bundleSha256") == ExpectedBundleSHA256, "FIXED_APPLICATION_HASH_REJECTED");
            RunnerBytes = ReadAll(ReadLease(artifacts, "application-runner.mjs", 1048576));
            IsolationBytes = ReadAll(ReadLease(artifacts, "application-isolation.mjs", 4194304));
            BundleBytes = ReadAll(ReadLease(artifacts, "product-bundle.json", 16777216));
            Require(Hash(RunnerBytes) == ExpectedRunnerSHA256, "RUNNER_HASH_REJECTED");
            Require(Hash(IsolationBytes) == ExpectedIsolationSHA256, "ISOLATION_HASH_REJECTED");
            Require(Hash(BundleBytes) == ExpectedBundleSHA256, "BUNDLE_HASH_REJECTED");
        }
        HoldParents(Path.GetDirectoryName(NodePath)); var nodeDir = HoldDirectory(Path.GetDirectoryName(NodePath), false);
        NodeLease = ReadLease(nodeDir, "node.exe", 134217728);
        Require(HashFile(NodeLease) == NodeSHA256, "NODE_BINARY_HASH_REJECTED"); CheckProgramNamespace(NodePath, NodeLease);
    }
    static string Ticket()
    {
        return BindNormalCandidate(Json("schema", "cru21-candidate-integration-ticket-v1", "mode", CurrentMode, "runtimeAllowed", false,
            "manifestSha256", ManifestSHA256, "hostSha256", HostSHA256, "windowId", WindowId, "nonce", Nonce,
            "productHead", CurrentProductHead, "productTree", CurrentProductTree, "durationMs", NormalCandidate ? 900000 : Duration));
    }
    static void OpenAuthority(bool create)
    {
        Authority = Child(RootDir, "authority", create); Windows = Child(Authority, "windows", create);
        Window = Child(Windows, WindowId, create);
    }
    static int Prepare()
    {
        OpenAuthority(true); Write(Window, "ticket.json", Ticket());
        Console.WriteLine(Json("phase", "PREPARED", "manifestSha256", ManifestSHA256, "windowId", WindowId, "runtimeAllowed", false)); return 0;
    }
    // Only this fixed optional variant may depart from the legacy AI-on HTTP18722
    // contract. Validation is metadata-only; the public normal gate remains HOLD.
    static Dictionary<string, object> NormalCandidateMetadata;
    static int NormalListenerPort() { return NormalCandidateMetadata == null ? 18722 : 18723; }
    static Dictionary<string, object> ValidateNormalCandidate(Dictionary<string, object> value)
    {
        if (!value.ContainsKey("candidate")) return null;
        var c = Bag(value, "candidate");
        ExactKeys(c, "scope", "previewType", "host", "port", "transport", "aiEnabled", "cookieSecure", "certificate");
        Require(String(c, "scope") == "MARKET_RESEARCH_AI_DISABLED_CANDIDATE" && String(c, "previewType") == "CRU21_MARKET_RESEARCH_CANDIDATE"
            && String(c, "host") == "127.0.0.1" && Number(c, "port") == 18723 && String(c, "transport") == "https"
            && IsBool(c, "aiEnabled", false) && IsBool(c, "cookieSecure", true), "NORMAL_CANDIDATE_CONTRACT_REJECTED");
        var cert = Bag(c, "certificate"); ExactKeys(cert, "bundlePath", "bundleSHA256", "certificatePinSHA256");
        RequireLocalFixedPath(String(cert, "bundlePath"));
        Require(HashShape(String(cert, "bundleSHA256")) && HashShape(String(cert, "certificatePinSHA256")), "NORMAL_CANDIDATE_CERTIFICATE_REJECTED");
        return c;
    }
    static string BindNormalCandidate(string json)
    {
        if (!NormalCandidate || NormalCandidateMetadata == null) return json;
        var body = Object(Bytes(json)); body["candidateSHA256"] = CanonicalHash(NormalCandidateMetadata); return Canonical(body);
    }
    static void ValidateNormalRequest(Dictionary<string, object> request)
    {
        var requestKeys = new List<string>(new string[] { "schema", "mode", "runtimeAllowed", "windowId", "nonce", "productHead", "productTree", "sourceManifestSHA256",
            "durationMs", "roots", "node", "git", "helperSHA256", "normalAuth", "vendor", "ownerApproval", "authorityRoot" });
        if (request.ContainsKey("candidate")) requestKeys.Add("candidate"); ExactKeys(request, requestKeys.ToArray());
        NormalCandidateMetadata = ValidateNormalCandidate(request);
        Require(HashShape(CurrentNormalSourceManifestSHA256), "NORMAL_PRODUCT_PINS_UNFROZEN");
        Require(String(request, "schema") == "cru21-normal-entry-request-v1" && String(request, "mode") == "NORMAL_CANDIDATE" && IsBool(request, "runtimeAllowed", false)
            && String(request, "productHead") == CurrentProductHead && String(request, "productTree") == CurrentProductTree && Number(request, "durationMs") == 900000
            && Uuid(String(request, "windowId")) && HashShape(String(request, "nonce")) && SamePath(String(request, "authorityRoot"), Root)
            && String(request, "sourceManifestSHA256") == CurrentNormalSourceManifestSHA256 && String(request, "helperSHA256") == ExpectedNormalEntrySHA256, "NORMAL_REQUEST_REJECTED");
        var approval = Bag(request, "ownerApproval"); ExactKeys(approval, "schema", "approvalId", "requestSHA256", "notBeforeUtcTicks", "expiresUtcTicks", "operationPlanSHA256");
        Require(HashShape(ExpectedNormalOwnerApprovalSHA256) && CanonicalHash(approval) == ExpectedNormalOwnerApprovalSHA256
            && String(approval, "schema") == "cru21-normal-window-owner-approval-v1" && System.Text.RegularExpressions.Regex.IsMatch(String(approval, "approvalId"), "^owner-[A-Za-z0-9-]{1,120}$"), "NORMAL_EXACT_OWNER_APPROVAL_REQUIRED");
        var approvedBody = new Dictionary<string, object>(request); approvedBody.Remove("ownerApproval");
        byte[] planBytes = Read(RootDir, "normal-operation-plan.json", 1048576);
        Require(CanonicalHash(approvedBody) == String(approval, "requestSHA256") && HashShape(String(approval, "operationPlanSHA256"))
            && Hash(planBytes) == String(approval, "operationPlanSHA256"), "NORMAL_APPROVAL_SCOPE_CHANGED");
        var operation = Object(planBytes);
        if (NormalCandidateMetadata != null) Require(String(operation, "candidateSHA256") == CanonicalHash(NormalCandidateMetadata), "NORMAL_CANDIDATE_OPERATION_SCOPE_REJECTED");
        var probe = Bag(operation, "candidateListenerProbe");
        ExactKeys(probe, "mode", "host", "port", "exclusiveAddressUse", "listen", "connect", "maxAttempts");
        Require(String(probe, "mode") == "BIND_ONLY" && String(probe, "host") == "127.0.0.1" && Number(probe, "port") == NormalListenerPort()
            && IsBool(probe, "exclusiveAddressUse", true) && IsBool(probe, "listen", false) && IsBool(probe, "connect", false) && Number(probe, "maxAttempts") == 1, "NORMAL_CLOSE_PROBE_SCOPE_REJECTED");
        NormalCloseProbeApproved = true;
        Require(Int64.TryParse(String(approval, "notBeforeUtcTicks"), out NormalNotBeforeTicks) && Int64.TryParse(String(approval, "expiresUtcTicks"), out NormalExpiresTicks)
            && NormalNotBeforeTicks > 0 && NormalExpiresTicks > NormalNotBeforeTicks && NormalExpiresTicks - NormalNotBeforeTicks <= 900000L * TimeSpan.TicksPerMillisecond
            && Wall >= NormalNotBeforeTicks && Wall < NormalExpiresTicks, "NORMAL_APPROVAL_TIME_REJECTED");
        var roots = Bag(request, "roots"); foreach (string key in roots.Keys) RequireLocalFixedPath(String(roots, key));
        ValidateNormalRoots(roots, String(request, "windowId"));
        var node = Bag(request, "node"); var git = Bag(request, "git");
        Require(SamePath(String(node, "path"), NodePath) && HashShape(String(node, "sha256")) && SamePath(String(git, "path"), GitPath) && HashShape(String(git, "sha256")), "NORMAL_FIXED_EXECUTABLE_REQUIRED");
    }
    static Dir EnsurePrivateDirectory(Dir parent, string name)
    {
        Dir dir;
        try { dir = Child(parent, name, false); }
        catch (IOException e)
        {
            if (e.Message != "CANDIDATE_NATIVE_IO_c0000034") throw;
            var writable = Dir.Open(parent.PathName, true); Leases.Add(writable); CheckCodeSecurity(writable.Handle, true);
            dir = Child(writable, name, true);
        }
        CheckCodeSecurity(dir.Handle, true); return dir;
    }
    static Dictionary<string, object> FrozenNormalSourceFiles()
    {
        var artifacts = Directories[Path.Combine(Root, "artifacts")];
        byte[] bytes = ReadAll(ReadLease(artifacts, "application-normal-entry.mjs", 1048576));
        Require(Hash(bytes) == ExpectedNormalEntrySHA256, "NORMAL_ENTRY_CHANGED");
        string text = Text(bytes), marker = NormalSourceMarker;
        int begin = text.IndexOf(marker, StringComparison.Ordinal); Require(begin >= 0 && begin == text.LastIndexOf(marker, StringComparison.Ordinal), "NORMAL_FIXED_MANIFEST_REJECTED");
        begin += marker.Length; int end = text.IndexOf(");", begin, StringComparison.Ordinal); Require(end > begin, "NORMAL_FIXED_MANIFEST_REJECTED");
        var files = Object(new UTF8Encoding(false, true).GetBytes(text.Substring(begin, end - begin)));
        string wrapper = "{\"schema\":\"cru21-normal-source-closure-v1\",\"productHead\":" + Q(CurrentProductHead) + ",\"productTree\":" + Q(CurrentProductTree) + ",\"files\":" + Canonical(files) + "}";
        Require(files.Count == CurrentNormalSourceFileCount && CurrentNormalSourceFileCount > 0 && Hash(new UTF8Encoding(false, true).GetBytes(wrapper)) == CurrentNormalSourceManifestSHA256, "NORMAL_FIXED_MANIFEST_REJECTED"); return files;
    }
    static int PrepareNormalAuthority()
    {
        var roots = Bag(NormalRequest, "roots"); Dir source = CodeDirectory(String(roots, "sourceRoot"));
        var files = FrozenNormalSourceFiles(); foreach (string relative in files.Keys) CodeFile(source, relative, String(files, relative));
        var data = EnsurePrivateDirectory(source, "data");
        try { ReadLease(data, ".cru21-normal-window-consumed.json", 65536); throw new InvalidOperationException("NORMAL_PRIVATE_AUTHORITY_ALREADY_CONSUMED"); }
        catch (IOException e) { if (e.Message != "CANDIDATE_NATIVE_IO_c0000034") throw; }
        NormalPermanentAuthority = data;
        EnsurePrivateDirectory(data, "candidate-local-appdata"); EnsurePrivateDirectory(data, "dashboard-chart-cache"); EnsurePrivateDirectory(data, "history");
        if (AiDisabledCandidate) EnsurePrivateDirectory(data, "decision-workspace");
        var evidence = EnsurePrivateDirectory(data, "cru21-normal-candidate"); EnsurePrivateDirectory(evidence, WindowId);
        return Prepare();
    }
    static byte[] CreateNormalTicket(string intentHash)
    {
        var ticket = new Dictionary<string, object>(NormalRequest); ticket.Remove("ownerApproval"); ticket.Remove("authorityRoot");
        ticket["schema"] = "cru21-normal-entry-ticket-v1"; ticket["intentHash"] = intentHash;
        byte[] bytes = Bytes(Canonical(ticket)); Write(Window, "normal-ticket.json", Canonical(ticket)); return bytes;
    }
    static bool NormalGateAllows() { return false; } // Source review, never a manifest flag, must resolve the fault model.
    static void ValidateNormalRoots(Dictionary<string, object> roots, string windowId)
    {
        ExactKeys(roots, "sourceRoot", "chartReadRoot", "producerDataRoot", "projectionRoot", "snapshotPath", "statusPath", "privateDataRoot", "localAppDataRoot", "chartCacheRoot", "evidenceRoot");
        foreach (string key in roots.Keys) RequireLocalFixedPath(String(roots, key));
        string source = String(roots, "sourceRoot"), data = String(roots, "privateDataRoot"), chart = String(roots, "chartReadRoot"), producer = String(roots, "producerDataRoot");
        Require(SamePath(data, Path.Combine(source, "data")) && SamePath(String(roots, "localAppDataRoot"), Path.Combine(data, "candidate-local-appdata"))
            && SamePath(String(roots, "chartCacheRoot"), Path.Combine(data, "dashboard-chart-cache"))
            && SamePath(String(roots, "projectionRoot"), Path.Combine(producer, "runtime", "cru34-live"))
            && SamePath(String(roots, "snapshotPath"), Path.Combine(String(roots, "projectionRoot"), "latest.json"))
            && SamePath(String(roots, "statusPath"), Path.Combine(String(roots, "projectionRoot"), "status.json"))
            && SamePath(String(roots, "evidenceRoot"), Path.Combine(data, "cru21-normal-candidate", windowId)), "NORMAL_ROOT_RELATION_REJECTED");
        string[] disjoint = { source, chart, producer };
        for (int i = 0; i < disjoint.Length; i++) for (int j = i + 1; j < disjoint.Length; j++)
            Require(!Within(disjoint[i], disjoint[j]) && !Within(disjoint[j], disjoint[i]), "NORMAL_SPLIT_ROOT_REJECTED");
    }

    sealed class Proc : IDisposable
    {
        internal IntPtr Process, Thread, OutputRead, InputWrite; internal uint Pid; internal bool IsNode;
        internal bool Exited { get { return CandidateHost.Exited(Process); } }
        public void Dispose() { if (InputWrite != IntPtr.Zero) { N.CloseHandle(InputWrite); InputWrite = IntPtr.Zero; } if (OutputRead != IntPtr.Zero) { N.CloseHandle(OutputRead); OutputRead = IntPtr.Zero; } if (Thread != IntPtr.Zero) { N.CloseHandle(Thread); Thread = IntPtr.Zero; } if (Process != IntPtr.Zero) { N.CloseHandle(Process); Process = IntPtr.Zero; } }
    }
    sealed class Attributes : IDisposable
    {
        internal IntPtr List; readonly List<IntPtr> Values = new List<IntPtr>();
        internal Attributes(IntPtr job, IntPtr[] handles)
        {
            IntPtr size = IntPtr.Zero; int count = handles.Length == 0 ? 1 : 2;
            N.InitializeProcThreadAttributeList(IntPtr.Zero, count, 0, ref size);
            Require(size.ToInt64() > 0, "ATTRIBUTE_LIST_UNAVAILABLE"); List = Marshal.AllocHGlobal(size);
            N.Check(N.InitializeProcThreadAttributeList(List, count, 0, ref size));
            Add(new IntPtr(0x2000d), new IntPtr[] { job });
            if (handles.Length > 0) Add(new IntPtr(0x20002), handles);
        }
        void Add(IntPtr attribute, IntPtr[] values)
        {
            IntPtr memory = Marshal.AllocHGlobal(IntPtr.Size * values.Length); Values.Add(memory);
            for (int i = 0; i < values.Length; i++) Marshal.WriteIntPtr(memory, i * IntPtr.Size, values[i]);
            N.Check(N.UpdateProcThreadAttribute(List, 0, attribute, memory, new IntPtr(IntPtr.Size * values.Length), IntPtr.Zero, IntPtr.Zero));
        }
        public void Dispose() { if (List != IntPtr.Zero) { N.DeleteProcThreadAttributeList(List); Marshal.FreeHGlobal(List); List = IntPtr.Zero; } foreach (IntPtr value in Values) Marshal.FreeHGlobal(value); }
    }
    static IntPtr NewJob()
    {
        IntPtr job = N.CreateJobObject(IntPtr.Zero, null); N.Check(job != IntPtr.Zero);
        var limits = new N.JOB_LIMITS(); limits.Basic.LimitFlags = 0x2000;
        if (!N.SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(N.JOB_LIMITS)))) { int e = Marshal.GetLastWin32Error(); N.CloseHandle(job); throw new Win32Exception(e); }
        return job;
    }
    static Proc Spawn(IntPtr job, bool node, IntPtr[] inherited, params string[] fixedArgs)
    {
        // ProgramFiles code namespaces must be safe by actual held-handle ACLs.
        // Self-tests refuse unsafe Temp ancestors rather than lock global paths.
        if (node) CheckProgramNamespace(NodePath, NodeLease);
        else CheckProgramNamespace(Exe, ReadLease(RootDir, "candidate-host.exe", 16777216));
        IntPtr outputRead = IntPtr.Zero, outputWrite = IntPtr.Zero, inputRead = IntPtr.Zero, inputWrite = IntPtr.Zero, nullError = IntPtr.Zero;
        var security = new N.SA { Length = Marshal.SizeOf(typeof(N.SA)), Inherit = true };
        N.Check(N.CreatePipe(out outputRead, out outputWrite, ref security, 0));
        N.Check(N.SetHandleInformation(outputRead, 1, 0));
        IntPtr nativeSecurity = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(N.SA)));
        try
        {
            Marshal.StructureToPtr(security, nativeSecurity, false);
            // NUL is a fixed nonpersistent device; never an arbitrary file or endpoint.
            if (node)
            {
                N.Check(N.CreatePipe(out inputRead, out inputWrite, ref security, 0));
                N.Check(N.SetHandleInformation(inputWrite, 1, 0));
            }
            else inputRead = N.CreateFile("NUL", 0x80000000, 3, nativeSecurity, 3, 0, IntPtr.Zero);
            nullError = N.CreateFile("NUL", 0x40000000, 3, nativeSecurity, 3, 0, IntPtr.Zero);
            N.Check(inputRead != new IntPtr(-1) && nullError != new IntPtr(-1));
            var handles = new List<IntPtr>(inherited); handles.Add(outputWrite); handles.Add(inputRead); handles.Add(nullError);
            using (var attrs = new Attributes(job, handles.ToArray()))
            {
                var startup = new N.STARTUPINFOEX(); startup.Startup.cb = Marshal.SizeOf(typeof(N.STARTUPINFOEX)); startup.List = attrs.List;
                startup.Startup.Flags = 0x100; startup.Startup.Input = inputRead; startup.Startup.Output = outputWrite; startup.Startup.Error = nullError;
                N.PI info; IntPtr env = IntPtr.Zero; string application = node ? NodePath : Exe;
                string command = node ? Args(NodePath, "--input-type=module", "--experimental-vm-modules", "-", Root, WindowId, Nonce) : Arg(Exe) + " " + Args(fixedArgs);
                try
                {
                    var windows = new StringBuilder(32768); Require(N.GetWindowsDirectory(windows, windows.Capacity) > 0, "WINDOWS_DIRECTORY_UNAVAILABLE");
                    string privateRoot = Path.Combine(Root, "private", WindowId), originalTemp = Path.GetDirectoryName(Root);
                    // Deliberately no PATH, NODE_OPTIONS, NODE_PATH, preload, secrets or parent env.
                    string normalAuth = "";
                    if (NormalCandidate)
                    {
                        string existingHash = Environment.GetEnvironmentVariable("DASHBOARD_PASSWORD_HASH");
                        Require(existingHash != null && existingHash.StartsWith("scrypt-v1$", StringComparison.Ordinal) && existingHash.IndexOfAny(new char[] { '\0', '\r', '\n' }) < 0, "NORMAL_EXISTING_AUTH_REQUIRED");
                        normalAuth = "DASHBOARD_PASSWORD_HASH=" + existingHash + "\0";
                        privateRoot = String(Bag(NormalRequest, "roots"), "localAppDataRoot");
                    }
                    env = Marshal.StringToHGlobalUni(normalAuth + "LOCALAPPDATA=" + privateRoot + "\0SystemRoot=" + windows + "\0TEMP=" + originalTemp + "\0TMP=" + originalTemp + "\0WINDIR=" + windows + "\0\0");
                    N.Check(N.CreateProcess(application, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, true,
                        0x08000000u | 0x00080000u | 0x00000400u | 4u, env, Path.GetDirectoryName(NodePath), ref startup, out info));
                    SpawnCount++; var process = new Proc { Process = info.Process, Thread = info.Thread, Pid = info.Pid, IsNode = node, OutputRead = outputRead, InputWrite = inputWrite };
                    outputRead = IntPtr.Zero; inputWrite = IntPtr.Zero; return process;
                }
                finally { if (env != IntPtr.Zero) Marshal.FreeHGlobal(env); }
            }
        }
        finally
        {
            Marshal.FreeHGlobal(nativeSecurity); if (outputRead != IntPtr.Zero) N.CloseHandle(outputRead);
            if (outputWrite != IntPtr.Zero) N.CloseHandle(outputWrite);
            if (inputRead != IntPtr.Zero && inputRead != new IntPtr(-1)) N.CloseHandle(inputRead);
            if (inputWrite != IntPtr.Zero) N.CloseHandle(inputWrite);
            if (nullError != IntPtr.Zero && nullError != new IntPtr(-1)) N.CloseHandle(nullError);
        }
    }
    static byte[] IsolatedProgram(string intent)
    {
        string import = "'./application-isolation.mjs'", runner = Text(RunnerBytes);
        int at = runner.IndexOf(import, StringComparison.Ordinal);
        Require(at >= 0 && at == runner.LastIndexOf(import, StringComparison.Ordinal), "FIXED_IMPORT_REPLACEMENT_REJECTED");
        string packet = "{\"schema\":\"cru21-normal-application-input-v1\",\"root\":" + Q(Root) + ",\"windowId\":" + Q(WindowId) + ",\"nonce\":" + Q(Nonce)
            + ",\"mode\":" + Q(Mode) + ",\"runtimeAllowed\":false,\"productHead\":" + Q(ProductHead) + ",\"productTree\":" + Q(ProductTree)
            + ",\"intent\":{\"sha256\":" + Q(Hash(Bytes(intent))) + ",\"contentUTF8\":" + Q(Text(Bytes(intent))) + "}"
            + ",\"bundle\":{\"sha256\":" + Q(Hash(BundleBytes)) + ",\"contentUTF8\":" + Q(Text(BundleBytes)) + "}}";
        string prefix = "const CRU21_INPUT_PACKET=JSON.parse(Buffer.from(" + Q(Convert.ToBase64String(new UTF8Encoding(false, true).GetBytes(packet))) + ",'base64').toString('utf8'));\n";
        string source = prefix + runner.Replace(import, Q("data:text/javascript;base64," + Convert.ToBase64String(IsolationBytes)));
        byte[] program = Bytes(source); Require(program.Length < 2097152, "ISOLATED_PROGRAM_TOO_LARGE"); return program;
    }
    static void WriteInput(Proc child, byte[] bytes)
    {
        IntPtr pipe = child.InputWrite;
        try
        {
            int offset = 0;
            while (offset < bytes.Length)
            {
                int length = Math.Min(16384, bytes.Length - offset); byte[] part = new byte[length]; Buffer.BlockCopy(bytes, offset, part, 0, length); uint written;
                N.Check(N.WriteFile(pipe, part, (uint)part.Length, out written, IntPtr.Zero)); Require(written > 0, "ISOLATED_INPUT_WRITE_UNVERIFIED"); offset += checked((int)written);
            }
        }
        finally { N.CloseHandle(pipe); child.InputWrite = IntPtr.Zero; }
    }
    static byte[] ReadPipeLine(Proc child, long start, long wallStart)
    {
        long end = Math.Min(start + Duration - 100, Mono + 10000);
        using (var bytes = new MemoryStream())
        {
            while (true)
            {
                Require(Mono < end && Wall < wallStart + Duration * TimeSpan.TicksPerMillisecond && !child.Exited, "APPLICATION_HANDSHAKE_UNAVAILABLE");
                uint available; N.Check(N.PeekNamedPipe(child.OutputRead, IntPtr.Zero, 0, IntPtr.Zero, out available, IntPtr.Zero));
                if (available == 0) { Thread.Sleep(10); continue; }
                byte[] buffer = new byte[Math.Min(available, 4096u)]; uint count;
                N.Check(N.ReadFile(child.OutputRead, buffer, (uint)buffer.Length, out count, IntPtr.Zero));
                Require(count > 0, "APPLICATION_PIPE_EOF");
                for (int i = 0; i < count; i++)
                {
                    Require(bytes.Length < 262144, "APPLICATION_HANDSHAKE_TOO_LARGE");
                    if (buffer[i] == 10) return bytes.ToArray();
                    bytes.WriteByte(buffer[i]);
                }
            }
        }
    }
    static void VerifyHandshake(Dictionary<string, object> h, Proc child, string intentHash)
    {
        Require(String(h, "schema") == "cru21-normal-application-handshake-v1" && String(h, "windowId") == WindowId && String(h, "nonce") == Nonce && String(h, "intentHash") == intentHash, "APPLICATION_NONCE_OR_INTENT_REJECTED");
        Require(String(h, "productHead") == ProductHead && String(h, "productTree") == ProductTree && String(h, "entrySHA256") == ExpectedEntrySHA256, "APPLICATION_PRODUCT_REJECTED");
        Require(Number(h, "pid") == child.Pid && N.GetProcessId(child.Process) == child.Pid && Creation(child.Process) > 0 && !child.Exited, "APPLICATION_ORIGINAL_HANDLE_REJECTED");
        Require(IsBool(h, "normalAuthVerified", true) && IsBool(h, "sessionCsrfVerified", true) && IsBool(h, "automaticAIStatusReadOnlyVerified", true) && IsBool(h, "capturedNormalHandler", true), "NORMAL_APPLICATION_VERIFICATION_REJECTED");
        Require(IsBool(h, "listenerOpened", false) && IsBool(h, "runtimeAllowed", false) && String(h, "evidenceClass") == "NORMAL_APPLICATION_VM_SYNTHETIC_DEPENDENCIES", "APPLICATION_ISOLATION_REJECTED");
        Require(Number(h, "networkCalls") == 0 && Number(h, "childProcessCalls") == 0 && Number(h, "realCredentialReads") == 0, "APPLICATION_SIDE_EFFECT_REJECTED");
        Require(String(h, "storeInspectorClass") == "SYNTHETIC_MISSING_NO_STORE" && Number(h, "automaticStatusWrites") == 0 && Number(h, "automaticStatusCredentialCalls") == 0, "STATUS_SIDE_EFFECT_REJECTED");
        Require(String(h, "filesystemClass") == "SYNTHETIC_MEMORY" && Number(h, "applicationPathReads") == 0 && Number(h, "applicationPathWrites") == 0, "APPLICATION_PATH_IO_REJECTED");
        object paths; Require(h.TryGetValue("privateWritePaths", out paths) && paths is object[] && ((object[])paths).Length == 0, "PRIVATE_WRITE_ALLOWLIST_REJECTED");
        object memoryPaths; Require(h.TryGetValue("syntheticWritePaths", out memoryPaths) && memoryPaths is object[] && ((object[])memoryPaths).Length == 1
            && ((object[])memoryPaths)[0] is string && ((string)((object[])memoryPaths)[0]) == "synthetic-app/data/sessions.json", "SYNTHETIC_WRITE_ALLOWLIST_REJECTED");
        object observations; Require(h.TryGetValue("observations", out observations) && observations is object[] && ((object[])observations).Length == 11, "APPLICATION_OBSERVATIONS_REQUIRED");
        string[] methods = { "GET", "GET", "POST", "POST", "GET", "GET", "GET", "POST", "POST", "GET", "GET" };
        string[] routes = { "/api/v1/ask-gpt/status", "/api/v1/ask-gpt/status", "/api/auth/login", "/api/auth/login", "/api/session",
            "/api/v1/ask-gpt/status", "/api/v1/ask-gpt/status", "/api/v1/ask-gpt/accounts", "/api/v1/ask-gpt/accounts", "/", "/api/v1/observed-flow" };
        int[] statuses = { 401, 401, 401, 200, 200, 200, 200, 403, 403, 200, 200 };
        for (int i = 0; i < methods.Length; i++)
        {
            var item = ((object[])observations)[i] as Dictionary<string, object>; Require(item != null, "APPLICATION_OBSERVATION_REJECTED");
            ExactKeys(item, "method", "route", "status", "responseSHA256");
            Require(String(item, "method") == methods[i] && String(item, "route") == routes[i] && Number(item, "status") == statuses[i] && HashShape(String(item, "responseSHA256")), "APPLICATION_OBSERVATION_REJECTED");
            if (i == 9) Require(String(item, "responseSHA256") == "72959ff2fe1488b2e0ddd8a7f092c49f07f134b3883a5fa976b4e6cba2070e7f", "STATIC_HTML_RESPONSE_REJECTED");
        }
    }
    static void VerifyNormalHandshake(Dictionary<string, object> h, Proc child, string intentHash)
    {
        Require(String(h, "schema") == "cru21-normal-entry-listening-v1" && String(h, "windowId") == WindowId && String(h, "nonce") == Nonce
            && String(h, "productHead") == CurrentProductHead && String(h, "productTree") == CurrentProductTree && String(h, "intentHash") == intentHash
            && String(h, "helperSHA256") == ExpectedNormalEntrySHA256, "NORMAL_LISTENING_BINDING_REJECTED");
        Require(Number(h, "pid") == child.Pid && N.GetProcessId(child.Process) == child.Pid && Creation(child.Process) > 0 && !child.Exited, "NORMAL_ORIGINAL_HANDLE_REJECTED");
        var listener = Bag(h, "listener");
        if (NormalCandidateMetadata == null) ExactKeys(listener, "address", "port", "originalHandlerForwarded");
        else
        {
            ExactKeys(listener, "address", "port", "originalHandlerForwarded", "transport", "certificatePinSHA256", "peerAuthorized", "peerIdentityVerified");
            Require(String(h, "candidateSHA256") == CanonicalHash(NormalCandidateMetadata)
                && String(listener, "transport") == "https" && String(listener, "certificatePinSHA256") == String(Bag(NormalCandidateMetadata, "certificate"), "certificatePinSHA256")
                && IsBool(listener, "peerAuthorized", true) && IsBool(listener, "peerIdentityVerified", true), "NORMAL_TLS_PEER_BINDING_REJECTED");
        }
        Require(String(listener, "address") == "127.0.0.1" && Number(listener, "port") == NormalListenerPort() && IsBool(listener, "originalHandlerForwarded", true)
            && IsBool(h, "normalAuthConfigured", true), "NORMAL_LISTENER_REJECTED");
        // Configuration and listening are not proof that Owner logged in or
        // accepted the page. No account/ciphertext/model request is issued here.
    }
    static bool? ObserveNormalPortFree()
    {
        Require(NormalCandidate && NormalCloseProbeApproved, "NORMAL_CLOSE_PROBE_NOT_APPROVED");
        System.Net.Sockets.Socket probe = null; bool? result = null;
        try
        {
            probe = new System.Net.Sockets.Socket(System.Net.Sockets.AddressFamily.InterNetwork, System.Net.Sockets.SocketType.Stream, System.Net.Sockets.ProtocolType.Tcp);
            probe.ExclusiveAddressUse = true;
            probe.Bind(new System.Net.IPEndPoint(System.Net.IPAddress.Loopback, NormalListenerPort())); result = true;
        }
        catch { result = null; } // Occupied/denied/uncertain: no retry or takeover.
        finally { if (probe != null) try { probe.Dispose(); } catch { result = null; } }
        return result;
    }
    static int Run(IntPtr observer)
    {
        OpenAuthority(false); Require(Text(Read(Window, "ticket.json", 65536)).Trim() == Ticket(), "TICKET_CHANGED");
        long start = Mono, wallStart = Wall;
        if (NormalCandidate)
        {
            Require(wallStart >= NormalNotBeforeTicks && wallStart < NormalExpiresTicks, "NORMAL_APPROVAL_EXPIRED");
            Duration = Math.Min(900000, (NormalExpiresTicks - wallStart) / TimeSpan.TicksPerMillisecond);
            Require(Duration >= 1000, "NORMAL_APPROVAL_EXPIRED");
        }
        string binding = Json("windowId", WindowId, "nonce", Nonce, "manifestSha256", ManifestSHA256, "runtimeAllowed", false);
        Write(Authority, "guard.json", binding); Write(Authority, "consumed.json", binding);
        if (NormalCandidate) Write(NormalPermanentAuthority, ".cru21-normal-window-consumed.json", binding);
        string intent = BindNormalCandidate(Json("schema", "cru21-candidate-integration-intent-v1", "mode", CurrentMode, "runtimeAllowed", false,
            "windowId", WindowId, "nonce", Nonce, "productHead", CurrentProductHead, "productTree", CurrentProductTree,
            "startMonoMs", start, "startUtcTicks", wallStart, "durationMs", Duration, "manifestSha256", ManifestSHA256));
        Write(Window, "intent.json", intent); string intentHash = Hash(Bytes(intent));
        byte[] normalTicket = NormalCandidate ? CreateNormalTicket(intentHash) : null;
        byte[] inputProgram = NormalCandidate ? null : IsolatedProgram(intent);
        IntPtr job = NewJob(); Proc child = null;
        var stopped = new ManualResetEvent(false); var done = new ManualResetEvent(false);
        object admission = new object(); bool stopRequested = false, terminateAttempted = false, handshake = false; long stoppedAt = 0; string reason = "UNKNOWN"; Exception monitorError = null, inputError = null;
        Thread inputWriter = null;
        var monitor = new Thread(delegate()
        {
            try
            {
                while (true)
                {
                    if (Mono - start >= Duration - 100 || Wall >= wallStart + (Duration - 100) * TimeSpan.TicksPerMillisecond) { reason = "EARLY_DEADLINE_STOP"; break; }
                    lock (admission) { if (child != null && child.Exited) { reason = "APPLICATION_UNEXPECTED_EXIT"; break; } }
                    if (done.WaitOne(10)) return;
                }
                lock (admission) { stopRequested = true; terminateAttempted = true; stoppedAt = Mono; N.Check(N.TerminateJobObject(job, 0xc021)); }
            }
            catch (Exception e)
            {
                monitorError = e; reason = "MONITOR_UNVERIFIED";
                // Never repeat a failed termination request. Main closes this
                // original Job after joining us, then observes the original child.
                lock (admission) { stopRequested = true; }
            }
            finally { stopped.Set(); }
        });
        monitor.IsBackground = true; monitor.Start();
        try
        {
            lock (admission)
            {
                Require(!stopRequested && Mono - start < Duration - 100 && Wall < wallStart + (Duration - 100) * TimeSpan.TicksPerMillisecond, "EXPIRED_BEFORE_SPAWN");
                child = Spawn(job, true, new IntPtr[0]);
            }
            // Normal admission leases/hash-verifies actual code while its only
            // thread is still suspended. No I/O holds the deadline monitor lock.
            if (NormalCandidate) inputProgram = NormalProgram(normalTicket, child);
            lock (admission)
            {
                Require(!stopRequested && Mono - start < Duration - 100 && Wall < wallStart + (Duration - 100) * TimeSpan.TicksPerMillisecond, "EXPIRED_BEFORE_RESUME");
                N.Check(N.ResumeThread(child.Thread) != UInt32.MaxValue);
            }
            // A Node "-" process must run before its bounded input writer starts.
            // Pipe I/O is never performed under the admission/deadline lock.
            inputWriter = new Thread(delegate() { try { WriteInput(child, inputProgram); } catch (Exception e) { inputError = e; } });
            inputWriter.IsBackground = true; inputWriter.Start();
            byte[] handshakeBytes = ReadPipeLine(child, start, wallStart); var h = Object(handshakeBytes);
            Require(inputWriter.Join(2000) && inputError == null, "ISOLATED_INPUT_UNVERIFIED");
            if (NormalCandidate) VerifyNormalHandshake(h, child, intentHash); else VerifyHandshake(h, child, intentHash); handshake = true;
            // Only the original Node inherited the anonymous pipe write end.
            // A preexisting path receipt cannot authenticate a writer and instead fails.
            Write(Window, "app-handshake.json", Text(handshakeBytes));
            Write(Window, "launch.json", Json("schema", "cru21-candidate-integration-launch-v1", "windowId", WindowId, "intentHash", intentHash,
                "pidEvidenceOnly", child.Pid, "creationFileTime", Creation(child.Process), "handshakeSha256", Hash(Read(Window, "app-handshake.json", 262144)),
                "productHead", CurrentProductHead, "productTree", CurrentProductTree, "normalAuthVerified", !NormalCandidate,
                "normalAuthConfigured", NormalCandidate, "normalListeningVerified", NormalCandidate, "runtimeAllowed", false));
            if (observer != IntPtr.Zero)
            {
                IntPtr duplicate; N.Check(N.DuplicateHandle(N.GetCurrentProcess(), child.Process, observer, out duplicate, SyncQuery, false, 0));
                Console.WriteLine(Json("handle", duplicate.ToInt64(), "creationFileTime", Creation(child.Process), "pidEvidenceOnly", child.Pid, "nonce", Nonce));
            }
            stopped.WaitOne(); Require(monitorError == null, "MONITOR_UNVERIFIED"); AwaitExit(child.Process, 5000);
            bool? portFree = null;
            if (NormalCandidate) portFree = ObserveNormalPortFree();
            // Probe completion is not deadline grace. Both original clocks are
            // sampled after its Dispose, and a late/uncertain close stays UNKNOWN.
            long elapsed = Mono - start; bool timely = elapsed <= Duration && Wall <= wallStart + Duration * TimeSpan.TicksPerMillisecond;
            bool clean = reason == "EARLY_DEADLINE_STOP" && timely && (!NormalCandidate || portFree == true);
            if (NormalCandidate && portFree != true) reason = "CANDIDATE_LISTENER_UNVERIFIED";
            else if (!timely) reason = "DEADLINE_EXIT_UNVERIFIED";
            Write(Window, "terminal.json", Json("phase", clean ? "CLOSED" : "UNKNOWN", "reason", reason, "windowId", WindowId,
                "handshakeVerified", handshake, "childExited", true, "stopElapsedMs", stoppedAt - start, "observedExitElapsedMs", elapsed,
                "durationMs", Duration, "timelyObservedExit", timely, "listenerOpened", NormalCandidate, "runtimeAllowed", false,
                "portFreeAtCloseObservation", portFree.HasValue ? (object)portFree.Value : null, "candidateListenerProbe", NormalCandidate ? "BIND_ONLY" : "NOT_RUN",
                "hardDeadlineProven", false, "nativeAuthorityIntegrated", true, "guardRetained", true));
            Console.WriteLine(Text(Read(Window, "terminal.json", 65536)).Trim()); return clean ? 0 : 2;
        }
        catch
        {
            lock (admission) { if (!terminateAttempted) { stopRequested = true; terminateAttempted = true; N.TerminateJobObject(job, 0xc021); } }
            done.Set(); if (!monitor.Join(2000)) Environment.Exit(71);
            // Passive containment after an uncertain/failed first request uses
            // only the original last Job handle, never a new process lookup.
            N.CloseHandle(job); job = IntPtr.Zero;
            if (child != null) AwaitExit(child.Process, 5000);
            if (inputWriter != null && !inputWriter.Join(2000)) Environment.Exit(71);
            try { Write(Window, "unknown.json", Json("phase", "UNKNOWN", "childExited", child == null || child.Exited, "runtimeAllowed", false, "guardRetained", true)); } catch { }
            throw;
        }
        finally
        {
            done.Set(); if (!monitor.Join(2000)) Environment.Exit(71);
            if (job != IntPtr.Zero) N.CloseHandle(job);
            if (inputWriter != null && !inputWriter.Join(2000)) Environment.Exit(71);
            if (child != null) child.Dispose(); stopped.Dispose(); done.Dispose();
        }
    }
    static int HostDeathSuite()
    {
        OpenAuthority(false); Require(Text(Read(Window, "ticket.json", 65536)).Trim() == Ticket(), "TICKET_CHANGED");
        IntPtr outer = NewJob(), observer; Proc host = null; IntPtr node = IntPtr.Zero;
        N.Check(N.DuplicateHandle(N.GetCurrentProcess(), N.GetCurrentProcess(), N.GetCurrentProcess(), out observer, SyncQuery | DuplicateAccess, true, 0));
        try
        {
            host = Spawn(outer, false, new IntPtr[] { observer }, "--isolated-host-child", Root, WindowId, observer.ToInt64().ToString(), Creation(observer).ToString());
            N.Check(N.ResumeThread(host.Thread) != UInt32.MaxValue);
            byte[] handoffBytes = ReadPipeLine(host, Mono, Wall); var handoff = Object(handoffBytes);
            Require(String(handoff, "nonce") == Nonce, "HOST_DEATH_NONCE_REJECTED");
            node = new IntPtr(Number(handoff, "handle")); Require(node != IntPtr.Zero && Creation(node) == Number(handoff, "creationFileTime") && N.GetProcessId(node) == Number(handoff, "pidEvidenceOnly") && !Exited(node), "ORIGINAL_NODE_OBSERVER_REJECTED");
            Write(Window, "observer-handoff.json", Text(handoffBytes));
            StopProcess(host.Process); AwaitExit(node, 5000);
            Write(Window, "host-death-result.json", Json("test", "actual-normal-application-host-death", "status", "PASS", "handshakeVerified", true, "originalHostHandleStopped", true, "originalNodeObserverSignaled", true, "pidReopened", false, "runtimeAllowed", false));
            Console.WriteLine(Text(Read(Window, "host-death-result.json", 65536)).Trim()); return 0;
        }
        finally { N.CloseHandle(outer); if (host != null) { AwaitExit(host.Process, 5000); host.Dispose(); } if (node != IntPtr.Zero) N.CloseHandle(node); N.CloseHandle(observer); }
    }
    static int LiveGate()
    {
        Console.WriteLine(Json("allowed", false, "reason", "HARD_DEADLINE_FAULT_MODEL_UNRESOLVED", "runtimeAllowed", false, "spawnCount", 0)); return 2;
    }
    static int PlanNormal()
    {
        Require(HashShape(ExpectedNormalEntrySHA256), "NORMAL_ENTRY_NOT_FROZEN");
        var artifacts = Directories[Path.Combine(Root, "artifacts")];
        Require(HashFile(ReadLease(artifacts, "application-normal-entry.mjs", 1048576)) == ExpectedNormalEntrySHA256, "NORMAL_ENTRY_HASH_REJECTED");
        string entry = Path.Combine(Root, "artifacts", "application-normal-entry.mjs");
        string ticket = Path.Combine(Root, "authority", "windows", WindowId, "normal-ticket.json");
        // A plan is not an authorization or an imported application. The normal
        // entry validates its separate exact ticket before any normal bootstrap.
        Console.WriteLine("{\"mode\":\"NORMAL_CANDIDATE\",\"allowed\":false,\"runtimeAllowed\":false,\"spawnCount\":0,"
            + "\"productHead\":" + Q(CurrentProductHead) + ",\"productTree\":" + Q(CurrentProductTree)
            + ",\"executable\":" + Q(NodePath) + ",\"nodeSha256\":" + Q(NodeSHA256) + ",\"entrySha256\":" + Q(ExpectedNormalEntrySHA256)
            + ",\"argv\":[" + Q("--input-type=module") + "," + Q("--experimental-vm-modules") + "," + Q("-") + "," + Q(Root) + "," + Q(WindowId) + "," + Q(Nonce) + "]"
            + ",\"entryTransport\":\"ORIGINAL_INHERITED_STDIN_VERIFIED_CODE\""
            + ",\"normalTicketPath\":" + Q(ticket) + ",\"normalTicketValidated\":false,\"sourceClosureLeases\":\"NOT_RUN\",\"listener\":\"NOT_RUN\""
            + ",\"approvalSource\":\"ISOLATED_MANIFEST_NOT_NORMAL_AUTHORIZATION\",\"reason\":\"HARD_DEADLINE_FAULT_MODEL_UNRESOLVED\"}");
        return 2;
    }
    static string Canonical(object value)
    {
        if (value == null) return "null";
        if (value is string) return Q((string)value);
        if (value is bool) return (bool)value ? "true" : "false";
        var map = value as Dictionary<string, object>;
        if (map != null)
        {
            var keys = new List<string>(map.Keys); keys.Sort(StringComparer.Ordinal); var pieces = new List<string>();
            foreach (string key in keys) pieces.Add(Q(key) + ":" + Canonical(map[key]));
            return "{" + System.String.Join(",", pieces.ToArray()) + "}";
        }
        var array = value as object[];
        if (array != null) { var pieces = new List<string>(); foreach (object item in array) pieces.Add(Canonical(item)); return "[" + System.String.Join(",", pieces.ToArray()) + "]"; }
        Require(value is int || value is long || value is double || value is decimal, "CANONICAL_VALUE_REJECTED");
        return Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture);
    }
    static string CanonicalHash(object value) { return Hash(new UTF8Encoding(false, true).GetBytes(Canonical(value))); }
    static void RequireLocalFixedPath(string path)
    {
        Require(path != null && System.Text.RegularExpressions.Regex.IsMatch(path, "^[A-Za-z]:[\\\\/]") && path.IndexOf('\0') < 0, "LOCAL_FIXED_DRIVE_REQUIRED");
        string drive = Path.GetPathRoot(Path.GetFullPath(path));
        Require(new DriveInfo(drive).DriveType == DriveType.Fixed, "LOCAL_FIXED_DRIVE_REQUIRED");
    }
    static Dictionary<string, object> Bag(Dictionary<string, object> value, string key)
    {
        object item; Require(value.TryGetValue(key, out item) && item is Dictionary<string, object>, "OBJECT_FIELD_REJECTED"); return (Dictionary<string, object>)item;
    }
    static bool SamePath(string left, string right) { return System.String.Equals(Path.GetFullPath(left).TrimEnd('\\'), Path.GetFullPath(right).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase); }
    static bool Within(string parent, string child)
    {
        string p = Path.GetFullPath(parent).TrimEnd('\\'), c = Path.GetFullPath(child).TrimEnd('\\');
        return SamePath(p, c) || c.StartsWith(p + "\\", StringComparison.OrdinalIgnoreCase);
    }
    static void CheckCodeSecurity(IntPtr handle, bool directory, bool existingAncestor = false)
    {
        IntPtr owner, group, dacl, sacl, descriptor;
        uint error = N.GetSecurityInfo(handle, 1, 5, out owner, out group, out dacl, out sacl, out descriptor);
        if (error != 0) throw new Win32Exception(checked((int)error));
        try
        {
            uint length = N.GetSecurityDescriptorLength(descriptor); Require(length > 0 && length < 1048576, "CODE_SECURITY_DESCRIPTOR_REJECTED");
            byte[] bytes = new byte[length]; Marshal.Copy(descriptor, bytes, 0, bytes.Length);
            var sd = new RawSecurityDescriptor(bytes, 0);
            var trusted = new HashSet<string>(StringComparer.Ordinal) { WindowsIdentity.GetCurrent().User.Value, "S-1-5-18", "S-1-5-32-544", "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464" };
            Require(sd.Owner != null && trusted.Contains(sd.Owner.Value) && sd.DiscretionaryAcl != null && sd.DiscretionaryAcl.Count > 0, "CODE_NAMESPACE_OWNER_REJECTED");
            uint allowed = 1u | 8u | 32u | 128u | 131072u | 1048576u | 0x80000000u | 0x20000000u;
            // Creating a sibling below an existing outer ancestor cannot
            // replace this selected child. Actual executable code namespaces
            // never permit foreign additions, including ADD_SUBDIRECTORY.
            if (directory && existingAncestor) allowed |= 4u;
            foreach (GenericAce entry in sd.DiscretionaryAcl)
            {
                var ace = entry as CommonAce; Require(ace != null && !ace.IsCallback && ace.SecurityIdentifier != null, "CODE_NAMESPACE_ACE_REJECTED");
                Require(ace.AceQualifier == AceQualifier.AccessAllowed || ace.AceQualifier == AceQualifier.AccessDenied, "CODE_NAMESPACE_ACE_REJECTED");
                if (directory && (ace.AceFlags & AceFlags.InheritOnly) != 0) continue;
                if (ace.AceQualifier == AceQualifier.AccessAllowed && !trusted.Contains(ace.SecurityIdentifier.Value))
                    Require((unchecked((uint)ace.AccessMask) & ~allowed) == 0, "UNTRUSTED_CODE_NAMESPACE_WRITE");
            }
        }
        finally { N.LocalFree(descriptor); }
    }
    static void CheckProgramNamespace(string path, FileStream file)
    {
        RequireLocalFixedPath(path);
        string parent = Path.GetDirectoryName(Path.GetFullPath(path)); HoldParents(parent);
        for (string current = parent; current != null; current = Path.GetDirectoryName(current))
        {
            CheckCodeSecurity(Directories[current].Handle, true, !SamePath(current, parent));
            if (current == Path.GetPathRoot(current)) break;
        }
        CheckCodeSecurity(file.SafeFileHandle.DangerousGetHandle(), false);
    }
    static Dir CodeDirectory(string path)
    {
        HoldParents(path); string current = Path.GetFullPath(path);
        for (string p = current; p != null; p = Path.GetDirectoryName(p))
        {
            CheckCodeSecurity(Directories[p].Handle, true, !SamePath(p, current));
            if (p == Path.GetPathRoot(p)) break;
        }
        return Directories[current];
    }
    static FileStream CodeFile(Dir directory, string relative, string expected)
    {
        Require(!System.String.IsNullOrEmpty(relative) && relative.IndexOfAny(new char[] { '\\', ':', '\0' }) < 0 && !relative.StartsWith("/", StringComparison.Ordinal) && HashShape(expected), "FIXED_CODE_PATH_REJECTED");
        string[] parts = relative.Split('/'); Dir dir = directory;
        for (int i = 0; i < parts.Length; i++)
        {
            Require(parts[i] != "" && parts[i] != "." && parts[i] != "..", "FIXED_CODE_PATH_REJECTED");
            if (i + 1 < parts.Length) { dir = Child(dir, parts[i], false); CheckCodeSecurity(dir.Handle, true); }
        }
        var file = ReadLease(dir, parts[parts.Length - 1], 134217728); CheckCodeSecurity(file.SafeFileHandle.DangerousGetHandle(), false);
        Require(HashFile(file) == expected, "NORMAL_CODE_BYTES_CHANGED"); return file;
    }
    static void EnumerateVendor(Dir dir, string relative, HashSet<string> files)
    {
        CheckCodeSecurity(dir.Handle, true);
        string[] before = Directory.GetFileSystemEntries(dir.PathName); Array.Sort(before, StringComparer.Ordinal);
        foreach (string path in before)
        {
            string name = Path.GetFileName(path); Require(name != "" && name != "." && name != ".." && name.IndexOfAny(new char[] { '/', '\\', ':', '\0' }) < 0, "VENDOR_FILENAME_REJECTED");
            FileAttributes attributes = File.GetAttributes(path); Require((attributes & FileAttributes.ReparsePoint) == 0, "VENDOR_ALIAS_REJECTED");
            string key = relative + "/" + name;
            if ((attributes & FileAttributes.Directory) != 0) EnumerateVendor(Child(dir, name, false), key, files);
            else { Require(files.Count < 10000 && files.Add(key), "VENDOR_FILES_REJECTED"); }
        }
        string[] after = Directory.GetFileSystemEntries(dir.PathName); Array.Sort(after, StringComparer.Ordinal);
        Require(System.String.Join("\0", before) == System.String.Join("\0", after), "VENDOR_DIRECTORY_CHANGED");
    }
    // Dormant normal admission implementation. run-normal refuses before this
    // function or any site I/O. This is code, not a claim of a Windows run.
    static Dictionary<string, object> BuildNormalAdmission(byte[] ticketBytes, Proc child)
    {
        Require(child != null && child.IsNode && !child.Exited && N.GetProcessId(child.Process) == child.Pid, "NORMAL_ORIGINAL_NODE_REQUIRED");
        Require(Hash(ticketBytes) == Hash(Read(Window, "normal-ticket.json", 1048576)), "NORMAL_ORIGINAL_TICKET_REQUIRED");
        var ticket = Object(ticketBytes);
        var ticketKeys = new List<string>(new string[] { "schema", "mode", "runtimeAllowed", "windowId", "nonce", "productHead", "productTree", "sourceManifestSHA256", "durationMs", "roots", "node", "git", "helperSHA256", "normalAuth", "intentHash", "vendor" });
        if (ticket.ContainsKey("candidate")) ticketKeys.Add("candidate"); ExactKeys(ticket, ticketKeys.ToArray());
        var candidate = ValidateNormalCandidate(ticket);
        Require((candidate == null && NormalCandidateMetadata == null) || (candidate != null && NormalCandidateMetadata != null
            && CanonicalHash(candidate) == CanonicalHash(NormalCandidateMetadata)), "NORMAL_CANDIDATE_BINDING_REJECTED");
        Require(String(ticket, "schema") == "cru21-normal-entry-ticket-v1" && String(ticket, "mode") == "NORMAL_CANDIDATE" && IsBool(ticket, "runtimeAllowed", false)
            && String(ticket, "windowId") == WindowId && String(ticket, "nonce") == Nonce && String(ticket, "productHead") == CurrentProductHead && String(ticket, "productTree") == CurrentProductTree
            && Number(ticket, "durationMs") == 900000 && String(ticket, "sourceManifestSHA256") == CurrentNormalSourceManifestSHA256
            && HashShape(String(ticket, "intentHash")) && String(ticket, "intentHash") == Hash(Read(Window, "intent.json", 65536)), "NORMAL_TICKET_REJECTED");
        var roots = Bag(ticket, "roots"); ExactKeys(roots, "sourceRoot", "chartReadRoot", "producerDataRoot", "projectionRoot", "snapshotPath", "statusPath", "privateDataRoot", "localAppDataRoot", "chartCacheRoot", "evidenceRoot");
        foreach (string key in roots.Keys) RequireLocalFixedPath(String(roots, key));
        string sourcePath = String(roots, "sourceRoot"), privatePath = String(roots, "privateDataRoot"), producer = String(roots, "producerDataRoot"), chart = String(roots, "chartReadRoot");
        Require(SamePath(privatePath, Path.Combine(sourcePath, "data")) && SamePath(String(roots, "localAppDataRoot"), Path.Combine(privatePath, "candidate-local-appdata"))
            && SamePath(String(roots, "chartCacheRoot"), Path.Combine(privatePath, "dashboard-chart-cache"))
            && SamePath(String(roots, "projectionRoot"), Path.Combine(producer, "runtime", "cru34-live"))
            && SamePath(String(roots, "snapshotPath"), Path.Combine(String(roots, "projectionRoot"), "latest.json"))
            && SamePath(String(roots, "statusPath"), Path.Combine(String(roots, "projectionRoot"), "status.json"))
            && SamePath(String(roots, "evidenceRoot"), Path.Combine(privatePath, "cru21-normal-candidate", WindowId)), "NORMAL_ROOT_RELATION_REJECTED");
        string[] disjoint = { sourcePath, chart, producer };
        for (int i = 0; i < disjoint.Length; i++) for (int j = i + 1; j < disjoint.Length; j++)
            Require(!Within(disjoint[i], disjoint[j]) && !Within(disjoint[j], disjoint[i]), "NORMAL_SPLIT_ROOT_REJECTED");
        Require(!Within(chart, String(roots, "evidenceRoot")) && !Within(String(roots, "evidenceRoot"), chart)
            && !Within(producer, String(roots, "evidenceRoot")) && !Within(String(roots, "evidenceRoot"), producer), "NORMAL_EVIDENCE_ROOT_REJECTED");
        var auth = Bag(ticket, "normalAuth"); ExactKeys(auth, "passwordHashSource", "sessionPath", "csrfRequired", "guest");
        Require(String(auth, "passwordHashSource") == "EXISTING_PROCESS_ENV:DASHBOARD_PASSWORD_HASH" && SamePath(String(auth, "sessionPath"), Path.Combine(privatePath, "sessions.json"))
            && IsBool(auth, "csrfRequired", true) && IsBool(auth, "guest", false), "NORMAL_AUTH_REJECTED");
        var artifacts = Directories[Path.Combine(Root, "artifacts")];
        FileStream helper = ReadLease(artifacts, "application-normal-entry.mjs", 1048576); byte[] helperBytes = ReadAll(helper);
        Require(Hash(helperBytes) == ExpectedNormalEntrySHA256 && String(ticket, "helperSHA256") == ExpectedNormalEntrySHA256, "NORMAL_HELPER_REJECTED");
        string text = Text(helperBytes), marker = NormalSourceMarker;
        int begin = text.IndexOf(marker, StringComparison.Ordinal); Require(begin >= 0 && begin == text.LastIndexOf(marker, StringComparison.Ordinal), "NORMAL_FIXED_MANIFEST_REJECTED");
        begin += marker.Length; int end = text.IndexOf(");", begin, StringComparison.Ordinal); Require(end > begin, "NORMAL_FIXED_MANIFEST_REJECTED");
        var sourceFiles = Object(new UTF8Encoding(false, true).GetBytes(text.Substring(begin, end - begin)));
        string sourceWrapper = "{\"schema\":\"cru21-normal-source-closure-v1\",\"productHead\":" + Q(CurrentProductHead) + ",\"productTree\":" + Q(CurrentProductTree) + ",\"files\":" + Canonical(sourceFiles) + "}";
        Require(sourceFiles.Count == CurrentNormalSourceFileCount && CurrentNormalSourceFileCount > 0 && Hash(new UTF8Encoding(false, true).GetBytes(sourceWrapper)) == CurrentNormalSourceManifestSHA256, "NORMAL_FIXED_MANIFEST_REJECTED");
        Dir source = CodeDirectory(sourcePath);
        foreach (string relative in sourceFiles.Keys) CodeFile(source, relative, String(sourceFiles, relative));
        // Data roots are held for canonical directory identity only; no live
        // snapshot/status contents are read or leased against Producer rotation.
        foreach (string key in new string[] { "chartReadRoot", "producerDataRoot", "projectionRoot" })
        {
            HoldParents(String(roots, key)); HoldDirectory(String(roots, key), false);
        }
        // Private/auth write namespaces must already be safely prepared. This
        // admission does not create them or repair their permissions.
        foreach (string key in new string[] { "privateDataRoot", "localAppDataRoot", "chartCacheRoot", "evidenceRoot" })
            CodeDirectory(String(roots, key));
        if (candidate != null) CodeDirectory(Path.Combine(privatePath, "decision-workspace"));
        var node = Bag(ticket, "node"); var git = Bag(ticket, "git"); ExactKeys(node, "path", "sha256"); ExactKeys(git, "path", "sha256");
        RequireLocalFixedPath(String(node, "path")); RequireLocalFixedPath(String(git, "path"));
        Require(SamePath(String(node, "path"), NodePath) && String(node, "sha256") == NodeSHA256 && SamePath(String(git, "path"), GitPath) && HashShape(String(git, "sha256")), "NORMAL_EXECUTABLE_REJECTED");
        CheckProgramNamespace(NodePath, NodeLease);
        Dir gitDir = CodeDirectory(Path.GetDirectoryName(GitPath)); var gitFile = ReadLease(gitDir, "git.exe", 134217728);
        CheckProgramNamespace(GitPath, gitFile); Require(HashFile(gitFile) == String(git, "sha256"), "NORMAL_GIT_BYTES_CHANGED");
        var vendor = Bag(ticket, "vendor"); ExactKeys(vendor, "manifestSHA256", "manifest"); var vm = Bag(vendor, "manifest");
        ExactKeys(vm, "schema", "productHead", "productTree", "lockSHA256", "packages", "files");
        Require(String(vm, "schema") == "cru21-normal-vendor-closure-v1" && String(vm, "productHead") == CurrentProductHead && String(vm, "productTree") == CurrentProductTree
            && String(vm, "lockSHA256") == String(sourceFiles, "package-lock.json") && CanonicalHash(vm) == String(vendor, "manifestSHA256"), "NORMAL_VENDOR_DESCRIPTOR_REJECTED");
        string[] names = { "@koromix/koffi-win32-x64", "fancy-canvas", "koffi", "lightweight-charts" }, versions = { "3.3.1", "2.1.0", "3.3.1", "5.2.0" };
        var packageLock = Object(ReadAll(CodeFile(source, "package-lock.json", String(sourceFiles, "package-lock.json")))); var lockedPackages = Bag(packageLock, "packages");
        object packageArray; Require(vm.TryGetValue("packages", out packageArray) && packageArray is object[] && ((object[])packageArray).Length == names.Length, "NORMAL_VENDOR_PACKAGES_REJECTED");
        var vendorFiles = Bag(vm, "files"); Require(vendorFiles.Count > names.Length && vendorFiles.Count < 10000, "NORMAL_VENDOR_FILES_REJECTED");
        foreach (string relative in vendorFiles.Keys)
        {
            Require(relative.IndexOfAny(new char[] { '\\', ':', '\0' }) < 0 && !relative.StartsWith("/", StringComparison.Ordinal), "NORMAL_VENDOR_PATH_REJECTED");
            string[] parts = relative.Split('/'); foreach (string part in parts) Require(part != "" && part != "." && part != "..", "NORMAL_VENDOR_PATH_REJECTED");
            bool prefix = false; foreach (string name in names) if (relative.StartsWith(name + "/", StringComparison.Ordinal)) prefix = true;
            Require(prefix && HashShape(String(vendorFiles, relative)), "NORMAL_VENDOR_PATH_REJECTED");
        }
        Dir vendorRoot = CodeDirectory(Path.Combine(sourcePath, "node_modules")); var actualFiles = new HashSet<string>(StringComparer.Ordinal); long total = 0;
        for (int i = 0; i < names.Length; i++)
        {
            var package = ((object[])packageArray)[i] as Dictionary<string, object>; Require(package != null, "NORMAL_VENDOR_PACKAGE_REJECTED"); ExactKeys(package, "name", "version", "lockIntegrity");
            var locked = Bag(lockedPackages, "node_modules/" + names[i]);
            Require(String(package, "name") == names[i] && String(package, "version") == versions[i] && String(locked, "version") == versions[i] && String(package, "lockIntegrity") == String(locked, "integrity"), "NORMAL_VENDOR_VERSION_REJECTED");
            Dir packageDir = CodeDirectory(Path.Combine(sourcePath, "node_modules", names[i].Replace('/', '\\'))); EnumerateVendor(packageDir, names[i], actualFiles);
        }
        Require(actualFiles.SetEquals(vendorFiles.Keys), "NORMAL_VENDOR_FILE_SET_CHANGED");
        foreach (string relative in vendorFiles.Keys)
        {
            var file = CodeFile(vendorRoot, relative, String(vendorFiles, relative)); total += file.Length; Require(total <= 268435456, "NORMAL_VENDOR_SIZE_REJECTED");
        }
        // Future normal launch: retain the exact encrypted TLS file and its safe
        // namespace until original child exit. No host-side decryption or trust change.
        if (candidate != null)
        {
            var certificate = Bag(candidate, "certificate"); string bundle = String(certificate, "bundlePath");
            Dir certificateDirectory = CodeDirectory(Path.GetDirectoryName(bundle));
            CodeFile(certificateDirectory, Path.GetFileName(bundle), String(certificate, "bundleSHA256"));
        }
        N.FILE_INFO identity; N.Check(N.GetFileInformationByHandle(source.Handle, out identity));
        var rootIdentity = new Dictionary<string, object> { { "volumeSerial", identity.Volume.ToString("x8") }, { "fileId", identity.IndexHigh.ToString("x8") + identity.IndexLow.ToString("x8") } };
        var leases = new Dictionary<string, object> { { "sourceFiles", sourceFiles.Count }, { "sourceSHA256", CurrentNormalSourceManifestSHA256 }, { "vendorFiles", vendorFiles.Count },
            { "vendorSHA256", CanonicalHash(vm) }, { "node", true }, { "helper", true }, { "git", true }, { "namespacePolicy", "NO_UNTRUSTED_NAMESPACE_WRITES" } };
        var admissionRecord = new Dictionary<string, object> {
            { "schema", "cru21-normal-native-admission-v1" }, { "mode", "NORMAL_CANDIDATE" }, { "productHead", CurrentProductHead }, { "productTree", CurrentProductTree },
            { "ticketSHA256", CanonicalHash(ticket) }, { "sourceManifestSHA256", CurrentNormalSourceManifestSHA256 }, { "vendorManifestSHA256", CanonicalHash(vm) },
            { "helperSHA256", ExpectedNormalEntrySHA256 }, { "nodeSHA256", HashFile(NodeLease) }, { "gitSHA256", HashFile(gitFile) }, { "rootsSHA256", CanonicalHash(roots) },
            { "childPid", (long)child.Pid }, { "childCreationFileTime", Creation(child.Process).ToString(System.Globalization.CultureInfo.InvariantCulture) },
            { "sourceRootIdentity", rootIdentity }, { "leases", leases }, { "transport", "ORIGINAL_INHERITED_PIPE" }, { "lifetime", "UNTIL_ORIGINAL_CHILD_EXIT" }, { "qualified", true }
        };
        if (candidate != null) admissionRecord["candidateSHA256"] = CanonicalHash(candidate);
        return admissionRecord;
    }
    static byte[] NormalProgram(byte[] ticketBytes, Proc child)
    {
        // Only a future explicitly admitted normal launch could call this.
        // Public run-normal currently returns HOLD before any site I/O/spawn.
        var record = BuildNormalAdmission(ticketBytes, child);
        var artifacts = Directories[Path.Combine(Root, "artifacts")];
        byte[] entry = ReadAll(ReadLease(artifacts, "application-normal-entry.mjs", 1048576));
        Require(Hash(entry) == ExpectedNormalEntrySHA256, "NORMAL_ENTRY_CHANGED");
        var packet = new Dictionary<string, object> {
            { "schema", "cru21-normal-stdin-admission-v1" }, { "authorityRoot", Root },
            { "ticket", Object(ticketBytes) }, { "nativeAdmission", record }, { "entrySourceUTF8", Text(entry) }
        };
        string prefix = "const CRU21_NORMAL_INPUT_PACKET=JSON.parse(Buffer.from(" + Q(Convert.ToBase64String(new UTF8Encoding(false, true).GetBytes(Canonical(packet)))) + ",'base64').toString('utf8'));\n";
        string footer = "\nconst __cru21NormalResult=await bootstrapNormalEntry({root:process.argv[2],windowId:process.argv[3],nonce:process.argv[4]});process.stdout.write(JSON.stringify(__cru21NormalResult)+'\\n');\n";
        byte[] program = Bytes(prefix + Text(entry) + footer); Require(program.Length < 2097152, "NORMAL_PROGRAM_TOO_LARGE"); return program;
    }
    static int Main(string[] args)
    {
        try
        {
            if (args.Length == 1 && args[0] == "live-gate")
                return LiveGate();
            // Reject before reading any caller-controlled manifest, setting or
            // normal ticket. A self-written runtimeAllowed flag cannot unlock it.
            if (args.Length >= 1 && args[0] == "run-normal")
            {
                if (!NormalGateAllows()) return LiveGate();
                Require(args.Length == 3, "NORMAL_FIXED_ARGUMENTS_REQUIRED");
                Configure(args[1], true); Require(args[2] == WindowId, "NORMAL_WINDOW_BINDING_REJECTED");
                PrepareNormalAuthority(); return Run(IntPtr.Zero);
            }
            Require(args.Length >= 2, "FIXED_COMMAND_REQUIRED"); Configure(args[1]);
            if (args.Length == 2 && args[0] == "prepare-isolated") return Prepare();
            Require(args.Length >= 3 && args[2] == WindowId, "WINDOW_BINDING_REJECTED");
            if (args.Length == 3 && args[0] == "run-isolated") return Run(IntPtr.Zero);
            if (args.Length == 3 && args[0] == "suite-host-death") return HostDeathSuite();
            if (args.Length == 3 && args[0] == "plan-normal") return PlanNormal();
            if (args.Length == 5 && args[0] == "--isolated-host-child")
            {
                long number = 0, creation = 0; Require(Int64.TryParse(args[3], out number) && number > 0 && Int64.TryParse(args[4], out creation) && creation > 0, "INHERITED_OBSERVER_REJECTED");
                IntPtr observer = new IntPtr(number);
                Require(Creation(observer) == creation && N.GetProcessId(observer) == N.GetParentProcessId(), "ORIGINAL_PARENT_HANDLE_REQUIRED");
                return Run(observer);
            }
            throw new InvalidOperationException("FIXED_COMMAND_REQUIRED");
        }
        catch (Exception e) { Console.Error.WriteLine("ISOLATED_APPLICATION_HOLD " + e.GetType().Name + ":" + e.Message); return 1; }
        finally { for (int i = Leases.Count - 1; i >= 0; i--) Leases[i].Dispose(); }
    }
    sealed class Dir : IDisposable
    {
        internal IntPtr Handle; internal string PathName;
        internal static Dir Open(string path, bool writable)
        {
            IntPtr h = N.CreateFile(path, writable ? 0x001200a7u : 0x001200a1u, 3, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
            N.Check(h != new IntPtr(-1)); var d = new Dir { Handle = h, PathName = path };
            try
            {
                d.Check(); var canonical = new StringBuilder(32768);
                uint length = N.GetFinalPathNameByHandle(h, canonical, canonical.Capacity, 0);
                Require(length > 0 && length < canonical.Capacity, "CANDIDATE_CANONICAL_PATH_UNAVAILABLE");
                string final = canonical.ToString(); if (final.StartsWith("\\\\?\\", StringComparison.Ordinal)) final = final.Substring(4);
                Require(System.String.Equals(final.TrimEnd('\\'), System.IO.Path.GetFullPath(path).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase), "CANDIDATE_PATH_ALIAS_REJECTED");
                return d;
            }
            catch { d.Dispose(); throw; }
        }
        void Check()
        {
            N.FILE_INFO info; N.Check(N.GetFileInformationByHandle(Handle, out info));
            Require((info.Attributes & 0x10) != 0 && (info.Attributes & 0x400) == 0, "CANDIDATE_DIRECTORY_REPARSE_REJECTED");
        }
        IntPtr OpenRelative(string name, uint access, uint disposition, bool directory, uint fileSharing = 1)
        {
            Require(name.Length > 0 && name.IndexOfAny(new char[] { '/', '\\', ':', '\0' }) < 0 && name != "." && name != "..", "CANDIDATE_FILENAME_INVALID");
            Check(); IntPtr text = Marshal.StringToHGlobalUni(name), unicode = IntPtr.Zero;
            try
            {
                var str = new N.US { Length = checked((ushort)(name.Length * 2)), MaximumLength = checked((ushort)((name.Length + 1) * 2)), Buffer = text };
                unicode = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(N.US))); Marshal.StructureToPtr(str, unicode, false);
                var oa = new N.OA { Length = Marshal.SizeOf(typeof(N.OA)), Root = Handle, Name = unicode, Attributes = 0x1040 };
                IntPtr h; N.IOSB status;
                uint sharing = directory ? 3u : fileSharing;
                int nt = N.NtCreateFile(out h, access, ref oa, out status, IntPtr.Zero, 0x80, sharing, disposition,
                    0x00200020 | (directory ? 1u : 0x40u), IntPtr.Zero, 0);
                if (nt < 0) throw new IOException("CANDIDATE_NATIVE_IO_" + unchecked((uint)nt).ToString("x8"));
                N.FILE_INFO info; if (!N.GetFileInformationByHandle(h, out info) || (info.Attributes & 0x400) != 0 || (!directory && info.Links != 1)) { N.CloseHandle(h); throw new IOException("CANDIDATE_FILE_ALIAS_REJECTED"); }
                return h;
            }
            finally { if (unicode != IntPtr.Zero) Marshal.FreeHGlobal(unicode); Marshal.FreeHGlobal(text); }
        }
        internal Dir NewDirectory(string name) { return new Dir { Handle = OpenRelative(name, 0x001200a7, 2, true), PathName = System.IO.Path.Combine(PathName, name) }; }
        internal Dir ExistingDirectory(string name) { return new Dir { Handle = OpenRelative(name, 0x001200a7, 1, true), PathName = System.IO.Path.Combine(PathName, name) }; }
        internal FileStream CreateFile(string name) { return new FileStream(new SafeFileHandle(OpenRelative(name, 0xc0100080, 2, false), true), FileAccess.ReadWrite); }
        internal FileStream ReadFile(string name) { return new FileStream(new SafeFileHandle(OpenRelative(name, 0x80100080, 1, false), true), FileAccess.Read); }
        public void Dispose() { if (Handle != IntPtr.Zero) { N.CloseHandle(Handle); Handle = IntPtr.Zero; } }
    }

    internal static class N
    {
        [DllImport("advapi32.dll", SetLastError=true)] internal static extern uint GetSecurityInfo(IntPtr handle, int kind, uint info, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
        [DllImport("advapi32.dll")] internal static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
        [DllImport("kernel32.dll")] internal static extern IntPtr LocalFree(IntPtr memory);
        [StructLayout(LayoutKind.Sequential)] internal struct SA { internal int Length; internal IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] internal bool Inherit; }
        [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref SA security, uint size);
        [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
        [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool PeekNamedPipe(IntPtr pipe, IntPtr buffer, uint size, IntPtr read, out uint available, IntPtr left);
        [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool ReadFile(IntPtr file, byte[] buffer, uint size, out uint read, IntPtr overlap);
        [DllImport("kernel32.dll", SetLastError=true)] internal static extern bool WriteFile(IntPtr file, byte[] buffer, uint size, out uint written, IntPtr overlap);
        [DllImport("kernel32.dll", SetLastError=true)] internal static extern uint GetProcessId(IntPtr process);
        [StructLayout(LayoutKind.Sequential)] internal struct PBI { internal IntPtr Reserved1, Peb, Reserved2, Reserved3, Pid, ParentPid; }
        [DllImport("ntdll.dll")] internal static extern int NtQueryInformationProcess(IntPtr process, int kind, out PBI info, int length, out int returned);
        internal static uint GetParentProcessId()
        {
            PBI info; int returned;
            if (NtQueryInformationProcess(GetCurrentProcess(), 0, out info, Marshal.SizeOf(typeof(PBI)), out returned) < 0) throw new InvalidOperationException("ORIGINAL_PARENT_QUERY_UNAVAILABLE");
            return checked((uint)info.ParentPid.ToInt64());
        }
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
    }
}
