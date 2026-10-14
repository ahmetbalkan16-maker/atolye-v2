' Ollama for AYAS production: only this process and its children use D temp.
Option Explicit
Dim fso, shell, projectDir, productionRoot, tempRoot, executable, service, processes, process, showRequested, launchStyle
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
projectDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
productionRoot = fso.GetParentFolderName(fso.GetParentFolderName(projectDir))
tempRoot = fso.BuildPath(productionRoot, "private\temp")
executable = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\Ollama\ollama app.exe"
If Not fso.FolderExists(tempRoot) Or Not fso.FileExists(executable) Then WScript.Quit 78
shell.Environment("Process")("TEMP") = tempRoot
shell.Environment("Process")("TMP") = tempRoot
shell.Environment("Process")("OLLAMA_TMPDIR") = tempRoot
shell.CurrentDirectory = productionRoot
showRequested = False
launchStyle = 0
If WScript.Arguments.Count > 0 Then
  If WScript.Arguments.Count <> 1 Then WScript.Quit 78
  If WScript.Arguments(0) <> "--show" Then WScript.Quit 78
  showRequested = True
  launchStyle = 1
End If
Set service = GetObject("winmgmts:{impersonationLevel=impersonate}!\\.\root\cimv2")
Set processes = service.ExecQuery("SELECT ExecutablePath FROM Win32_Process WHERE Name = 'ollama app.exe'")
For Each process In processes
  If Not IsNull(process.ExecutablePath) Then
    If LCase(process.ExecutablePath) = LCase(executable) And Not showRequested Then WScript.Quit 0
  End If
Next
shell.Run """" & executable & """", launchStyle, False
WScript.Quit 0
