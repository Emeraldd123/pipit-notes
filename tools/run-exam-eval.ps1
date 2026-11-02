# Asks for your Anthropic API key in a small window, then runs the exam evaluation with it.
# The key is only held in memory for this run: it is not saved to disk or shown on screen.
#   npm run eval:exam                    (or: powershell -ExecutionPolicy Bypass -File tools/run-exam-eval.ps1)
#   npm run eval:exam -- --only bio,econ (extra options are passed to tools/exam-eval.mjs)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "Pipit Notes - exam evaluation"
$form.Size = New-Object System.Drawing.Size(460, 190)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true

$label = New-Object System.Windows.Forms.Label
$label.Text = "Paste your Anthropic API key (it is only used for this run):"
$label.Location = New-Object System.Drawing.Point(14, 16)
$label.Size = New-Object System.Drawing.Size(420, 20)
$form.Controls.Add($label)

$box = New-Object System.Windows.Forms.TextBox
$box.Location = New-Object System.Drawing.Point(14, 44)
$box.Size = New-Object System.Drawing.Size(414, 24)
$box.UseSystemPasswordChar = $true
$form.Controls.Add($box)

$ok = New-Object System.Windows.Forms.Button
$ok.Text = "Run"
$ok.Location = New-Object System.Drawing.Point(262, 98)
$ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
$form.AcceptButton = $ok
$form.Controls.Add($ok)

$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = "Cancel"
$cancel.Location = New-Object System.Drawing.Point(352, 98)
$cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.CancelButton = $cancel
$form.Controls.Add($cancel)

$form.Add_Shown({ $box.Focus() })
$result = $form.ShowDialog()
$key = $box.Text.Trim()
$form.Dispose()

if ($result -ne [System.Windows.Forms.DialogResult]::OK -or -not $key) { Write-Host "Cancelled - nothing was run."; exit 1 }

$env:ANTHROPIC_API_KEY = $key
try {
  Set-Location (Join-Path $PSScriptRoot "..")
  node tools/exam-eval.mjs @args
} finally {
  Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
  $key = $null
}
