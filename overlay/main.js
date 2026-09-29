'use strict';
// Electron shell: a transparent, always-on-top, click-through window placed over the
// left strip of the League window. It does not inject into or read the game; it only
// draws on top of it, so the game must be in Borderless (or Windowed) mode.
const { app, BrowserWindow, globalShortcut, ipcMain, clipboard, screen } = require('electron');
const path = require('path');
const { execFile } = require('child_process');
const { start } = require('../server/index.js');

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let srv = null;
let gameRect = null;      // League window client area, in DIPs
let calibrating = false;
let visible = true;
let lastBoundsKey = '';

// Finds the League game window's client rectangle (Windows only).
const PS = `
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct PT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref PT p);
}
'@
$p = Get-Process 'League of Legends' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($p) {
  $r = New-Object W+RECT; [void][W]::GetClientRect($p.MainWindowHandle, [ref]$r)
  $pt = New-Object W+PT; [void][W]::ClientToScreen($p.MainWindowHandle, [ref]$pt)
  "$($pt.X),$($pt.Y),$($r.R),$($r.B)"
}`;

function findGameRect() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS], { timeout: 6000, windowsHide: true }, (err, out) => {
      if (err || !out || !out.trim()) return resolve(null);
      const [x, y, width, height] = out.trim().split(',').map(Number);
      if (!(width > 300 && height > 300)) return resolve(null);
      try { resolve(screen.screenToDipRect(null, { x, y, width, height })); } catch (e) { resolve({ x, y, width, height }); }
    });
  });
}

const baseRect = () => gameRect || screen.getPrimaryDisplay().bounds;

function computeBounds() {
  const b = baseRect();
  const o = srv.config.overlay;
  return {
    x: Math.round(b.x + b.width * o.x),
    y: Math.round(b.y + b.height * o.y),
    width: Math.max(120, Math.round(b.width * o.w)),
    height: Math.max(200, Math.round(b.height * o.h)),
  };
}

function applyBounds() {
  if (!win || calibrating) return;
  const nb = computeBounds();
  const key = JSON.stringify(nb);
  if (key !== lastBoundsKey) { win.setBounds(nb); lastBoundsKey = key; }
}

function createWindow() {
  win = new BrowserWindow({
    ...computeBounds(),
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    focusable: false,       // never steal keyboard focus from the game
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadURL('http://127.0.0.1:' + srv.port + '/overlay/');
  win.once('ready-to-show', () => win.showInactive());
}

// ---- calibration: move/resize the strip with the keyboard, then save as % of the game window ----
function toggleCalibrate() {
  if (!win) return;
  calibrating = !calibrating;
  const step = 5;
  const keys = {
    'Alt+Left': () => nudge(-step, 0, 0, 0), 'Alt+Right': () => nudge(step, 0, 0, 0),
    'Alt+Up': () => nudge(0, -step, 0, 0), 'Alt+Down': () => nudge(0, step, 0, 0),
    'Alt+Shift+Left': () => nudge(0, 0, -step, 0), 'Alt+Shift+Right': () => nudge(0, 0, step, 0),
    'Alt+Shift+Up': () => nudge(0, 0, 0, -step), 'Alt+Shift+Down': () => nudge(0, 0, 0, step),
  };
  if (calibrating) {
    win.setIgnoreMouseEvents(false);
    for (const [k, fn] of Object.entries(keys)) globalShortcut.register(k, fn);
  } else {
    for (const k of Object.keys(keys)) globalShortcut.unregister(k);
    const b = win.getBounds();
    const base = baseRect();
    const clamp = (v) => Math.max(0, Math.min(1, v));
    Object.assign(srv.config.overlay, {
      x: clamp((b.x - base.x) / base.width),
      y: clamp((b.y - base.y) / base.height),
      w: clamp(b.width / base.width),
      h: clamp(b.height / base.height),
    });
    srv.saveConfig();
    win.setIgnoreMouseEvents(true, { forward: true });
    lastBoundsKey = '';
    applyBounds();
  }
  win.webContents.send('jade:calibrate', calibrating);
}
function nudge(dx, dy, dw, dh) {
  const b = win.getBounds();
  win.setBounds({ x: b.x + dx, y: b.y + dy, width: Math.max(120, b.width + dw), height: Math.max(200, b.height + dh) });
}

app.whenReady().then(async () => {
  srv = start({ mock: process.argv.includes('--mock') });
  gameRect = await findGameRect();
  createWindow();

  const hk = srv.config.hotkeys;
  globalShortcut.register(hk.shop, () => win && win.webContents.send('jade:toggle-shop'));
  globalShortcut.register(hk.calibrate, toggleCalibrate);
  globalShortcut.register(hk.toggle, () => {
    if (!win) return;
    visible = !visible;
    visible ? win.showInactive() : win.hide();
  });
  globalShortcut.register('Ctrl+Alt+Q', () => app.quit());

  ipcMain.on('jade:copy', (_e, text) => clipboard.writeText(String(text).slice(0, 200)));
  ipcMain.on('jade:interactive', (_e, on) => {
    if (win && !calibrating) win.setIgnoreMouseEvents(!on, { forward: true });
  });

  setInterval(async () => {
    if (calibrating) return;
    gameRect = await findGameRect();
    applyBounds();
  }, 3000);
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); if (srv) srv.close(); });
app.on('window-all-closed', () => app.quit());
