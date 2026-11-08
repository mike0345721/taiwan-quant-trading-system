# ASCII source, compatible with Windows PowerShell 5.1. No policy override.
param([Parameter(Mandatory=$true)][string]$BindingPath)
$ErrorActionPreference = 'Stop'
if (-not [Environment]::UserInteractive -or [Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') {
    throw 'Run manually in an interactive MSI desktop: powershell.exe -NoProfile -STA -File <this-script> -BindingPath <verified-binding.json>'
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = New-Object Windows.Forms.Form
$form.Text = 'Owner local acceptance v1 - HTTP - NOT PRODUCTION'
$form.ClientSize = New-Object Drawing.Size(720, 540)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$notice = New-Object Windows.Forms.Label
$notice.SetBounds(20, 15, 680, 225)
$notice.Text = @"
OWNER LOCAL ACCEPTANCE / HTTP / NOT LIVE QUALIFIED
Machine: $([Environment]::MachineName)

Only http://localhost:18723 on this MSI. No TLS encryption or server identity.
Do not share, forward, proxy or tunnel this address. Trust all users signed into
this machine. This mode cannot protect against same-user/admin tampering or
OS suspension. It does not use the old native persistent namespace locks or
an unconditional 15-minute hard deadline. This is acceptance, not production.

Secure + HttpOnly + SameSite=Strict cookies remain enabled. Whether this
browser accepts Secure cookies on localhost HTTP must be verified by you.
Missing/stale LIVE/Flow remains unavailable; no producer is started.
Keep this window open. Stop or close it to stop only this candidate.
No binding/source/private/auth access or listener until you accept below.
"@
$form.Controls.Add($notice)
$agree = New-Object Windows.Forms.CheckBox
$agree.SetBounds(20, 248, 680, 35)
$agree.Text = 'I am the Owner on MSI and accept these risks for this interactive launch only.'
$agree.Checked = $false
$form.Controls.Add($agree)
$label = New-Object Windows.Forms.Label
$label.SetBounds(20, 292, 680, 25)
$label.Text = 'New dedicated candidate password (12+ characters; never reuse the formal password):'
$form.Controls.Add($label)
$password = New-Object Windows.Forms.TextBox
$password.SetBounds(20, 322, 330, 28)
$password.UseSystemPasswordChar = $true
$password.MaxLength = 1024
$form.Controls.Add($password)
$confirm = New-Object Windows.Forms.TextBox
$confirm.SetBounds(370, 322, 330, 28)
$confirm.UseSystemPasswordChar = $true
$confirm.MaxLength = 1024
$form.Controls.Add($confirm)
$hint = New-Object Windows.Forms.Label
$hint.SetBounds(370, 353, 320, 22)
$hint.Text = 'Repeat the new candidate password'
$form.Controls.Add($hint)
$status = New-Object Windows.Forms.Label
$status.SetBounds(20, 390, 680, 60)
$status.Text = 'OFF. No launch consent recorded. Binding will be verified after acceptance.'
$form.Controls.Add($status)
$start = New-Object Windows.Forms.Button
$start.SetBounds(20, 470, 210, 40)
$start.Text = 'Accept risks and start candidate'
$start.Enabled = $false
$form.Controls.Add($start)
$stop = New-Object Windows.Forms.Button
$stop.SetBounds(490, 470, 210, 40)
$stop.Text = 'Cancel / Stop candidate'
$form.Controls.Add($stop)
$script:child = $null
$script:childStarted = $false
$script:lineTask = $null
$script:errorTask = $null
$script:started = $false
$script:browserOpened = $false
$update = { $start.Enabled = -not $script:started -and $agree.Checked -and $password.Text.Length -ge 12 -and $password.Text -ceq $confirm.Text }
$agree.Add_CheckedChanged($update)
$password.Add_TextChanged($update)
$confirm.Add_TextChanged($update)
function Stop-OwnerChild {
    if ($null -ne $script:child) {
        if ($script:childStarted -and -not $script:child.HasExited) {
            try { $script:child.StandardInput.WriteLine('STOP'); $script:child.StandardInput.Close() } catch {}
            if (-not $script:child.WaitForExit(11000)) { $script:child.Kill(); $script:child.WaitForExit() }
        }
        $script:child.Dispose()
        $script:child = $null
        $script:childStarted = $false
    }
}
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 200
$timer.Add_Tick({
    if ($null -eq $script:child) { return }
    if ($script:lineTask -and $script:lineTask.IsCompleted) {
        $line = $script:lineTask.GetAwaiter().GetResult()
        if ($line -ceq 'OWNER_LOCAL_LISTENING http://localhost:18723 | HTTP | NOT PRODUCTION | NOT LIVE QUALIFIED') {
            $status.Text = 'HTTP candidate listening. Manually open http://localhost:18723/ and log in with the new password. NOT LIVE QUALIFIED.'
            if (-not $script:browserOpened) {
                $script:browserOpened = $true
                try { Start-Process -FilePath 'http://localhost:18723/' -ErrorAction Stop | Out-Null } catch { }
            }
        }
        $script:lineTask = $script:child.StandardOutput.ReadLineAsync()
    }
    if ($script:child.HasExited) {
        $reason = 'STOPPED_OR_UNAVAILABLE'
        if ($script:errorTask.IsCompleted) {
            $errorText = $script:errorTask.GetAwaiter().GetResult()
            $match = [regex]::Match($errorText, '(?m)^(?:OWNER|MARKET_CANDIDATE)_[A-Z0-9_]+\r?$')
            if ($match.Success) { $reason = $match.Value.Trim() }
        }
        $status.Text = 'Candidate stopped/rejected: ' + $reason + '. No HTTPS/native acceptance.'
        $timer.Stop()
    }
})
$start.Add_Click({
    if (-not $agree.Checked -or $password.Text.Length -lt 12 -or $password.Text -cne $confirm.Text -or $script:started) { return }
    $script:started = $true
    $start.Enabled = $false
    $agree.Enabled = $false
    try {
        $node = (Get-Command node.exe -CommandType Application).Source
        $info = New-Object Diagnostics.ProcessStartInfo
        $info.FileName = $node
        $info.Arguments = '"' + (Join-Path $PSScriptRoot 'start-owner-local-acceptance.mjs') + '"'
        $info.WorkingDirectory = Split-Path $PSScriptRoot -Parent
        $info.UseShellExecute = $false
        $info.CreateNoWindow = $true
        $info.RedirectStandardInput = $true
        $info.RedirectStandardOutput = $true
        $info.RedirectStandardError = $true
        $info.EnvironmentVariables.Clear()
        foreach ($name in @('SystemRoot','WINDIR','PATH','PATHEXT','TEMP','TMP','COMSPEC')) {
            $value = [Environment]::GetEnvironmentVariable($name)
            if ($value) { $info.EnvironmentVariables[$name] = $value }
        }
        $script:child = New-Object Diagnostics.Process
        $script:child.StartInfo = $info
        if (-not $script:child.Start()) { throw 'OWNER_CHILD_NOT_STARTED' }
        $script:childStarted = $true
        $script:lineTask = $script:child.StandardOutput.ReadLineAsync()
        $script:errorTask = $script:child.StandardError.ReadToEndAsync()
        $frame = @{accepted=$true; riskVersion='owner-local-http-risk-v1'; password=$password.Text; bindingPath=$BindingPath} | ConvertTo-Json -Compress
        $password.Clear(); $confirm.Clear()
        # Windows PowerShell 5.1 lacks ProcessStartInfo.StandardInputEncoding.
        # Write UTF-8 bytes directly; no BOM, console encoding or transcript copy.
        $bytes = [Text.Encoding]::UTF8.GetBytes($frame + "`n")
        try {
            $script:child.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
            $script:child.StandardInput.BaseStream.Flush()
        } finally { [Array]::Clear($bytes, 0, $bytes.Length); $bytes = $null }
        $frame = $null
        $status.Text = 'Verifying source/bindings. This window owns only this candidate process.'
        $timer.Start()
    } catch {
        Stop-OwnerChild
        $status.Text = 'Startup failed. Candidate stopped. No approval receipt was created.'
    } finally {
        $frame = $null
        $password.Clear(); $confirm.Clear()
        $password.Enabled = $false; $confirm.Enabled = $false
    }
})
$stop.Add_Click({ $form.Close() })
$form.Add_FormClosing({ $timer.Stop(); Stop-OwnerChild; $password.Clear(); $confirm.Clear() })
try { [void]$form.ShowDialog() } finally { Stop-OwnerChild; $timer.Dispose(); $form.Dispose() }
