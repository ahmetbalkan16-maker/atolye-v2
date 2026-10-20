' Atolye V3 production order watcher (AYAS places orders, this makes the videos): hidden, D temp, one instance.
' Started from the user's Startup folder. The watcher itself refuses a second copy (pid lock in the order folder).
Option Explicit
Dim fso, shell, projectDir, productionRoot, tempRoot, logDir, command
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
projectDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
productionRoot = fso.GetParentFolderName(fso.GetParentFolderName(projectDir))
tempRoot = fso.BuildPath(productionRoot, "private\temp")
If Not fso.FolderExists(tempRoot) Then WScript.Quit 78
logDir = fso.BuildPath(productionRoot, "private\logs")
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)
shell.Environment("Process")("TEMP") = tempRoot
shell.Environment("Process")("TMP") = tempRoot
shell.Environment("Process")("NPM_CONFIG_CACHE") = fso.BuildPath(productionRoot, "private\npm-cache")
shell.CurrentDirectory = projectDir
command = "cmd /c npx tsx scripts\v3\yapim.ts izle >> """ & fso.BuildPath(logDir, "atolye-v3-yapim.log") & """ 2>&1"
shell.Run command, 0, False
