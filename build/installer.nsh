; WP-5: writes the data-save-location boot pointer on install (defaults to
; %LOCALAPPDATA%\Echocue). In-app migration (系统设置 → 数据保存位置) relocates
; later. The installer is one-click (see electron-builder.yml); the assisted page
; flow was reverted after it crashed the Windows runner with 0xC0000005. WP-6:
; optional user-data cleanup on uninstall.
;
; electron-builder includes this file in BOTH the installer and the uninstaller
; build (BUILD_UNINSTALLER is defined for the latter). Installer-only macros are
; guarded so the uninstaller build does not compile unreferenced install code
; (NSIS warning 6010, which electron-builder promotes to an error).

!ifndef ECHOCUE_INSTALLER_NSH
!define ECHOCUE_INSTALLER_NSH

; Libraries are included at the top so the macro bodies below (compiled at
; include time) can resolve ${GetParameters}/${GetOptions}/${FileExists}.
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!macro customHeader
!macroend

!ifndef BUILD_UNINSTALLER

!macro customInstall
  ; Persist the data root as the boot pointer (plain text — no JSON escaping or
  ; string-replace macros, which are the fragile parts). The app reads this file
  ; first and falls back to the JSON pointer written by in-app migration.
  CreateDirectory "$LOCALAPPDATA\Echocue"
  FileOpen $0 "$LOCALAPPDATA\Echocue\data-location.txt" w
  FileWrite $0 "$LOCALAPPDATA\Echocue"
  FileClose $0
!macroend

!endif ; !ifndef BUILD_UNINSTALLER

; -----------------------------------------------------------------------------
; WP-6: optional user-data cleanup on uninstall. deleteAppDataOnUninstall stays
; false (see electron-builder.yml); instead this macro asks once (default No)
; whether to also remove all user data. /cleanData skips the prompt (install
; verify). Reinstall/upgrade (--updated) never asks, so upgrades never wipe data.
; -----------------------------------------------------------------------------

; customUnInstall runs in the uninstaller. The data-root resolution is inlined
; (no un. helper function) and the pointer is plain text without a trailing
; newline, so FileRead returns it cleanly.
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
      StrCpy $R2 $R1
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
