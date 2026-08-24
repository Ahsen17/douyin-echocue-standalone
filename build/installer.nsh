; WP-5: assisted-install data-save-directory selection.
; WP-6: optional user-data cleanup on uninstall.
;
; electron-builder includes this file in BOTH the installer and the uninstaller
; build (BUILD_UNINSTALLER is defined for the latter). Installer-only functions
; and macros are guarded so the uninstaller build does not compile unreferenced
; install functions (NSIS warning 6010, which electron-builder promotes to an
; error).

!ifndef ECHOCUE_INSTALLER_NSH
!define ECHOCUE_INSTALLER_NSH

; Libraries are included at the top so the function bodies below (compiled at
; include time) can resolve ${WordReplace}/${GetParameters}/${GetOptions} macros;
; electron-builder includes installer.nsh during the header phase.
!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "WordFunc.nsh"
!include "FileFunc.nsh"

!macro customHeader
!macroend

!ifndef BUILD_UNINSTALLER

Var EchocueDataDir
Var EchocueDataDialog
Var EchocueDataDirFwd

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

  ; Page header via plain nsDialogs labels (no MUI2 dependency: electron-builder
  ; may compile the include before MUI2's header macros are defined).
  ${NSD_CreateLabel} 0 0 100% 20u "数据保存位置"
  Pop $0
  ${NSD_CreateLabel} 0 20u 100% 24u "审计、人设、配置与案例库将保存在所选目录。之后可在应用内随时迁移。"
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

!endif ; !ifndef BUILD_UNINSTALLER

; -----------------------------------------------------------------------------
; WP-6: optional user-data cleanup on uninstall. deleteAppDataOnUninstall stays
; false (see electron-builder.yml); instead this macro asks once (default No)
; whether to also remove all user data. /cleanData skips the prompt (install
; verify). Reinstall/upgrade (--updated) never asks, so upgrades never wipe data.
; -----------------------------------------------------------------------------

; customUnInstall runs in the uninstaller, where a Call to a non-un. function is
; illegal, so the data-root resolution is inlined (no separate helper).
!macro customUnInstall
  Push $R2
  Push $R3
  Push $R4
  StrCpy $R2 "$LOCALAPPDATA\Echocue"
  ${If} ${FileExists} "$LOCALAPPDATA\Echocue\data-location.txt"
    ClearErrors
    FileOpen $R0 "$LOCALAPPDATA\Echocue\data-location.txt" r
    FileRead $R0 $R1
    FileClose $R0
    ${IfNot} ${Errors}
      ; Strip the trailing CRLF (WordFunc ships with all NSIS builds).
      ${WordReplace} "$R1" "$\r$\n" "" "+" $R2
    ${EndIf}
  ${EndIf}

  StrCpy $R3 "$LOCALAPPDATA\Echocue"
  StrCpy $R4 "0"
  ${GetParameters} $R0
  ; /cleanData always cleans without asking (verify script / silent automation).
  ClearErrors
  ${GetOptions} $R0 "/cleanData" $R1
  ${IfNot} ${Errors}
    Goto clean0
  ${EndIf}
  ; Upgrade uninstaller runs with --updated; an upgrade must never wipe data.
  ClearErrors
  ${GetOptions} $R0 "--updated" $R1
  ${IfNot} ${Errors}
    Goto done0
  ${EndIf}
  ${IfNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "是否一并清理所有用户数据？将删除审计、人设、配置与案例库。" IDYES clean0 IDNO done0
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
