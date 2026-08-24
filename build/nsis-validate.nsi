; Local-only makensis validation harness for build/installer.nsh.
; Mimics the electron-builder include context (MUI2 + macros + isUpdated define).
!define isUpdated "0"

!include "MUI2.nsh"
!include "installer.nsh"

Name "Echocue NSIS validation"
OutFile "nsis-validate.exe"
RequestExecutionLevel user

!insertmacro customHeader
!insertmacro customPageAfterChangeDir
!insertmacro MUI_PAGE_INSTFILES

Function .onInit
  !insertmacro customInit
FunctionEnd

Section "Install"
  !insertmacro customInstall
SectionEnd

; Simulated uninstaller context (electron-builder sets isUpdated for upgrades).
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
Section "Uninstall"
  !insertmacro customUnInstall
SectionEnd

!insertmacro MUI_LANGUAGE "SimpChinese"
