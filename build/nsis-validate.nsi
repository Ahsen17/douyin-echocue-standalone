; Local-only makensis validation harness for build/installer.nsh.
; Mimics electron-builder's two builds: the installer (no BUILD_UNINSTALLER) and
; the uninstaller (BUILD_UNINSTALLER defined).
;
; Usage:
;   makensis nsis-validate.nsi           -> installer build validation
;   makensis /DBUILD_UNINSTALLER nsis-validate.nsi -> uninstaller build validation

!ifndef isUpdated
  !define isUpdated "0"
!endif

!include "MUI2.nsh"
!include "installer.nsh"

Name "Echocue NSIS validation"
OutFile "nsis-validate.exe"
RequestExecutionLevel user

!ifndef BUILD_UNINSTALLER
  !insertmacro customHeader
  !insertmacro customPageAfterChangeDir
  !insertmacro MUI_PAGE_INSTFILES

  Function .onInit
    !insertmacro customInit
  FunctionEnd

  Section "Install"
    !insertmacro customInstall
  SectionEnd
!else
  !insertmacro MUI_UNPAGE_CONFIRM
  !insertmacro MUI_UNPAGE_INSTFILES
  Section "Uninstall"
    !insertmacro customUnInstall
  SectionEnd
!endif

!insertmacro MUI_LANGUAGE "SimpChinese"
