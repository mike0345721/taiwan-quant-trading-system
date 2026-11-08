# ASCII source, compatible with Windows PowerShell 5.1. No policy override.
param([Parameter(Mandatory=$true)][string]$BindingPath)
$ErrorActionPreference = 'Stop'
if (-not [Environment]::UserInteractive -or [Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') {
    throw 'Run manually in an interactive MSI desktop: powershell.exe -NoProfile -STA -File <this-script> -BindingPath <verified-binding.json>'
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
# Constant localized UI strings; ASCII source preserves Windows PowerShell 5.1 decoding.
$script:ownerUiText = ConvertFrom-Json '{"start":"\u958b\u59cb\u9a57\u6536\u7db2\u7ad9","stop":"\u53d6\u6d88\uff0f\u505c\u6b62\u5019\u9078\u7db2\u7ad9","checkbox":"\u6211\u5df2\u95b1\u8b80\u4e26\u63a5\u53d7\u4ee5\u4e0a\u672c\u6a5f HTTP \u98a8\u96aa\uff0c\u50c5\u540c\u610f\u672c\u6b21\u4e92\u52d5\u9a57\u6536\u3002","passwordLabel":"\u8a2d\u5b9a\u672c\u6b21\u9a57\u6536\u5c08\u7528\u5bc6\u78bc\uff08\u81f3\u5c11 12 \u500b\u5b57\u5143\uff1b\u4e0d\u8981\u6cbf\u7528\u6b63\u5f0f\u7248\u5bc6\u78bc\uff09\uff1a","confirm":"\u518d\u8f38\u5165\u4e00\u6b21\u76f8\u540c\u5bc6\u78bc\uff08\u5340\u5206\u5927\u5c0f\u5beb\uff09","risk":"\u5c1a\u672a\u555f\u52d5\uff1a\u8acb\u5148\u52fe\u9078\u4e0a\u65b9\u7684\u672c\u6a5f HTTP \u98a8\u96aa\u78ba\u8a8d\u3002","length":"\u5c1a\u672a\u555f\u52d5\uff1a\u5169\u683c\u5bc6\u78bc\u90fd\u9700\u81f3\u5c11 12 \u500b\u5b57\u5143\u3002\u76ee\u524d\u7b2c\u4e00\u683c {0} \u500b\uff0c\u7b2c\u4e8c\u683c {1} \u500b\u3002","mismatch":"\u5c1a\u672a\u555f\u52d5\uff1a\u5169\u6b21\u5bc6\u78bc\u4e0d\u4e00\u81f4\uff08\u5340\u5206\u5927\u5c0f\u5beb\uff0c\u7a7a\u767d\u4e5f\u7b97\u5b57\u5143\uff09\u3002\u8acb\u4fee\u6b63\u7b2c\u4e8c\u683c\u3002","ready":"\u8f38\u5165\u6aa2\u67e5\u5b8c\u6210\u3002\u8acb\u6309\u300c\u958b\u59cb\u9a57\u6536\u7db2\u7ad9\u300d\uff1b\u6210\u529f\u555f\u52d5\u5f8c\u624d\u6703\u958b\u555f\u700f\u89bd\u5668\u3002","tooLong":"\u5c1a\u672a\u555f\u52d5\uff1a\u5bc6\u78bc\u4e0d\u53ef\u8d85\u904e 1024 \u500b\u5b57\u5143\u3002"}'
$form = New-Object Windows.Forms.Form
$form.Text = 'Owner local acceptance v1.1 - HTTP - NOT PRODUCTION'
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
$agree.Text = $script:ownerUiText.checkbox
$agree.Checked = $false
$form.Controls.Add($agree)
$label = New-Object Windows.Forms.Label
$label.SetBounds(20, 292, 680, 25)
$label.Text = $script:ownerUiText.passwordLabel
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
$hint.Text = $script:ownerUiText.confirm
$form.Controls.Add($hint)
$status = New-Object Windows.Forms.Label
$status.SetBounds(20, 390, 680, 60)
$status.Text = $script:ownerUiText.risk
$form.Controls.Add($status)
$start = New-Object Windows.Forms.Button
$start.SetBounds(20, 470, 210, 40)
$start.Text = $script:ownerUiText.start
$start.Enabled = $true
$form.Controls.Add($start)
$stop = New-Object Windows.Forms.Button
$stop.SetBounds(490, 470, 210, 40)
$stop.Text = $script:ownerUiText.stop
$form.Controls.Add($stop)
$script:child = $null
$script:childStarted = $false
$script:lineTask = $null
$script:errorTask = $null
$script:started = $false
$script:browserOpened = $false
function Update-OwnerInputState {
    if ($script:started) { $start.Enabled = $false; return $false }
    # Always allow an explanation click before launch; never bypass consent/password checks.
    $start.Enabled = $true
    $firstLength = $password.TextLength
    $secondLength = $confirm.TextLength
    if (-not $agree.Checked) {
        $status.Text = $script:ownerUiText.risk
        return $false
    }
    if ($firstLength -lt 12 -or $secondLength -lt 12) {
        $status.Text = [string]::Format($script:ownerUiText.length, $firstLength, $secondLength)
        return $false
    }
    if ($firstLength -gt 1024 -or $secondLength -gt 1024) {
        $status.Text = $script:ownerUiText.tooLong
        return $false
    }
    if (-not [string]::Equals($password.Text, $confirm.Text, [StringComparison]::Ordinal)) {
        $status.Text = $script:ownerUiText.mismatch
        return $false
    }
    $status.Text = $script:ownerUiText.ready
    return $true
}
$update = { [void](Update-OwnerInputState) }
$agree.Add_CheckedChanged($update)
$password.Add_TextChanged($update)
$confirm.Add_TextChanged($update)
[void](Update-OwnerInputState)
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
    if ($script:started) { return }
    if (-not (Update-OwnerInputState)) { return }
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
