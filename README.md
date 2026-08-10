# WLED WS2805 Card for Home Assistant

A custom Lovelace card built specifically for **WS2805 RGBWW LED strips** controlled via [WLED](https://kno.wled.ge/).

---

## Why does this exist?

The WS2805 is a 5-channel RGBWW LED (R, G, B, cold white, warm white). Home Assistant's built-in `wled` integration doesn't correctly expose independent control of the two white channels — under certain WLED firmware capability reporting, the light entity can drop to a CCT-only color mode and lose RGB entirely. This is a known, currently open upstream bug: [home-assistant/core#146123](https://github.com/home-assistant/core/issues/146123).

This card works around it two ways:

- **`host:` mode** (direct WLED REST API, browser → WLED device) — bypasses the HA entity completely for effects, palettes, speed/intensity, and real independent cold/warm white control. This works out of the box, no HA-side patching required.
- **`entity:` mode** — used for on/off, brightness, and state sync so your existing automations keep working. If you also want the *entity itself* to correctly report true independent CW/WW (`rgbww_color`), you'll need a patched `wled` integration — HA core's stock version doesn't do this yet. See the linked issue above for current status.

You can use `host:` alone for full control without touching HA's integration at all, or combine both for entity-based automations plus full manual control.

**No iframe. No popups. No scroll hijacking.**

---

## Features

- On/Off toggle + brightness slider, synced with HA entity state
- 7 quick-pick color buttons (instant color + power on)
- Real independent cold/warm white sliders via direct WLED REST (`host:` mode)
- **Color Palettes** — 18 curated WLED palettes, live-rendered as gradient swatches pulled directly from your WLED device (`/json/palx`), paged list, click to apply
- WLED effect selector — loaded live from your device, not hardcoded
- Effect speed and intensity sliders
- Card background tints to reflect current light color, locked during active edits to avoid flicker/revert from background polling
- Standalone test-harness friendly — works without a `hass` object

---

## Requirements

- WLED **0.14+** (uses `/json/palx` for palette gradient data, added in 0.14)
- `host:` must be reachable from your **browser**, not from HA itself:
  - On LAN: local IP (`http://192.168.1.x`) or mDNS (`http://wled.local`)
  - Remote access (Nabu Casa, Cloudflare Tunnel, etc.): LAN IP won't resolve externally — use a FQDN that does, or omit `host:` and run entity-only (loses effects/palettes/CW-WW control)

---

## Installation via HACS

1. Open HACS in Home Assistant
2. Go to **Frontend**
3. Three-dot menu → **Custom repositories**
4. Add `https://github.com/gootynz/Wled-Ws2805-HA-Fix` as a **Lovelace** repository
5. Install **WLED WS2805 Card**
6. Refresh your browser (hard refresh — HA's frontend caches JS independently of server cache headers)

## Manual Installation

1. Download `wled-ws2805-card.js`
2. Copy to `/config/www/wled-ws2805-card.js`
3. **Settings → Dashboards → Resources → Add**
   - URL: `/local/wled-ws2805-card.js`
   - Type: JavaScript module
4. Hard refresh your browser

---

## Configuration

```yaml
type: custom:wled-card
name: LED Strip
entity: light.your_wled_light    # optional — on/off, brightness, automations
host: http://192.168.1.13        # optional — required for effects/palettes/speed/intensity/CW-WW
```

### Direct REST only, no HA entity

```yaml
type: custom:wled-card
name: LED Strip
host: http://192.168.1.13
```

---

## Known limitations

- `entity:`-mode CW/WW state reporting depends on HA core's `wled` integration correctly exposing `rgbww_color` — currently broken on some firmware capability configurations ([core#146123](https://github.com/home-assistant/core/issues/146123), open). `host:` mode is unaffected.
- No `presets:` YAML override — the palette list is a fixed, curated set matched to what's commonly useful on WS2805; fork and edit the `PALETTES` array directly if you want different ones.

---

## Support

None — provided as-is. Fork and modify for your own setup; issues/PRs welcome but no guaranteed response.

---

## License

MIT
