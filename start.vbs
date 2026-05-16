Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
appExe = fso.BuildPath(root, "src-tauri\target\release\voice.exe")
devCmd = fso.BuildPath(root, "dev.cmd")

If fso.FileExists(appExe) Then
  shell.Run """" & appExe & """", 0, False
Else
  shell.Run """" & devCmd & """", 0, False
End If
