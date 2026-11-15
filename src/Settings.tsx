import { StrictMode, useState, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Effect } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
	X,
	Settings,
	Palette,
	PanelTop,
	Monitor,
	Layers,
	Info,
	Megaphone,
	Bell,
	Keyboard,
	Search,
	ArrowRight
} from "lucide-react";
import {
	useSettings,
	GeneralTab,
	AppearanceTab,
	NotchTab,
	NotificationsTab,
	DockTab,
	HotkeysTab,
	OverlaysTab,
	AboutTab
} from "./settings/index";
import type { SettingsTab } from "./settings/index";
import { useAnnouncement } from "./hooks/useAnnouncement";
import { initTheme } from "./theme";
import "./Settings.css";

const appWindow = getCurrentWebviewWindow();

const TABS: { id: SettingsTab; label: string; icon: typeof Settings }[] = [
	{ id: "general", label: "General", icon: Settings },
	{ id: "appearance", label: "Appearance", icon: Palette },
	{ id: "notch", label: "Notch", icon: PanelTop },
	{ id: "notifications", label: "Notifications", icon: Bell },
	{ id: "dock", label: "Dock", icon: Monitor },
	{ id: "hotkeys", label: "Hotkeys", icon: Keyboard },
	{ id: "overlays", label: "Overlays", icon: Layers },
	{ id: "about", label: "About", icon: Info }
];

