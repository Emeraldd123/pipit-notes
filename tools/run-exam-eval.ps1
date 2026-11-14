# Asks for your Anthropic API key (and optionally a Gemini key) in a small window, then runs the exam evaluation (or the tuning loop) with it.
# The key is only held in memory for this run: it is not saved to disk or shown on screen.
#   npm run eval:exam                    (or: powershell -ExecutionPolicy Bypass -File tools/run-exam-eval.ps1)
#   npm run eval:exam -- --only bio,econ (extra options are passed to tools/exam-eval.mjs)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "Pipit Notes - exam tools"
$form.Size = New-Object System.Drawing.Size(460, 250)
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

$label2 = New-Object System.Windows.Forms.Label
$label2.Text = "Gemini API key (only for --writer gemini runs; leave empty otherwise):"
$label2.Location = New-Object System.Drawing.Point(14, 80)
$label2.Size = New-Object System.Drawing.Size(420, 20)
$form.Controls.Add($label2)

$box2 = New-Object System.Windows.Forms.TextBox
$box2.Location = New-Object System.Drawing.Point(14, 106)
$box2.Size = New-Object System.Drawing.Size(414, 24)
$box2.UseSystemPasswordChar = $true
$form.Controls.Add($box2)

$ok = New-Object System.Windows.Forms.Button
$ok.Text = "Run"
$ok.Location = New-Object System.Drawing.Point(262, 160)
$ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
$form.AcceptButton = $ok
$form.Controls.Add($ok)

$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = "Cancel"
$cancel.Location = New-Object System.Drawing.Point(352, 160)
$cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.CancelButton = $cancel
$form.Controls.Add($cancel)

$form.Add_Shown({ $box.Focus() })
$result = $form.ShowDialog()
$key = $box.Text.Trim()
$gkey = $box2.Text.Trim()
$form.Dispose()

if ($result -ne [System.Windows.Forms.DialogResult]::OK -or -not $key) { Write-Host "Cancelled - nothing was run."; exit 1 }

$env:ANTHROPIC_API_KEY = $key
if ($gkey) { $env:GEMINI_API_KEY = $gkey }
try {
  Set-Location (Join-Path $PSScriptRoot "..")
  # the first argument may name the tool to run (npm run tune:exam passes tools/exam-tune.mjs); the rest are its options
  $script = "tools/exam-eval.mjs"
  $rest = $args
  if ($args.Count -gt 0 -and "$($args[0])" -like "*.mjs") { $script = "$($args[0])"; $rest = @($args | Select-Object -Skip 1) }
  node $script @rest
} finally {
  Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:GEMINI_API_KEY -ErrorAction SilentlyContinue
  $key = $null
  $gkey = $null
}
