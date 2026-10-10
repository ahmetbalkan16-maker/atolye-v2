' AYAS Access Online hidden launcher: the logon target for wscript.exe.
' Runs scripts\ayas-access-daemon.ps1 -Continuous with no window at all.
' A powershell.exe shortcut cannot do this on Windows 11: when Windows Terminal
' is the default terminal, the console is handed to a visible Terminal window
' and -WindowStyle Hidden no longer hides it. WshShell.Run(..., 0) creates the
' console hidden, so no Terminal handoff happens. Waiting for the daemon keeps
' its exit code for Task Scheduler. Paths come from this file's own location,
' so the file stays ASCII-only.
Option Explicit
Dim fso, shell, scriptsDir, powershell, daemon, rc
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scriptsDir = fso.GetParentFolderName(WScript.ScriptFullName)
powershell = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
daemon = fso.BuildPath(scriptsDir, "ayas-access-daemon.ps1")
shell.CurrentDirectory = fso.GetParentFolderName(scriptsDir)
rc = shell.Run("""" & powershell & """ -NoProfile -WindowStyle Hidden -File """ & daemon & """ -Continuous -IntervalSeconds 60", 0, True)
WScript.Quit rc
