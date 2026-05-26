/**
 * wled-card.js — v1.1
 * Custom Lovelace card for WS2805 RGBWW LED strips via WLED.
 *
 * Why this exists:
 * HA's built-in light integration does not correctly handle WS2805 5-channel
 * RGBWW LEDs. Colors break, white channels are mangled, every standard card
 * fails. This card bypasses the broken integration — routing on/off/brightness/
 * color through HA callService to keep automations working, while talking
 * directly to WLED REST for effects, speed and intensity.
 *
 * v1.1 changes:
 * - Scrollable inline effects list (no popup dropdown)
 * - State polling every 30s (stays in sync with external changes)
 * - Expanded preset list (primaries, secondaries, multi-color combos)
 * - Background color on load bulletproofed with retry
 *
 * License: MIT
 */

const POLL_INTERVAL = 30000; // ms — how often to sync state from WLED
const ITEM_H = 28;           // px — height of each effect list row
const MAX_VISIBLE = 6;       // number of effect rows visible before scrolling

// ─── Color presets ────────────────────────────────────────────────────────────
// Single color: col: [[r,g,b]]
// Multi-color:  col: [[r,g,b],[r,g,b],[r,g,b]] — used by effects with palettes
const DEFAULT_PRESETS = [
  // Primaries
  { name: 'Red',          col: [[255,0,0]] },
  { name: 'Green',        col: [[0,255,0]] },
  { name: 'Blue',         col: [[0,0,255]] },
  // Secondaries
  { name: 'Cyan',         col: [[0,255,255]] },
  { name: 'Magenta',      col: [[255,0,255]] },
  { name: 'Yellow',       col: [[255,255,0]] },
  // Whites
  { name: 'White',        col: [[255,255,255]] },
  { name: 'Warm White',   col: [[255,180,80]] },
  { name: 'Soft White',   col: [[255,220,150]] },
  { name: 'Cool White',   col: [[200,220,255]] },
  // Warm tones
  { name: 'Orange',       col: [[255,100,0]] },
  { name: 'Amber',        col: [[255,140,0]] },
  { name: 'Pink',         col: [[255,0,128]] },
  { name: 'Hot Pink',     col: [[255,0,80]] },
  // Cool tones
  { name: 'Purple',       col: [[160,0,255]] },
  { name: 'Lavender',     col: [[180,130,255]] },
  { name: 'Ice Blue',     col: [[100,180,255]] },
  { name: 'Teal',         col: [[0,180,150]] },
  // Multi-color effect presets
  { name: 'RGB',          col: [[255,0,0],[0,255,0],[0,0,255]] },
  { name: 'Fire',         col: [[255,0,0],[255,80,0],[255,200,0]] },
  { name: 'Ocean',        col: [[0,60,180],[0,180,200],[0,255,180]] },
  { name: 'Forest',       col: [[0,120,40],[0,200,80],[180,255,0]] },
  { name: 'Sunset',       col: [[255,80,20],[255,180,0],[200,0,50]] },
  { name: 'Aurora',       col: [[0,255,128],[0,128,255],[128,0,255]] },
  { name: 'Candy',        col: [[255,0,128],[255,255,0],[0,255,255]] },
];

// ─── Quick pick buttons ───────────────────────────────────────────────────────
// Tap to set color and power on simultaneously — no popup
const QUICK = [
  { title: 'Red',        col: [[255,0,0]],     bg: '#ff0000' },
  { title: 'Green',      col: [[0,255,0]],     bg: '#00ff00' },
  { title: 'Blue',       col: [[0,0,255]],     bg: '#0000ff' },
  { title: 'White',      col: [[255,255,255]], bg: '#ffffff' },
  { title: 'Warm White', col: [[255,180,80]],  bg: '#ffb450' },
  { title: 'Cyan',       col: [[0,255,255]],   bg: '#00ffff' },
  { title: 'Magenta',    col: [[255,0,255]],   bg: '#ff00ff' },
];

class WledCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._debounce = {};
    this._hass = null;
    this._entity = null;
    this._host = null;
    this._initialized = false;
    this._pollTimer = null;
  }

  // ─── HA state sync ────────────────────────────────────────────────────────
  // Fires on every HA state change — keeps card in sync with automations
  set hass(hass) {
    this._hass = hass;
    if (!this._initialized || !this._entity) return;
    const state = hass.states[this._entity];
    if (!state) return;
    this._syncFromState(state);
  }

  setConfig(config) {
    this._entity = config.entity || null;
    this._host = config.host ? config.host.replace(/\/$/, '') : null;
    if (!this._entity && !this._host) throw new Error('wled-card: entity or host required');
    this._name = config.name || 'WLED';
    this._presets = (config.presets && config.presets.length)
      ? config.presets.map(p => ({
          name: p.name,
          col: Array.isArray(p.rgb && p.rgb[0]) ? p.rgb : p.col || [p.rgb || [255,255,255]]
        }))
      : DEFAULT_PRESETS;
    this._render();
    this._initialized = true;
    if (this._host) {
      this._loadFromWled();
      this._startPolling();
    }
  }

  disconnectedCallback() {
    // Clean up poll timer when card is removed
    clearInterval(this._pollTimer);
  }

  // ─── Polling ──────────────────────────────────────────────────────────────
  // Syncs WLED state every 30s so card stays current after external changes
  _startPolling() {
    clearInterval(this._pollTimer);
    this._pollTimer = setInterval(() => this._pollWled(), POLL_INTERVAL);
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
        const [r,g,b] = seg.col[0];
        sr.getElementById('cur-color').style.background = this._toHex(seg.col[0]);
        this._setCardBg(r,g,b);
      }
      if (seg?.sx !== undefined) { sr.getElementById('sx').value = seg.sx; sr.getElementById('sx-val').textContent = seg.sx; }
      if (seg?.ix !== undefined) { sr.getElementById('ix').value = seg.ix; sr.getElementById('ix-val').textContent = seg.ix; }
      // Highlight current effect in list
      if (seg?.fx !== undefined) this._highlightEffect(seg.fx);
    } catch(e) { /* silent fail on poll */ }
  }

  // ─── Sync UI from HA state ────────────────────────────────────────────────
  _syncFromState(state) {
    const sr = this.shadowRoot;
    const on = state.state === 'on';
    sr.getElementById('pwr').checked = on;
    if (state.attributes.brightness !== undefined) {
      const bri = state.attributes.brightness;
      sr.getElementById('bri').value = bri;
      sr.getElementById('bri-val').textContent = bri;
    }
    if (on && state.attributes.rgb_color) {
      const [r,g,b] = state.attributes.rgb_color;
      sr.getElementById('cur-color').style.background = this._toHex([r,g,b]);
      this._setCardBg(r,g,b);
    }
    sr.getElementById('status').textContent = on ? 'On' : 'Off';
    sr.getElementById('status').className = 'status';
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  _toHex(rgb) {
    return '#' + rgb.map(x => Math.round(Math.max(0,Math.min(255,x))).toString(16).padStart(2,'0')).join('');
  }

  // ─── Card background gradient ─────────────────────────────────────────────
  // Tints card background to reflect current light color.
  // Uncomment preferred style — only one active at a time.
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
    // el.style.background = `linear-gradient(90deg, rgba(${r},${g},${b},0.05) 0%, rgba(${r},${g},${b},0.05) 75%, rgba(${r},${g},${b},0.95) 100%)`;

    // Option 5 — radial vignette glow from edges (default)
    el.style.background = `radial-gradient(ellipse at center, rgba(${r},${g},${b},0.0) 40%, rgba(${r},${g},${b},0.95) 100%)`;
  }

  // ─── Set color ────────────────────────────────────────────────────────────
  // Powers on + sets color in one call — tap quick button or preset
  _setColor(col) {
    const [r,g,b] = col[0];
    const sr = this.shadowRoot;
    sr.getElementById('cur-color').style.background = this._toHex(col[0]);
    sr.getElementById('pwr').checked = true;
    this._setCardBg(r,g,b);
    if (this._entity && this._hass) {
      this._hass.callService('light', 'turn_on', {
        entity_id: this._entity,
        rgb_color: col[0],
      });
      this._setStatus('OK');
    } else if (this._host) {
      this._restApi({ on: true, seg: [{ col }] });
    }
  }

  // ─── Generic light call ───────────────────────────────────────────────────
  _callLight(data) {
    if (this._entity && this._hass) {
      if (data.state === false) {
        this._hass.callService('light', 'turn_off', { entity_id: this._entity });
      } else {
        const svc = { entity_id: this._entity };
        if (data.brightness !== undefined) svc.brightness = data.brightness;
        if (data.rgb !== undefined) svc.rgb_color = data.rgb;
        this._hass.callService('light', 'turn_on', svc);
      }
      this._setStatus('OK');
    } else if (this._host) {
      this._restApi(data.state === false ? { on: false } : { on: true, ...data });
    }
  }

  // ─── Direct WLED REST ─────────────────────────────────────────────────────
  // Effects, speed, intensity — not available via HA light entity
  async _restApi(payload) {
    try {
      const r = await fetch(this._host + '/json/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      this._setStatus('OK');
    } catch(e) {
      this._setStatus(e.message, true);
    }
  }

  // ─── Load WLED state + effects ────────────────────────────────────────────
  async _loadFromWled() {
    try {
      const [state, info] = await Promise.all([
        fetch(this._host + '/json/state').then(r => r.json()),
        fetch(this._host + '/json').then(r => r.json())
      ]);
      this._effects = info.effects || [];
      this._renderEffectList(state.seg?.[0]?.fx ?? 0);
      if (!this._entity) {
        const sr = this.shadowRoot;
        sr.getElementById('pwr').checked = state.on;
        sr.getElementById('bri').value = state.bri;
        sr.getElementById('bri-val').textContent = state.bri;
        const seg = state.seg?.[0];
        if (seg?.col?.[0]) {
          const [r,g,b] = seg.col[0];
          sr.getElementById('cur-color').style.background = this._toHex(seg.col[0]);
          // Retry setCardBg to ensure DOM is ready
          setTimeout(() => this._setCardBg(r,g,b), 150);
        }
        if (seg?.sx !== undefined) { sr.getElementById('sx').value = seg.sx; sr.getElementById('sx-val').textContent = seg.sx; }
        if (seg?.ix !== undefined) { sr.getElementById('ix').value = seg.ix; sr.getElementById('ix-val').textContent = seg.ix; }
      } else {
        // Entity mode — still need bg color on load
        const seg = state.seg?.[0];
        if (seg?.col?.[0]) {
          const [r,g,b] = seg.col[0];
          setTimeout(() => this._setCardBg(r,g,b), 150);
        }
      }
      this._setStatus('Connected');
    } catch(e) {
      this._setStatus('Cannot reach WLED', true);
    }
  }

  // ─── Inline scrollable effect list ───────────────────────────────────────
  _renderEffectList(curFx = 0) {
    const list = this.shadowRoot.getElementById('fx-list');
    if (!list || !this._effects) return;
    list.innerHTML = '';
    this._effects.forEach((name, i) => {
      const item = document.createElement('div');
      item.className = 'list-item' + (i === curFx ? ' selected' : '');
      item.textContent = name;
      item.dataset.idx = i;
      item.addEventListener('click', () => {
        list.querySelectorAll('.list-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        if (this._host) this._restApi({ seg: [{ fx: i }] });
      });
      list.appendChild(item);
    });
    list.style.height = (Math.min(this._effects.length, MAX_VISIBLE) * ITEM_H) + 'px';
  }

  _highlightEffect(fxIdx) {
    const list = this.shadowRoot.getElementById('fx-list');
    if (!list) return;
    list.querySelectorAll('.list-item').forEach(el => {
      el.classList.toggle('selected', parseInt(el.dataset.idx) === fxIdx);
    });
  }

  _setStatus(msg, err=false) {
    const s = this.shadowRoot.getElementById('status');
    if (!s) return;
    s.textContent = msg;
    s.className = 'status' + (err ? ' err' : '');
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .card {
          background: var(--ha-card-background, var(--card-background-color, #1c1c1e));
          border-radius: var(--ha-card-border-radius, 12px);
          border: 1px solid rgba(255,255,255,0.07);
          overflow: hidden;
        }
        .card-inner {
          padding: 16px;
          font-family: 'SF Pro Display', -apple-system, sans-serif;
          color: var(--primary-text-color, #fff);
          transition: background 0.6s ease;
          border-radius: var(--ha-card-border-radius, 12px);
        }
        .header {
          display: flex; align-items: center;
          justify-content: space-between; margin-bottom: 16px;
        }
        .name {
          font-size: 14px; font-weight: 600;
          letter-spacing: 0.04em; text-transform: uppercase; opacity: 0.6;
        }
        .toggle { position: relative; width: 46px; height: 26px; flex-shrink: 0; }
        .toggle input { opacity: 0; width: 0; height: 0; }
        .knob {
          position: absolute; inset: 0;
          background: rgba(255,255,255,0.12);
          border-radius: 13px; cursor: pointer; transition: background 0.2s;
        }
        .toggle input:checked + .knob { background: #ff6a00; }
        .knob:before {
          content: ''; position: absolute;
          width: 20px; height: 20px; left: 3px; top: 3px;
          background: #fff; border-radius: 50%;
          transition: transform 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.4);
        }
        .toggle input:checked + .knob:before { transform: translateX(20px); }
        .row { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
        .lbl { font-size: 12px; opacity: 0.45; min-width: 72px; letter-spacing: 0.03em; }
        .val { font-size: 12px; min-width: 30px; text-align: right; opacity: 0.7; font-variant-numeric: tabular-nums; }
        input[type=range] {
          flex: 1; -webkit-appearance: none;
          height: 3px; border-radius: 2px;
          background: rgba(255,255,255,0.15); outline: none; cursor: pointer;
        }
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none; width: 16px; height: 16px;
          border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.5);
        }
        .quick-row { display: flex; gap: 8px; margin-bottom: 12px; }
        .qbtn {
          flex: 1; height: 28px; border-radius: 6px;
          border: 2px solid transparent;
          cursor: pointer; outline: none;
          transition: transform 0.1s, border-color 0.15s; font-size: 0;
        }
        .qbtn:hover { transform: scale(1.08); }
        .qbtn.active { border-color: #fff; box-shadow: 0 0 6px rgba(255,255,255,0.4); }
        .cur-color {
          width: 18px; height: 18px; border-radius: 50%;
          border: 1px solid rgba(255,255,255,0.2); flex-shrink: 0;
          transition: background 0.4s;
        }
        .divider {
          border: none; border-top: 1px solid rgba(255,255,255,0.07);
          margin: 4px 0 12px;
        }
        .col-header {
          font-size: 10px; font-weight: 600; letter-spacing: 0.08em;
          text-transform: uppercase; opacity: 0.35; margin-bottom: 6px;
        }
        .two-col {
          display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
          margin-bottom: 12px;
        }
        .scroll-list {
          overflow-y: auto;
          border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.03);
          scrollbar-width: thin;
          scrollbar-color: rgba(255,255,255,0.15) transparent;
        }
        .scroll-list::-webkit-scrollbar { width: 4px; }
        .scroll-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }
        .list-item {
          display: flex; align-items: center;
          padding: 0 10px; height: ${ITEM_H}px;
          font-size: 12px; cursor: pointer;
          border-bottom: 1px solid rgba(255,255,255,0.04);
          transition: background 0.1s; user-select: none;
        }
        .list-item:last-child { border-bottom: none; }
        .list-item:hover { background: rgba(255,255,255,0.06); }
        .list-item.selected { background: rgba(255,106,0,0.18); color: #ff6a00; }
        .preset-swatch {
          width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
          border: 1px solid rgba(255,255,255,0.2); margin-right: 7px;
        }
        .row-with-dot { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
        .status {
          font-size: 10px; opacity: 0.3; text-align: right;
          margin-top: 4px; letter-spacing: 0.05em; min-height: 14px;
        }
        .status.err { opacity: 0.7; color: #ff453a; }
      </style>

      <ha-card>
        <div class="card">
          <div class="card-inner" id="card-inner">

            <div class="header">
              <span class="name">${this._name}</span>
              <label class="toggle">
                <input type="checkbox" id="pwr">
                <span class="knob"></span>
              </label>
            </div>

            <div class="row">
              <span class="lbl">Brightness</span>
              <input type="range" id="bri" min="0" max="255" value="128" step="1">
              <span class="val" id="bri-val">128</span>
            </div>

            <hr class="divider">

            <div class="quick-row">
              ${QUICK.map((q,i) => `<button class="qbtn" data-idx="${i}" style="background:${q.bg}" title="${q.title}" aria-label="${q.title}"></button>`).join('')}
              <div class="cur-color" id="cur-color"></div>
            </div>

            <hr class="divider">

            <div class="two-col">
              <div>
                <div class="col-header">Color Presets</div>
                <div class="scroll-list" id="preset-list" style="height:${MAX_VISIBLE * ITEM_H}px"></div>
              </div>
              <div>
                <div class="col-header">Effects</div>
                <div class="scroll-list" id="fx-list" style="height:${MAX_VISIBLE * ITEM_H}px">
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

    // Populate preset list with color swatches
    const presetList = sr.getElementById('preset-list');
    this._presets.forEach((p, i) => {
      const item = document.createElement('div');
      item.className = 'list-item';
      const dot = document.createElement('div');
      dot.className = 'preset-swatch';
      dot.style.background = this._toHex(p.col[0]);
      item.appendChild(dot);
      item.appendChild(document.createTextNode(p.name));
      item.addEventListener('click', () => {
        presetList.querySelectorAll('.list-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        sr.querySelectorAll('.qbtn').forEach(b => b.classList.remove('active'));
        this._setColor(p.col);
      });
      presetList.appendChild(item);
    });

    sr.getElementById('pwr').addEventListener('change', e => {
      this._callLight({ state: e.target.checked });
    });

    sr.getElementById('bri').addEventListener('input', e => {
      sr.getElementById('bri-val').textContent = e.target.value;
      clearTimeout(this._debounce.bri);
      this._debounce.bri = setTimeout(() =>
        this._callLight({ brightness: parseInt(e.target.value) }), 250);
    });

    sr.querySelectorAll('.qbtn').forEach(btn => {
      btn.addEventListener('click', () => {
        sr.querySelectorAll('.qbtn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        presetList.querySelectorAll('.list-item').forEach(el => el.classList.remove('selected'));
        this._setColor(QUICK[parseInt(btn.dataset.idx)].col);
      });
    });

    sr.getElementById('sx').addEventListener('input', e => {
      sr.getElementById('sx-val').textContent = e.target.value;
      clearTimeout(this._debounce.sx);
      this._debounce.sx = setTimeout(() => {
        if (this._host) this._restApi({ seg: [{ sx: parseInt(e.target.value) }] });
      }, 250);
    });

    sr.getElementById('ix').addEventListener('input', e => {
      sr.getElementById('ix-val').textContent = e.target.value;
      clearTimeout(this._debounce.ix);
      this._debounce.ix = setTimeout(() => {
        if (this._host) this._restApi({ seg: [{ ix: parseInt(e.target.value) }] });
      }, 250);
    });
  }

  getCardSize() { return 5; }
}

customElements.define('wled-card', WledCard);