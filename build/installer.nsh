; WP-5: assisted-install data-save-directory selection.
;
; Adds a custom installer page asking where user data (audit/personas/config/
; case library) should live, then writes a boot pointer file so the app can
; set its data root accordingly. Defaults to %LOCALAPPDATA%\Echocue and always
; writes the pointer even on the silent path, so packaged mode keeps a stable
; root. NSIS reserves an unused identifier space (custom pages only).

!ifndef ECHOCUE_INSTALLER_NSH
!define ECHOCUE_INSTALLER_NSH

; WP-6 uninstaller macro (same include file covers installer + uninstaller).
!include "uninstaller.nsh"

Var EchocueDataDir
Var EchocueDataDialog
Var EchocueDataDirFwd

!macro customHeader
  !include "LogicLib.nsh"
  !include "nsDialogs.nsh"
  !include "WordFunc.nsh"
!macroend

!macro customInit
  StrCpy $EchocueDataDir "$LOCALAPPDATA\Echocue"
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

!endif
