// g_wled_card.js — v2.5 — 2026-08-10 (saved as g_wled_card.js [live] and g_wled_card_v25.js [versioned])
/**
 * g_wled_card.js — v2.5
 * Custom Lovelace card for WS2805 RGBWW LED strips via WLED.
 * Designed for Home Assistant Lovelace with optional direct WLED REST API control.
 *
 * Configuration (in Lovelace YAML):
 *   type: custom:wled-card
 *   name: "Strip Name"          # display label
 *   entity: light.my_wled       # HA light entity (optional)
 *   host: http://wled.local      # direct WLED IP or FQDN (optional, required for effects/speed/intensity/palettes)
 *
 * Note: `host` must be reachable from the browser, not from HA.
 *   - On LAN: use local IP (e.g. http://192.168.1.x) or mDNS (http://wled.local)
 *   - Remote access (via Nabu Casa / Cloudflare Tunnel etc): LAN IP will fail.
 *     Use a FQDN that resolves externally, or omit `host` and use `entity` only.
 *     Without `host`, effects/speed/intensity/palette controls are unavailable.
 *
 * v2.5 changes:
 *   - Fixed: /json/palx is paginated by WLED (8 palette ids per page, "m" field
 *     = total page count). v2.4 only fetched the unpaginated default (page 0),
 *     so only palette ids 0-7 ever had real swatch data — 14 of the 18 curated
 *     palettes (anything id >= 8) silently fell back to the gray placeholder
 *     swatch. New _fetchAllPalx() fetches page 0 to learn the page count, then
 *     fetches and merges the rest.
 *   - Palette swatches widened 18px -> 68px to use the column's spare width.
 *
 * v2.4 changes:
 *   - Left column ("Color Presets" list) replaced entirely with "Color Palettes":
 *     18 hand-picked WLED palettes (host mode only), swatch rendered as a
 *     multi-stop gradient pulled from /json/palx (fetched once in
 *     _loadFromWled). Clicking a palette sends only `seg.pal` — no forced
 *     effect switch, matching WLED's own web UI behaviour (palette and
 *     effect are independent; either can be set in any order).
 *   - Removed: DEFAULT_PRESETS, the old broken multi-colour presets (always
 *     collapsed to col[0], never functional), and the `config.presets:`
 *     YAML override path in setConfig() — no longer meaningful now the list
 *     is a fixed palette set, not colour presets.
 *   - Added defensive handling for WLED's dynamic palette entries (the
 *     `*`-prefixed ones like "* Random Cycle", "* Color 1" — string-array
 *     entries in /json/palx instead of [pos,r,g,b] stops): rendered with a
 *     striped fallback swatch instead of a gradient. None of the 18
 *     hand-picked palettes are dynamic; this exists for correctness if the
 *     list is ever extended.
 *
 * v2.3 changes:
 *   - Fixed missing _setStatus method — was being called in 7 places but never
 *     defined, throwing a silent TypeError after every _loadFromWled() success
 *     that broke subsequent renders (looked like a pagination bug, wasn't one).
 *   - Preset/effects nav rows: taller touch target (NAV_H, 42px vs 28px item
 *     rows) for phone use, labels changed from arrow glyphs to "prev page"/
 *     "next page".
 *   - Preset/effects list columns now bottom-align via fixed LIST_H regardless
 *     of actual row count on a given page (previously varied with content).
 *   - "Color Presets" column header gained an invisible spacer matching the
 *     "SET TO SOLID" button's box model so both column headers align at the
 *     same height — spacer is a non-interactive <span>, not a fake button.
 *
 * v2.0 changes:
 *   - Real independent Cold White / Warm White sliders, replacing the RGB-faked
 *     white presets. Entity mode sends rgbww_color: [r,g,b,cw,ww], matching the
 *     ATTR_RGBWW_COLOR shape the WLED custom_components override's light.py
 *     expects. Host/REST mode sends the WLED-native equivalent: col [r,g,b,w]
 *     (w = max(cw,ww)) plus a computed cct 0-255 balance value, since WLED's own
 *     firmware only exposes a single warm<->cool axis, not independently
 *     addressable channels — HA's rgbww_color is an abstraction on top of that.
 *   - State readback (poll and entity sync) reconstructs cw/ww from whichever
 *     source is active so the sliders stay in sync with the strip.
 *
 * v1.79 changes:
 *   - Header redesign: auto toggle left, name+version centred, on/off toggle right
 *
 * v1.78 changes:
 *   - Auto toggle button in header: optional `auto_toggle` YAML config option
 *     toggles an input_boolean to enable/disable the light's automation
 *   - Colour lock: ignore HA state colour sync for 5s after user picks a colour
 *     prevents HA entity pushing white back over user-selected colour
 *
 * v1.7 changes:
 *   - Brightness slider fix: use bitwise OR (| 0) to force true 32-bit integer
 *     resolving HA "expected int for dictionary value @ data['brightness']" error
 *
 * v1.6 changes:
 *   - Brightness slider fix: value explicitly cast to integer via Math.round(Number())
 *     to resolve HA "expected int for dictionary value @ data['brightness']" error
 *
 * v1.5 changes:
 *   - Version stamp visible in card header (top right)
 *
 * v1.4 changes:
 *   - Effects list sorted A-Z
 *   - Pager redesigned: dedicated prev/next nav rows — all items selectable on every page
 *   - "Set Solid Colour" quick button added above effects list
 *   - Colour circle indicator removed from quick-colour row
 *   - Brightness slider fix: includes current brightness when toggling power on (host mode)
 *
 * v1.3 changes:
 *   - Click-to-page list for both presets and effects (no scrollbar, no focus stealing)
 *   - Polling every 30s to stay in sync with external changes
 *   - Background colour tint on load bulletproofed
 *
 * v1.2 changes:
 *   - Initial paged list implementation
 */

