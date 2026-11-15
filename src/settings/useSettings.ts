import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { getVersion } from "@tauri-apps/api/app";
import type { UpdateCheckResult } from "../updater";
import { useSettingsSync } from "../hooks/useSettingsSync";
import { reloadIfMirrorWasStale } from "../hooks/settingsMirror";
import { hexToHsl } from "../theme";
import {
	addCustomFolder,
	removeCustomFolder,
	toggleEnabledFolder,
	toggleHiddenDrive,
	DEFAULT_ENABLED_FOLDERS
} from "../dockExtras";
import type { WidgetConfig } from "./types";

function readBool(val: string | null): boolean {
	return val === "true";
}

export function useSettings() {
	const [saveError, setSaveError] = useState(
		() => sessionStorage.getItem("bloom-settings-save-error") !== null
	);
	const saveQueue = useRef<Promise<void>>(Promise.resolve());
	const saveFailed = useRef(false);
	const [autostart, setAutostart] = useState(false);
	const [weatherEnabled, setWeatherEnabled] = useState(true);
	const [calendarEnabled, setCalendarEnabled] = useState(true);
	const [timerPresets, setTimerPresets] = useState<number[]>(() => {
		try {
			const saved = localStorage.getItem("bloom-timer-presets");
			if (saved) {
				const parsed = JSON.parse(saved);
				if (Array.isArray(parsed) && parsed.length > 0) {
					const nums = parsed.map(Number).filter((n) => !isNaN(n) && n > 0);
					if (nums.length > 0) return nums;
				}
			}
		} catch {}
		return [5, 15, 25, 50];
	});
	const [timerSoundEnabled, setTimerSoundEnabled] = useState(
		() => localStorage.getItem("bloom-timer-sound-enabled") !== "false"
	);
	const [musicModeEnabled, setMusicModeEnabled] = useState(true);
	const [notchRememberPanel, setNotchRememberPanel] = useState(
		() => (localStorage.getItem("bloom-notch-remember-panel") ??
			localStorage.getItem("bloom-notch-click-to-open")) !== "false"
	);
	const [notchDefaultPanel, setNotchDefaultPanel] = useState<"calendar" | "command-center" | "timers" | "notifications">(
		() => {
			const saved = localStorage.getItem("bloom-notch-default-panel");
			if (saved === "command-center" || saved === "timers" || saved === "notifications" || saved === "calendar") return saved;
			return "command-center";
		}
	);
	const [musicCompactNotch, setMusicCompactNotch] = useState(true);
	const [shelfPersist, setShelfPersist] = useState(
		() => localStorage.getItem("bloom-shelf-persist") === "true"
	);
	const [volumeOverlayEnabled, setVolumeOverlayEnabled] = useState(true);
	const [volumeEdgeEnabled, setVolumeEdgeEnabled] = useState(
		() => localStorage.getItem("bloom-volume-edge-enabled") !== "false"
	);
	const [brightnessOverlayEnabled, setBrightnessOverlayEnabled] = useState(
		() => localStorage.getItem("bloom-brightness-overlay-enabled") !== "false"
	);
	const [brightnessEdgeEnabled, setBrightnessEdgeEnabled] = useState(
		() => localStorage.getItem("bloom-brightness-edge-enabled") !== "false"
	);
	const [mediaAmbienceEnabled, setMediaAmbienceEnabled] = useState(true);
	const [mediaCompactGlowEnabled, setMediaCompactGlowEnabled] = useState(true);
	const [mediaLayout, setMediaLayout] = useState<"classic" | "compact">(
		() => (localStorage.getItem("bloom-media-layout") as "classic" | "compact") || "classic"
	);
	const [cornersEnabled, setCornersEnabled] = useState(
		() => localStorage.getItem("bloom-corners-enabled") === "true"
	);
	const [showUpdateIndicator, setShowUpdateIndicator] = useState(
		() => localStorage.getItem("bloom-show-update-indicator") !== "false"
	);
	const [timeFormat24h, setTimeFormat24h] = useState(
		() => localStorage.getItem("bloom-time-format-24h") === "true"
	);
	const [tempUnitFahrenheit, setTempUnitFahrenheit] = useState(false);
	const [cityName, setCityName] = useState("");
	const [citySearchResults, setCitySearchResults] = useState<
		Array<{ name: string; country: string; latitude: number; longitude: number }>
	>([]);
	const [showCityDropdown, setShowCityDropdown] = useState(false);
	const [statusWidgets, setStatusWidgets] = useState<WidgetConfig>({
		left: ["weather"],
		right: ["battery"]
	});
	const [dockEnabled, setDockEnabled] = useState(true);
	const [dockPreviewEnabled, setDockPreviewEnabled] = useState(true);
	const [dockIconOnly, setDockIconOnly] = useState(
		() => localStorage.getItem("bloom-dock-icon-only") === "true"
	);
	const [dockSeparatorEnabled, setDockSeparatorEnabled] = useState(
		() => localStorage.getItem("bloom-dock-separator-enabled") !== "false"
	);
	const [startIcon, setStartIcon] = useState(
		() => localStorage.getItem("bloom-start-icon") || "default"
	);
	const [dockAdaptive, setDockAdaptive] = useState(
		() => localStorage.getItem("bloom-dock-adaptive") === "true"
	);
	const [dockWinNumberEnabled, setDockWinNumberEnabled] = useState(
		() => localStorage.getItem("bloom-dock-win-number-enabled") !== "false"
	);
	const [dockExtrasPosition, setDockExtrasPosition] = useState(
		() => localStorage.getItem("bloom-dock-extras-position") || "off"
	);
	const [dockExtrasDrives, setDockExtrasDrives] = useState(
		() => localStorage.getItem("bloom-dock-extras-drives") !== "false"
	);
	const [dockExtrasHiddenDrives, setDockExtrasHiddenDrives] = useState(
		() => localStorage.getItem("bloom-dock-extras-hidden-drives") || ""
	);
	const [dockExtrasRecycleBin, setDockExtrasRecycleBin] = useState(
		() => localStorage.getItem("bloom-dock-extras-recycle-bin") !== "false"
	);
	// Off unless turned on, so existing docks don't change.
	const [dockTaskView, setDockTaskView] = useState(
		() => localStorage.getItem("bloom-dock-task-view") === "true"
	);
	const [dockExtrasFolders, setDockExtrasFolders] = useState(
		() => localStorage.getItem("bloom-dock-extras-folders") ?? DEFAULT_ENABLED_FOLDERS
	);
	const [dockExtrasCustomFolders, setDockExtrasCustomFolders] = useState(
		() => localStorage.getItem("bloom-dock-extras-custom-folders") || "[]"
	);

	const [fastBoot, setFastBoot] = useState(
		() => localStorage.getItem("bloom-fast-boot") !== "false"
	);
	const toggleFastBoot = () => {
		const next = !fastBoot;
		setFastBoot(next);
		localStorage.setItem("bloom-fast-boot", next.toString());
	};

	const [interceptNotifications, setInterceptNotifications] = useState(
		() => localStorage.getItem("bloom-intercept-notifications") !== "false"
	);
	const toggleInterceptNotifications = () => {
		const next = !interceptNotifications;
		setInterceptNotifications(next);
		localStorage.setItem("bloom-intercept-notifications", next.toString());
	};

	const [pomoFocusMins, setPomoFocusMins] = useState(
		() => parseInt(localStorage.getItem("bloom_pomo_focus_mins") || "25") || 25
	);
	const [pomoShortMins, setPomoShortMins] = useState(
		() => parseInt(localStorage.getItem("bloom_pomo_short_mins") || "5") || 5
	);
	const [pomoLongMins, setPomoLongMins] = useState(
		() => parseInt(localStorage.getItem("bloom_pomo_long_mins") || "15") || 15
	);
	const [pomoCycles, setPomoCycles] = useState(
		() => parseInt(localStorage.getItem("bloom_pomo_cycle_count") || "4") || 4
	);
	const updatePomoSettings = (focus: number, shortB: number, longB: number, cycles: number) => {
		setPomoFocusMins(focus);
		setPomoShortMins(shortB);
		setPomoLongMins(longB);
		setPomoCycles(cycles);
		localStorage.setItem("bloom_pomo_focus_mins", focus.toString());
		localStorage.setItem("bloom_pomo_short_mins", shortB.toString());
		localStorage.setItem("bloom_pomo_long_mins", longB.toString());
		localStorage.setItem("bloom_pomo_cycle_count", cycles.toString());
	};
	const resetPomoProgress = () => {
		localStorage.setItem("bloom_pomo_cycle_count", "1");
		localStorage.setItem("bloom_pomo_phase", "focus");
		localStorage.setItem("bloom_pomo_today_completed", "0");
		setPomoCycles(1);
	};
	const [dockMode, setDockMode] = useState(() => {
		// "smart" is the fresh-install default — keep in step with App.tsx,
		// Dock.tsx, and the backend fallback in commands.rs.
		const raw = localStorage.getItem("bloom-dock-mode") || "smart";
		return raw === "auto-hide" ? "smart" : raw;
	});
	const [dockEdgeDelay, setDockEdgeDelay] = useState(() => {
		const val = localStorage.getItem("bloom-dock-edge-delay");
		return val !== null ? parseInt(val) : 200;
	});
	const [notchMode, setNotchMode] = useState("fixed");
	const [notchEdgeDelay, setNotchEdgeDelay] = useState(() => {
		const val = localStorage.getItem("bloom-notch-edge-delay");
		return val !== null ? parseInt(val) : 200;
	});
	const [lowBatteryThreshold, setLowBatteryThreshold] = useState(20);
	const [updateStatus, setUpdateStatus] = useState<
		"idle" | "checking" | "available" | "uptodate" | "error" | "downloading" | "installing"
	>("idle");
	const [updateVersion, setUpdateVersion] = useState("");
	const [appVersion, setAppVersion] = useState("");
	const [autoUpdate, setAutoUpdate] = useState(
		() => localStorage.getItem("bloom-auto-update") === "true"
	);
	const [scale, setScale] = useState(() =>
		parseFloat(localStorage.getItem("bloom-scale") || "1.0")
	);
	const [themeMode, setThemeMode] = useState(
		() => localStorage.getItem("bloom-theme-mode") || "dark"
	);
	const [themeColor, setThemeColor] = useState(
		() => localStorage.getItem("bloom-theme-color") || "#007aff"
	);
	const [themeOpacity, setThemeOpacity] = useState(() => {
		const val = localStorage.getItem("bloom-theme-opacity");
		return val !== null ? parseFloat(val) : 0.8;
	});
	const [themeSaturation, setThemeSaturation] = useState(() => {
		const val = localStorage.getItem("bloom-theme-saturation");
		return val !== null ? parseFloat(val) : 0.5;
	});
	const [themeBrightness, setThemeBrightness] = useState(() => {
		const val = localStorage.getItem("bloom-theme-brightness");
		return val !== null ? parseFloat(val) : 0.15;
	});
	const [exportStatus, setExportStatus] = useState<"idle" | "exporting" | "success" | "error">(
		"idle"
	);
	const [importStatus, setImportStatus] = useState<"idle" | "importing" | "success" | "error">(
		"idle"
	);

	// Notifications
	const [notifSuppressWindows, setNotifSuppressWindows] = useState(
		() => localStorage.getItem("bloom-notif-suppress-windows-toasts") !== "false"
	);
	const toggleNotifSuppressWindows = () => {
		const next = !notifSuppressWindows;
		setNotifSuppressWindows(next);
		saveSetting("bloom-notif-suppress-windows-toasts", next.toString());
		invoke("set_windows_toast_suppression_cmd", { suppress: next }).catch(() => {});
	};

	const [notifDuration, setNotifDuration] = useState(
		() => Number(localStorage.getItem("bloom-notif-duration") || "6")
	);
	const changeNotifDuration = (sec: number) => {
		setNotifDuration(sec);
		saveSetting("bloom-notif-duration", sec.toString());
	};

	const [notifSound, setNotifSound] = useState(
		() => localStorage.getItem("bloom-notif-sound") !== "false"
	);
	const toggleNotifSound = () => {
		const next = !notifSound;
		setNotifSound(next);
		saveSetting("bloom-notif-sound", next.toString());
	};

	const [notifQuickReply, setNotifQuickReply] = useState(
		() => localStorage.getItem("bloom-notif-quick-reply") !== "false"
	);
	const toggleNotifQuickReply = () => {
		const next = !notifQuickReply;
		setNotifQuickReply(next);
		saveSetting("bloom-notif-quick-reply", next.toString());
	};

	const [notifCatMessages, setNotifCatMessages] = useState(
		() => localStorage.getItem("bloom-notif-cat-messages") !== "false"
	);
	const toggleNotifCatMessages = () => {
		const next = !notifCatMessages;
		setNotifCatMessages(next);
		saveSetting("bloom-notif-cat-messages", next.toString());
	};

	const [notifCatAlarms, setNotifCatAlarms] = useState(
		() => localStorage.getItem("bloom-notif-cat-alarms") !== "false"
	);
	const toggleNotifCatAlarms = () => {
		const next = !notifCatAlarms;
		setNotifCatAlarms(next);
		saveSetting("bloom-notif-cat-alarms", next.toString());
	};

	const [notifCatCalls, setNotifCatCalls] = useState(
		() => localStorage.getItem("bloom-notif-cat-calls") !== "false"
	);
	const toggleNotifCatCalls = () => {
		const next = !notifCatCalls;
		setNotifCatCalls(next);
		saveSetting("bloom-notif-cat-calls", next.toString());
	};

	const [notifCatSystem, setNotifCatSystem] = useState(
		() => localStorage.getItem("bloom-notif-cat-system") !== "false"
	);
	const toggleNotifCatSystem = () => {
		const next = !notifCatSystem;
		setNotifCatSystem(next);
		saveSetting("bloom-notif-cat-system", next.toString());
	};

	const [notifHistoryLimit, setNotifHistoryLimit] = useState(
		() => Number(localStorage.getItem("bloom-notif-history-limit") || "20")
	);
	const changeNotifHistoryLimit = (limit: number) => {
		setNotifHistoryLimit(limit);
		saveSetting("bloom-notif-history-limit", limit.toString());
	};

	const clearNotificationHistory = async () => {
		try {
			await invoke("clear_notification_history_cmd");
		} catch (e) {
			console.error("Failed to clear notifications:", e);
		}
	};

	const sendTestNotification = async (category: string = "message") => {
		try {
			let appName = "Telegram";
			let title = "Sarah Jenkins";
			let body = "Bloom notification system is working perfectly!";
			if (category === "alarm") {
				appName = "Clock";
				title = "Morning Alarm";
				body = "Wake up, meeting starts in 15 minutes";
			} else if (category === "call") {
				appName = "WhatsApp";
				title = "Incoming Call";
				body = "David Miller is calling you...";
			}
			await invoke("emit_test_notification", {
				appName,
				title,
				body,
				category
			});
		} catch (e) {
			console.error("Failed to send test notification:", e);
		}
	};

	// Notch Geometry & Behavior
	const [notchOffsetY, setNotchOffsetY] = useState(
		() => Number(localStorage.getItem("bloom-notch-offset-y") || "0")
	);
	const handleNotchOffsetYChange = (val: number) => {
		setNotchOffsetY(val);
		saveSetting("bloom-notch-offset-y", val.toString());
	};

	const [notchWidthOffset, setNotchWidthOffset] = useState(
		() => Number(localStorage.getItem("bloom-notch-width-offset") || "0")
	);
	const handleNotchWidthOffsetChange = (val: number) => {
		setNotchWidthOffset(val);
		saveSetting("bloom-notch-width-offset", val.toString());
	};

	const [notchCornerRadius, setNotchCornerRadius] = useState(
		() => Number(localStorage.getItem("bloom-notch-corner-radius") || "18")
	);
	const handleNotchCornerRadiusChange = (val: number) => {
		setNotchCornerRadius(val);
		saveSetting("bloom-notch-corner-radius", val.toString());
	};

	const [notchCloseOutside, setNotchCloseOutside] = useState(
		() => localStorage.getItem("bloom-notch-close-outside") !== "false"
	);
	const toggleNotchCloseOutside = () => {
		const next = !notchCloseOutside;
		setNotchCloseOutside(next);
		saveSetting("bloom-notch-close-outside", next.toString());
	};

	const [notchProtectStartMenu, setNotchProtectStartMenu] = useState(
		() => localStorage.getItem("bloom-notch-protect-startmenu") !== "false"
	);
	const toggleNotchProtectStartMenu = () => {
		const next = !notchProtectStartMenu;
		setNotchProtectStartMenu(next);
		saveSetting("bloom-notch-protect-startmenu", next.toString());
	};

	const [notchFullscreenDisable, setNotchFullscreenDisable] = useState(
		() => localStorage.getItem("bloom-notch-fullscreen-disable") !== "false"
	);
	const toggleNotchFullscreenDisable = () => {
		const next = !notchFullscreenDisable;
		setNotchFullscreenDisable(next);
		saveSetting("bloom-notch-fullscreen-disable", next.toString());
	};

	// Dock Customizations
	const [dockIconSize, setDockIconSize] = useState(
		() => Number(localStorage.getItem("bloom-dock-icon-size") || "44")
	);
	const handleDockIconSizeChange = (val: number) => {
		setDockIconSize(val);
		saveSetting("bloom-dock-icon-size", val.toString());
	};

	const [dockMagnification, setDockMagnification] = useState(
		() => localStorage.getItem("bloom-dock-magnification") !== "false"
	);
	const toggleDockMagnification = () => {
		const next = !dockMagnification;
		setDockMagnification(next);
		saveSetting("bloom-dock-magnification", next.toString());
	};

	const [dockMagScale, setDockMagScale] = useState(
		() => Number(localStorage.getItem("bloom-dock-mag-scale") || "1.25")
	);
	const handleDockMagScaleChange = (val: number) => {
		setDockMagScale(val);
		saveSetting("bloom-dock-mag-scale", val.toString());
	};

	const [dockIndicatorStyle, setDockIndicatorStyle] = useState(
		() => localStorage.getItem("bloom-dock-indicator-style") || "dot"
	);
	const handleDockIndicatorStyleChange = (val: string) => {
		setDockIndicatorStyle(val);
		saveSetting("bloom-dock-indicator-style", val);
	};

	const [dockPosition, setDockPosition] = useState(
		() => localStorage.getItem("bloom-dock-position") || "center"
	);
	const handleDockPositionChange = (val: string) => {
		setDockPosition(val);
		saveSetting("bloom-dock-position", val);
	};

	const [dockHideTaskbar, setDockHideTaskbar] = useState(
		() => localStorage.getItem("bloom-dock-hide-taskbar") !== "false"
	);
	const toggleDockHideTaskbar = () => {
		const next = !dockHideTaskbar;
		setDockHideTaskbar(next);
		saveSetting("bloom-dock-hide-taskbar", next.toString());
		invoke("set_taskbar_visibility_cmd", { visible: !next }).catch(() => {});
	};

	// Appearance Customizations
	const [zeroShadowMode, setZeroShadowMode] = useState(
		() => localStorage.getItem("bloom-theme-zero-shadow") !== "false"
	);
	const toggleZeroShadowMode = () => {
		const next = !zeroShadowMode;
		setZeroShadowMode(next);
		saveSetting("bloom-theme-zero-shadow", next.toString());
	};

	const [borderStyle, setBorderStyle] = useState(
		() => localStorage.getItem("bloom-border-style") || "subtle"
	);
	const handleBorderStyleChange = (val: string) => {
		setBorderStyle(val);
		saveSetting("bloom-border-style", val);
	};

	const [blurStyle, setBlurStyle] = useState(
		() => localStorage.getItem("bloom-blur-style") || "acrylic"
	);
	const handleBlurStyleChange = (val: string) => {
		setBlurStyle(val);
		saveSetting("bloom-blur-style", val);
	};

	const applyThemePreset = (preset: {
		mode: string;
		color: string;
		opacity: number;
		zeroShadow: boolean;
		border: string;
		blur: string;
	}) => {
		setThemeMode(preset.mode);
		setThemeColor(preset.color);
		setThemeOpacity(preset.opacity);
		setZeroShadowMode(preset.zeroShadow);
		setBorderStyle(preset.border);
		setBlurStyle(preset.blur);

		saveSetting("bloom-theme-mode", preset.mode);
		saveSetting("bloom-theme-color", preset.color);
		saveSetting("bloom-theme-opacity", preset.opacity.toString());
		saveSetting("bloom-theme-zero-shadow", preset.zeroShadow.toString());
		saveSetting("bloom-border-style", preset.border);
		saveSetting("bloom-blur-style", preset.blur);
	};

	// Hotkeys
	const [hotkeyNotch, setHotkeyNotch] = useState(
		() => localStorage.getItem("bloom-hotkey-notch") || "Ctrl+Shift+Space"
	);
	const [hotkeyDock, setHotkeyDock] = useState(
		() => localStorage.getItem("bloom-hotkey-dock") || "Ctrl+Shift+D"
	);
	const [hotkeyNotifs, setHotkeyNotifs] = useState(
		() => localStorage.getItem("bloom-hotkey-notifs") || "Ctrl+Shift+N"
	);
	const [hotkeySettings, setHotkeySettings] = useState(
		() => localStorage.getItem("bloom-hotkey-settings") || "Ctrl+,"
	);
	const updateHotkey = (key: string, value: string) => {
		if (key === "notch") {
			setHotkeyNotch(value);
			saveSetting("bloom-hotkey-notch", value);
		} else if (key === "dock") {
			setHotkeyDock(value);
			saveSetting("bloom-hotkey-dock", value);
		} else if (key === "notifs") {
			setHotkeyNotifs(value);
			saveSetting("bloom-hotkey-notifs", value);
		} else if (key === "settings") {
			setHotkeySettings(value);
			saveSetting("bloom-hotkey-settings", value);
		}
	};

	// ── Load all settings from backend + localStorage ──
	const loadAllSettings = useCallback(async () => {
		try {
			const settings: Record<string, string> = await invoke("load_settings");
			if (await reloadIfMirrorWasStale(settings)) return;
			const getVal = (key: string) => {
				const val = settings[key];
				if (val !== undefined && val !== null) return String(val);
				return localStorage.getItem(key);
			};

			const apply = <T>(
				val: string | null,
				setter: (v: T) => void,
				transform: (v: string) => T
			) => {
				if (val !== null) setter(transform(val));
			};

			apply(getVal("bloom-weather-enabled"), setWeatherEnabled, readBool);
			apply(getVal("bloom-calendar-enabled"), setCalendarEnabled, readBool);
			try {
				const val = getVal("bloom-timer-presets");
				if (val) {
					const parsed = JSON.parse(val);
					if (Array.isArray(parsed) && parsed.length > 0) {
						const nums = parsed.map(Number).filter((n: any) => !isNaN(n) && n > 0);
						if (nums.length > 0) setTimerPresets(nums);
					}
				}
			} catch {}
			apply(getVal("bloom-timer-sound-enabled"), setTimerSoundEnabled, readBool);
			apply(getVal("bloom-music-mode-enabled"), setMusicModeEnabled, readBool);
			apply(getVal("bloom-notch-remember-panel") ?? getVal("bloom-notch-click-to-open"),
				setNotchRememberPanel, readBool);
			apply(getVal("bloom-notch-default-panel"), setNotchDefaultPanel,
				(v) => (v === "calendar" || v === "timers" || v === "notifications") ? v : "command-center");
			apply(getVal("bloom-music-compact-notch"), setMusicCompactNotch, readBool);
			apply(getVal("bloom-shelf-persist"), setShelfPersist, readBool);
			apply(getVal("bloom-volume-overlay-enabled"), setVolumeOverlayEnabled, readBool);
			apply(getVal("bloom-brightness-overlay-enabled"), setBrightnessOverlayEnabled, readBool);
			apply(getVal("bloom-media-ambience-enabled"), setMediaAmbienceEnabled, readBool);
			apply(getVal("bloom-media-compact-glow-enabled"), setMediaCompactGlowEnabled, readBool);
			apply(getVal("bloom-corners-enabled"), setCornersEnabled, readBool);
			apply(getVal("bloom-time-format-24h"), setTimeFormat24h, readBool);
			apply(getVal("bloom-show-update-indicator"), setShowUpdateIndicator, readBool);
			apply(getVal("bloom-auto-update"), setAutoUpdate, readBool);
			apply(getVal("bloom-volume-edge-enabled"), setVolumeEdgeEnabled, readBool);
			apply(getVal("bloom-brightness-edge-enabled"), setBrightnessEdgeEnabled, readBool);
			apply(getVal("bloom-dock-enabled"), setDockEnabled, readBool);
			apply(getVal("bloom-dock-preview-enabled"), setDockPreviewEnabled, readBool);
			apply(getVal("bloom-dock-icon-only"), setDockIconOnly, readBool);
			apply(getVal("bloom-dock-separator-enabled"), setDockSeparatorEnabled, readBool);
			apply(getVal("bloom-start-icon"), setStartIcon, (v) => v);
			apply(getVal("bloom-dock-adaptive"), setDockAdaptive, readBool);
			apply(getVal("bloom-dock-win-number-enabled"), setDockWinNumberEnabled, readBool);
			apply(getVal("bloom-dock-extras-position"), setDockExtrasPosition, (v) => v);
			apply(getVal("bloom-dock-extras-drives"), setDockExtrasDrives, readBool);
			apply(getVal("bloom-dock-extras-recycle-bin"), setDockExtrasRecycleBin, readBool);
			apply(getVal("bloom-dock-task-view"), setDockTaskView, readBool);
			apply(getVal("bloom-dock-extras-hidden-drives"), setDockExtrasHiddenDrives, (v) => v);
			apply(getVal("bloom-dock-extras-folders"), setDockExtrasFolders, (v) => v);
			apply(getVal("bloom-dock-extras-custom-folders"), setDockExtrasCustomFolders, (v) => v);

			apply(getVal("bloom-temp-unit"), setTempUnitFahrenheit, (v) => v === "fahrenheit");
			apply(getVal("bloom-scale"), setScale, parseFloat);
			apply(getVal("bloom-low-battery-threshold"), setLowBatteryThreshold, parseInt);

			apply(getVal("bloom-notch-mode"), setNotchMode, (v) => (v === "auto-hide" ? "smart" : v));
			apply(getVal("bloom-notch-edge-delay"), setNotchEdgeDelay, parseInt);
			apply(getVal("bloom-dock-mode"), setDockMode, (v) => (v === "auto-hide" ? "smart" : v));
			apply(getVal("bloom-dock-edge-delay"), setDockEdgeDelay, parseInt);

			const savedCity = getVal("bloom-weather-city");
			if (savedCity) setCityName(savedCity);

			apply(getVal("bloom-theme-mode"), setThemeMode, (v) => v);
			apply(getVal("bloom-theme-color"), setThemeColor, (v) => v);
			apply(getVal("bloom-theme-opacity"), setThemeOpacity, parseFloat);
			apply(getVal("bloom-theme-saturation"), setThemeSaturation, parseFloat);
			apply(getVal("bloom-theme-brightness"), setThemeBrightness, parseFloat);

			const widgetsVal = getVal("bloom-status-widgets");
			if (widgetsVal) {
				try {
					const parsed = JSON.parse(widgetsVal);
					if (parsed && Array.isArray(parsed.left) && Array.isArray(parsed.right)) {
						setStatusWidgets(parsed);
					}
				} catch {}
			}

			apply(getVal("bloom-notif-suppress-windows-toasts"), setNotifSuppressWindows, readBool);
			apply(getVal("bloom-notif-duration"), setNotifDuration, (v) => Number(v) || 6);
			apply(getVal("bloom-notif-sound"), setNotifSound, readBool);
			apply(getVal("bloom-notif-quick-reply"), setNotifQuickReply, readBool);
			apply(getVal("bloom-notif-cat-messages"), setNotifCatMessages, readBool);
			apply(getVal("bloom-notif-cat-alarms"), setNotifCatAlarms, readBool);
			apply(getVal("bloom-notif-cat-calls"), setNotifCatCalls, readBool);
			apply(getVal("bloom-notif-cat-system"), setNotifCatSystem, readBool);
			apply(getVal("bloom-notif-history-limit"), setNotifHistoryLimit, (v) => Number(v) || 20);

			apply(getVal("bloom-notch-offset-y"), setNotchOffsetY, (v) => Number(v) || 0);
			apply(getVal("bloom-notch-width-offset"), setNotchWidthOffset, (v) => Number(v) || 0);
			apply(getVal("bloom-notch-corner-radius"), setNotchCornerRadius, (v) => Number(v) || 18);
			apply(getVal("bloom-notch-close-outside"), setNotchCloseOutside, readBool);
			apply(getVal("bloom-notch-protect-startmenu"), setNotchProtectStartMenu, readBool);
			apply(getVal("bloom-notch-fullscreen-disable"), setNotchFullscreenDisable, readBool);

			apply(getVal("bloom-dock-icon-size"), setDockIconSize, (v) => Number(v) || 44);
			apply(getVal("bloom-dock-magnification"), setDockMagnification, readBool);
			apply(getVal("bloom-dock-mag-scale"), setDockMagScale, (v) => Number(v) || 1.25);
			apply(getVal("bloom-dock-indicator-style"), setDockIndicatorStyle, (v) => v);
			apply(getVal("bloom-dock-position"), setDockPosition, (v) => v);
			apply(getVal("bloom-dock-hide-taskbar"), setDockHideTaskbar, readBool);

			apply(getVal("bloom-theme-zero-shadow"), setZeroShadowMode, readBool);
			apply(getVal("bloom-border-style"), setBorderStyle, (v) => v);
			apply(getVal("bloom-blur-style"), setBlurStyle, (v) => v);

			apply(getVal("bloom-hotkey-notch"), setHotkeyNotch, (v) => v);
			apply(getVal("bloom-hotkey-dock"), setHotkeyDock, (v) => v);
			apply(getVal("bloom-hotkey-notifs"), setHotkeyNotifs, (v) => v);
			apply(getVal("bloom-hotkey-settings"), setHotkeySettings, (v) => v);
		} catch (e) {
			console.error("Failed to load settings:", e);
		}
	}, []);

	// The file write is authoritative. Serialize controls that change several
	// settings, and update the local mirror only after the backend confirms the
	// write. A failed save reloads the page from persisted values and leaves a
	// visible error instead of keeping an optimistic control value on screen.
	const saveSetting = (key: string, value: string | null): Promise<boolean> => {
		const operation = saveQueue.current.then(async () => {
			if (saveFailed.current) return false;
			try {
				await invoke<void>("save_setting", { key, value });
			} catch (error) {
				console.error(`Failed to save ${key}:`, error);
				saveFailed.current = true;
				sessionStorage.setItem("bloom-settings-save-error", "true");
				setSaveError(true);
				window.setTimeout(() => window.location.reload(), 0);
				return false;
			}
			try {
				if (value === null) localStorage.removeItem(key);
				else localStorage.setItem(key, value);
				sessionStorage.removeItem("bloom-settings-save-error");
			} catch (error) {
				// The file is saved; a mirror failure must not be reported as a failed write.
				console.warn("Settings mirror update failed:", error);
			}
			setSaveError(false);
			return true;
		});
		saveQueue.current = operation.then(() => {});
		return operation;
	};

	// Coordinates only need the backend settings file. Keep them out of the
	// browser's localStorage mirror while preserving the same queued/error path.
	const saveLocation = (key: "bloom-weather-lat" | "bloom-weather-lon", value: string | null): Promise<boolean> => {
		const operation = saveQueue.current.then(async () => {
			if (saveFailed.current) return false;
			try {
				await invoke<void>("save_setting", { key, value });
			} catch (error) {
				console.error(`Failed to save ${key}:`, error);
				saveFailed.current = true;
				sessionStorage.setItem("bloom-settings-save-error", "true");
				setSaveError(true);
				window.setTimeout(() => window.location.reload(), 0);
				return false;
			}
			try {
				localStorage.removeItem(key);
				sessionStorage.removeItem("bloom-settings-save-error");
			} catch (error) {
				console.warn("Settings mirror cleanup failed:", error);
			}
			setSaveError(false);
			return true;
		});
		saveQueue.current = operation.then(() => {});
		return operation;
	};

	const dismissSaveError = () => {
		sessionStorage.removeItem("bloom-settings-save-error");
		setSaveError(false);
	};

	// ── Initialize on mount ──
	useEffect(() => {
		loadAllSettings();

		isEnabled()
			.then(setAutostart)
			.catch(() => {});

		getVersion()
			.then((ver) => setAppVersion(ver || "3.1.2"))
			.catch(() => setAppVersion("3.1.2"));

		checkForUpdates(false);
	}, []);

	// ── Sync settings from other windows ──
	useSettingsSync({
		"bloom-dock-mode": setDockMode,
		"bloom-dock-edge-delay": setDockEdgeDelay,
		"bloom-notch-mode": setNotchMode,
		"bloom-notch-edge-delay": setNotchEdgeDelay,
		"bloom-dock-enabled": setDockEnabled,
		"bloom-dock-icon-only": setDockIconOnly,
		"bloom-dock-separator-enabled": setDockSeparatorEnabled,
		"bloom-start-icon": setStartIcon,
		"bloom-dock-preview-enabled": setDockPreviewEnabled,
		"bloom-dock-adaptive": setDockAdaptive,
		"bloom-dock-win-number-enabled": setDockWinNumberEnabled,
		"bloom-dock-extras-position": setDockExtrasPosition,
		"bloom-dock-extras-drives": setDockExtrasDrives,
		"bloom-dock-extras-recycle-bin": setDockExtrasRecycleBin,
		"bloom-dock-task-view": setDockTaskView,
		"bloom-dock-extras-hidden-drives": setDockExtrasHiddenDrives,
		"bloom-dock-extras-folders": setDockExtrasFolders,
		"bloom-dock-extras-custom-folders": setDockExtrasCustomFolders,
		"bloom-weather-enabled": setWeatherEnabled,
		"bloom-calendar-enabled": setCalendarEnabled,
		"bloom-timer-presets": (v: unknown) => {
			try {
				const parsed = typeof v === "string" ? JSON.parse(v) : v;
				if (Array.isArray(parsed) && parsed.length > 0) {
					const nums = parsed.map(Number).filter((n) => !isNaN(n) && n > 0);
					if (nums.length > 0) setTimerPresets(nums);
				}
			} catch {}
		},
		"bloom-timer-sound-enabled": setTimerSoundEnabled,
		"bloom-music-mode-enabled": setMusicModeEnabled,
		"bloom-notch-remember-panel": setNotchRememberPanel,
		"bloom-notch-default-panel": (v: unknown) =>
			setNotchDefaultPanel(v === "command-center" || v === "timers" || v === "notifications" ? v : "calendar"),
		"bloom-music-compact-notch": setMusicCompactNotch,
		"bloom-media-ambience-enabled": setMediaAmbienceEnabled,
		"bloom-media-compact-glow-enabled": setMediaCompactGlowEnabled,
		"bloom-media-layout": setMediaLayout,
		"bloom-corners-enabled": setCornersEnabled,
		"bloom-show-update-indicator": setShowUpdateIndicator,
		"bloom-time-format-24h": setTimeFormat24h,
		"bloom-low-battery-threshold": setLowBatteryThreshold,
		"bloom-scale": setScale,
		"bloom-temp-unit": (v) => setTempUnitFahrenheit(v === "fahrenheit"),
		"bloom-auto-update": setAutoUpdate,
		"bloom-volume-overlay-enabled": setVolumeOverlayEnabled,
		"bloom-volume-edge-enabled": setVolumeEdgeEnabled,
		"bloom-brightness-overlay-enabled": setBrightnessOverlayEnabled,
		"bloom-brightness-edge-enabled": setBrightnessEdgeEnabled,
		"bloom-theme-mode": setThemeMode,
		"bloom-theme-color": setThemeColor,
		"bloom-theme-opacity": setThemeOpacity,
		"bloom-theme-saturation": setThemeSaturation,
		"bloom-theme-brightness": setThemeBrightness,
		"bloom-weather-city": (v) => setCityName(v || "")
	});

	// ── Listen for system accent changes (adaptive theme) ──
	useEffect(() => {
		const unlisten = listen<string>("system-accent-changed", (event) => {
			const mode = localStorage.getItem("bloom-theme-mode") || "dark";
			if (mode === "adaptive") {
				try {
					const hsl = hexToHsl(event.payload);
					setThemeSaturation(hsl.s / 100);
					setThemeBrightness(hsl.l / 100);
				} catch (e) {
					console.error("Failed to parse system accent color change HSL:", e);
				}
			}
		});
		return () => {
			unlisten.then((fn) => fn());
		};
	}, []);

	// ── City search debounce ──
	useEffect(() => {
		if (cityName.trim().length < 2) {
			setCitySearchResults([]);
			setShowCityDropdown(false);
			return;
		}

		const timeout = setTimeout(async () => {
			try {
				const res = await fetch(
					`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=5&language=en&format=json`
				);
				const data = await res.json();
				if (data.results && data.results.length > 0) {
					setCitySearchResults(
						data.results.map((r: any) => ({
							name: r.name,
							country: r.country || "",
							latitude: r.latitude,
							longitude: r.longitude
						}))
					);
					setShowCityDropdown(true);
				} else {
					setCitySearchResults([]);
				}
			} catch {
				setCitySearchResults([]);
			}
		}, 300);

		return () => clearTimeout(timeout);
	}, [cityName]);

	// ── Update checker ──
	const checkForUpdates = async (manual = true) => {
		setUpdateStatus("checking");
		try {
			const result = await invoke<UpdateCheckResult>("check_for_updates", { force: manual });
			if (result.available) {
				setUpdateStatus("available");
				setUpdateVersion(result.version ?? "");
			} else {
				setUpdateStatus("uptodate");
			}
		} catch (e) {
			console.error("Updater error:", e);
			setUpdateStatus("error");
		}
	};

	const installUpdate = async () => {
		try {
			setUpdateStatus("downloading");
			await invoke("install_update");
			setUpdateStatus("idle");
		} catch (e) {
			console.error(e);
			setUpdateStatus("error");
		}
	};

	// Reflect install progress triggered from any window (including auto-update).
	useEffect(() => {
		const unlisten = listen<{ status: string; progress?: number }>(
			"auto-update-status",
			(event) => {
				switch (event.payload.status) {
					case "downloading":
						setUpdateStatus("downloading");
						break;
					case "installing":
						setUpdateStatus("installing");
						break;
					case "done":
						setUpdateStatus((prev) =>
							prev === "downloading" || prev === "installing" ? "idle" : prev
						);
						break;
				}
			}
		);
		return () => {
			unlisten.then((fn) => fn());
		};
	}, []);

	// ── Autostart ──
	const toggleAutostart = async () => {
		try {
			const currentlyEnabled = await isEnabled();
			if (currentlyEnabled) {
				await disable();
				setAutostart(false);
			} else {
				await enable();
				setAutostart(true);
			}
		} catch (err) {}
	};

	// ── Simple boolean toggles ──
	const toggleWeather = () => {
		const next = !weatherEnabled;
		setWeatherEnabled(next);
		saveSetting("bloom-weather-enabled", String(next));
	};

	const toggleCalendar = () => {
		const next = !calendarEnabled;
		setCalendarEnabled(next);
		saveSetting("bloom-calendar-enabled", String(next));
	};

	const toggleTimerSound = () => {
		const next = !timerSoundEnabled;
		setTimerSoundEnabled(next);
		saveSetting("bloom-timer-sound-enabled", String(next));
	};

	const updateTimerPresets = (presets: number[]) => {
		setTimerPresets(presets);
		saveSetting("bloom-timer-presets", JSON.stringify(presets));
	};

	const toggleMusicMode = () => {
		const next = !musicModeEnabled;
		setMusicModeEnabled(next);
		saveSetting("bloom-music-mode-enabled", String(next));
	};

	const toggleNotchRememberPanel = () => {
		const next = !notchRememberPanel;
		setNotchRememberPanel(next);
		saveSetting("bloom-notch-remember-panel", String(next));
	};

	const changeNotchDefaultPanel = (panel: "calendar" | "command-center" | "timers" | "notifications") => {
		setNotchDefaultPanel(panel);
		saveSetting("bloom-notch-default-panel", panel);
	};

	const toggleMusicCompactNotch = () => {
		const next = !musicCompactNotch;
		setMusicCompactNotch(next);
		saveSetting("bloom-music-compact-notch", String(next));
	};

	const toggleShelfPersist = () => {
		const next = !shelfPersist;
		setShelfPersist(next);
		saveSetting("bloom-shelf-persist", String(next));
	};

	const toggleMediaLayout = (layout: "classic" | "compact") => {
		setMediaLayout(layout);
		saveSetting("bloom-media-layout", layout);
	};

	const toggleVolumeOverlay = () => {
		const next = !volumeOverlayEnabled;
		setVolumeOverlayEnabled(next);
		saveSetting("bloom-volume-overlay-enabled", String(next));
	};

	const toggleVolumeEdge = () => {
		const next = !volumeEdgeEnabled;
		setVolumeEdgeEnabled(next);
		saveSetting("bloom-volume-edge-enabled", String(next));
	};

	const toggleBrightnessOverlay = () => {
		const next = !brightnessOverlayEnabled;
		setBrightnessOverlayEnabled(next);
		saveSetting("bloom-brightness-overlay-enabled", String(next));
	};

	const toggleBrightnessEdge = () => {
		const next = !brightnessEdgeEnabled;
		setBrightnessEdgeEnabled(next);
		saveSetting("bloom-brightness-edge-enabled", String(next));
	};

	const toggleAmbience = () => {
		const next = !mediaAmbienceEnabled;
		setMediaAmbienceEnabled(next);
		saveSetting("bloom-media-ambience-enabled", String(next));
	};

	const toggleCompactGlow = () => {
		const next = !mediaCompactGlowEnabled;
		setMediaCompactGlowEnabled(next);
		saveSetting("bloom-media-compact-glow-enabled", String(next));
	};

	const toggleCorners = () => {
		const next = !cornersEnabled;
		setCornersEnabled(next);
		saveSetting("bloom-corners-enabled", String(next));
	};

	const toggleUpdateIndicator = () => {
		const next = !showUpdateIndicator;
		setShowUpdateIndicator(next);
		saveSetting("bloom-show-update-indicator", String(next));
	};

	const toggleTimeFormat24h = () => {
		const next = !timeFormat24h;
		setTimeFormat24h(next);
		saveSetting("bloom-time-format-24h", String(next));
	};

	const toggleTempUnit = () => {
		const next = !tempUnitFahrenheit;
		setTempUnitFahrenheit(next);
		saveSetting("bloom-temp-unit", next ? "fahrenheit" : "celsius");
	};

	const toggleDock = () => {
		const next = !dockEnabled;
		setDockEnabled(next);
		saveSetting("bloom-dock-enabled", String(next));
	};

	const toggleDockPreview = () => {
		const next = !dockPreviewEnabled;
		setDockPreviewEnabled(next);
		saveSetting("bloom-dock-preview-enabled", String(next));
	};

	const toggleDockIconOnly = () => {
		const next = !dockIconOnly;
		setDockIconOnly(next);
		saveSetting("bloom-dock-icon-only", String(next));
	};

	const toggleDockSeparator = () => {
		const next = !dockSeparatorEnabled;
		setDockSeparatorEnabled(next);
		saveSetting("bloom-dock-separator-enabled", String(next));
	};

	const handleStartIconChange = (icon: string) => {
		setStartIcon(icon);
		saveSetting("bloom-start-icon", icon);
	};

	const toggleDockAdaptive = () => {
		const next = !dockAdaptive;
		setDockAdaptive(next);
		saveSetting("bloom-dock-adaptive", String(next));
	};

	const toggleDockWinNumber = () => {
		const next = !dockWinNumberEnabled;
		setDockWinNumberEnabled(next);
		saveSetting("bloom-dock-win-number-enabled", String(next));
	};

	const handleDockExtrasPositionChange = (position: string) => {
		setDockExtrasPosition(position);
		saveSetting("bloom-dock-extras-position", position);
	};

	const toggleDockExtrasDrives = () => {
		const next = !dockExtrasDrives;
		setDockExtrasDrives(next);
		saveSetting("bloom-dock-extras-drives", String(next));
	};

	const toggleDockExtrasDrive = (letter: string) => {
		const next = toggleHiddenDrive(dockExtrasHiddenDrives, letter);
		setDockExtrasHiddenDrives(next);
		saveSetting("bloom-dock-extras-hidden-drives", next);
	};

	const toggleDockExtrasRecycleBin = () => {
		const next = !dockExtrasRecycleBin;
		setDockExtrasRecycleBin(next);
		saveSetting("bloom-dock-extras-recycle-bin", String(next));
	};

	const toggleDockTaskView = () => {
		const next = !dockTaskView;
		setDockTaskView(next);
		saveSetting("bloom-dock-task-view", String(next));
	};

	const toggleDockExtraFolder = (id: string) => {
		const next = toggleEnabledFolder(dockExtrasFolders, id);
		setDockExtrasFolders(next);
		saveSetting("bloom-dock-extras-folders", next);
	};

	const handleAddDockExtraFolder = async () => {
		try {
			const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
			const selected = await openDialog({
				title: "Add a folder to the dock",
				directory: true,
				multiple: false
			});
			if (typeof selected === "string") {
				const next = addCustomFolder(dockExtrasCustomFolders, selected);
				setDockExtrasCustomFolders(next);
				saveSetting("bloom-dock-extras-custom-folders", next);
			}
		} catch (e) {
			console.error("Folder picker failed:", e);
		}
	};

	const handleRemoveDockExtraFolder = (path: string) => {
		const next = removeCustomFolder(dockExtrasCustomFolders, path);
		setDockExtrasCustomFolders(next);
		saveSetting("bloom-dock-extras-custom-folders", next);
	};

	const toggleAutoUpdate = () => {
		const next = !autoUpdate;
		setAutoUpdate(next);
		saveSetting("bloom-auto-update", String(next));
	};

	// ── Value setters ──
	const setDockModeValue = (newMode: string) => {
		setDockMode(newMode);
		saveSetting("bloom-dock-mode", newMode);
	};

	const setNotchModeValue = (newMode: string) => {
		setNotchMode(newMode);
		saveSetting("bloom-notch-mode", newMode);
	};

	const handleDockEdgeDelayChange = (val: number) => {
		setDockEdgeDelay(val);
		saveSetting("bloom-dock-edge-delay", val.toString());
	};

	const handleNotchEdgeDelayChange = (val: number) => {
		setNotchEdgeDelay(val);
		saveSetting("bloom-notch-edge-delay", val.toString());
	};

	const handleThresholdChange = (val: number) => {
		setLowBatteryThreshold(val);
		saveSetting("bloom-low-battery-threshold", val.toString());
	};

	const handleScaleChange = (val: number) => {
		setScale(val);
		saveSetting("bloom-scale", val.toString());
	};

	const handleWidgetsChange = (config: WidgetConfig) => {
		setStatusWidgets(config);
		saveSetting("bloom-status-widgets", JSON.stringify(config));
	};

	// ── Theme handlers ──
	const handleThemeModeChange = async (mode: string) => {
		setThemeMode(mode);
		saveSetting("bloom-theme-mode", mode);

		if (mode === "adaptive") {
			try {
				const accentHex = await invoke<string>("get_system_accent_color");
				const hsl = hexToHsl(accentHex);
				setThemeSaturation(hsl.s / 100);
				saveSetting("bloom-theme-saturation", String(hsl.s / 100));
				setThemeBrightness(hsl.l / 100);
				saveSetting("bloom-theme-brightness", String(hsl.l / 100));
			} catch (e) {
				console.error("Failed to parse adaptive accent HSL:", e);
			}
		}
	};

	const handleThemeColorChange = (color: string) => {
		setThemeColor(color);
		saveSetting("bloom-theme-color", color);

		try {
			const hsl = hexToHsl(color);
			setThemeSaturation(hsl.s / 100);
			saveSetting("bloom-theme-saturation", String(hsl.s / 100));
			setThemeBrightness(hsl.l / 100);
			saveSetting("bloom-theme-brightness", String(hsl.l / 100));
		} catch (e) {
			console.error("Failed to parse custom color HSL:", e);
		}
	};

	const handleOpacityChange = (value: number) => {
		setThemeOpacity(value);
		saveSetting("bloom-theme-opacity", String(value));
	};

	const handleSaturationChange = (value: number) => {
		setThemeSaturation(value);
		saveSetting("bloom-theme-saturation", String(value));
	};

	const handleBrightnessChange = (value: number) => {
		setThemeBrightness(value);
		saveSetting("bloom-theme-brightness", String(value));
	};

	// ── City search ──
	const selectCity = async (city: {
		name: string;
		country: string;
		latitude: number;
		longitude: number;
	}) => {
		setCityName(city.name);
		setShowCityDropdown(false);
		setCitySearchResults([]);
		const saved =
			(await saveLocation("bloom-weather-lat", city.latitude.toString())) &&
			(await saveLocation("bloom-weather-lon", city.longitude.toString())) &&
			(await saveSetting("bloom-weather-city", city.name));
		if (saved) emit("weather-refresh", { lat: city.latitude, lon: city.longitude });
	};

	const handleCityClear = async () => {
		setCityName("");
		setShowCityDropdown(false);
		setCitySearchResults([]);
		const saved =
			(await saveLocation("bloom-weather-lat", null)) &&
			(await saveLocation("bloom-weather-lon", null)) &&
			(await saveSetting("bloom-weather-city", null));
		if (saved) emit("weather-refresh", true);
	};

	// ── Reset to defaults ──
	const resetToDefaults = async () => {
		try {
			const { ask } = await import("@tauri-apps/plugin-dialog");
			const confirmed = await ask(
				"All settings return to their defaults and Bloom restarts. Pinned apps and custom icons are kept.",
				{
					title: "Reset Bloom to Defaults",
					kind: "warning",
					okLabel: "Reset and Restart",
					cancelLabel: "Cancel"
				}
			);
			if (!confirmed) return;

			await invoke("reset_settings");

			// settings.json is cleared, but every window also caches bloom keys
			// in localStorage; drop them so the restart can't resurrect values.
			// The first-run/version sentinels are lifecycle markers, not
			// preferences — keeping them avoids replaying the splash, which
			// would also re-trigger the first-run autostart enable.
			const keep = new Set(["bloom-first-run", "bloom-app-version"]);
			for (const key of Object.keys(localStorage)) {
				if (key.startsWith("bloom-") && !keep.has(key)) localStorage.removeItem(key);
			}

			await invoke("restart_bloom").catch(console.error);
		} catch (e) {
			console.error("Reset failed:", e);
		}
	};

	// ── Export / Import ──
	// The backend opens the native dialog and owns the file path, so these
	// cannot be used to read or write arbitrary files from a webview.
	const handleExportSettings = async () => {
		setExportStatus("exporting");
		try {
			const filePath = await invoke<string | null>("export_settings_to_file");
			if (filePath) {
				setExportStatus("success");
				setTimeout(() => setExportStatus("idle"), 2000);
			} else {
				setExportStatus("idle");
			}
		} catch (e) {
			console.error("Export failed:", e);
			setExportStatus("error");
			setTimeout(() => setExportStatus("idle"), 3000);
		}
	};

	const handleImportSettings = async () => {
		setImportStatus("importing");
		try {
			const filePath = await invoke<string | null>("import_settings_from_file");
			if (filePath) {
				await loadAllSettings();
				setImportStatus("success");
				setTimeout(() => setImportStatus("idle"), 2000);
			} else {
				setImportStatus("idle");
			}
		} catch (e) {
			console.error("Import failed:", e);
			setImportStatus("error");
			setTimeout(() => setImportStatus("idle"), 3000);
		}
	};

	return {
		saveError,
		dismissSaveError,
		// System
		autostart,
		toggleAutostart,
		fastBoot,
		toggleFastBoot,
		interceptNotifications,
		toggleInterceptNotifications,
		pomoFocusMins,
		pomoShortMins,
		pomoLongMins,
		pomoCycles,
		updatePomoSettings,
		resetPomoProgress,
		autoUpdate,
		toggleAutoUpdate,
		lowBatteryThreshold,
		handleThresholdChange,
		timeFormat24h,
		toggleTimeFormat24h,
		showUpdateIndicator,
		toggleUpdateIndicator,
		scale,
		handleScaleChange,
		cornersEnabled,
		toggleCorners,

		// Theme
		themeMode,
		handleThemeModeChange,
		themeColor,
		handleThemeColorChange,
		themeOpacity,
		handleOpacityChange,
		themeSaturation,
		handleSaturationChange,
		themeBrightness,
		handleBrightnessChange,

		// Notch
		notchMode,
		setNotchModeValue,
		notchEdgeDelay,
		handleNotchEdgeDelayChange,
		calendarEnabled,
		toggleCalendar,
		timerPresets,
		updateTimerPresets,
		timerSoundEnabled,
		toggleTimerSound,
		musicModeEnabled,
		toggleMusicMode,
		notchRememberPanel,
		toggleNotchRememberPanel,
		notchDefaultPanel,
		changeNotchDefaultPanel,
		musicCompactNotch,
		toggleMusicCompactNotch,
		shelfPersist,
		toggleShelfPersist,
		mediaLayout,
		toggleMediaLayout,
		mediaAmbienceEnabled,
		toggleAmbience,
		mediaCompactGlowEnabled,
		toggleCompactGlow,

		// Weather
		weatherEnabled,
		toggleWeather,
		tempUnitFahrenheit,
		toggleTempUnit,
		cityName,
		setCityName,
		citySearchResults,
		showCityDropdown,
		setShowCityDropdown,
		selectCity,
		handleCityClear,

		// Widgets
		statusWidgets,
		handleWidgetsChange,

		// Dock
		dockEnabled,
		toggleDock,
		dockMode,
		setDockModeValue,
		dockEdgeDelay,
		handleDockEdgeDelayChange,
		dockPreviewEnabled,
		toggleDockPreview,
		dockIconOnly,
		toggleDockIconOnly,
		dockSeparatorEnabled,
		toggleDockSeparator,
		startIcon,
		handleStartIconChange,
		dockAdaptive,
		toggleDockAdaptive,
		dockWinNumberEnabled,
		toggleDockWinNumber,
		dockExtrasPosition,
		handleDockExtrasPositionChange,
		dockExtrasDrives,
		toggleDockExtrasDrives,
		dockExtrasHiddenDrives,
		toggleDockExtrasDrive,
		dockExtrasRecycleBin,
		toggleDockExtrasRecycleBin,
		dockTaskView,
		toggleDockTaskView,
		dockExtrasFolders,
		toggleDockExtraFolder,
		dockExtrasCustomFolders,
		handleAddDockExtraFolder,
		handleRemoveDockExtraFolder,

		// Notifications
		notifSuppressWindows,
		toggleNotifSuppressWindows,
		notifDuration,
		changeNotifDuration,
		notifSound,
		toggleNotifSound,
		notifQuickReply,
		toggleNotifQuickReply,
		notifCatMessages,
		toggleNotifCatMessages,
		notifCatAlarms,
		toggleNotifCatAlarms,
		notifCatCalls,
		toggleNotifCatCalls,
		notifCatSystem,
		toggleNotifCatSystem,
		notifHistoryLimit,
		changeNotifHistoryLimit,
		clearNotificationHistory,
		sendTestNotification,

		// Notch Geometry & Behavior
		notchOffsetY,
		handleNotchOffsetYChange,
		notchWidthOffset,
		handleNotchWidthOffsetChange,
		notchCornerRadius,
		handleNotchCornerRadiusChange,
		notchCloseOutside,
		toggleNotchCloseOutside,
		notchProtectStartMenu,
		toggleNotchProtectStartMenu,
		notchFullscreenDisable,
		toggleNotchFullscreenDisable,

		// Dock Customizations
		dockIconSize,
		handleDockIconSizeChange,
		dockMagnification,
		toggleDockMagnification,
		dockMagScale,
		handleDockMagScaleChange,
		dockIndicatorStyle,
		handleDockIndicatorStyleChange,
		dockPosition,
		handleDockPositionChange,
		dockHideTaskbar,
		toggleDockHideTaskbar,

		// Appearance Customizations
		zeroShadowMode,
		toggleZeroShadowMode,
		borderStyle,
		handleBorderStyleChange,
		blurStyle,
		handleBlurStyleChange,
		applyThemePreset,

		// Hotkeys
		hotkeyNotch,
		hotkeyDock,
		hotkeyNotifs,
		hotkeySettings,
		updateHotkey,

		// Overlays
		volumeOverlayEnabled,
		toggleVolumeOverlay,
		volumeEdgeEnabled,
		toggleVolumeEdge,
		brightnessOverlayEnabled,
		toggleBrightnessOverlay,
		brightnessEdgeEnabled,
		toggleBrightnessEdge,

		// Updates
		updateStatus,
		updateVersion,
		appVersion,
		checkForUpdates,
		installUpdate,

		// Import / Export
		exportStatus,
		importStatus,
		handleExportSettings,
		handleImportSettings,

		// Utilities
		restartBloom: () => invoke("restart_bloom"),
		resetToDefaults,
		quitBloom: () => invoke("quit_bloom")
	};
}
