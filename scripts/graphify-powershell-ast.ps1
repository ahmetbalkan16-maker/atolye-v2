# Parses text supplied as JSON on stdin. Target scripts are NEVER invoked,
# dot-sourced, imported, or evaluated. Only the built-in parser visits their AST.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
$results = @()
foreach ($item in $inputData.files) {
  $tokens = $null
  $parseErrors = $null
  $tree = [System.Management.Automation.Language.Parser]::ParseInput([string]$item.text, [ref]$tokens, [ref]$parseErrors)
  $functions = @($tree.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true) | ForEach-Object {
    [ordered]@{ name = $_.Name; line = $_.Extent.StartLineNumber; offset = $_.Extent.StartOffset }
  })
  $commands = @($tree.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true) | ForEach-Object {
    $owner = $_.Parent
    while ($owner -and -not ($owner -is [System.Management.Automation.Language.FunctionDefinitionAst])) { $owner = $owner.Parent }
    [ordered]@{ name = $_.GetCommandName(); line = $_.Extent.StartLineNumber; offset = $_.Extent.StartOffset; ownerOffset = $(if ($owner) { $owner.Extent.StartOffset } else { $null }); invocation = $_.InvocationOperator.ToString() }
  })
  $literals = @($tree.FindAll({ param($n) $n -is [System.Management.Automation.Language.StringConstantExpressionAst] }, $true) | ForEach-Object {
    [ordered]@{ value = $_.Value; line = $_.Extent.StartLineNumber }
  })
  $results += [ordered]@{
    file = $item.file
    parser = 'System.Management.Automation.Language.Parser'
    version = $PSVersionTable.PSVersion.ToString()
    functions = $functions
    commands = $commands
    literals = $literals
    errors = @($parseErrors | ForEach-Object { [ordered]@{ id = $_.ErrorId; message = $_.Message; line = $_.Extent.StartLineNumber } })
  }
}
ConvertTo-Json -InputObject $results -Depth 8 -Compress
