"""Windows integration regression; synthetic credentials only, no SDK/network."""
import ast
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'broker'))
from bridge_startup_diagnostics import StartupDiagnostics, StartupStage, decode_credential_reader_failure


@unittest.skipUnless(os.name == 'nt', 'Windows PowerShell integration')
class ReaderEnvironmentTests(unittest.TestCase):
    def test_python_inherits_foreign_module_path_but_reader_uses_native_host_modules(self):
        source = ast.parse((ROOT / 'broker/shioaji_readonly_bridge.py').read_text(encoding='utf-8'))
        function = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == 'load_credentials')
        namespace = dict(Path=Path, Any=object, os=os, subprocess=subprocess, sys=sys, json=json,
                         STARTUP_DIAGNOSTICS=StartupDiagnostics(), StartupStage=StartupStage,
                         decode_credential_reader_failure=decode_credential_reader_failure,
                         CREDENTIAL_READER=ROOT / 'scripts/read-shioaji-credentials.ps1')
        exec(compile(ast.Module(body=[function], type_ignores=[]), '<actual-loader>', 'exec'), namespace)
        with tempfile.TemporaryDirectory(prefix='synthetic-reader-') as directory:
            temp = Path(directory)
            foreign = temp / 'foreign' / 'Microsoft.PowerShell.Security'
            foreign.mkdir(parents=True)
            (foreign / 'Microsoft.PowerShell.Security.psd1').write_text("@{ModuleVersion='99.0';RootModule='foreign.psm1';FunctionsToExport=@('ConvertTo-SecureString');GUID='b3239e3d-a398-43a6-8713-7ae252810147'}")
            (foreign / 'foreign.psm1').write_text("throw 'SYNTHETIC_FOREIGN_MODULE_MUST_NOT_LOAD'")
            # Create only a temporary synthetic fixture using the native host.
            native_env = {key:value for key,value in os.environ.items() if key.upper() != 'PSMODULEPATH'}
            native_env['SYNTHETIC_READER_OUTPUT'] = str(temp / 'synthetic.json')
            script = "$ErrorActionPreference='Stop'; $secure=ConvertTo-SecureString -String 'SYNTHETIC_TEST_ONLY' -AsPlainText -Force; $cipher=ConvertFrom-SecureString $secure; @{version=1;protection='windows-dpapi-current-user';production=$false;apiKey=$cipher;secretKey=$cipher} | ConvertTo-Json | Set-Content -LiteralPath $env:SYNTHETIC_READER_OUTPUT -Encoding UTF8"
            setup = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', script], capture_output=True, text=True, env=native_env, timeout=20, creationflags=subprocess.CREATE_NO_WINDOW)
            self.assertEqual(setup.returncode, 0, 'synthetic setup failed; raw child output intentionally suppressed')
            with patch.dict(os.environ, {'PSModulePath':str(foreign.parent)}):
                captured = io.StringIO()
                with contextlib.redirect_stderr(captured):
                    payload = namespace['load_credentials'](temp / 'synthetic.json')
                self.assertEqual(payload, {'apiKey':'SYNTHETIC_TEST_ONLY','secretKey':'SYNTHETIC_TEST_ONLY','production':False})
                self.assertEqual(os.environ['PSModulePath'], str(foreign.parent))
                self.assertEqual(captured.getvalue(), '')


if __name__ == '__main__':
    unittest.main()
