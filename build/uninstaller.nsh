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
!include "WordFunc.nsh"

; Resolve the data root into $R2. Reads data-location.json next to the default
; root; the path is stored forward-slash (see installer.nsh), so extracting the
; JSON string needs no backslash unescaping. Any read/parse failure falls back
; to %LOCALAPPDATA%\Echocue.
Function EchocueResolveDataRoot
  Push $R0
  Push $R1
  StrCpy $R2 "$LOCALAPPDATA\Echocue"
  ${If} ${FileExists} "$LOCALAPPDATA\Echocue\data-location.json"
    ClearErrors
    FileOpen $R0 "$LOCALAPPDATA\Echocue\data-location.json" r
    FileRead $R0 $R1
    FileClose $R0
    ${IfNot} ${Errors}
      ${WordFind} $R1 '"dataRoot":"' 'E+1' $R2
      ${If} $R2 != ""
        ${WordFind} $R2 '"' '1' $R2
      ${EndIf}
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
  Call EchocueResolveDataRoot

  StrCpy $R3 "$LOCALAPPDATA\Echocue\data-location.json"
  ${IfNot} ${Silent}
    ${Unless} ${isUpdated}
      MessageBox MB_YESNO|MB_ICONQUESTION "是否一并清理所有用户数据？将删除审计、人设、配置与案例库。" IDYES +2 IDNO done
      Goto clean
    ${EndUnless}
  ${EndIf}
  FindCmdLineSwitch "/cleanData"
  IfErrors done
  Goto clean

clean:
  RMDir /r "$R2"
  RMDir /r "$R3"

done:
  Pop $R3
  Pop $R2
!macroend

!endif