const CARD_VERSION = 'v2.5';
const PAGE_SIZE = 5;      // items visible per page
const ITEM_H    = 28;     // px per row
const POLL_MS   = 10000;
const NAV_H     = 42;     // prev/next row height — bigger touch target
const LIST_H    = PAGE_SIZE * ITEM_H + (2 * NAV_H);   // fixed list height so both columns bottom-align, ignoring actual row count

// 18 hand-picked WLED palettes, indices confirmed against device's /json/palettes.
// Host-mode only — sets seg.pal via REST, no forced effect switch (matches WLED's
// own web UI: palette and effect are independent, either can be set in any order).
const PALETTES = [
  { name: 'Party',          id: 6 },
  { name: 'Ocean',          id: 9 },
  { name: 'Rainbow',        id: 11 },
  { name: 'Rainbow Bands',  id: 12 },
  { name: 'Sunset',         id: 13 },
  { name: 'Sunset 2',       id: 21 },
  { name: 'Fire',           id: 35 },
  { name: 'Icefire',        id: 36 },
  { name: 'Orange & Teal',  id: 44 },
  { name: 'C9',             id: 48 },
  { name: 'Aurora',         id: 50 },
  { name: 'C9 2',           id: 52 },
  { name: 'C9 New',         id: 53 },
  { name: 'Aurora 2',       id: 55 },
  { name: 'Retro Clown',    id: 56 },
  { name: 'Candy',          id: 57 },
  { name: 'Candy2',         id: 70 },
  { name: 'Traffic Light',  id: 71 },
];

const QUICK = [
  { title: 'Red',        col: [[255,0,0]],   cw: 0,   ww: 0,   bg: '#ff0000' },
  { title: 'Green',      col: [[0,255,0]],   cw: 0,   ww: 0,   bg: '#00ff00' },
  { title: 'Blue',       col: [[0,0,255]],   cw: 0,   ww: 0,   bg: '#0000ff' },
  { title: 'White',      col: [[0,0,0]],     cw: 180, ww: 180, bg: '#ffffff' },
  { title: 'Warm White', col: [[0,0,0]],     cw: 0,   ww: 255, bg: '#ffb450' },
  { title: 'Cyan',       col: [[0,255,255]], cw: 0,   ww: 0,   bg: '#00ffff' },
  { title: 'Magenta',    col: [[255,0,255]], cw: 0,   ww: 0,   bg: '#ff00ff' },
];

// -- CW/WW ? WLED cct/w-brightness conversion ------------------------------
// WLED's own firmware only exposes a single warm?cool axis (cct, 0-255) plus
// one white brightness value — it has no independently addressable cold/warm
// channels. The WLED custom_components override's light.py approximates
// independent CW/WW sliders on top of that single axis. These two functions
// mirror light.py's math exactly so REST/host mode (which talks to WLED's
// native JSON API directly, bypassing that override) computes the same
// values the HA entity would.
function cwWwToCct(cw, ww) {
  const wBrightness = Math.max(cw, ww);
  let cct;
  if (wBrightness === 0) cct = 127;
  else if (ww === wBrightness) cct = Math.floor((cw * 127) / wBrightness);
  else cct = 255 - Math.floor((ww * 128) / wBrightness);
  return { cct, wBrightness };
}
function cctToCwWw(cct, wBrightness) {
  let cw, ww;
  if (cct <= 127) {
    ww = wBrightness;
    cw = Math.floor((cct * wBrightness) / 127);
  } else {
    cw = wBrightness;
    ww = Math.floor(((255 - cct) * wBrightness) / 128);
  }
  return { cw, ww };
}

class WledCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._loadedAt = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'});
    this._debounce = {};
    this._hass = null;
    this._entity = null;
    this._host = null;
    this._initialized = false;
    this._pollTimer = null;
    this._effects = [];
    this._fxPage = 0;
    this._presetPage = 0;
    this._selectedFx = 0;
    this._selectedPreset = null;
    this._paletteData = {};   // populated in _loadFromWled from /json/palx: id -> {stops:[[pos,r,g,b],...]} or {dynamic:true}
  }

	set hass(hass) {
    this._hass = hass;
    if (!this._initialized || !this._entity) return;
    // Auto-detect boolean from sensor map
    if (!this._autoToggle) {
      const sensor = hass.states['sensor.auto_lights_onoff_map'];
      if (sensor && sensor.attributes.map) {
        const map = sensor.attributes.map;
        const match = map.find(e => e.light === this._entity);
        if (match) {
          this._autoToggle = match.boolean;
          this._render();
        }
      }
    }
    const state = hass.states[this._entity];
    if (!state) return;
    this._syncFromState(state);
  }

  setConfig(config) {
    this._entity = config.entity || null;
    this._host = config.host ? config.host.replace(/\/$/, '') : null;
    if (!this._entity && !this._host) throw new Error('wled-card: entity or host required');
    this._name = config.name || 'WLED';
    this._autoToggle = null;
    this._render();
    this._initialized = true;
    if (this._host) {
      this._loadFromWled();
      this._startPolling();
    }
  }

  disconnectedCallback() {
    clearInterval(this._pollTimer);
  }

  _startPolling() {
    clearInterval(this._pollTimer);
    this._pollTimer = setInterval(() => this._pollWled(), POLL_MS);
  }

  async _pollWled() {
    if (!this._host) return;
    try {
      const state = await fetch(this._host + '/json/state').then(r => r.json());
      const sr = this.shadowRoot;
      sr.getElementById('pwr').checked = state.on;
      sr.getElementById('bri').value = state.bri;
      sr.getElementById('bri-val').textContent = state.bri;
      const seg = state.seg?.[0];
      if (seg?.col?.[0]) {
        const [r,g,b,w] = seg.col[0];
        if (!this._colourLocked) this._setCardBg(r,g,b);
        if (!this._colourLocked && seg.cct !== undefined && w !== undefined) {
          const { cw, ww } = cctToCwWw(seg.cct, w);
          sr.getElementById('cw').value = cw;
          sr.getElementById('cw-val').textContent = cw;
          sr.getElementById('ww').value = ww;
          sr.getElementById('ww-val').textContent = ww;
        }
      }
      if (seg?.sx !== undefined) { sr.getElementById('sx').value = seg.sx; sr.getElementById('sx-val').textContent = seg.sx; }
      if (seg?.ix !== undefined) { sr.getElementById('ix').value = seg.ix; sr.getElementById('ix-val').textContent = seg.ix; }
      if (seg?.fx !== undefined && seg.fx !== this._selectedFx) {
        this._selectedFx = seg.fx;
        const si = this._effects.findIndex(e => e.id === seg.fx);
        if (si >= 0) this._fxPage = Math.floor(si / PAGE_SIZE);
        this._renderFxPage();
      }
    } catch(e) { /* silent */ }
  }

