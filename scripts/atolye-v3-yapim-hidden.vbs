' Atolye V3 production order watcher (AYAS places orders, this makes the videos): hidden, D temp, one instance.
' Started from the user's Startup folder. The watcher itself refuses a second copy (pid lock in the order folder).
' A start that fails at once is tried again (10 Nov 2026: at logon node could not yet read tsx's own folder,
' "ENOENT ... tsx\dist\esm", and the watcher stayed down until a session restarted it; owner approved the retry the
' same day): up to 3 more tries, 60 s apart, only while it ends with an error within 2 minutes. A watcher that ran
' longer (stopped or restarted on purpose) or ended cleanly (a second copy refused) is never started again here.
Option Explicit
Const TRIES = 4
Const EARLY_S = 120
Const PAUSE_MS = 60000
Dim fso, shell, projectDir, productionRoot, tempRoot, logDir, logFile, command, attempt, startedAt, code
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
projectDir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
productionRoot = fso.GetParentFolderName(fso.GetParentFolderName(projectDir))
tempRoot = fso.BuildPath(productionRoot, "private\temp")
If Not fso.FolderExists(tempRoot) Then WScript.Quit 78
logDir = fso.BuildPath(productionRoot, "private\logs")
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)
logFile = fso.BuildPath(logDir, "atolye-v3-yapim.log")
shell.Environment("Process")("TEMP") = tempRoot
shell.Environment("Process")("TMP") = tempRoot
shell.Environment("Process")("NPM_CONFIG_CACHE") = fso.BuildPath(productionRoot, "private\npm-cache")
shell.CurrentDirectory = projectDir
command = "cmd /c npx tsx scripts\v3\yapim.ts izle >> """ & logFile & """ 2>&1"

Sub Note(text)
  Dim f
  On Error Resume Next
  Set f = fso.OpenTextFile(logFile, 8, True)
  f.WriteLine text
  f.Close
End Sub

For attempt = 1 To TRIES
  startedAt = Now
  code = shell.Run(command, 0, True)
  If code = 0 Or DateDiff("s", startedAt, Now) > EARLY_S Then Exit For
  If attempt < TRIES Then
    Note "izleyici baslatilamadi (cikis " & code & "); " & (PAUSE_MS / 1000) & " sn sonra yeniden deneniyor (" & (attempt + 1) & "/" & TRIES & ")"
    WScript.Sleep PAUSE_MS
  Else
    Note "izleyici " & TRIES & " denemede baslatilamadi (son cikis " & code & "); elle baslatilmali"
  End If
Next
