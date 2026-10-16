' Ollama for AYAS production: only this process and its children use D temp.
Option Explicit
Dim fso, shell, projectDir, productionRoot, tempRoot, executable, service, processes, process, showRequested, launchStyle, launchArgs
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
' Keep a partly downloaded model across restarts: by default Ollama prunes
' unfinished blobs when it starts, so a reboot mid-download starts it over
' (2026-10-16: gemma4:12b lost that way). The owner's "Indir ve olc" downloads
' in slices over several observer rounds and relies on this.
shell.Environment("Process")("OLLAMA_NOPRUNE") = "1"
shell.CurrentDirectory = productionRoot
showRequested = False
launchStyle = 0
' Ollama starts without its window only when it sees it was opened from a
' Startup shortcut; launched through this script it cannot tell, and opened
' its chat window at every logon. "hidden" asks for the tray-only start.
launchArgs = " hidden"
If WScript.Arguments.Count > 0 Then
  If WScript.Arguments.Count <> 1 Then WScript.Quit 78
  If WScript.Arguments(0) <> "--show" Then WScript.Quit 78
  showRequested = True
  launchStyle = 1
  launchArgs = ""
End If
Set service = GetObject("winmgmts:{impersonationLevel=impersonate}!\\.\root\cimv2")
Set processes = service.ExecQuery("SELECT ExecutablePath FROM Win32_Process WHERE Name = 'ollama app.exe'")
For Each process In processes
  If Not IsNull(process.ExecutablePath) Then
    If LCase(process.ExecutablePath) = LCase(executable) And Not showRequested Then WScript.Quit 0
  End If
Next
shell.Run """" & executable & """" & launchArgs, launchStyle, False
WScript.Quit 0
