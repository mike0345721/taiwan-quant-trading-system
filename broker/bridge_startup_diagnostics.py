"""Pure, bounded startup diagnostics; no SDK, filesystem, network, or logging."""
from enum import Enum
import json
import subprocess


class StartupStage(str, Enum):
    UNKNOWN = "UNKNOWN"
    SINGLETON = "SINGLETON"
    BIND = "BIND"
    WRITER_START = "WRITER_START"
    SIGNAL_SETUP = "SIGNAL_SETUP"
    CREDENTIAL_READ = "CREDENTIAL_READ"
    CREDENTIAL_PARSE = "CREDENTIAL_PARSE"
    SDK_CREATE = "SDK_CREATE"
    LOGIN = "LOGIN"
    LIFECYCLE_START = "LIFECYCLE_START"
    CALLBACK_BIND = "CALLBACK_BIND"
    CORE_SUBSCRIBE = "CORE_SUBSCRIBE"
    OPTIONAL_SUBSCRIBE = "OPTIONAL_SUBSCRIBE"
    LIFECYCLE_READY = "LIFECYCLE_READY"
    WATCHDOG_START = "WATCHDOG_START"
    SERVE = "SERVE"
    CLEANUP = "CLEANUP"


# Exact types only: subclass names and overridden attributes are untrusted.
_EXCEPTION_TYPES = (
    OSError, PermissionError, FileNotFoundError, FileExistsError,
    ConnectionError, ConnectionRefusedError, ConnectionResetError,
    ConnectionAbortedError, BrokenPipeError, TimeoutError,
    subprocess.CalledProcessError, json.JSONDecodeError,
    KeyError, LookupError, AttributeError, TypeError, ValueError, RuntimeError,
)
_OS_TYPES = (
    OSError, PermissionError, FileNotFoundError, FileExistsError,
    ConnectionError, ConnectionRefusedError, ConnectionResetError,
    ConnectionAbortedError, BrokenPipeError, TimeoutError,
)
_ERRNO_CODES = frozenset((2, 5, 13, 17, 22, 24, 28, 32, 98, 99, 100, 101, 104, 110, 111, 113))
_WINERROR_CODES = frozenset((2, 3, 5, 32, 183, 10013, 10048, 10049, 10050, 10051, 10054, 10060, 10061, 11001))
_CHILD_EXIT_CODES = frozenset((1, 2, 126, 127))
_FORMAT_FAILURE = '{"schemaVersion":1,"event":"bridge_startup_failure","diagnosticStatus":"FORMAT_FAILED"}'


def _safe_code(error, error_type):
    if any(error_type is allowed for allowed in _OS_TYPES):
        windows_code = getattr(error, "winerror", None)
        if type(windows_code) is int:
            return {"domain": "WINERROR", "code": windows_code if windows_code in _WINERROR_CODES else "UNLISTED"}
        code = error.errno
        if type(code) is int:
            return {"domain": "ERRNO", "code": code if code in _ERRNO_CODES else "UNLISTED"}
    if error_type is subprocess.CalledProcessError:
        code = error.returncode
        return {"domain": "CHILD_EXIT", "code": code if type(code) is int and code in _CHILD_EXIT_CODES else "UNLISTED"}
    return None


def format_startup_failure(stage, error, *, role, prior_primary_failure=False):
    """Never inspect error text, stack, command, outputs, or arbitrary attributes."""
    try:
        error_type = type(error)
        exception_type = next(
            (allowed.__name__ for allowed in _EXCEPTION_TYPES if error_type is allowed),
            "OTHER_EXCEPTION",
        )
        record = {
            "schemaVersion": 1,
            "event": "bridge_startup_failure",
            "failureRole": role if type(role) is str and role in ("primary", "cleanup") else "unknown",
            "stage": stage.value if type(stage) is StartupStage else "UNKNOWN",
            "exceptionType": exception_type,
            "safeErrorCode": _safe_code(error, error_type),
            "priorPrimaryFailure": prior_primary_failure is True,
        }
        return json.dumps(record, ensure_ascii=True, separators=(",", ":"))
    except Exception:
        # Diagnostic failure must never replace the exception being diagnosed.
        return _FORMAT_FAILURE


class StartupDiagnostics:
    def __init__(self):
        self.stage = StartupStage.UNKNOWN
        self.failure_recorded = False
        self.primary_failure_recorded = False

    def failure(self, error, *, role):
        prior_primary = self.primary_failure_recorded
        self.failure_recorded = True
        if role == "primary":
            self.primary_failure_recorded = True
        return format_startup_failure(
            self.stage, error, role=role, prior_primary_failure=prior_primary,
        )


