# WLED Card for Home Assistant

A custom Lovelace card built specifically for **WS2805 RGBWW LED strips** controlled via [WLED](https://kno.wled.ge/).

---

## Why does this exist?

The WS2805 is a 5-channel RGBWW LED (R, G, B, W, WW). Home Assistant's built-in light integration does not correctly handle the dedicated white channels — it guesses at the color model, mangling colors and breaking white controls entirely.

This is a known, long-standing issue that remains unfixed while HA continues to ship new features. Rather than wait for a fix that may never come, this card bypasses the broken integration entirely and talks directly to WLED's REST API for effects, speed and intensity — while routing on/off, brightness and color through HA's `callService` to keep your automations working.

**No iframe. No popups. No scroll hijacking. No broken light entity.**

---

## Features

- On/Off toggle synced with HA state
- Brightness slider
- 7 quick-pick color buttons (tap to set color and power on simultaneously)
- Configurable color preset dropdown (supports multi-color effect presets)
- WLED effect selector (loaded directly from your WLED device)
- Effect speed and intensity sliders
- Card background tints to reflect the current light color
- Works alongside existing automations — no conflicts

---

## Installation via HACS

1. Open HACS in Home Assistant
2. Go to **Frontend**
3. Click the three dots menu → **Custom repositories**
4. Add `https://github.com/gootynz/wled-card` as a **Lovelace** repository
5. Install **WLED Card**
6. Refresh your browser

---

## Manual Installation

1. Download `wled-card.js`
2. Copy to `/config/www/wled-card.js`
3. In HA go to **Settings → Dashboards → Resources → Add**
   - URL: `/local/wled-card.js`
   - Type: JavaScript module
4. Reload your browser

---

## Configuration

```yaml
type: custom:wled-card
entity: light.your_wled_light    # HA light entity (keeps automations working)
host: http://192.168.1.13        # WLED device IP (for effects, speed, intensity)
name: LED Strip
```

### With custom presets

```yaml
type: custom:wled-card
entity: light.your_wled_light
host: http://192.168.1.13
name: LED Strip
presets:
  - name: Warm White
    rgb: [255, 180, 80]
  - name: Sunset
    rgb: [[255,80,20], [255,180,0], [200,0,50]]   # multi-color for effects
  - name: Red
    rgb: [255, 0, 0]
```

### Without HA entity (direct REST only)

```yaml
type: custom:wled-card
host: http://192.168.1.13
name: LED Strip
```

---

## Card Background Styles

The card background tints to the current light color. Five styles are available in `wled-card.js` — comment/uncomment your preferred option in the `_setCardBg` method:

| Option | Style |
|--------|-------|
| 1 | Subtle full card tint |
| 2 | Strong left fade |
| 3 | Strong right fade |
| 4 | Right quarter color only |
| 5 | Radial vignette glow from edges (default) |

---

## WS2805 Notes

- WLED handles the W and WW channels automatically based on your LED type configured in WLED settings
- Just send RGB — WLED sorts the white channel
- Warm White preset `[255, 180, 80]` approximates warm white via RGB; the actual W channel is managed by WLED

---

## License

MIT

