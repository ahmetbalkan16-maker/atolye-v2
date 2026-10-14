' AYAS Autonomy Observer hidden launcher: the logon target for wscript.exe.
' Runs scripts\ayas-autonomy-daemon.ps1 -Continuous (its M25 bounded restart
' loop) with no window, like ayas-access-hidden.vbs. Every path comes from this
' file's own location (<production>\Atolye\atolye-v2\scripts), so a copied
' production bundle on a new PC needs no edits and the file stays ASCII-only.
' Only this process tree uses the bundle temp and npm cache; Windows env is not
' changed. Output: <production>\handover\observer-task-native.log.
Option Explicit
Dim fso, shell, scriptsDir, projectDir, productionRoot, powershell, daemon, tempRoot, cacheRoot, handover, hostLog, nativeLog, logFile, command, rc
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scriptsDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectDir = fso.GetParentFolderName(scriptsDir)
productionRoot = fso.GetParentFolderName(fso.GetParentFolderName(projectDir))
powershell = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
daemon = fso.BuildPath(scriptsDir, "ayas-autonomy-daemon.ps1")
tempRoot = fso.BuildPath(productionRoot, "private\temp")
cacheRoot = fso.BuildPath(productionRoot, "private\npm-cache")
handover = fso.BuildPath(productionRoot, "handover")
If Not fso.FileExists(daemon) Or Not fso.FolderExists(tempRoot) Or Not fso.FolderExists(handover) Then WScript.Quit 78
shell.Environment("Process")("TEMP") = tempRoot
shell.Environment("Process")("TMP") = tempRoot
If fso.FolderExists(cacheRoot) Then shell.Environment("Process")("NPM_CONFIG_CACHE") = cacheRoot
hostLog = fso.BuildPath(handover, "observer-task-host.log")
nativeLog = fso.BuildPath(handover, "observer-task-native.log")
Set logFile = fso.OpenTextFile(hostLog, 8, True, -1)
logFile.WriteLine "BOOT " & Now & " " & WScript.ScriptFullName
logFile.Close
shell.CurrentDirectory = projectDir
command = """" & powershell & """ -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command ""& '" & Replace(daemon, "'", "''") & "' -Continuous *> '" & Replace(nativeLog, "'", "''") & "'; exit $LASTEXITCODE"""
rc = shell.Run(command, 0, True)
WScript.Quit rc
