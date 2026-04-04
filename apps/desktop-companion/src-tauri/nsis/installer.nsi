; Joyus Desktop — custom NSIS uninstall hook
; This script is referenced by tauri.conf.json -> bundle.windows.nsis.installerScript
; It adds a dialog during uninstall asking whether to remove user data.

!macro NSIS_HOOK_PREUNINSTALL
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Would you like to remove all Joyus Desktop data?$\n$\n\
    This includes your settings, skill-sync cache, and local configuration.$\n\
    Select 'No' to keep your data for a future reinstall." \
    IDYES RemoveData IDNO KeepData

  RemoveData:
    ; Remove skill-sync cache
    RMDir /r "$PROFILE\.claude\.skill-sync-cache"

    ; Remove Tauri app data
    RMDir /r "$APPDATA\com.joyus.desktop-companion"

    ; Remove managed MCP entries directory
    RMDir /r "$PROFILE\.claude\.joyus-managed"

    Goto DataDone

  KeepData:
    ; User chose to keep data — nothing to do

  DataDone:
!macroend
