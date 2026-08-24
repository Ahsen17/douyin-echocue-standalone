; WP-6: optional user-data cleanup on uninstall.
;
; deleteAppDataOnUninstall stays false (see electron-builder.yml); instead this
; macro asks the host once (default No) whether to also remove all user data.
; /cleanData on the uninstaller command line skips the prompt (used by the
; install-verify script). Reinstall/upgrade (isUpdated) never asks, so an
; upgrade never wipes the data root.

!ifndef ECHOCUE_UNINSTALLER_NSH
!define ECHOCUE_UNINSTALLER_NSH

!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "TextFunc.nsh"

; Resolve the data root into $R2. Reads the plain-text pointer
; (data-location.txt, written by installer.nsh with a forward-slash path), falls
; back to %LOCALAPPDATA%\Echocue when absent. No JSON parsing — avoids WordFind
; index ambiguity entirely.
Function EchocueResolveDataRoot
  Push $R0
  Push $R1
  StrCpy $R2 "$LOCALAPPDATA\Echocue"
  ${If} ${FileExists} "$LOCALAPPDATA\Echocue\data-location.txt"
    ClearErrors
    FileOpen $R0 "$LOCALAPPDATA\Echocue\data-location.txt" r
    FileRead $R0 $R1
    FileClose $R0
    ${IfNot} ${Errors}
      ${TrimNewlines} $R1 $R2
    ${EndIf}
    ${If} $R2 == ""
      StrCpy $R2 "$LOCALAPPDATA\Echocue"
    ${EndIf}
  ${EndIf}
  Pop $R1
  Pop $R0
FunctionEnd

!macro customUnInstall
  Push $R2
  Push $R3
  Push $R4
  Call EchocueResolveDataRoot

  StrCpy $R3 "$LOCALAPPDATA\Echocue"
  StrCpy $R4 "0"
  ${IfNot} ${Silent}
    ${Unless} ${isUpdated}
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "是否一并清理所有用户数据？将删除审计、人设、配置与案例库。" /SD IDNO IDYES clean0 IDNO done0
    ${EndUnless}
  ${EndIf}
  FindCmdLineSwitch "/cleanData"
  IfErrors done0
clean0:
  StrCpy $R4 "1"
done0:
  ${If} $R4 == "1"
    RMDir /r "$R2"
    RMDir /r "$R3"
  ${EndIf}
  Pop $R4
  Pop $R3
  Pop $R2
!macroend

!endif
