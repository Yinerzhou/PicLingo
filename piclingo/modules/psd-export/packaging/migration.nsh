!macro customInit
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PicLingo" "InstallLocation"
  ${If} $R0 != ""
    ${If} ${FileExists} "$R0\.piclingo-install.json"
      StrCpy $INSTDIR $R0
    ${EndIf}
  ${EndIf}
!macroend

!macro customInstall
  nsExec::ExecToStack '"$INSTDIR\PicLingoMaintenance.exe" migrate "$INSTDIR"'
  Pop $R0
  Pop $R1
  ${If} $R0 != 0
    MessageBox MB_ICONSTOP "旧安装清理失败，个人文件已保留。$R1" /SD IDOK
    Abort
  ${EndIf}
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\PicLingo"
!macroend

!macro customRemoveFiles
  nsExec::ExecToStack '"$INSTDIR\PicLingoMaintenance.exe" uninstall "$INSTDIR"'
  Pop $R0
  Pop $R1
  ${If} $R0 != 0
    MessageBox MB_ICONSTOP "应用文件清理失败，请关闭正在运行的程序。$R1" /SD IDOK
    Abort
  ${EndIf}
  SetOutPath $TEMP
  Delete "$INSTDIR\PicLingoMaintenance.exe"
  Delete "$INSTDIR\.piclingo-managed.json"
  Delete "$INSTDIR\${UNINSTALL_FILENAME}"
  RMDir "$INSTDIR"
!macroend

