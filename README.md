<div align="center">

<img 
  src="https://github.com/user-attachments/assets/962887ec-636b-4e0f-90eb-0862c0feefca" 
  width="72"
/>

# Bloom Alternative by RMNO21

**An enhanced, deeply customizable desktop companion for Windows.**

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri%20v2-orange.svg)](https://tauri.app/)
[![Platform](https://img.shields.io/badge/Platform-Windows%2011%20%7C%2010-0078D4.svg)](https://www.microsoft.com/windows)
[![Author](https://img.shields.io/badge/Author-RMNO21-blueviolet.svg)](https://github.com/RMNO21)
[![Original Project](https://img.shields.io/badge/Based%20On-Bloom%20by%20SehajveerSingh2005-green.svg)](https://github.com/SehajveerSingh2005/bloom)

<br/>

<img width="1920" height="1080" alt="Bloom Hero" src="https://github.com/user-attachments/assets/22041f25-a69e-457d-80d9-7dfbfbed2d29" />

</div>

---

## 🌟 Credits & Attribution

This project is an advanced, customized edition and fork of **Bloom**, originally developed and created by **[Sehajveer Singh (@SehajveerSingh2005)](https://github.com/SehajveerSingh2005)**.

* **Author of this Alternative Edition:** [Raman Tondro (@RMNO21)](https://github.com/RMNO21)
* **Original Project & Repository:** [SehajveerSingh2005/bloom](https://github.com/SehajveerSingh2005/bloom)
* **License:** Licensed under the [GNU General Public License v3.0 (GPLv3)](LICENSE). All original copyright notices and open-source licenses are preserved.

Sincere appreciation to Sehajveer Singh and all original contributors for creating the initial vision and architecture of the Dynamic Island and Dock. This alternative edition builds upon that great foundation by introducing universal Windows notification interception, interactive droplet animations, inline quick reply, zero-shadow minimalist styling, comprehensive system settings overhaul, and deep Windows shell stability improvements.

---

## 🚀 What Makes This Alternative Edition Unique?

### 💧 1. Universal Notification Droplet Engine
* **Universal WinRT Interception:** Integrates directly with Windows `UserNotificationListener` to capture notifications from all applications (Telegram, WhatsApp, Discord, Slack, Browsers, System, Alarms, Calls).
* **Smooth Droplet Detachment Animation:** When a notification arrives, it organically detaches from the top notch like a fluid droplet, presenting the app icon, title, body, and timestamp.
* **Universal Action Handling:**
  * **Alarms & Timers:** Native Snooze (+5 min) and Dismiss action buttons.
  * **Calls:** Answer and Decline actions.
  * **Messaging:** Built-in **Inline Quick Reply** field allowing you to type and send replies instantly without switching windows.
* **Native Toast Suppression:** Optional toggle to suppress redundant Windows native popup toasts, preventing duplicate notifications while keeping the Dynamic Island droplet as the sole, elegant source of alerts.
* **Direct App Activation:** Clicking on the notification automatically brings the originating window to the foreground.

### ⚡ 2. Zero-Shadow Minimalist Design
* **Clean, Razor-Sharp Edges:** Eliminates muddy, ambient box shadows and fuzzy drop shadows around the notch and droplet.
* **Tuned for OLED & Modern Displays:** True black OLED surfaces, crisp high-contrast outlines, and refined frosted glass blurs that blend seamlessly with any desktop wallpaper.

### 🎛️ 3. Completely Overhauled Settings Architecture
* **Spacious 740×540 Desktop Layout:** Redesigned from the ground up for modern monitors with no cramped panels or awkward clipping.
* **Instant Live Search:** Built-in bilingual search bar supporting English and Persian (فارسی) keywords (`سایه`, `نوتیف`, `تسکبار`, `shadow`, `notif`, `dock`, `boot`, `theme`). Instantly jump to any setting.
* **Dedicated Customization Tabs:**
  * **Notifications & Droplet:** Banner duration slider (2s–15s), toast suppression toggle, chime sound toggle, inline reply toggle, category filters, history limit, and instant test notification buttons.
  * **Appearance:** One-click Theme Presets (`OLED Black`, `Midnight`, `Slate`, `Deep Navy`, `Cyber Violet`, `Light Frosted`), Zero-Shadow Mode toggle, border styles, and blur intensity.
  * **Notch Geometry & Interaction:** Top offset Y, base width adjustment, corner curvature, outside click collapse, and fullscreen suppression.
  * **Dock Controls:** Icon sizing (32px–64px), hover magnification slider, running indicator styles, and taskbar auto-hide integration.
  * **Hotkeys:** Comprehensive view and customization of global keyboard shortcuts.
  * **General & Backup:** 1-click **Export Configuration (JSON)** and **Import Configuration (JSON)** for seamless backups across devices.

### 🛡️ 4. Focus & Multi-Tasking Intelligence
* **Start Menu Protection:** Prevents notch closing collisions when interacting with the Windows 11 Start Menu and search bar.
* **Fullscreen Game Detection:** Automatically suppresses hover expansions during fullscreen games or media playback to eliminate unwanted distractions.

### 📝 5. Integrated Productivity & System Suite
* **Interactive To-Do List:** Built-in to-do panel with atomic disk persistence (`%APPDATA%/todos.json`).
* **Quick Timers & Stopwatch:** Multi-preset timers with audio chimes.
* **Quick Notes Scratchpad:** Auto-saving quick notes right inside the island.
* **Expanded Command Center:** Fast audio output device switching, removable drive storage monitors, Wi-Fi, Bluetooth, volume, and brightness sliders.

### ⚡ 6. Instant Startup & Shell Priority
* Elevated process priority (`High Priority Class`) at launch.
* Zero-delay taskbar concealment on boot, preventing the default Windows taskbar from flickering or showing before Bloom takes over.

---

## 🛠️ Architecture

* **Frontend:** [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Framer Motion](https://www.framer.com/motion/) (physics-based spring animations), [Lucide Icons](https://lucide.dev/), [Tailwind CSS v4](https://tailwindcss.com/), [Vite](https://vitejs.dev/).
* **Backend:** [Rust](https://www.rust-lang.org/), [Tauri v2](https://tauri.app/), `windows` crate (Win32 APIs, WinRT `UserNotificationListener`, COM, WMI, WASAPI, `UI_Notifications`, `Data_Xml_Dom`).

---

## 📦 Building from Source

### Prerequisites
* [Rust](https://rustup.rs/) (v1.78+)
* [Node.js](https://nodejs.org/) (v20+) or [Bun](https://bun.sh/)
* Windows 11 or Windows 10 (Version 1903+)

### Setup
```bash
# Clone this repository
git clone https://github.com/RMNO21/bloom-alternative-by-RMNO21.git
cd bloom-alternative-by-RMNO21

# Install frontend dependencies
npm install
# or: bun install

# Run in development mode
npm run tauri dev
# or: bun run tauri dev

# Build production executable
npm run build
cd src-tauri && cargo build --release
```

The compiled release binary will be available at:
`src-tauri/target/release/bloom.exe`

---

## 📄 License & Legal Notice

This project is licensed under the **GNU General Public License v3.0 (GPLv3)**.
See the [LICENSE](LICENSE) file for details.

* Original Bloom project Copyright © 2024–2026 Sehajveer Singh ([@SehajveerSingh2005](https://github.com/SehajveerSingh2005)).
* Modifications, alternative features, notification engine, and UI overhaul Copyright © 2026 Raman Tondro ([@RMNO21](https://github.com/RMNO21)).

---

<div align="center">

**Crafted with care by [RMNO21](https://github.com/RMNO21)** • *Reimagining the Windows Desktop*

</div>
