; Crew Link – Anpassungen des NSIS-Installers. Übernommen aus Suite-Launcher build/installer.nsh (EPL-2.0), Namen angepasst.
; Immer pro Benutzer, ohne Seite „Für wen installieren?“ und ohne Administratorrechte.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; Lizenz nur als Link auf der Abschlussseite (keine Pflichtseite mit Textwand)
!macro customHeader
  !define MUI_FINISHPAGE_LINK "Eclipse Public License 2.0"
  !define MUI_FINISHPAGE_LINK_LOCATION "https://www.eclipse.org/legal/epl-2.0/"
!macroend

; Deinstaller in den Vordergrund
!macro customUnInit
  BringToFront
!macroend

; Firewall-Regeln, die Windows beim ersten Start (Weboberfläche, Suite-Chat) für „Crew Link.exe“ anlegt, lassen sich
; ohne Administratorrechte nicht entfernen. Der Deinstaller lässt sie deshalb stehen.

; Deinstallieren: läuft Crew Link noch kurz nach (Windows gibt Prozesse verzögert frei), bis zu 10 s auf das Löschen der
; letzten Dateien warten, statt Reste liegen zu lassen.
!macro customUnInstall
  ; nicht beim Aktualisieren (dann deinstalliert der neue Installer die alte Version und legt danach neue Dateien ab)
  ${ifNot} ${isUpdated}
    StrCpy $R9 0
    crewlink_retry:
      Delete "$INSTDIR\Crew Link.exe"
      Delete "$INSTDIR\ffmpeg.dll"
      IfFileExists "$INSTDIR\Crew Link.exe" 0 crewlink_done
      IntOp $R9 $R9 + 1
      IntCmp $R9 10 crewlink_done
      Sleep 1000
      Goto crewlink_retry
    crewlink_done:
    RMDir "$INSTDIR"
  ${endIf}
!macroend
