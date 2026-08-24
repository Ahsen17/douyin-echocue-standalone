; WP-5: assisted-install data-save-directory selection.
;
; Adds a custom installer page asking where user data (audit/personas/config/
; case library) should live, then writes a boot pointer file so the app can
; set its data root accordingly. Defaults to %LOCALAPPDATA%\Echocue and always
; writes the pointer even on the silent path, so packaged mode keeps a stable
; root. NSIS reserves an unused identifier space (custom pages only).

!ifndef ECHOCUE_INSTALLER_NSH
!define ECHOCUE_INSTALLER_NSH

Var EchocueDataDir
Var EchocueDataDialog
Var EchocueDataDirFwd

!macro customHeader
  !include "LogicLib.nsh"
  !include "nsDialogs.nsh"
  !include "WordFunc.nsh"
  !include "FileFunc.nsh"
  !include "TextFunc.nsh"
!macroend

!macro customInit
  StrCpy $EchocueDataDir "$LOCALAPPDATA\Echocue"
!macroend

; Register the data-dir selection page after the install-dir page. electron-builder
; calls customPageAfterChangeDir inside the assisted installer's page flow.
!macro customPageAfterChangeDir
  Page custom EchocueDataPageCreate EchocueDataPageLeave
!macroend

Function EchocueDataPageCreate
  nsDialogs::Create /NOUNLOAD 1018
  Pop $EchocueDataDialog
  ${If} $EchocueDataDialog == error
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "数据保存位置" "选择 Echocue 数据保存目录"
  ${NSD_CreateLabel} 0 0 100% 24u "审计、人设、配置与案例库将保存在所选目录。之后可在应用内随时迁移。"
  Pop $0
  ${NSD_CreateDirRequest} 0 32u 100% 12u "$EchocueDataDir"
  Pop $EchocueDataDir
  ${NSD_CreateBrowseButton} 0 48u 100% 12u "浏览..."
  Pop $0
  ${NSD_OnClick} $0 EchocueDataBrowse

  nsDialogs::Show
FunctionEnd

Function EchocueDataBrowse
  ${NSD_GetText} $EchocueDataDir $1
  nsDialogs::SelectFolderDialog "选择数据保存目录" $1
  Pop $0
  ${If} $0 != error
    ${NSD_SetText} $EchocueDataDir "$0"
  ${EndIf}
FunctionEnd

Function EchocueDataPageLeave
  ${NSD_GetText} $EchocueDataDir $0
  StrCpy $EchocueDataDir "$0"
FunctionEnd

!macro customInstall
  ; Persist the chosen data root as the boot pointer. The files live at a fixed
  ; location so the app can read them before deciding the userData path. The path
  ; is written with forward slashes so the JSON stays valid (no backslash escape
  ; ambiguity) and Node/NSIS both accept it on Windows. data-location.txt is a
  ; plain copy the uninstaller reads without JSON parsing.
  CreateDirectory "$LOCALAPPDATA\Echocue"
  ${WordReplace} "$EchocueDataDir" "\" "/" "+" $EchocueDataDirFwd
  FileOpen $0 "$LOCALAPPDATA\Echocue\data-location.json" w
  FileWrite $0 '{"schemaVersion":1,"dataRoot":"$EchocueDataDirFwd"}'
  FileClose $0
  FileOpen $0 "$LOCALAPPDATA\Echocue\data-location.txt" w
  FileWrite $0 "$EchocueDataDirFwd$\r$\n"
  FileClose $0
!macroend

; -----------------------------------------------------------------------------
; WP-6: optional user-data cleanup on uninstall. deleteAppDataOnUninstall stays
; false (see electron-builder.yml); instead this macro asks once (default No)
; whether to also remove all user data. /cleanData skips the prompt (install
; verify). Reinstall/upgrade (isUpdated) never asks, so upgrades never wipe data.
; -----------------------------------------------------------------------------

; Resolve the data root into $R2. Reads the plain-text pointer (data-location.txt,
; written above with a forward-slash path), falls back to %LOCALAPPDATA%\Echocue.
; No JSON parsing — avoids WordFind index ambiguity entirely.
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
  ; /cleanData always cleans without asking (verify script / silent automation).
  FindCmdLineSwitch "/cleanData"
  IfErrors +2
  Goto clean0
  ${IfNot} ${Silent}
    ${Unless} ${isUpdated}
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "是否一并清理所有用户数据？将删除审计、人设、配置与案例库。" IDYES clean0 IDNO done0
    ${EndUnless}
  ${EndIf}
  Goto done0
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
