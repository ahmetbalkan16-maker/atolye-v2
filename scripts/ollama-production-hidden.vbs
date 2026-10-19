' Ollama for AYAS production: only this process and its children use D temp.
Option Explicit
Dim fso, shell, projectDir, productionRoot, tempRoot, executable, service, processes, process, showRequested, launchStyle, launchArgs, userModels, smi, os, uptime, waited
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
' The model store moved to the NVMe disk (owner decision 2026-10-19). A caller started before that change
' still carries the old OLLAMA_MODELS, so the user's current value wins.
userModels = shell.Environment("User")("OLLAMA_MODELS")
If userModels <> "" Then shell.Environment("Process")("OLLAMA_MODELS") = userModels
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
' A logon start can come before the NVIDIA driver answers: Ollama then finds no GPU and runs every model on the
' CPU (2026-10-19 11:30, three minutes per answer). Wait until 90 s after boot and until nvidia-smi lists a GPU,
' at most 90 s more. Without the NVIDIA tool there is nothing to wait for.
For Each os In service.ExecQuery("SELECT SystemUpTime FROM Win32_PerfFormattedData_PerfOS_System")
  uptime = CLng(os.SystemUpTime)
Next
If uptime > 0 And uptime < 90 Then WScript.Sleep (90 - uptime) * 1000
smi = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\nvidia-smi.exe"
If fso.FileExists(smi) Then
  For waited = 1 To 45
    If shell.Run("""" & smi & """ -L", 0, True) = 0 Then Exit For
    WScript.Sleep 2000
  Next
End If
shell.Run """" & executable & """" & launchArgs, launchStyle, False
WScript.Quit 0