function SettingsApp() {
	const [activeTab, setActiveTab] = useState<SettingsTab>("general");
	const [searchQuery, setSearchQuery] = useState("");
	const settings = useSettings();
	const { announcement, dismissed, dismiss } = useAnnouncement();

	useEffect(() => {
		return initTheme();
	}, []);

	useEffect(() => {
		const preventContext = (e: MouseEvent) => e.preventDefault();
		document.addEventListener("contextmenu", preventContext as any);

		appWindow
			.setEffects({
				effects: ["mica" as Effect],
				state: "active" as any
			})
			.catch(() => {});

		return () => {
			document.removeEventListener("contextmenu", preventContext as any);
		};
	}, []);

	useEffect(() => {
		invoke("resize_settings_window", {
			width: 740 * settings.scale,
			height: 540 * settings.scale
		}).catch(console.error);
	}, [settings.scale]);

	const handleClose = async (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		try {
			await appWindow.hide();
		} catch {}
	};

	// Searchable settings catalog
	const searchItems = useMemo(() => {
		return [
			// General
			{
				id: "autostart",
				tab: "general" as SettingsTab,
				tabLabel: "General",
				label: "Launch at Login",
				desc: "Open Bloom automatically when Windows starts",
				keywords: ["boot", "startup", "login", "windows", "استارتاپ", "بوت", "ورود"],
				control: (
					<label className="toggle-switch">
						<input
							type="checkbox"
							checked={settings.autostart}
							onChange={settings.toggleAutostart}
						/>
						<span className="slider"></span>
					</label>
				)
			},
			{
				id: "fastboot",
				tab: "general" as SettingsTab,
				tabLabel: "General",
				label: "Instant Boot (Zero Delay)",
				desc: "Launch immediately upon Windows login without Explorer delay",
				keywords: ["fast", "boot", "speed", "priority", "تاخیر", "سریع", "لود"],
				control: (
					<label className="toggle-switch">
						<input
							type="checkbox"
							checked={settings.fastBoot}
							onChange={settings.toggleFastBoot}
						/>
						<span className="slider"></span>
					</label>
				)
			},
			{
				id: "timeformat",
				tab: "general" as SettingsTab,
				tabLabel: "General",
				label: "24-Hour Time Format",
				desc: "Use 24-hour clock (14:30 vs 2:30 PM)",
				keywords: ["clock", "time", "24h", "ساعت", "زمان"],
				control: (
					<label className="toggle-switch">
						<input
							type="checkbox"
							checked={settings.timeFormat24h}
							onChange={settings.toggleTimeFormat24h}
						/>
						<span className="slider"></span>
					</label>
				)
			},
			{
				id: "export",
				tab: "general" as SettingsTab,
				tabLabel: "General",
				label: "Export Settings to JSON",
				desc: "Download and backup all your customizations",
				keywords: ["export", "backup", "save", "خروجی", "پشتیبان"],
				control: (
					<button className="settings-btn" onClick={settings.handleExportSettings}>
						Export JSON
					</button>
				)
			},
			{
				id: "import",
				tab: "general" as SettingsTab,
				tabLabel: "General",
				label: "Import Settings from JSON",
				desc: "Restore your settings from backup file",
				keywords: ["import", "restore", "ورودی", "بازیابی"],
				control: (
					<button className="settings-btn" onClick={settings.handleImportSettings}>
						Import JSON
					</button>
				)
			},

			// Notifications
			{
				id: "notif-live",
				tab: "notifications" as SettingsTab,
				tabLabel: "Notifications",
				label: "Live Notch Notifications (Droplet)",
				desc: "Show interactive Dynamic Island alert expanding from notch",
				keywords: ["notif", "notification", "droplet", "toast", "نوتیفیکیشن", "اعلان", "دراپلت"],
				control: (
					<label className="toggle-switch">
						<input
							type="checkbox"
							checked={settings.interceptNotifications}
							onChange={settings.toggleInterceptNotifications}
						/>
						<span className="slider"></span>
					</label>
				)
			},
			{
				id: "notif-suppress",
				tab: "notifications" as SettingsTab,
				tabLabel: "Notifications",
				label: "Suppress Native Windows Toasts",
				desc: "Disable Windows default bottom-right toast banners at source",
				keywords: ["toast", "windows", "suppress", "hide", "پنهان", "ویندوز", "تست"],
				control: (
					<label className="toggle-switch">
						<input
							type="checkbox"
							checked={settings.notifSuppressWindows}
							onChange={settings.toggleNotifSuppressWindows}
						/>
						<span className="slider"></span>
					</label>
				)
			},
			{
				id: "notif-duration",
				tab: "notifications" as SettingsTab,
				tabLabel: "Notifications",
				label: "Notification Duration",
				desc: "How long the notification droplet stays before auto-dismiss",
				keywords: ["duration", "timeout", "seconds", "زمان", "ثانیه"],
				control: (
					<div className="notif-duration-selector">
						{[3, 5, 8, 12, 0].map((sec) => (
							<button
								key={sec}
								type="button"
								className={`notif-pill-btn ${settings.notifDuration === sec ? "active" : ""}`}
								onClick={() => settings.changeNotifDuration(sec)}
							>
								{sec === 0 ? "Manual" : `${sec}s`}
							</button>
						))}
					</div>
				)
			},
			{
				id: "notif-sound",
				tab: "notifications" as SettingsTab,
				tabLabel: "Notifications",
				label: "Notification Sound Alert",
				desc: "Play subtle audio chime when a notification arrives",
				keywords: ["sound", "audio", "chime", "bell", "صدا", "زنگ"],
				control: (
					<label className="toggle-switch">
						<input
							type="checkbox"
							checked={settings.notifSound}
							onChange={settings.toggleNotifSound}
						/>
						<span className="slider"></span>
					</label>
				)
			},
			{
				id: "notif-reply",
				tab: "notifications" as SettingsTab,
				tabLabel: "Notifications",
				label: "Inline Quick Reply",
				desc: "Type and send direct replies inside notch for Telegram, WhatsApp, etc.",
				keywords: ["reply", "message", "telegram", "whatsapp", "پاسخ", "ریپلای", "پیام"],
				control: (
					<label className="toggle-switch">
						<input
							type="checkbox"
							checked={settings.notifQuickReply}
							onChange={settings.toggleNotifQuickReply}
						/>
						<span className="slider"></span>
					</label>
				)
			},
			{
				id: "notif-test",
				tab: "notifications" as SettingsTab,
				tabLabel: "Notifications",
				label: "Test Notification",
				desc: "Fire a test message to inspect the droplet animation and sound",
				keywords: ["test", "trigger", "message", "تست", "ارسال"],
				control: (
					<button
						className="settings-btn settings-btn-accent"
						onClick={() => settings.sendTestNotification("message")}
					>
						Test Now
					</button>
				)
			},

			// Appearance & Shadows
			{
				id: "zero-shadow",
				tab: "appearance" as SettingsTab,
				tabLabel: "Appearance",
				label: "Zero Shadow Mode",
				desc: "Completely eliminate box-shadows, drop-shadows and glowing rings around notch and cards",
				keywords: ["shadow", "halo", "glow", "flat", "سایه", "نور", "هاله", "تخت"],
				control: (
					<label className="toggle-switch">
						<input
							type="checkbox"
							checked={settings.zeroShadowMode}
							onChange={settings.toggleZeroShadowMode}
						/>
						<span className="slider"></span>
					</label>
				)
			},
			{
				id: "theme-mode",
				tab: "appearance" as SettingsTab,
				tabLabel: "Appearance",
				label: "Theme Mode",
				desc: "Dark, Light, Custom Color, or Adaptive Accent",
				keywords: ["theme", "dark", "light", "color", "تم", "رنگ", "تیره", "روشن"],
				control: (
					<select
						className="settings-select"
						value={settings.themeMode}
						onChange={(e) => settings.handleThemeModeChange(e.target.value)}
					>
						<option value="dark">Dark (Translucent)</option>
						<option value="light">Light (Translucent)</option>
						<option value="custom">Custom Color</option>
						<option value="adaptive">Adaptive Accent</option>
					</select>
				)
			},
			{
				id: "border-style",
				tab: "appearance" as SettingsTab,
				tabLabel: "Appearance",
				label: "Card Border Style",
				desc: "Subtle, Hairline, Borderless, or Tinted",
				keywords: ["border", "stroke", "line", "بوردر", "حاشیه", "خط"],
				control: (
					<select
						className="settings-select"
						value={settings.borderStyle}
						onChange={(e) => settings.handleBorderStyleChange(e.target.value)}
					>
						<option value="subtle">Subtle (1px translucent)</option>
						<option value="fine">Hairline (0.5px ultra-thin)</option>
						<option value="none">Borderless (Seamless flat)</option>
						<option value="accent">Tinted Accent</option>
					</select>
				)
			},
			{
				id: "blur-style",
				tab: "appearance" as SettingsTab,
				tabLabel: "Appearance",
				label: "Translucency & Blur Effect",
				desc: "Acrylic Glass, Windows Mica, or Solid Black",
				keywords: ["blur", "acrylic", "mica", "glass", "مات", "شیشه‌ای", "بلور"],
				control: (
					<select
						className="settings-select"
						value={settings.blurStyle}
						onChange={(e) => settings.handleBlurStyleChange(e.target.value)}
					>
						<option value="acrylic">Acrylic Glass</option>
						<option value="mica">Windows Mica</option>
						<option value="oled">Pure Solid Black</option>
						<option value="frosted">Frosted Minimal</option>
					</select>
				)
			},
			{
				id: "scale",
				tab: "appearance" as SettingsTab,
				tabLabel: "Appearance",
				label: "UI Scale / Desktop Zoom",
				desc: "Adjust overall sizing of notch and dock",
				keywords: ["scale", "zoom", "size", "font", "مقیاس", "اندازه", "بزرگنمایی"],
				control: (
					<span className="scale-display-value">{Math.round(settings.scale * 100)}%</span>
				)
			},

			// Notch
			{
				id: "notch-mode",
				tab: "notch" as SettingsTab,
				tabLabel: "Notch",
				label: "Notch Trigger Mode",
				desc: "Smart (hover/click), Fixed (always open), or Peek",
				keywords: ["notch", "mode", "trigger", "hover", "ناچ", "هاور"],
				control: (
					<select
						className="settings-select"
						value={settings.notchMode}
						onChange={(e) => settings.setNotchModeValue(e.target.value)}
					>
						<option value="smart">Smart (Hover / Click)</option>
						<option value="fixed">Fixed</option>
						<option value="peek">Peek</option>
					</select>
				)
			},
			{
				id: "notch-offset-y",
				tab: "notch" as SettingsTab,
				tabLabel: "Notch",
				label: "Top Screen Offset (Y)",
				desc: "Vertical distance from the top screen edge",
				keywords: ["offset", "margin", "position", "موقعیت", "فاصله"],
				control: (
					<span className="scale-display-value">{settings.notchOffsetY}px</span>
				)
			},
			{
				id: "notch-fullscreen",
				tab: "notch" as SettingsTab,
				tabLabel: "Notch",
				label: "Suppress in Fullscreen Games",
				desc: "Prevent accidental notch popouts while playing full-screen games",
				keywords: ["fullscreen", "game", "gaming", "فول اسکرین", "بازی", "گیم"],
				control: (
					<label className="toggle-switch">
						<input
							type="checkbox"
							checked={settings.notchFullscreenDisable}
							onChange={settings.toggleNotchFullscreenDisable}
						/>
						<span className="slider"></span>
					</label>
				)
			},
			{
				id: "notch-startmenu",
				tab: "notch" as SettingsTab,
				tabLabel: "Notch",
				label: "Protect Notch on Start Menu",
				desc: "Do not close notch when opening Windows Start Menu",
				keywords: ["start", "menu", "استارت", "منو"],
				control: (
					<label className="toggle-switch">
						<input
							type="checkbox"
							checked={settings.notchProtectStartMenu}
							onChange={settings.toggleNotchProtectStartMenu}
						/>
						<span className="slider"></span>
					</label>
				)
			},

			// Dock
			{
				id: "dock-enabled",
				tab: "dock" as SettingsTab,
				tabLabel: "Dock",
				label: "Enable Bloom Dock",
				desc: "Modern floating application dock for Windows",
				keywords: ["dock", "taskbar", "داک", "تسکبار"],
				control: (
					<label className="toggle-switch">
						<input
							type="checkbox"
							checked={settings.dockEnabled}
							onChange={settings.toggleDock}
						/>
						<span className="slider"></span>
					</label>
				)
			},
			{
				id: "dock-icon-size",
				tab: "dock" as SettingsTab,
				tabLabel: "Dock",
				label: "Dock Icon Size",
				desc: "Size of app icons in pixels (32px - 64px)",
				keywords: ["icon", "size", "dock", "اندازه", "آیکون"],
				control: (
					<span className="scale-display-value">{settings.dockIconSize}px</span>
				)
			},
			{
				id: "dock-taskbar-hide",
				tab: "dock" as SettingsTab,
				tabLabel: "Dock",
				label: "Auto-Hide Native Taskbar",
				desc: "Keep Windows native taskbar suppressed and auto-hidden",
				keywords: ["taskbar", "native", "stuckrects", "تسکبار", "پنهان"],
				control: (
					<label className="toggle-switch">
						<input
							type="checkbox"
							checked={settings.dockHideTaskbar}
							onChange={settings.toggleDockHideTaskbar}
						/>
						<span className="slider"></span>
					</label>
				)
			},
			{
				id: "dock-mag",
				tab: "dock" as SettingsTab,
				tabLabel: "Dock",
				label: "Hover Magnification",
				desc: "Magnify dock icons smoothly under cursor",
				keywords: ["magnify", "zoom", "hover", "بزرگنمایی", "زوم"],
				control: (
					<label className="toggle-switch">
						<input
							type="checkbox"
							checked={settings.dockMagnification}
							onChange={settings.toggleDockMagnification}
						/>
						<span className="slider"></span>
					</label>
				)
			},

			// Hotkeys
			{
				id: "hotkey-notch",
				tab: "hotkeys" as SettingsTab,
				tabLabel: "Hotkeys",
				label: "Toggle Notch Shortcut",
				desc: "Global shortcut to open or close the notch",
				keywords: ["hotkey", "shortcut", "key", "کلید", "میانبر"],
				control: <span className="hotkey-badge">{settings.hotkeyNotch}</span>
			},
			{
				id: "hotkey-dock",
				tab: "hotkeys" as SettingsTab,
				tabLabel: "Hotkeys",
				label: "Toggle Dock Shortcut",
				desc: "Global shortcut to show or hide the dock",
				keywords: ["hotkey", "shortcut", "dock", "کلید", "داک"],
				control: <span className="hotkey-badge">{settings.hotkeyDock}</span>
			},
			{
				id: "hotkey-notifs",
				tab: "hotkeys" as SettingsTab,
				tabLabel: "Hotkeys",
				label: "Notification Center Shortcut",
				desc: "Open notification center in the notch directly",
				keywords: ["hotkey", "shortcut", "notif", "نوتیفیکیشن"],
				control: <span className="hotkey-badge">{settings.hotkeyNotifs}</span>
			}
		];
	}, [settings]);

	const filteredItems = useMemo(() => {
		if (!searchQuery.trim()) return [];
		const q = searchQuery.toLowerCase().trim();
		return searchItems.filter(
			(item) =>
				item.label.toLowerCase().includes(q) ||
				item.desc.toLowerCase().includes(q) ||
				item.tabLabel.toLowerCase().includes(q) ||
				item.keywords.some((k) => k.toLowerCase().includes(q))
		);
	}, [searchQuery, searchItems]);

	return (
		<div className="settings-container" style={{ zoom: settings.scale }}>
			<div className="title-bar" data-tauri-drag-region>
				<div className="title-left" data-tauri-drag-region>
					<span className="title-text" data-tauri-drag-region>
						Bloom Settings
					</span>
				</div>
				<button className="close-btn" onClick={handleClose} title="Close Settings">
					<X size={12} strokeWidth={1.5} className="close-btn-icon" />
				</button>
			</div>

			<div className="settings-body">
				<div className="settings-sidebar">
					<div className="settings-search-wrapper">
						<Search size={13} className="settings-search-icon" />
						<input
							type="text"
							placeholder="Search settings..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="settings-search-input"
						/>
						{searchQuery && (
							<button className="search-clear-btn" onClick={() => setSearchQuery("")}>
								<X size={11} />
							</button>
						)}
					</div>

					<div className="sidebar-tabs-list">
						{TABS.map(({ id, label, icon: Icon }) => (
							<button
								key={id}
								className={`sidebar-tab ${activeTab === id && !searchQuery ? "active" : ""}`}
								onClick={() => {
									setActiveTab(id);
									setSearchQuery("");
								}}
							>
								<div className="sidebar-tab-icon">
									<Icon size={14} strokeWidth={1.5} />
								</div>
								<span>{label}</span>
							</button>
						))}
					</div>
				</div>

				<div className="settings-content">
					{settings.saveError && (
						<div className="settings-save-error" role="alert">
							<span>Changes could not be saved. Your saved settings have been restored.</span>
							<button onClick={settings.dismissSaveError} aria-label="Dismiss save error">
								<X size={14} strokeWidth={2} />
							</button>
						</div>
					)}
					{announcement && !dismissed && (
						<div className={`announcement-banner severity-${announcement.severity}`}>
							<Megaphone size={14} className="announcement-banner-icon" />
							<div className="announcement-banner-text">
								<span className="announcement-banner-title">{announcement.title}</span>
								{announcement.body && (
									<span className="announcement-banner-body">{announcement.body}</span>
								)}
							</div>
							{announcement.url && (
								<button
									className="announcement-banner-link"
									onClick={() => openUrl(announcement.url!)}
								>
									Learn more
								</button>
							)}
							<button className="announcement-banner-close" onClick={dismiss} title="Dismiss">
								<X size={12} strokeWidth={2.2} />
							</button>
						</div>
					)}

					{searchQuery.trim() !== "" ? (
						<div className="search-results-container">
							<div className="search-results-header">
								<span className="search-results-count">
									Found {filteredItems.length} {filteredItems.length === 1 ? "setting" : "settings"} matching "{searchQuery}"
								</span>
								<button className="clear-search-link" onClick={() => setSearchQuery("")}>
									Clear Search
								</button>
							</div>

							{filteredItems.length === 0 ? (
								<div className="search-no-results">
									<Search size={28} opacity={0.3} style={{ marginBottom: 10 }} />
									<span>No matching settings found for "{searchQuery}"</span>
									<span className="search-sub-text">
										Try searching for "shadow", "notification", "taskbar", "boot", "color", "timer"
									</span>
								</div>
							) : (
								<div className="setting-group" style={{ marginTop: 8 }}>
									{filteredItems.map((item, idx) => (
										<div
											key={item.id}
											className="setting-item"
											style={{ borderBottom: idx < filteredItems.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none" }}
										>
											<div className="setting-info" style={{ flex: 1 }}>
												<div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
													<span
														className="search-item-tab-pill"
														onClick={() => {
															setActiveTab(item.tab);
															setSearchQuery("");
														}}
													>
														{item.tabLabel} <ArrowRight size={9} />
													</span>
													<span className="setting-label">{item.label}</span>
												</div>
												<span className="setting-desc">{item.desc}</span>
											</div>
											<div className="setting-control">{item.control}</div>
										</div>
									))}
								</div>
							)}
						</div>
					) : (
						<>
							{activeTab === "general" && (
								<GeneralTab
									autostart={settings.autostart}
									toggleAutostart={settings.toggleAutostart}
									fastBoot={settings.fastBoot}
									toggleFastBoot={settings.toggleFastBoot}
									interceptNotifications={settings.interceptNotifications}
									toggleInterceptNotifications={settings.toggleInterceptNotifications}
									timeFormat24h={settings.timeFormat24h}
									toggleTimeFormat24h={settings.toggleTimeFormat24h}
									showUpdateIndicator={settings.showUpdateIndicator}
									toggleUpdateIndicator={settings.toggleUpdateIndicator}
									lowBatteryThreshold={settings.lowBatteryThreshold}
									handleThresholdChange={settings.handleThresholdChange}
									restartBloom={settings.restartBloom}
									resetToDefaults={settings.resetToDefaults}
									quitBloom={settings.quitBloom}
									handleExportSettings={settings.handleExportSettings}
									handleImportSettings={settings.handleImportSettings}
									exportStatus={settings.exportStatus}
									importStatus={settings.importStatus}
								/>
							)}
							{activeTab === "appearance" && (
								<AppearanceTab
									themeMode={settings.themeMode}
									handleThemeModeChange={settings.handleThemeModeChange}
									themeColor={settings.themeColor}
									handleThemeColorChange={settings.handleThemeColorChange}
									themeOpacity={settings.themeOpacity}
									handleOpacityChange={settings.handleOpacityChange}
									themeSaturation={settings.themeSaturation}
									handleSaturationChange={settings.handleSaturationChange}
									themeBrightness={settings.themeBrightness}
									handleBrightnessChange={settings.handleBrightnessChange}
									cornersEnabled={settings.cornersEnabled}
									toggleCorners={settings.toggleCorners}
									scale={settings.scale}
									handleScaleChange={settings.handleScaleChange}
									zeroShadowMode={settings.zeroShadowMode}
									toggleZeroShadowMode={settings.toggleZeroShadowMode}
									borderStyle={settings.borderStyle}
									handleBorderStyleChange={settings.handleBorderStyleChange}
									blurStyle={settings.blurStyle}
									handleBlurStyleChange={settings.handleBlurStyleChange}
									applyThemePreset={settings.applyThemePreset}
								/>
							)}
							{activeTab === "notch" && (
								<NotchTab
									notchMode={settings.notchMode}
									setNotchModeValue={settings.setNotchModeValue}
									notchEdgeDelay={settings.notchEdgeDelay}
									handleNotchEdgeDelayChange={settings.handleNotchEdgeDelayChange}
									notchOffsetY={settings.notchOffsetY}
									handleNotchOffsetYChange={settings.handleNotchOffsetYChange}
									notchWidthOffset={settings.notchWidthOffset}
									handleNotchWidthOffsetChange={settings.handleNotchWidthOffsetChange}
									notchCornerRadius={settings.notchCornerRadius}
									handleNotchCornerRadiusChange={settings.handleNotchCornerRadiusChange}
									notchCloseOutside={settings.notchCloseOutside}
									toggleNotchCloseOutside={settings.toggleNotchCloseOutside}
									notchProtectStartMenu={settings.notchProtectStartMenu}
									toggleNotchProtectStartMenu={settings.toggleNotchProtectStartMenu}
									notchFullscreenDisable={settings.notchFullscreenDisable}
									toggleNotchFullscreenDisable={settings.toggleNotchFullscreenDisable}
									calendarEnabled={settings.calendarEnabled}
									toggleCalendar={settings.toggleCalendar}
									timerPresets={settings.timerPresets}
									updateTimerPresets={settings.updateTimerPresets}
									notchRememberPanel={settings.notchRememberPanel}
									toggleNotchRememberPanel={settings.toggleNotchRememberPanel}
									notchDefaultPanel={settings.notchDefaultPanel}
									changeNotchDefaultPanel={settings.changeNotchDefaultPanel}
									notchPanelsOrder={settings.notchPanelsOrder}
									updateNotchPanelsOrder={settings.updateNotchPanelsOrder}
									timerSoundEnabled={settings.timerSoundEnabled}
									toggleTimerSound={settings.toggleTimerSound}
									musicModeEnabled={settings.musicModeEnabled}
									toggleMusicMode={settings.toggleMusicMode}
									musicCompactNotch={settings.musicCompactNotch}
									toggleMusicCompactNotch={settings.toggleMusicCompactNotch}
									shelfPersist={settings.shelfPersist}
									toggleShelfPersist={settings.toggleShelfPersist}
									mediaLayout={settings.mediaLayout}
									toggleMediaLayout={settings.toggleMediaLayout}
									mediaAmbienceEnabled={settings.mediaAmbienceEnabled}
									toggleAmbience={settings.toggleAmbience}
									mediaCompactGlowEnabled={settings.mediaCompactGlowEnabled}
									toggleCompactGlow={settings.toggleCompactGlow}
									weatherEnabled={settings.weatherEnabled}
									toggleWeather={settings.toggleWeather}
									tempUnitFahrenheit={settings.tempUnitFahrenheit}
									toggleTempUnit={settings.toggleTempUnit}
									cityName={settings.cityName}
									setCityName={settings.setCityName}
									citySearchResults={settings.citySearchResults}
									showCityDropdown={settings.showCityDropdown}
									setShowCityDropdown={settings.setShowCityDropdown}
									selectCity={settings.selectCity}
									handleCityClear={settings.handleCityClear}
									statusWidgets={settings.statusWidgets}
									handleWidgetsChange={settings.handleWidgetsChange}
									pomoFocusMins={settings.pomoFocusMins}
									pomoShortMins={settings.pomoShortMins}
									pomoLongMins={settings.pomoLongMins}
									pomoCycles={settings.pomoCycles}
									updatePomoSettings={settings.updatePomoSettings}
									resetPomoProgress={settings.resetPomoProgress}
								/>
							)}
							{activeTab === "notifications" && (
								<NotificationsTab
									interceptNotifications={settings.interceptNotifications}
									toggleInterceptNotifications={settings.toggleInterceptNotifications}
									notifSuppressWindows={settings.notifSuppressWindows}
									toggleNotifSuppressWindows={settings.toggleNotifSuppressWindows}
									notifDuration={settings.notifDuration}
									changeNotifDuration={settings.changeNotifDuration}
									notifSound={settings.notifSound}
									toggleNotifSound={settings.toggleNotifSound}
									notifQuickReply={settings.notifQuickReply}
									toggleNotifQuickReply={settings.toggleNotifQuickReply}
									notifCatMessages={settings.notifCatMessages}
									toggleNotifCatMessages={settings.toggleNotifCatMessages}
									notifCatAlarms={settings.notifCatAlarms}
									toggleNotifCatAlarms={settings.toggleNotifCatAlarms}
									notifCatCalls={settings.notifCatCalls}
									toggleNotifCatCalls={settings.toggleNotifCatCalls}
									notifCatSystem={settings.notifCatSystem}
									toggleNotifCatSystem={settings.toggleNotifCatSystem}
									notifHistoryLimit={settings.notifHistoryLimit}
									changeNotifHistoryLimit={settings.changeNotifHistoryLimit}
									clearNotificationHistory={settings.clearNotificationHistory}
									sendTestNotification={settings.sendTestNotification}
								/>
							)}
							{activeTab === "dock" && (
								<DockTab
									dockEnabled={settings.dockEnabled}
									toggleDock={settings.toggleDock}
									dockMode={settings.dockMode}
									setDockModeValue={settings.setDockModeValue}
									dockEdgeDelay={settings.dockEdgeDelay}
									handleDockEdgeDelayChange={settings.handleDockEdgeDelayChange}
									dockIconSize={settings.dockIconSize}
									handleDockIconSizeChange={settings.handleDockIconSizeChange}
									dockMagnification={settings.dockMagnification}
									toggleDockMagnification={settings.toggleDockMagnification}
									dockMagScale={settings.dockMagScale}
									handleDockMagScaleChange={settings.handleDockMagScaleChange}
									dockIndicatorStyle={settings.dockIndicatorStyle}
									handleDockIndicatorStyleChange={settings.handleDockIndicatorStyleChange}
									dockPosition={settings.dockPosition}
									handleDockPositionChange={settings.handleDockPositionChange}
									dockHideTaskbar={settings.dockHideTaskbar}
									toggleDockHideTaskbar={settings.toggleDockHideTaskbar}
									dockPreviewEnabled={settings.dockPreviewEnabled}
									toggleDockPreview={settings.toggleDockPreview}
									dockIconOnly={settings.dockIconOnly}
									toggleDockIconOnly={settings.toggleDockIconOnly}
									dockSeparatorEnabled={settings.dockSeparatorEnabled}
									toggleDockSeparator={settings.toggleDockSeparator}
									dockAdaptive={settings.dockAdaptive}
									toggleDockAdaptive={settings.toggleDockAdaptive}
									dockWinNumberEnabled={settings.dockWinNumberEnabled}
									toggleDockWinNumber={settings.toggleDockWinNumber}
									dockExtrasPosition={settings.dockExtrasPosition}
									handleDockExtrasPositionChange={settings.handleDockExtrasPositionChange}
									dockExtrasDrives={settings.dockExtrasDrives}
									toggleDockExtrasDrives={settings.toggleDockExtrasDrives}
									dockExtrasHiddenDrives={settings.dockExtrasHiddenDrives}
									toggleDockExtrasDrive={settings.toggleDockExtrasDrive}
									dockExtrasRecycleBin={settings.dockExtrasRecycleBin}
									toggleDockExtrasRecycleBin={settings.toggleDockExtrasRecycleBin}
									dockTaskView={settings.dockTaskView}
									toggleDockTaskView={settings.toggleDockTaskView}
									dockExtrasFolders={settings.dockExtrasFolders}
									toggleDockExtraFolder={settings.toggleDockExtraFolder}
									dockExtrasCustomFolders={settings.dockExtrasCustomFolders}
									handleAddDockExtraFolder={settings.handleAddDockExtraFolder}
									handleRemoveDockExtraFolder={settings.handleRemoveDockExtraFolder}
									startIcon={settings.startIcon}
									handleStartIconChange={settings.handleStartIconChange}
								/>
							)}
							{activeTab === "hotkeys" && (
								<HotkeysTab
									hotkeyNotch={settings.hotkeyNotch}
									hotkeyDock={settings.hotkeyDock}
									hotkeyNotifs={settings.hotkeyNotifs}
									hotkeySettings={settings.hotkeySettings}
									updateHotkey={settings.updateHotkey}
									notchFullscreenDisable={settings.notchFullscreenDisable}
									toggleNotchFullscreenDisable={settings.toggleNotchFullscreenDisable}
								/>
							)}
							{activeTab === "overlays" && (
								<OverlaysTab
									volumeOverlayEnabled={settings.volumeOverlayEnabled}
									toggleVolumeOverlay={settings.toggleVolumeOverlay}
									volumeEdgeEnabled={settings.volumeEdgeEnabled}
									toggleVolumeEdge={settings.toggleVolumeEdge}
									brightnessOverlayEnabled={settings.brightnessOverlayEnabled}
									toggleBrightnessOverlay={settings.toggleBrightnessOverlay}
									brightnessEdgeEnabled={settings.brightnessEdgeEnabled}
									toggleBrightnessEdge={settings.toggleBrightnessEdge}
								/>
							)}
							{activeTab === "about" && (
								<AboutTab
									appVersion={settings.appVersion}
									autoUpdate={settings.autoUpdate}
									toggleAutoUpdate={settings.toggleAutoUpdate}
									updateStatus={settings.updateStatus}
									updateVersion={settings.updateVersion}
									checkForUpdates={settings.checkForUpdates}
									installUpdate={settings.installUpdate}
									exportStatus={settings.exportStatus}
									importStatus={settings.importStatus}
									handleExportSettings={settings.handleExportSettings}
									handleImportSettings={settings.handleImportSettings}
								/>
							)}
						</>
					)}
				</div>
			</div>
		</div>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<SettingsApp />
	</StrictMode>
);
