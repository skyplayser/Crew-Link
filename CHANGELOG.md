# Changelog

All notable changes to Crew Link are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Crew Link uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). As long as the version starts with 0, everything is alpha and
may still change – including the `.crewlink` file format.

## [0.1.0] – Alpha

_Date: 2026-11-17_

First public alpha of Crew Link, part of the Link-Suite: the running order of the night, countdowns to set end and
curfew, and one house clock for everyone. This is phase 1 of the concept (MVP).

**Tested so far:** on one Mac, in demo mode, and with more than 100 automatic tests. **Not tested yet:** real phones and
tablets, Windows, two computers in one network, a real club night.

### Added

- **Control desk** (desktop app for macOS and Windows): start screen, tabs NOW, TIMETABLE, CLOCK, ROLES, SIGNALS and
  CONNECT, day and night mode, German and English.
- **Events with days and floors:** one night or a festival with several days, each with its own opening hours and
  curfew; floors with colours; slots on a timeline (drag) or as a list; ALL DAYS view; *Copy day*; templates without
  names, notes or PINs; a check for overlaps, slots after curfew and the clock change; A4 print.
- **Time handling:** time zone of the event, midnight, clock change in March and October. A time in the missing hour is
  rejected when typed; copying a day or using a template keeps the slot length and marks the slot for checking.
- **Countdowns:** set end, next slot, floor end and curfew – green, yellow from 10 min, red from 2 min, red with “+”
  when a set runs over. Curfew sequence with entry stop and last round as notices in the views.
- **Handover:** “as planned” (default) or “confirm” with *Handover now*. Without a confirmation the plan applies again
  at the latest at the next slot end, floor end or curfew; from +15 min lead and booth get “Confirm handover?”.
- **Running over:** *Shorten next* and *Shift everything* show a preview and change nothing until you confirm; warning
  when a shift goes past curfew.
- **Web interface** (port 8070, off by default, switched on with *Connect phones*): read-only pages for lead, booth
  (per floor), DJ (per DJ), tech, security and bar; big clock per floor (`/uhr/<floor>`); public page for the entrance
  (`/oeffentlich`, public names only); one QR code per role, printable.
- **House clock:** the control desk gives the time; browsers measure their offset over the WebSocket (about ±0.01 s on
  the test computer). Without network, pages keep counting with the last plan and show a yellow strip.
- **Keep the screen on** in the browser: wake lock with the video fallback from LJ Link (untested on real devices).
- **Big clock window** on the control desk for a second screen (public names only).
- **Suite network:** `here`, `tick` (house clock and public names only), `bye`, `probe`/`echo` over multicast
  239.255.76.76:47676, TTL 1; can be switched off under CONNECT. Crew Link takes part in the **suite chat** with
  **EMERGENCY** on the control desk. Warning when a second Crew Link control desk is in the network.
- **Saving only with consent:** *Save on this computer?* – without a yes the plan stays in memory only. `.crewlink`
  files, *Open event*, *Save as*. `prefs.json` only when a setting differs from the default.
- **Lock mode** on the control desk: one click on the lock blocks every change to the plan, hold it for one second to
  unlock.
- **Demo event** “Wochenende Club Beispiel” (two days, three floors, relative to the current time); saves nothing.
- Shared suite building blocks: start animation “Programm-Intro” and the card “All programs in one place” (shown only
  when the Link-Suite launcher is not installed; the check is local and sends nothing).

### Security

- Web server: only GET/HEAD, host and origin check, fixed file list, CSP without outside sources, only private source
  addresses (10/8, 172.16/12, 192.168/16, 169.254/16, 127/8), no fallback port. WebSocket messages limited to 64 KB,
  time pings limited per connection.
- Big clock and public page never get internal names or notes.
- **Known gap:** there is no PIN check in 0.1.0. Anyone who reaches port 8070 can open every role, including the lead's
  page with internal names and notes. Everything in the show network is unencrypted (no HTTPS).

### Known limitations

- Not tested on real phones and tablets, not on Windows, not between two computers, not in a club.
- Timeline dragging, the dialogs, saving with consent, print and ALL DAYS were checked by reading the code and by
  automatic tests, not operated by hand.
- *Keep the screen on* is a workaround over http and untested on real devices – on a device on power, set auto-lock to
  never.
- Stages (festival) exist in the file format but have no interface yet.
- LJ Link, LJL Link and VJ-Link do not show the countdown yet; Crew Link already sends it.
- The launcher Link-Suite and Crew Link 0.1.0 are not signed or notarized; macOS and Windows may warn on first start.

### Not in 0.1.0 (planned)

- Phase 2: PIN check and rights, buttons on the phone (*Ready*, *+5 min*), crew chat page and EMERGENCY on phones,
  Bonjour `_crewlink._tcp`.
- Phase 3: log of the night (only the consent question exists).
- Phase 4: signals to light and video, house light, timecode as time source (the SIGNALS tab only shows the notice
  times).
- Later: interface for stages, own countdowns, offline copy in the browser, CSV import.

[0.1.0]: https://github.com/skyplayser/Crew-Link/releases/tag/v0.1.0
