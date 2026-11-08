# Actual WinForms controls/events with synthetic inputs only. Never reads the Owner dialog.
param([string]$SourceRoot = (Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference = 'Stop'
$launcher = Join-Path $SourceRoot 'scripts\start-owner-local-acceptance.ps1'
$code = [IO.File]::ReadAllText($launcher)
$marker = 'try { [void]$form.ShowDialog() }'
$cut = $code.LastIndexOf($marker)
if ($cut -lt 0) { throw 'FORM_TEST_BOUNDARY_MISSING' }
$tokens=$null; $parseErrors=$null
[void][Management.Automation.Language.Parser]::ParseInput($code,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw 'FORM_SOURCE_PARSE_FAILED' }
. ([scriptblock]::Create($code.Substring(0,$cut))) -BindingPath 'SYNTHETIC_NOT_OPENED.json'
$script:checks = New-Object 'System.Collections.Generic.List[object]'
function Check-Form([string]$Name,[bool]$Condition) {
    $script:checks.Add([pscustomobject]@{case=$Name;passed=$Condition})
}
try {
    $form.ShowInTaskbar=$false
    $form.StartPosition='Manual'
    $form.Location=New-Object Drawing.Point(-30000,-30000)
    $form.Opacity=0
    $form.Show()
    [Windows.Forms.Application]::DoEvents()
    Check-Form 'off_has_clickable_explanation_not_silent_disabled_button' $start.Enabled
    $initial=$status.Text
    $start.PerformClick()
    Check-Form 'unchecked_click_does_not_create_child' ($null -eq $script:child -and -not $script:started)
    $agree.Checked=$true
    [Windows.Forms.Application]::DoEvents()
    $empty=$status.Text
    Check-Form 'empty_input_has_distinct_feedback' ($empty -ne $initial)
    $password.Text='Only11chars'; $confirm.Text='Only11chars'
    [Windows.Forms.Application]::DoEvents()
    Check-Form 'length_feedback_updates_on_real_TextChanged' ($status.Text -ne $empty)
    Check-Form 'short_input_still_allows_explanation_click' $start.Enabled
    $start.PerformClick()
    Check-Form 'short_input_cannot_launch' ($null -eq $script:child -and -not $script:started)
    $password.Text='Fixture-Only-012345';$confirm.Text='fixture-Only-012345'
    [Windows.Forms.Application]::DoEvents()
    $mismatch=$status.Text
    Check-Form 'mismatch_distinguished_from_length' ($mismatch -ne $empty)
    $start.PerformClick()
    Check-Form 'case_mismatch_click_cannot_launch' ($null -eq $script:child -and -not $script:started)
    $confirm.Text='Fixture-Only-012345'
    [Windows.Forms.Application]::DoEvents()
    Check-Form 'matching_values_enable_start_and_show_ready' ($start.Enabled -and $status.Text -ne $mismatch)
    $ready=$status.Text
    $confirm.Text='Fixture-Only-012345 '
    [Windows.Forms.Application]::DoEvents()
    Check-Form 'trailing_password_space_is_not_silently_trimmed' ($status.Text -ne $ready)
    $start.PerformClick()
    Check-Form 'whitespace_mismatch_cannot_launch' ($null -eq $script:child -and -not $script:started)
    $confirm.Text='Fixture-Only-012345'
    $agree.Checked=$false
    [Windows.Forms.Application]::DoEvents()
    Check-Form 'revoking_checkbox_returns_to_risk_feedback' ($status.Text -eq $initial)
    $start.PerformClick()
    Check-Form 'revoked_consent_cannot_launch' ($null -eq $script:child -and -not $script:started)
    $script:started=$true
    $status.Text='SYNTHETIC_OPERATION_STATUS_DO_NOT_OVERWRITE'
    $password.Text='Fixture-Only-012346'
    [Windows.Forms.Application]::DoEvents()
    Check-Form 'running_state_remains_disabled_and_status_preserved' (-not $start.Enabled -and $status.Text -eq 'SYNTHETIC_OPERATION_STATUS_DO_NOT_OVERWRITE')
    Check-Form 'click_guard_precedes_started_and_child_creation' ($code -match '(?s)\$start\.Add_Click\(\{\s*if \(\$script:started\) \{ return \}\s*if \(-not \(Update-OwnerInputState\)\) \{ return \}\s*\$script:started = \$true')
    Check-Form 'checkbox_not_automatically_accepted' ($code.Contains('$agree.Checked = $false'))
    Check-Form 'masking_retained' ($password.UseSystemPasswordChar -and $confirm.UseSystemPasswordChar)
    Check-Form 'synthetic_test_opened_no_product_process' ($null -eq $script:child)
} finally {
    $script:started=$true
    $password.Clear();$confirm.Clear();$form.Close();$timer.Dispose();$form.Dispose()
}
$failed=@($script:checks | Where-Object { -not $_.passed })
[pscustomobject]@{evidence='REAL_WINFORMS_EVENTS_SYNTHETIC_ONLY';passed=$script:checks.Count-$failed.Count;failed=$failed.Count;cases=$script:checks;userInputsRead=$false;productStarted=$false;browserUsed=$false} | ConvertTo-Json -Depth 4
if ($failed.Count -gt 0) { exit 1 }