# Reader diagnostics are a separate, fixed wire contract. Never forward raw stderr.
_READER_STAGES = frozenset((
    "FILE_READ", "JSON_PARSE", "FORMAT_CHECK", "DPAPI_DECRYPT",
    "COMMAND_DISCOVERY", "DPAPI_CONVERT", "PARAMETER_BINDING",
    "MARSHAL", "SERIALIZE", "UNKNOWN",
))
_READER_TYPES = frozenset((
    "System.IO.IOException", "System.IO.FileNotFoundException",
    "System.IO.DirectoryNotFoundException", "System.UnauthorizedAccessException",
    "System.Security.Cryptography.CryptographicException",
    "System.ArgumentException", "System.InvalidOperationException", "System.FormatException",
    "System.Management.Automation.RuntimeException",
    "System.Management.Automation.PSArgumentException",
    "System.Management.Automation.PSInvalidOperationException",
    "System.Management.Automation.ItemNotFoundException",
    "System.Management.Automation.MethodInvocationException",
    "System.Management.Automation.ParameterBindingException",
    "System.Management.Automation.ParameterBindingValidationException",
    "System.Management.Automation.ParameterBindingArgumentTransformationException",
    "System.Management.Automation.PSInvalidCastException",
    "System.Management.Automation.CommandNotFoundException",
    "System.Management.Automation.PSSecurityException",
    "System.Management.Automation.CmdletInvocationException",
    "System.Management.Automation.ActionPreferenceStopException",
    "OTHER_EXCEPTION",
))
_READER_HRESULTS = frozenset((
    "0x80070002", "0x80070003", "0x80070005", "0x8007000D",
    "0x80070057", "0x80090005", "0x8009000B", "UNLISTED",
))
_READER_KEYS = frozenset(("schemaVersion", "event", "stage", "exceptions", "exitCode"))
_READER_EXCEPTION_KEYS = frozenset(("type", "hresult"))


def _unique_json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate key")
        result[key] = value
    return result


def _reject_json_constant(value):
    raise ValueError("non-finite JSON constant")


def _reader_record(record):
    if type(record) is not dict or set(record) != _READER_KEYS:
        return None
    if type(record["schemaVersion"]) is not int or record["schemaVersion"] != 1:
        return None
    if type(record["exitCode"]) is not int or record["exitCode"] != 1:
        return None
    if type(record["event"]) is not str or record["event"] != "shioaji_credential_reader_failure":
        return None
    stage = record["stage"]
    if type(stage) is not str or stage not in _READER_STAGES:
        return None
    exceptions = record["exceptions"]
    if type(exceptions) is not list or not 1 <= len(exceptions) <= 3:
        return None
    safe_exceptions = []
    for item in exceptions:
        if type(item) is not dict or set(item) != _READER_EXCEPTION_KEYS:
            return None
        exception_type, hresult = item["type"], item["hresult"]
        if type(exception_type) is not str or exception_type not in _READER_TYPES:
            return None
        if type(hresult) is not str or hresult not in _READER_HRESULTS:
            return None
        safe_exceptions.append({"type": exception_type, "hresult": hresult})
    return {
        "schemaVersion": 1,
        "event": "shioaji_credential_reader_failure",
        "stage": stage,
        "exceptions": safe_exceptions,
        "exitCode": 1,
    }


def decode_credential_reader_failure(stderr):
    """Return one rebuilt allowlisted JSON line, or None; never return child text."""
    try:
        if type(stderr) is not str or len(stderr) > 16 * 1024:
            return None
        if len(stderr.encode("utf-8")) > 16 * 1024:
            return None
        lines = stderr.splitlines()
        if len(lines) > 64 or any(len(line.encode("utf-8")) > 2 * 1024 for line in lines):
            return None
        selected = None
        for line in lines:
            if not line.lstrip().startswith("{"):
                continue
            record = json.loads(
                line, object_pairs_hook=_unique_json_object,
                parse_constant=_reject_json_constant,
            )
            safe = _reader_record(record)
            # A JSON-looking but invalid record makes the envelope ambiguous.
            if safe is None or selected is not None:
                return None
            selected = safe
        if selected is None:
            return None
        return json.dumps(selected, ensure_ascii=True, separators=(",", ":"))
    except Exception:
        return None