_syncFromState(state) {
    const sr = this.shadowRoot;
    const on = state.state === 'on';
    sr.getElementById('pwr').checked = on;
	if (!this._briDragging && state.attributes.brightness != null && state.attributes.brightness > 0) {
    //if (!this._briDragging && state.attributes.brightness != null) {
      const bri = state.attributes.brightness;
      sr.getElementById('bri').value = bri;
      sr.getElementById('bri-val').textContent = bri;
    }
    if (!this._colourLocked && on && state.attributes.rgbww_color) {
      const [r,g,b,cw,ww] = state.attributes.rgbww_color;
      this._setCardBg(r,g,b);
      sr.getElementById('cw').value = cw;
      sr.getElementById('cw-val').textContent = cw;
      sr.getElementById('ww').value = ww;
      sr.getElementById('ww-val').textContent = ww;
    } else if (!this._colourLocked && on && state.attributes.rgb_color) {
      const [r,g,b] = state.attributes.rgb_color;
      this._setCardBg(r,g,b);
    }
    sr.getElementById('status').textContent = on ? 'On' : 'Off';
    sr.getElementById('status').className = 'status';
    if (this._autoToggle && this._hass) {
      const autoEl = sr.getElementById('auto-tog');
      if (autoEl) autoEl.checked = this._hass.states[this._autoToggle]?.state === 'on';
    }
  }

  _toHex(rgb) {
    return '#' + rgb.map(x => Math.round(Math.max(0,Math.min(255,x))).toString(16).padStart(2,'0')).join('');
  }

  _setStatus(msg, err = false) {
    const el = this.shadowRoot.getElementById('status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'status' + (err ? ' err' : '');
  }

  _setCardBg(r,g,b) {
    const el = this.shadowRoot.getElementById('card-inner');
    if (!el) return;
    // Option 1 — subtle full card tint
    // el.style.background = `linear-gradient(135deg, rgba(${r},${g},${b},0.18) 0%, rgba(${r},${g},${b},0.05) 100%)`;
    // Option 2 — strong left fade
    // el.style.background = `linear-gradient(90deg, rgba(${r},${g},${b},0.98) 0%, rgba(${r},${g},${b},0.05) 100%)`;
    // Option 3 — strong right fade
    // el.style.background = `linear-gradient(90deg, rgba(${r},${g},${b},0.05) 0%, rgba(${r},${g},${b},0.98) 100%)`;
    // Option 4 — right quarter only
     el.style.background = `linear-gradient(180deg, rgba(${r},${g},${b},0.05) 0%, rgba(${r},${g},${b},0.05) 75%, rgba(${r},${g},${b},0.95) 100%)`;
    // Option 5 — radial vignette glow from edges (default)
    //el.style.background = `radial-gradient(ellipse at center, rgba(${r},${g},${b},0.0) 40%, rgba(${r},${g},${b},0.95) 100%)`;
  }

  _setColor(col, cw, ww) {
    const [r,g,b] = col[0];
    const sr = this.shadowRoot;
    if (cw === undefined) cw = parseInt(sr.getElementById('cw').value) || 0;
    if (ww === undefined) ww = parseInt(sr.getElementById('ww').value) || 0;
    sr.getElementById('pwr').checked = true;
    if (cw > 20 || ww > 20) this._setCardBg(255,255,255);
    else this._setCardBg(r,g,b);
    sr.getElementById('cw').value = cw;
    sr.getElementById('cw-val').textContent = cw;
    sr.getElementById('ww').value = ww;
    sr.getElementById('ww-val').textContent = ww;
    this._lastCol = col; this._lastCw = cw; this._lastWw = ww;
    this._colourLocked = true;
    clearTimeout(this._colourLockTimer);
    this._colourLockTimer = setTimeout(() => { this._colourLocked = false; }, 5000);
    if (this._entity && this._hass) {
      // Matches the (r, g, b, cold_white, warm_white) shape the WLED
      // override's light.py expects for ATTR_RGBWW_COLOR.
      this._hass.callService('light', 'turn_on', {
        entity_id: this._entity,
        rgbww_color: [r, g, b, cw, ww],
      });
      this._setStatus('OK');
    } else if (this._host) {
      const { cct, wBrightness } = cwWwToCct(cw, ww);
      this._restApi({ on: true, seg: [{ col: [[r, g, b, wBrightness]] }], cct });
    }
  }

  // Change only the white balance, keeping whatever RGB colour is currently set.
  _setWhiteChannel(cw, ww) {
    const col = this._lastCol || [[0,0,0]];
    if (cw === undefined) cw = this._lastCw ?? 0;
    if (ww === undefined) ww = this._lastWw ?? 0;
    this._setColor(col, cw, ww);
  }
_callLight(data) {
    if (this._entity && this._hass) {
      if (data.state === false) {
        this._hass.callService('light', 'turn_off', { entity_id: this._entity });
      } else {
        const svc = { entity_id: this._entity };
        if (data.brightness !== undefined) {
          const bri = data.brightness | 0;
          //console.log('[wled-card] brightness sending:', bri, typeof bri);
          svc.brightness = bri;
        }
        this._hass.callService('light', 'turn_on', svc);
      }
      this._setStatus('OK');
    } else if (this._host) {
      if (data.state === false) {
        this._restApi({ on: false });
      } else {
        const payload = { on: true };
        if (data.brightness !== undefined) {
          payload.bri = data.brightness | 0;
        } else {
          const briEl = this.shadowRoot.getElementById('bri');
          if (briEl) payload.bri = parseInt(briEl.value);
        }
        this._restApi(payload);
      }
    }
  }
  async _restApi(payload) {
    try {
      const r = await fetch(this._host + '/json/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      this._setStatus('OK');
    } catch(e) { this._setStatus(e.message, true); }
  }

  // /json/palx is paginated (8 palette ids per page, "m" in the response = total
  // page count). A single unpaginated fetch only ever returns ids 0-7 — anything
  // beyond that (most of the curated 18) silently has no swatch data. Fetch page 0
  // to learn the page count, then fetch the rest in parallel and merge.
  async _fetchAllPalx() {
    const first = await fetch(this._host + '/json/palx?page=0').then(r => r.json()).catch(() => null);
    if (!first || !first.p) return {};
    const merged = { ...first.p };
    const totalPages = first.m || 1;
    if (totalPages > 1) {
      const rest = await Promise.all(
        Array.from({ length: totalPages - 1 }, (_, i) => i + 1).map(page =>
          fetch(this._host + '/json/palx?page=' + page).then(r => r.json()).catch(() => null)
        )
      );
      for (const pg of rest) {
        if (pg && pg.p) Object.assign(merged, pg.p);
      }
    }
    return merged;
  }

  async _loadFromWled() {
    try {
      const [state, info, palx] = await Promise.all([
        fetch(this._host + '/json/state').then(r => r.json()),
        fetch(this._host + '/json').then(r => r.json()),
        this._fetchAllPalx().catch(() => null)
      ]);
      this._effects = (info.effects || []).map((name, id) => ({ name, id })).sort((a, b) => a.name.localeCompare(b.name));
      // palx keys are palette ids. Values are either [pos,r,g,b] gradient stops
      // (real palettes) or a string array like ["r"] / ["c1","c2"] (WLED's dynamic
      // palettes — random cycle, segment-color-driven — no fixed gradient exists).
      if (palx) {
        for (const [idStr, val] of Object.entries(palx)) {
          const id = parseInt(idStr);
          if (Array.isArray(val) && val.length && Array.isArray(val[0])) {
            this._paletteData[id] = { stops: val };
          } else {
            this._paletteData[id] = { dynamic: true };
          }
        }
      }
      this._renderPresetPage();
      this._selectedFx = state.seg?.[0]?.fx ?? 0;
      // jump to page containing current effect (sorted index)
      const sortedIdx = this._effects.findIndex(e => e.id === this._selectedFx);
      this._fxPage = Math.floor(Math.max(0, sortedIdx) / PAGE_SIZE);
      this._renderFxPage();
      if (!this._entity) {
        const sr = this.shadowRoot;
        sr.getElementById('pwr').checked = state.on;
        sr.getElementById('bri').value = state.bri;
        sr.getElementById('bri-val').textContent = state.bri;
        const seg = state.seg?.[0];
        if (seg?.col?.[0]) {
          const [r,g,b,w] = seg.col[0];
          setTimeout(() => this._setCardBg(r,g,b), 150);
          if (seg.cct !== undefined && w !== undefined) {
            const { cw, ww } = cctToCwWw(seg.cct, w);
            sr.getElementById('cw').value = cw;
            sr.getElementById('cw-val').textContent = cw;
            sr.getElementById('ww').value = ww;
            sr.getElementById('ww-val').textContent = ww;
            this._lastCol = [[r,g,b]]; this._lastCw = cw; this._lastWw = ww;
          }
        }
        if (seg?.sx !== undefined) { sr.getElementById('sx').value = seg.sx; sr.getElementById('sx-val').textContent = seg.sx; }
        if (seg?.ix !== undefined) { sr.getElementById('ix').value = seg.ix; sr.getElementById('ix-val').textContent = seg.ix; }
      } else {
        const seg = state.seg?.[0];
        if (seg?.col?.[0]) {
          const [r,g,b] = seg.col[0];
          setTimeout(() => this._setCardBg(r,g,b), 150);
        }
      }
      this._setStatus('Connected');
    } catch(e) { this._setStatus('Cannot reach WLED', true); }
  }

  // -- Paged list helpers ------------------------------------------------------
  // Items are shown PAGE_SIZE at a time.
  // Clicking the LAST visible item advances to the next page (wraps around).
  // Clicking the FIRST visible item goes back one page (wraps around).
  // No scrollbar — no focus stealing.
 
  _navRow(label, onClick) {
    const row = document.createElement('div');
    row.className = 'list-item';
    row.style.justifyContent = 'center';
    row.style.opacity = '0.45';
    row.style.fontSize = '11px';
    row.style.height = NAV_H + 'px';
    row.textContent = label;
    row.addEventListener('click', onClick);
    return row;
    }

_renderPresetPage() {
    const container = this.shadowRoot.getElementById('preset-list');
    if (!container) return;
    container.innerHTML = '';
    const total = PALETTES.length;
    const start = this._presetPage * PAGE_SIZE;
    const slice = PALETTES.slice(start, start + PAGE_SIZE);

    if (this._presetPage > 0) {
      container.appendChild(this._navRow('prev page', () => { this._presetPage--; this._renderPresetPage(); }));
    }

    slice.forEach((p, localIdx) => {
      const globalIdx = start + localIdx;
      const isSelected = this._selectedPreset === globalIdx;
      const item = document.createElement('div');
      item.className = 'list-item' + (isSelected ? ' selected' : '');
      const dot = document.createElement('div');
      const data = this._paletteData[p.id];
      if (data && data.stops) {
        dot.className = 'swatch-gradient';
        const stops = data.stops
          .slice().sort((a, b) => a[0] - b[0])
          .map(([pos, r, g, b]) => `rgb(${r},${g},${b}) ${(pos / 255 * 100).toFixed(1)}%`)
          .join(', ');
        dot.style.background = `linear-gradient(90deg, ${stops})`;
      } else if (data && data.dynamic) {
        dot.className = 'swatch-dynamic';
        dot.title = 'Dynamic palette — no fixed preview';
      } else {
        // palette data not loaded yet (no host, or /json/palx fetch pending/failed)
        dot.className = 'swatch-gradient';
        dot.style.background = 'rgba(255,255,255,0.12)';
      }
      item.appendChild(dot);
      const lbl = document.createElement('span');
      lbl.style.flex = '1';
      lbl.textContent = p.name;
      item.appendChild(lbl);
      item.addEventListener('click', () => {
        this._selectedPreset = globalIdx;
        this.shadowRoot.querySelectorAll('#preset-list .list-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        if (this._host) this._restApi({ seg: [{ pal: p.id }] });
      });
      container.appendChild(item);
    });

    if (start + PAGE_SIZE < total) {
      container.appendChild(this._navRow('next page', () => { this._presetPage++; this._renderPresetPage(); }));
    }
    container.style.height = LIST_H + 'px';
  }

_renderFxPage() {
    const container = this.shadowRoot.getElementById('fx-list');
    if (!container || !this._effects.length) return;
    container.innerHTML = '';
    const total = this._effects.length;
    const start = this._fxPage * PAGE_SIZE;
    const slice = this._effects.slice(start, start + PAGE_SIZE);

    if (this._fxPage > 0) {
      container.appendChild(this._navRow('prev page', () => { this._fxPage--; this._renderFxPage(); }));
    }

    slice.forEach((e, localIdx) => {
      const isSelected = e.id === this._selectedFx;
      const item = document.createElement('div');
      item.className = 'list-item' + (isSelected ? ' selected' : '');
      const lbl = document.createElement('span');
      lbl.style.flex = '1';
      lbl.textContent = e.name;
      item.appendChild(lbl);
      item.addEventListener('click', () => {
        this._selectedFx = e.id;
        this._renderFxPage();
        if (this._host) this._restApi({ seg: [{ fx: e.id }] });
      });
      container.appendChild(item);
    });

    if (start + PAGE_SIZE < total) {
      container.appendChild(this._navRow('next page', () => { this._fxPage++; this._renderFxPage(); }));
    }
    container.style.height = LIST_H + 'px';
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .card {
          position: relative;
          background: var(--ha-card-background, var(--card-background-color, #1c1c1e));
          border-radius: var(--ha-card-border-radius, 12px);
          border: 1px solid rgba(255,255,255,0.07);
          overflow: hidden;
        }
        .version-tag {
          position: absolute;
          top: 6px;
          right: 10px;
          font-size: 11px;
          color: rgba(255,255,255,0.5);
          letter-spacing: 0.05em;
          pointer-events: none;
          z-index: 1;
          font-family: 'SF Pro Display', -apple-system, sans-serif;
        }
        .card-inner {
          padding: 16px;
          font-family: 'SF Pro Display', -apple-system, sans-serif;
          color: var(--primary-text-color, #fff);
          transition: background 0.6s ease;
          border-radius: var(--ha-card-border-radius, 12px);
        }
        .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
        .name { font-size: 14px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; opacity: 0.6; }
        .toggle { position: relative; width: 46px; height: 26px; flex-shrink: 0; }
        .toggle input { opacity: 0; width: 0; height: 0; }
        .knob { position: absolute; inset: 0; background: rgba(255,255,255,0.12); border-radius: 13px; cursor: pointer; transition: background 0.2s; }
        .toggle input:checked + .knob { background: #ff6a00; }
        .knob:before { content: ''; position: absolute; width: 20px; height: 20px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: transform 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.4); }
        .toggle input:checked + .knob:before { transform: translateX(20px); }
        .row { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
        .lbl { font-size: 12px; opacity: 0.45; min-width: 72px; letter-spacing: 0.03em; }
        .val { font-size: 12px; min-width: 30px; text-align: right; opacity: 0.7; font-variant-numeric: tabular-nums; }
        input[type=range] { flex: 1; -webkit-appearance: none; height: 3px; border-radius: 2px; background: rgba(255,255,255,0.15); outline: none; cursor: pointer; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.5); }
        .quick-row { display: flex; gap: 8px; margin-bottom: 12px; }
        .qbtn { flex: 1; height: 28px; border-radius: 6px; border: 2px solid transparent; cursor: pointer; outline: none; transition: transform 0.1s, border-color 0.15s; font-size: 0; }
        .qbtn:hover { transform: scale(1.08); }
        .qbtn.active { border-color: #fff; box-shadow: 0 0 6px rgba(255,255,255,0.4); }
        .divider { border: none; border-top: 1px solid rgba(255,255,255,0.07); margin: 4px 0 12px; }
        .col-header { font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.35; margin-bottom: 6px; }
        .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
        .paged-list {
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.03);
          overflow: hidden;
        }
        .list-item {
          display: flex; align-items: center; gap: 6px;
          padding: 0 8px; height: ${ITEM_H}px;
          font-size: 12px; cursor: pointer;
          border-bottom: 1px solid rgba(255,255,255,0.04);
          transition: background 0.1s; user-select: none;
        }
        .list-item:last-child { border-bottom: none; }
        .list-item:hover { background: rgba(255,255,255,0.06); }
        .list-item.selected { background: rgba(255,106,0,0.18); color: #ff6a00; }
        .swatch { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.2); }
        .swatch-gradient { width: 68px; height: 14px; border-radius: 2px; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.2); }
        .swatch-dynamic {
          width: 68px; height: 14px; border-radius: 2px; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.2);
          background: repeating-linear-gradient(45deg, rgba(255,255,255,0.25) 0 3px, rgba(255,255,255,0.05) 3px 6px);
        }
        .page-nav { font-size: 9px; opacity: 0.4; flex-shrink: 0; }
        .list-item:hover .page-nav { opacity: 0.8; }
        .status { font-size: 10px; opacity: 0.3; text-align: right; margin-top: 4px; letter-spacing: 0.05em; min-height: 14px; }
        .status.err { opacity: 0.7; color: #ff453a; }
      </style>

      <ha-card>
        <div class="card">
          <div class="version-tag">${CARD_VERSION} · loaded ${this._loadedAt}</div>
          <div class="card-inner" id="card-inner">
            <div class="header">
              ${this._autoToggle ? `
              <div style="display:flex;align-items:center;gap:5px;">
                <label class="toggle"><input type="checkbox" id="auto-tog"><span class="knob"></span></label>
                <span style="font-size:11px;opacity:0.5;letter-spacing:0.03em;">Auto</span>
              </div>
              ` : '<div></div>'}
              <div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
                <span class="name">${this._name}</span>
              </div>
              <div style="display:flex;align-items:center;gap:5px;">
                <span style="font-size:11px;opacity:0.5;letter-spacing:0.03em;">On/Off</span>
                <label class="toggle"><input type="checkbox" id="pwr"><span class="knob"></span></label>
              </div>
            </div>

            <div class="row">
              <span class="lbl">Brightness</span>
              <input type="range" id="bri" min="0" max="255" value="128" step="1">
              <span class="val" id="bri-val">128</span>
            </div>

            <div class="row">
              <span class="lbl">Cold White</span>
              <input type="range" id="cw" min="0" max="255" value="0" step="1">
              <span class="val" id="cw-val">0</span>
            </div>

            <div class="row">
              <span class="lbl">Warm White</span>
              <input type="range" id="ww" min="0" max="255" value="0" step="1">
              <span class="val" id="ww-val">0</span>
            </div>

            <hr class="divider">

            <div class="quick-row">
              ${QUICK.map((q,i) => `<button class="qbtn" data-idx="${i}" style="background:${q.bg}" title="${q.title}" aria-label="${q.title}"></button>`).join('')}
            </div>

            <hr class="divider">

            <div class="two-col">
              <div>
                <div class="col-header" style="display:flex;align-items:center;justify-content:space-between;">Color Palettes<span style="font-size:12px;padding:1px 6px;border:1px solid transparent;letter-spacing:0.04em;visibility:hidden;">SET TO SOLID</span></div>

                <div class="paged-list" id="preset-list"></div>
              </div>
              <div>
                <div class="col-header" style="display:flex;align-items:center;justify-content:space-between;">Effects<button id="solid-btn" style="font-size:12px;padding:1px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.8);color:inherit;cursor:hand;letter-spacing:0.04em;">SET TO SOLID</button></div>
                <div class="paged-list" id="fx-list">
                  <div class="list-item" style="opacity:0.3;cursor:default">Loading…</div>
                </div>
              </div>
            </div>

            <div class="row">
              <span class="lbl">Speed</span>
              <input type="range" id="sx" min="0" max="255" value="128" step="1">
              <span class="val" id="sx-val">128</span>
            </div>

            <div class="row" style="margin-bottom:0">
              <span class="lbl">Intensity</span>
              <input type="range" id="ix" min="0" max="255" value="128" step="1">
              <span class="val" id="ix-val">128</span>
            </div>

            <div class="status" id="status">—</div>
          </div>
        </div>
      </ha-card>
    `;

    const sr = this.shadowRoot;

    sr.getElementById('pwr').addEventListener('change', e => this._callLight({ state: e.target.checked }));

    if (this._autoToggle) {
      sr.getElementById('auto-tog').addEventListener('change', e => {
        this._hass.callService('input_boolean', e.target.checked ? 'turn_on' : 'turn_off', { entity_id: this._autoToggle });
      });
    }

      sr.getElementById('bri').addEventListener('input', e => {
      //console.log('[wled-card] slider raw value:', e.target.value, 'slider min/max:', e.target.min, e.target.max);
      sr.getElementById('bri-val').textContent = e.target.value;
      clearTimeout(this._debounce.bri);
      const bri = e.target.value | 0;
      this._debounce.bri = setTimeout(() => this._callLight({ brightness: bri }), 250);
    });

    sr.getElementById('cw').addEventListener('input', e => {
      sr.getElementById('cw-val').textContent = e.target.value;
      clearTimeout(this._debounce.cw);
      this._debounce.cw = setTimeout(() =>
        this._setWhiteChannel(parseInt(e.target.value), undefined), 250);
    });

    sr.getElementById('ww').addEventListener('input', e => {
      sr.getElementById('ww-val').textContent = e.target.value;
      clearTimeout(this._debounce.ww);
      this._debounce.ww = setTimeout(() =>
        this._setWhiteChannel(undefined, parseInt(e.target.value)), 250);
    });

    sr.querySelectorAll('.qbtn').forEach(btn => {
      btn.addEventListener('click', () => {
        sr.querySelectorAll('.qbtn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._selectedPreset = null;
        this._renderPresetPage();
        const q = QUICK[parseInt(btn.dataset.idx)];
        this._setColor(q.col, q.cw, q.ww);
      });
    });

    sr.getElementById('sx').addEventListener('input', e => {
      sr.getElementById('sx-val').textContent = e.target.value;
      clearTimeout(this._debounce.sx);
      this._debounce.sx = setTimeout(() => { if (this._host) this._restApi({ seg: [{ sx: parseInt(e.target.value) }] }); }, 250);
    });

    sr.getElementById('ix').addEventListener('input', e => {
      sr.getElementById('ix-val').textContent = e.target.value;
      clearTimeout(this._debounce.ix);
      this._debounce.ix = setTimeout(() => { if (this._host) this._restApi({ seg: [{ ix: parseInt(e.target.value) }] }); }, 250);
    });

    sr.getElementById('solid-btn').addEventListener('click', () => {
      this._selectedFx = 0;
      this._fxPage = 0;
      this._renderFxPage();
      if (this._host) this._restApi({ seg: [{ fx: 0 }] });
      if (this._entity && this._hass) this._hass.callService('light', 'turn_on', { entity_id: this._entity, effect: 'Solid' });
      this._setStatus('Solid');
    });

    // render initial preset page
    this._renderPresetPage();
  }

  getCardSize() { return 5; }
}

customElements.define('wled-card', WledCard);