!macro customInstall
  ; Datengrube liegt dauerhaft in %APPDATA% (nicht neben der EXE).
  ; Beim NSIS-Update landet die alte Datengrube kurz in old-install — hier retten.
  CreateDirectory "$APPDATA\${APP_PACKAGE_NAME}\Datengrube"
  IfFileExists "$PLUGINSDIR\old-install\Datengrube\*.*" 0 +2
    CopyFiles /SILENT "$PLUGINSDIR\old-install\Datengrube\*.*" "$APPDATA\${APP_PACKAGE_NAME}\Datengrube\"
!macroend
