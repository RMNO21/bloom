import { motion, AnimatePresence, useAnimation } from "framer-motion";
import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef, memo } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getVersion } from "@tauri-apps/api/app";
import type { UpdateCheckResult } from "./updater";
import { batteryTooltip, type BatteryDetails } from "./batteryTooltip";
import {
	createRegionSender,
	measureElements,
	notchPillBox,
	type RegionRect
} from "./windowRegion";
import "./App.css";
import { initTheme } from "./theme";
import {
	PlayIcon,
	PauseIcon,
	SkipBackIcon,
	SkipForwardIcon,
	VolumeLowIcon,
	VolumeHighIcon,
	MusicNoteIcon,
	HeadphonesIcon
} from "./icons";
import { CompactMediaPlayer } from "./CompactMediaPlayer";
import { useWeather } from "./hooks/useWeather";
import { useSettingsSync } from "./hooks/useSettingsSync";
import { useTrailingThrottle } from "./hooks/useTrailingThrottle";
import { useAnnouncement } from "./hooks/useAnnouncement";
import { reloadIfMirrorWasStale } from "./hooks/settingsMirror";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import type { WidgetConfig } from "./components/StatusWidgetConfig";
import { EdgeSurface } from "./components/EdgeSurface";
import { ShelfTypeIcon } from "./components/ShelfTypeIcon";
import { WifiPanel } from "./components/WifiPanel";
import { BluetoothPanel } from "./components/BluetoothPanel";
import { TodoList } from "./components/TodoList";
import { NotificationCenter } from "./components/NotificationCenter";
import { MyNotes } from "./components/MyNotes";
import { TimersPanel } from "./components/TimersPanel";
import { CommandCenterFull } from "./components/CommandCenterFull";
import { alarmEngine, AlarmItem } from "./alarmEngine";
import { timerEngine, TimerEngineState } from "./timerEngine";
import {
	Cpu,
	MemoryStick,
	HardDrive,
	ArrowUpDown,
	Bell,
	BellRing,
	Megaphone,
	Type,
	X,
	ChevronLeft,
	ChevronRight,
	Inbox,
	Music,
	MessageSquare,
	Mail,
	Clock,
	PhoneCall,
	Send
} from "lucide-react";

/**
 * The notch has two kinds of content:
 * - Panels are tools the user chooses. A click opens the last-used panel by
 *   default, or a selected fixed panel when panel memory is turned off.
 * - Live activities (music, a set timer, a filled shelf) show a compact form in
 *   the pill or a bubble beside it, and opening one shows its own view, which
 *   stands alone (no panel arrows) and is never remembered as the last panel.
 *   Dragging files onto the notch also opens the shelf. Wheel/swipe switches
 *   between tool panels, including when a live activity occupies the pill.
 */
type NotchPanel = "calendar" | "command-center" | "timers" | "notifications";
const NOTCH_PANELS: readonly NotchPanel[] = ["command-center", "calendar", "timers", "notifications"];
const asNotchPanel = (value: unknown): NotchPanel | null =>
	NOTCH_PANELS.includes(value as NotchPanel) ? (value as NotchPanel) : null;

// Completion chime for the Pomodoro timer. Synthesized with the Web Audio API
// so no audio asset is needed; created on the Start click so the webview's
// autoplay policy lets it play when the timer ends.
let timerChimeCtx: AudioContext | null = null;

const getTimerChimeCtx = (): AudioContext | null => {
	try {
		if (!timerChimeCtx) timerChimeCtx = new AudioContext();
		if (timerChimeCtx.state === "suspended") timerChimeCtx.resume().catch(() => {});
		return timerChimeCtx;
	} catch {
		return null;
	}
};

const playTimerChime = () => {
	const ctx = getTimerChimeCtx();
	if (!ctx) return;
	const start = ctx.currentTime + 0.02;
	const master = ctx.createGain();
	master.gain.value = 0.45;
	master.connect(ctx.destination);

	// Soft rising bell arpeggio (A5–C#6–E6) with a quiet octave harmonic.
	const notes = [
		{ freq: 880.0, at: 0 },
		{ freq: 1108.73, at: 0.18 },
		{ freq: 1318.51, at: 0.36 }
	];
	notes.forEach(({ freq, at }) => {
		const osc = ctx.createOscillator();
		const harmonic = ctx.createOscillator();
		const gain = ctx.createGain();
		const harmonicGain = ctx.createGain();
		osc.type = "sine";
		osc.frequency.value = freq;
		harmonic.type = "sine";
		harmonic.frequency.value = freq * 2.01;
		harmonicGain.gain.value = 0.12;
		gain.gain.setValueAtTime(0.0001, start + at);
		gain.gain.exponentialRampToValueAtTime(0.32, start + at + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 1.4);
		osc.connect(gain);
		harmonic.connect(harmonicGain);
		harmonicGain.connect(gain);
		gain.connect(master);
		osc.start(start + at);
		harmonic.start(start + at);
		osc.stop(start + at + 1.5);
		harmonic.stop(start + at + 1.5);
	});
};

const playNotificationChime = () => {
	try {
		const audioEnabled = localStorage.getItem("bloom-notif-sound") !== "false";
		if (!audioEnabled) return;
		const ctx = getTimerChimeCtx();
		if (!ctx) return;
		const start = ctx.currentTime + 0.01;
		const master = ctx.createGain();
		master.gain.setValueAtTime(0.32, start);
		master.connect(ctx.destination);

		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = "sine";
		osc.frequency.setValueAtTime(587.33, start); // D5
		osc.frequency.exponentialRampToValueAtTime(880.0, start + 0.08); // A5

		gain.gain.setValueAtTime(0.001, start);
		gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);

		osc.connect(gain);
		gain.connect(master);
		osc.start(start);
		osc.stop(start + 0.36);
	} catch {}
};

function BatteryIcon({
	charging,
	level,
	threshold = 20
}: {
	charging: boolean;
	level: number;
	threshold?: number;
}) {
	const percentage = Math.min(Math.max(level, 0), 100);

	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				position: "relative",
				height: "14px",
				justifyContent: "center"
			}}
		>
			<svg width="20" height="10" viewBox="0 0 20 10" fill="none">
				{/* Battery Shell - Centered at 9px within 20px width, ignoring the tip's offset */}
				<rect
					x="2"
					y="0.75"
					width="14"
					height="8.5"
					rx="2.4"
					stroke="currentColor"
					strokeOpacity={0.35}
					strokeWidth="1.1"
				/>
				{/* Battery Tip */}
				<path
					d="M17.5 3.5V6.5"
					stroke="currentColor"
					strokeOpacity={0.35}
					strokeWidth="1.2"
					strokeLinecap="round"
				/>
				{/* Fill */}
				<rect
					x="3.8"
					y="2.5"
					width={Math.max(0.5, (percentage / 100) * 10.4)}
					height="5"
					rx="1"
					fill={charging ? "#32D74B" : percentage <= threshold ? "#FF453A" : "white"}
				/>
			</svg>
			{/* Charging Bolt - Centered on the battery body */}
			{charging && (
				<div
					style={{
						position: "absolute",
						top: "50%",
						left: "9px",
						transform: "translate(-50%, -50%)",
						color: "white",
						filter: "drop-shadow(0px 0px 1.5px rgba(0,0,0,0.8))"
					}}
				>
					<svg width="7" height="10" viewBox="0 0 8 12" fill="currentColor">
						<path d="M4.5 0L0 7H3.5L2.5 12L8 5H4.5L5.5 0H4.5Z" />
					</svg>
				</div>
			)}
		</div>
	);
}

function GreenDownArrowIcon() {
	return (
		<div
			style={{
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				width: "18px",
				height: "18px",
				borderRadius: "50%",
				background: "rgba(50, 215, 75, 0.15)",
				border: "1px solid rgba(50, 215, 75, 0.35)",
				boxShadow: "0 0 8px rgba(50, 215, 75, 0.25)",
				flexShrink: 0,
				verticalAlign: "middle"
			}}
		>
			<svg
				width="10"
				height="10"
				viewBox="0 0 24 24"
				fill="none"
				stroke="#32D74B"
				strokeWidth="3"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<line x1="12" y1="4" x2="12" y2="16"></line>
				<polyline points="18 10 12 16 6 10"></polyline>
				<line x1="6" y1="20" x2="18" y2="20"></line>
			</svg>
		</div>
	);
}

export const Visualizer = memo(function Visualizer({
	isPlaying,
	bars = 5,
	height = 20
}: {
	isPlaying: boolean;
	bars?: number;
	height?: number;
}) {
	const [audioData, setAudioData] = useState<number[]>(new Array(bars).fill(0.18));

	useEffect(() => {
		if (!isPlaying) {
			setAudioData(new Array(bars).fill(0.18));
			return;
		}

		const unlisten = listen<{ frequencies: number[] }>("audio-visualization", (event) => {
			// If we receive fewer frequencies than bars, repeat or interpolate
			// If more, slice
			let data = event.payload.frequencies;
			if (data.length > bars) data = data.slice(0, bars);
			while (data.length < bars) data.push(0.18);
			setAudioData(data);
		});

		return () => {
			unlisten.then((fn) => fn());
		};
	}, [isPlaying, bars]);

	return (
		<div
			className="visualizer-horizontal"
			style={{ height: `${height}px`, width: `${bars * 6}px` }}
		>
			{audioData.map((value, i) => (
				<motion.div
					key={i}
					className="bar-horizontal"
					animate={{
						scaleY: isPlaying ? Math.max(0.2, value) : 0.1,
						opacity: isPlaying ? 0.95 : 0.5
					}}
					transition={{
						type: "spring",
						stiffness: 600,
						damping: 30,
						mass: 0.5
					}}
				/>
			))}
		</div>
	);
});


interface MediaInfo {
	title: string;
	artist: string;
	is_playing: boolean;
	has_media: boolean;
	artwork?: string[];
	position_ms?: number;
	duration_ms?: number;
	seek_enabled?: boolean;
	position_updated_at?: number;
}

interface WifiStatus {
	enabled: boolean;
	connected: boolean;
	ssid: string | null;
}

// A shelf file's preview from the backend: a picture when one can be made,
// else the opening text of a document or text file, and whether it's a folder
// (for the placeholder icon).
interface ShelfPreview {
	thumb: string | null;
	text: string | null;
	folder: boolean;
}

interface ShelfItem {
	id: string;
	type: "file" | "text";
	name: string;
	path?: string;
	text?: string;
	timestamp: number;
}

type BloomMode =
	| "music"
	| "calendar"
	| "command-center"
	| "timers"
	| "notifications"
	| "announcement"
	| "notification"
	| "status"
	| "shelf"
	| "wifi"
	| "bluetooth";

interface NotificationItem {
	id: number;
	app_name: string;
	title: string;
	body: string;
	category?: string;
	actions: string[];
	has_reply?: boolean;
	placeholder?: string;
	timestamp: number;
}

// The shelf is a short-lived stash: one row, newest first, oldest evicted.
const SHELF_MAX_ITEMS = 10;

const MARQUEE_SPEED = 30; // px/s — constant for all titles
const MARQUEE_MIN_DURATION = 5; // floor so short titles don't flicker

const TitleMarquee = ({ title }: { title: string }) => {
	const textRef = useRef<HTMLSpanElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const [isOverflowing, setIsOverflowing] = useState(false);
	const [scrollDistance, setScrollDistance] = useState(0);
	const [scrollDuration, setScrollDuration] = useState(8);

	useEffect(() => {
		const check = () => {
			if (textRef.current && containerRef.current) {
				const textWidth = textRef.current.scrollWidth;
				const containerWidth = containerRef.current.clientWidth;
				const overflow = textWidth > containerWidth;
				setIsOverflowing(overflow);
				if (overflow) {
					const distance = textWidth - containerWidth;
					setScrollDistance(distance);
					setScrollDuration(Math.max(distance / MARQUEE_SPEED, MARQUEE_MIN_DURATION));
				}
			}
		};
		check();
		const observer = new ResizeObserver(check);
		if (containerRef.current) observer.observe(containerRef.current);
		return () => observer.disconnect();
	}, [title]);

	return (
		<div
			ref={containerRef}
			className="premium-title-wrap"
			style={{ width: "100%", overflow: "hidden" }}
		>
			<span
				ref={textRef}
				className={`premium-title ${isOverflowing ? "marquee" : ""}`}
				style={
					{
						"--scroll-distance": isOverflowing ? `-${scrollDistance}px` : undefined,
						"--scroll-duration": `${scrollDuration}s`
					} as React.CSSProperties
				}
			>
				{title}
			</span>
		</div>
	);
};

function App() {
	useEffect(() => {
		return initTheme();
	}, []);

	const [time, setTime] = useState("");
	const [currentDate, setCurrentDate] = useState(() => {
		return new Date().toLocaleDateString(undefined, {
			weekday: "short",
			month: "short",
			day: "numeric"
		});
	});
	const [isHovered, setIsHovered] = useState(false);
	// Expanded into a panel by a click. Hover alone only peeks.
	const [isOpen, setIsOpen] = useState(false);
	const isOpenRef = useRef(false);
	isOpenRef.current = isOpen;
	const panelCycleStepRef = useRef(0);
	const [isReady, setIsReady] = useState(false);
	const [scale, setScale] = useState(() =>
		parseFloat(localStorage.getItem("bloom-scale") || "1.0")
	);
	const [timeFormat24h, setTimeFormat24h] = useState(
		() => localStorage.getItem("bloom-time-format-24h") === "true"
	);

	const [batteryLevel, setBatteryLevel] = useState(100);
	const [isCharging, setIsCharging] = useState(false);
	// Fetched when the pointer reaches the battery widget, for its tooltip.
	const [batteryDetails, setBatteryDetails] = useState<BatteryDetails | null>(null);
	// The status widget whose tooltip is open, the side of the pill it hangs
	// from, and the distance from the widget to just past that edge.
	const [statusTooltip, setStatusTooltip] = useState<{
		id: string;
		side: "below" | "left" | "right";
		offset: number;
	} | null>(null);
	const statusTooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Width the hovered status strip needs so neither side runs into the clock.
	const [statusFitWidth, setStatusFitWidth] = useState(0);
	const [showPowerPulse, setShowPowerPulse] = useState(false);
	const [showLowBatteryPulse, setShowLowBatteryPulse] = useState(false);
	const [lowBatteryThreshold, setLowBatteryThreshold] = useState(() =>
		parseInt(localStorage.getItem("bloom-low-battery-threshold") || "20")
	);
	const prevChargingRef = useRef<boolean | null>(null);
	const powerPulseTimeoutRef = useRef<any>(null);
	const lowBatteryPulseShownRef = useRef<boolean>(false);

	const [eventPeek, setEventPeek] = useState(false);
	const eventPeekTimeoutRef = useRef<any>(null);
	const updatePulseTimerRef = useRef<any>(null);
	const triggerEventPeek = useCallback((duration = 3000) => {
		setEventPeek(true);
		if (eventPeekTimeoutRef.current) clearTimeout(eventPeekTimeoutRef.current);
		eventPeekTimeoutRef.current = setTimeout(() => setEventPeek(false), duration);
	}, []);

	const [notchMode, setNotchMode] = useState(() => {
		const raw = localStorage.getItem("bloom-notch-mode") || "fixed";
		if (raw === "auto-hide") return "smart";
		return raw;
	});
	const [notchOffsetY, setNotchOffsetY] = useState(() => Number(localStorage.getItem("bloom-notch-offset-y") || "0"));
	const [notchCornerRadius, setNotchCornerRadius] = useState(() => Number(localStorage.getItem("bloom-notch-corner-radius") || "18"));
	const [notchWidthOffset, setNotchWidthOffset] = useState(() => Number(localStorage.getItem("bloom-notch-width-offset") || "0"));
	const [notchCloseOutside, setNotchCloseOutside] = useState(() => localStorage.getItem("bloom-notch-close-outside") !== "false");
	const notchCloseOutsideRef = useRef(notchCloseOutside);
	notchCloseOutsideRef.current = notchCloseOutside;

	const [notchProtectStartMenu, setNotchProtectStartMenu] = useState(() => localStorage.getItem("bloom-notch-protect-startmenu") !== "false");
	const notchProtectStartMenuRef = useRef(notchProtectStartMenu);
	notchProtectStartMenuRef.current = notchProtectStartMenu;

	const [notchFullscreenDisable, setNotchFullscreenDisable] = useState(() => localStorage.getItem("bloom-notch-fullscreen-disable") !== "false");
	const notchFullscreenDisableRef = useRef(notchFullscreenDisable);
	notchFullscreenDisableRef.current = notchFullscreenDisable;

	const [interceptNotifications, setInterceptNotifications] = useState(() => localStorage.getItem("bloom-intercept-notifications") !== "false");
	const interceptNotificationsRef = useRef(interceptNotifications);
	interceptNotificationsRef.current = interceptNotifications;

	const [notifDuration, setNotifDuration] = useState(() => Number(localStorage.getItem("bloom-notif-duration") || "6"));
	const notifDurationRef = useRef(notifDuration);
	notifDurationRef.current = notifDuration;

	const [notifSound, setNotifSound] = useState(() => localStorage.getItem("bloom-notif-sound") !== "false");
	const notifSoundRef = useRef(notifSound);
	notifSoundRef.current = notifSound;

	const [notifQuickReply, setNotifQuickReply] = useState(() => localStorage.getItem("bloom-notif-quick-reply") !== "false");
	const notifQuickReplyRef = useRef(notifQuickReply);
	notifQuickReplyRef.current = notifQuickReply;

	const [notifCatMessages, setNotifCatMessages] = useState(() => localStorage.getItem("bloom-notif-cat-messages") !== "false");
	const notifCatMessagesRef = useRef(notifCatMessages);
	notifCatMessagesRef.current = notifCatMessages;

	const [notifCatAlarms, setNotifCatAlarms] = useState(() => localStorage.getItem("bloom-notif-cat-alarms") !== "false");
	const notifCatAlarmsRef = useRef(notifCatAlarms);
	notifCatAlarmsRef.current = notifCatAlarms;

	const [notifCatCalls, setNotifCatCalls] = useState(() => localStorage.getItem("bloom-notif-cat-calls") !== "false");
	const notifCatCallsRef = useRef(notifCatCalls);
	notifCatCallsRef.current = notifCatCalls;

	const [notifCatSystem, setNotifCatSystem] = useState(() => localStorage.getItem("bloom-notif-cat-system") !== "false");
	const notifCatSystemRef = useRef(notifCatSystem);
	notifCatSystemRef.current = notifCatSystem;

	const [notifHistoryLimit, setNotifHistoryLimit] = useState(() => Number(localStorage.getItem("bloom-notif-history-limit") || "20"));
	const notifHistoryLimitRef = useRef(notifHistoryLimit);
	notifHistoryLimitRef.current = notifHistoryLimit;

	useEffect(() => {
		if (isReady && prevChargingRef.current !== null && prevChargingRef.current !== isCharging) {
			setShowPowerPulse(true);
			if (notchMode === "peek") triggerEventPeek(4000);
			if (powerPulseTimeoutRef.current) clearTimeout(powerPulseTimeoutRef.current);
			powerPulseTimeoutRef.current = setTimeout(() => {
				setShowPowerPulse(false);
			}, 4000);
		}
		prevChargingRef.current = isCharging;
	}, [isCharging, isReady, notchMode, triggerEventPeek]);

	useEffect(() => {
		// Trigger pulse when dropping below threshold while discharging
		if (
			isReady &&
			batteryLevel <= lowBatteryThreshold &&
			!isCharging &&
			!lowBatteryPulseShownRef.current
		) {
			setShowLowBatteryPulse(true);
			if (notchMode === "peek") triggerEventPeek(5000);
			lowBatteryPulseShownRef.current = true;
			setTimeout(() => setShowLowBatteryPulse(false), 5000);
		}

		// Reset the "shown" state if battery is charged or threshold is lowered
		if (isCharging || batteryLevel > lowBatteryThreshold) {
			lowBatteryPulseShownRef.current = false;
		}
	}, [batteryLevel, isCharging, lowBatteryThreshold, isReady, notchMode, triggerEventPeek]);

	// Weather state (managed by useWeather hook)

	// Media state
	const [isPlaying, setIsPlaying] = useState(false);
	const [mediaInfo, setMediaInfo] = useState<MediaInfo>({
		title: "",
		artist: "",
		is_playing: false,
		has_media: false
	});
	const [albumArtUrl, setAlbumArtUrl] = useState<string | null>(null);
	const [albumArtKey, setAlbumArtKey] = useState(0);
	const [volume, setVolume] = useState(0.5);
	const [isMuted, setIsMuted] = useState(false);
	// Sliders show 0 while muted, matching the overlay HUD.
	const displayVolume = isMuted ? 0 : volume;
	// Null until the first successful fetch so the pill can't flash a wrong
	// default on startup.
	const [wifiStatus, setWifiStatus] = useState<WifiStatus | null>(null);
	const wifiEnabled = wifiStatus?.enabled ?? false;
	const wifiConnected = wifiStatus?.connected ?? false;
	const [bluetoothEnabled, setBluetoothEnabled] = useState(true);
	// Names of connected Bluetooth devices, for the controls tile.
	const [btConnectedNames, setBtConnectedNames] = useState<string[]>([]);
	const [batterySaverEnabled, setBatterySaverEnabled] = useState(false);
	const [currentBrightness, setCurrentBrightness] = useState(50);

	// System metrics for status widgets
	const [cpuUsage, setCpuUsage] = useState(0);
	const [ramUsage, setRamUsage] = useState(0);
	const [diskSpace, setDiskSpace] = useState(0);
	const [netUpSpeed, setNetUpSpeed] = useState(0);
	const [netDownSpeed, setNetDownSpeed] = useState(0);
	const [statusWidgets, setStatusWidgets] = useState<WidgetConfig>({
		left: ["weather"],
		right: ["battery"]
	});

	const [windowLabel] = useState<string>(() => {
		try {
			return getCurrentWebviewWindow().label;
		} catch {
			return "main";
		}
	});

	// Update state
	const [updateAvailable, setUpdateAvailable] = useState(false);
	const [showUpdateIndicator, setShowUpdateIndicator] = useState(
		() => localStorage.getItem("bloom-show-update-indicator") !== "false"
	);
	const [showUpdatePulse, setShowUpdatePulse] = useState(false);

	useEffect(() => {
		if (windowLabel !== "main") return;

		let unlisten: (() => void) | undefined;
		let disposed = false;

		listen<UpdateCheckResult>("update-available", (event) => {
			setUpdateAvailable(event.payload.available);
			if (!event.payload.available) {
				setShowUpdatePulse(false);
				if (updatePulseTimerRef.current) clearTimeout(updatePulseTimerRef.current);
				return;
			}
			setShowUpdatePulse(true);
			if (notchMode === "peek") triggerEventPeek(6000);
			if (updatePulseTimerRef.current) clearTimeout(updatePulseTimerRef.current);
			updatePulseTimerRef.current = setTimeout(() => {
				setShowUpdatePulse(false);
			}, 6000);
		}).then((fn) => {
			if (disposed) fn();
			else unlisten = fn;
		});

		invoke<UpdateCheckResult>("get_update_state")
			.then((state) => {
				// Only restore a badge; clearing is left to check results so a
				// late mount read cannot race an "update-available" event.
				if (state.available) setUpdateAvailable(true);
			})
			.catch((e) => console.error("Failed to read update state:", e));

		return () => {
			disposed = true;
			unlisten?.();
			if (updatePulseTimerRef.current) clearTimeout(updatePulseTimerRef.current);
		};
	}, [windowLabel, notchMode, triggerEventPeek]);

	// Live privacy indicators (mic / camera / location)
	const [privacyIndicators, setPrivacyIndicators] = useState<{
		mic_active: boolean;
		camera_active: boolean;
		location_active: boolean;
	}>({ mic_active: false, camera_active: false, location_active: false });

	useEffect(() => {
		if (windowLabel !== "main" || !isOpen) return;
		let mounted = true;
		invoke<{
			mic_active: boolean;
			camera_active: boolean;
			location_active: boolean;
		}>("get_privacy_indicators")
			.then((res) => {
				if (mounted && res) setPrivacyIndicators(res);
			})
			.catch(() => {});
		return () => {
			mounted = false;
		};
	}, [windowLabel, isOpen]);

	// Remote announcement shown as a persistent notch card until dismissed.
	const {
		announcement,
		dismissed: announcementDismissed,
		dismiss: dismissAnnouncement
	} = useAnnouncement();
	const announcementShownRef = useRef<string | null>(null);
	const announcementOpen = !!announcement && !announcementDismissed;
	const announcementOpenRef = useRef(false);
	announcementOpenRef.current = announcementOpen;

	const [bloomMode, setBloomMode] = useState<BloomMode>("status");
	const bloomModeRef = useRef<BloomMode>("status");
	bloomModeRef.current = bloomMode;

	const [activeNotification, setActiveNotification] = useState<NotificationItem | null>(null);
	const notifTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const notifResumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const prevModeBeforeNotifRef = useRef<BloomMode>("status");
	const prevOpenBeforeNotifRef = useRef<boolean>(false);

	const [isVisible, setIsVisible] = useState(true);
	const [isImpacted, setIsImpacted] = useState(false);
	const [isExpanded, setIsExpanded] = useState(false);
	const [startupAnimating, setStartupAnimating] = useState(false);

	const [dockMode, setDockMode] = useState(() => {
		const raw = localStorage.getItem("bloom-dock-mode") || "smart";
		if (raw === "auto-hide") return "smart";
		return raw;
	});
	const [dndActive, setDndActive] = useState(() => {
		return localStorage.getItem("bloom-dnd-active") === "true";
	});
	const dndActiveRef = useRef(dndActive);
	useEffect(() => {
		dndActiveRef.current = dndActive;
		localStorage.setItem("bloom-dnd-active", String(dndActive));
	}, [dndActive]);
	const [dockEnabled, setDockEnabled] = useState(
		() => localStorage.getItem("bloom-dock-enabled") !== "false"
	);
	const [isNotchHovered, setIsNotchHovered] = useState(false);
	const [isTimerCollapsed, setIsTimerCollapsed] = useState(() => {
		return localStorage.getItem("bloom-timer-collapsed") === "true";
	});

	const toggleTimerCollapsed = () => {
		setIsTimerCollapsed((prev) => {
			const next = !prev;
			localStorage.setItem("bloom-timer-collapsed", String(next));
			return next;
		});
	};

	const [isEdgeHovered, setIsEdgeHovered] = useState(false);
	const [isOverlapped, setIsOverlapped] = useState(false);
	const [interactionState, setInteractionState] = useState<"active" | "grace" | "none">("none");
	const bloomRef = useRef<HTMLDivElement>(null);
	// Measured to fit the hovered status strip; see statusFitWidth.
	const leftWidgetsRef = useRef<HTMLDivElement>(null);
	const rightWidgetsRef = useRef<HTMLDivElement>(null);
	const timeCenterRef = useRef<HTMLDivElement>(null);
	const musicBubbleRef = useRef<HTMLButtonElement>(null);
	const shelfBubbleRef = useRef<HTMLButtonElement>(null);
	const reportNotchRect = useRef<() => void>(() => {});
	const dismissActiveNotificationRef = useRef<() => void>(() => {});
	const closeAndCollapseNotchRef = useRef<() => void>(() => {});
	// The pill's target box in window CSS px, and the sender that applies the
	// notch window's region (holding earlier regions while it shrinks).
	const pillTargetRef = useRef<RegionRect | null>(null);
	const sendNotchRegion = useMemo(
		() =>
			createRegionSender((rects) => {
				invoke("set_window_region", { rects }).catch(() => {});
			}),
		[]
	);

	// Recomputes the notch window's region from the pill's target box and the
	// floating parts drawn around it, and sends it if it changed. Reads only
	// refs and the DOM, so it is safe to call from any callback.
	const updateNotchRegion = () => {
		const wanted: RegionRect[] = [];
		if (pillTargetRef.current) wanted.push(pillTargetRef.current);
		// Each floating part, padded to cover what it paints outside its box: a
		// tooltip card's shadow reaches 20px out plus a 6px drop, a bubble's
		// glow less, and the screen corners nothing.
		wanted.push(
			...measureElements([
				[".activity-bubble", 16],
				[".status-tooltip", 28],
				[".screen-corner", 0]
			])
		);
		sendNotchRegion(wanted);
	};
	const [systemSettingsReady, setSystemSettingsReady] = useState(false);
	const [waitForStartupSplash, setWaitForStartupSplash] = useState(false);
	const initialSystemSyncDone = useRef(false);
	const splashDone = useRef(false);
	const systemSyncQueue = useRef<Promise<void>>(Promise.resolve());
	const appliedDock = useRef<{ enabled: boolean; mode: string } | null>(null);
	const appliedNotchMode = useRef<string | null>(null);

	// Ringing Alarm State (Synced with global AlarmEngine)
	const [activeRingingAlarm, setActiveRingingAlarm] = useState<AlarmItem | null>(null);
	const isNotificationActive = bloomMode === "notification" && !!activeNotification;
	const isAlertActive = isNotificationActive || !!activeRingingAlarm;
	const isNotchActive = isOpen || isAlertActive;

	useEffect(() => {
		alarmEngine.init();
		timerEngine.init();
		const unsub = alarmEngine.subscribeRinging((alarm) => {
			setActiveRingingAlarm(alarm);
		});
		return unsub;
	}, []);

	const isAnyInteraction = isHovered || isNotchHovered || isEdgeHovered;
	const isHidden =
		!startupAnimating &&
		!activeRingingAlarm &&
		bloomMode !== "notification" &&
		((notchMode === "smart" && isOverlapped && interactionState === "none") ||
			(notchMode === "peek" && interactionState === "none" && !eventPeek));

	useEffect(() => {
		if (isAnyInteraction) {
			setInteractionState("active");
		} else if (interactionState !== "none") {
			setInteractionState("grace");
			const timer = setTimeout(() => setInteractionState("none"), 800);
			return () => clearTimeout(timer);
		}
	}, [isAnyInteraction]);

	useEffect(() => {
		if (windowLabel === "main") {
			invoke("set_notch_hovered", { hovered: isNotchHovered }).catch(() => {});
		}
	}, [isNotchHovered, windowLabel]);

	// Tell the backend whether the notch is actually on screen so a hidden
	// notch (smart/peek mode) stays click-through instead of swallowing clicks
	// in its footprint.
	useEffect(() => {
		if (windowLabel === "main") {
			invoke("set_notch_visible", { visible: (isVisible || isNotchActive) && !isHidden }).catch(() => {});
		}
	}, [isVisible, isHidden, isNotchActive, windowLabel]);

	useEffect(() => {
		const updateRect = () => {
			if (bloomRef.current && windowLabel === "main") {
				// Activity bubbles sit beside the pill and must stay clickable too.
				const rects = [bloomRef.current, musicBubbleRef.current, shelfBubbleRef.current]
					.filter((el): el is NonNullable<typeof el> => el !== null)
					.map((el) => el.getBoundingClientRect());
				const left = Math.min(...rects.map((r) => r.left));
				const top = Math.min(...rects.map((r) => r.top));
				const right = Math.max(...rects.map((r) => r.right));
				const bottom = Math.max(...rects.map((r) => r.bottom));
				invoke("update_notch_rect", {
					rect: {
						x: Math.round(left),
						y: Math.round(top),
						width: Math.round(right - left),
						height: Math.round(bottom - top)
					}
				}).catch(() => {});
				// Bubbles finishing their entrance land here too.
				updateNotchRegion();
			}
		};
		reportNotchRect.current = updateRect;

		updateRect();
		window.addEventListener("resize", updateRect);
		const observer = new ResizeObserver(updateRect);
		if (bloomRef.current) observer.observe(bloomRef.current);

		return () => {
			window.removeEventListener("resize", updateRect);
			observer.disconnect();
		};
	}, [isOpen, isExpanded, isHidden, windowLabel, scale]);

	useEffect(() => {
		if (!windowLabel) return;

		// Only animate the main top-bar
		if (windowLabel !== "main") {
			setIsReady(true);
			setIsImpacted(true);
			setIsExpanded(true);
			return;
		}

		const proceedWithStartup = () => {
			const checkVisibility = async () => {
				try {
					const win = getCurrentWebviewWindow();
					const visible = await win.isVisible();
					if (visible) {
						setStartupAnimating(true);
						setIsReady(true);
						// The window is shown here; WebView2 may only create its
						// render child now, so refresh the drop targets.
						invoke("setup_shelf_drop").catch(() => {});
						setTimeout(() => {
							setIsImpacted(true);
							setIsExpanded(true);
						}, 240);
						setTimeout(() => setStartupAnimating(false), 1500);
						return true;
					}
				} catch (e) {}
				return false;
			};

			const interval = setInterval(async () => {
				if (await checkVisibility()) clearInterval(interval);
			}, 100);

			checkVisibility();
			return interval;
		};

		// Mirror Overlay.tsx's splash decision so we only wait when a splash will actually fire.
		// Overlay always emits splash-done, but on a normal relaunch it emits it near-instantly
		// (after one async getVersion() call) — before this listener would be registered.
		// By making the same decision here we avoid a race and avoid any unnecessary delay.
		const firstRun = localStorage.getItem("bloom-first-run") === null;
		const storedVersion = localStorage.getItem("bloom-app-version");

		const waitForSplash = () => {
			// Splash is definitely coming — register listener now (2800ms animation gives us plenty of time)
			let started = false;
			let interval: any;
			const unlistenSplash = listen("splash-done", () => {
				if (started) return;
				started = true;
				interval = proceedWithStartup();
				unlistenSplash.then((fn) => fn());
			});
			const safetyTimer = setTimeout(() => {
				if (started) return;
				started = true;
				interval = proceedWithStartup();
				unlistenSplash.then((fn) => fn());
			}, 6000);
			return () => {
				clearTimeout(safetyTimer);
				if (interval) clearInterval(interval);
				unlistenSplash.then((fn) => fn());
			};
		};

		if (firstRun || storedVersion === null) {
			// Splash is definitely showing — wait for it
			return waitForSplash();
		}

		// Has a version key — need async check to know if version changed
		let interval: any;
		getVersion()
			.then((currentVersion) => {
				if (storedVersion !== currentVersion) {
					// Version changed — splash is coming, wait for it
					// (splash takes 2800ms so there's plenty of time to register the listener)
					waitForSplash();
				} else {
					// Same version — no splash, start immediately
					interval = proceedWithStartup();
				}
			})
			.catch(() => {
				interval = proceedWithStartup();
			});
		return () => {
			if (interval) clearInterval(interval);
		};
	}, [windowLabel]);

	// Settings state
	const [settingsWeatherEnabled, setSettingsWeatherEnabled] = useState(
		() => localStorage.getItem("bloom-weather-enabled") !== "false"
	);
	const [settingsCalendarEnabled, setSettingsCalendarEnabled] = useState(
		() => localStorage.getItem("bloom-calendar-enabled") !== "false"
	);
	const [settingsTimerSoundEnabled, setSettingsTimerSoundEnabled] = useState(
		() => localStorage.getItem("bloom-timer-sound-enabled") !== "false"
	);
	const [settingsMusicModeEnabled, setSettingsMusicModeEnabled] = useState(
		() => localStorage.getItem("bloom-music-mode-enabled") !== "false"
	);
	const [rememberPanelEnabled, setRememberPanelEnabled] = useState(
		() => (localStorage.getItem("bloom-notch-remember-panel") ??
			localStorage.getItem("bloom-notch-click-to-open")) !== "false"
	);
	const rememberPanelEnabledRef = useRef(rememberPanelEnabled);
	rememberPanelEnabledRef.current = rememberPanelEnabled;
	const [_defaultPanel, setDefaultPanel] = useState<NotchPanel>(() =>
		asNotchPanel(localStorage.getItem("bloom-notch-default-panel")) ?? "command-center"
	);
	// The panel the open notch was last left on. Opening the notch returns to it,
	// across restarts too (bloom-notch-last-panel).
	const [lastPanel, setLastPanel] = useState<NotchPanel | null>(() => {
		const saved = asNotchPanel(localStorage.getItem("bloom-notch-last-panel"));
		if (!saved || saved === "calendar") return "command-center";
		return saved;
	});
	const [settingsMusicCompactNotch, setSettingsMusicCompactNotch] = useState(
		() => localStorage.getItem("bloom-music-compact-notch") !== "false"
	);
	const [shelfPersist, setShelfPersist] = useState(
		() => localStorage.getItem("bloom-shelf-persist") === "true"
	);
	const [settingsVisualizerEnabled, setSettingsVisualizerEnabled] = useState(
		() => localStorage.getItem("bloom-visualizer-enabled") !== "false"
	);
	const [settingsAlbumArtEnabled, setSettingsAlbumArtEnabled] = useState(
		() => localStorage.getItem("bloom-media-album-art-enabled") !== "false"
	);
	const [settingsAmbienceEnabled, setSettingsAmbienceEnabled] = useState(
		() => localStorage.getItem("bloom-media-ambience-enabled") !== "false"
	);
	const [settingsCompactGlowEnabled, setSettingsCompactGlowEnabled] = useState(
		() => localStorage.getItem("bloom-media-compact-glow-enabled") !== "false"
	);
	const [settingsCornersEnabled, setSettingsCornersEnabled] = useState(
		() => localStorage.getItem("bloom-corners-enabled") === "true"
	);
	const [mediaLayout, setMediaLayout] = useState<"classic" | "compact">(
		() => (localStorage.getItem("bloom-media-layout") as "classic" | "compact") || "classic"
	);
	const [compactVolumeExpanded, setCompactVolumeExpanded] = useState(false);

	// Weather hook
	const {
		temperature,
		weatherCondition,
		weatherIcon: WeatherIcon,
		cityName,
		tempUnit
	} = useWeather(settingsWeatherEnabled);

	useEffect(() => {
		if (!windowLabel) return;
		let cancelled = false;

		invoke("load_settings")
			.then(async (settings: any) => {
				if (await reloadIfMirrorWasStale(settings)) return;
				if (cancelled) return;
				const getVal = (key: string, fallback: string | null = null) => {
					const val = settings[key];
					if (val !== undefined && val !== null) return String(val);
					const local = localStorage.getItem(key);
					if (local !== null) return local;
					return fallback;
				};

				setSettingsWeatherEnabled(getVal("bloom-weather-enabled", "true") !== "false");
				setSettingsCalendarEnabled(getVal("bloom-calendar-enabled", "true") !== "false");
				setSettingsTimerSoundEnabled(getVal("bloom-timer-sound-enabled", "true") !== "false");
				setSettingsMusicModeEnabled(getVal("bloom-music-mode-enabled", "true") !== "false");
				setRememberPanelEnabled(
					(getVal("bloom-notch-remember-panel") ?? getVal("bloom-notch-click-to-open", "true")) !== "false"
				);
				setDefaultPanel(asNotchPanel(getVal("bloom-notch-default-panel")) ?? "command-center");
				setShelfPersist(getVal("bloom-shelf-persist", "false") === "true");
				setSettingsMusicCompactNotch(getVal("bloom-music-compact-notch", "true") !== "false");
				setLastPanel(asNotchPanel(getVal("bloom-notch-last-panel")));
				const viz =
					getVal("bloom-media-visualizer-enabled") ?? getVal("bloom-visualizer-enabled", "true");
				setSettingsVisualizerEnabled(viz !== "false");
				setSettingsAlbumArtEnabled(getVal("bloom-media-album-art-enabled", "true") !== "false");
				setSettingsAmbienceEnabled(getVal("bloom-media-ambience-enabled", "true") !== "false");
				setSettingsCompactGlowEnabled(
					getVal("bloom-media-compact-glow-enabled", "true") !== "false"
				);
				setSettingsCornersEnabled(getVal("bloom-corners-enabled", "false") === "true");
				setTimeFormat24h(getVal("bloom-time-format-24h") === "true");

				const thresholdStr = getVal("bloom-low-battery-threshold", "20");
				if (thresholdStr) setLowBatteryThreshold(parseInt(thresholdStr as string));

				const nMode = getVal("bloom-notch-mode", "fixed");
				if (nMode) {
					const mapped = nMode === "auto-hide" ? "smart" : nMode;
					setNotchMode(mapped);
				}

				if (windowLabel === "main") {
					const firstRun = localStorage.getItem("bloom-first-run") === null;
					if (firstRun) {
						import("@tauri-apps/plugin-autostart").then(({ enable, isEnabled }) => {
							isEnabled().then((enabled) => {
								if (!enabled) enable().catch(() => {});
							});
						});
						localStorage.setItem("bloom-first-run", "done");
					}
					const rawDockMode = getVal("bloom-dock-mode", "smart") as string;
					const dockMode = rawDockMode === "auto-hide" ? "smart" : rawDockMode;
					setDockMode(dockMode);
					setDockEnabled(getVal("bloom-dock-enabled", "true") === "true");
					const storedVersion = localStorage.getItem("bloom-app-version");
					let waitForSplash = firstRun || storedVersion === null;
					if (!waitForSplash) {
						try {
							waitForSplash = storedVersion !== (await getVersion());
						} catch {
							// Version lookup is optional; continue startup without a splash.
						}
					}
					if (cancelled) return;
					setWaitForStartupSplash(waitForSplash);
					setSystemSettingsReady(true);
				}

				const scaleVal = getVal("bloom-scale");
				if (scaleVal !== null) setScale(parseFloat(scaleVal));

				const widgetsVal = getVal("bloom-status-widgets");
				if (widgetsVal) {
					try {
						const parsed = JSON.parse(widgetsVal);
						if (parsed && Array.isArray(parsed.left) && Array.isArray(parsed.right)) {
							setStatusWidgets(parsed);
						}
					} catch {}
				}
			})
			.catch((error) => {
				console.error(error);
				if (!cancelled && windowLabel === "main") setSystemSettingsReady(true);
			});
		return () => {
			cancelled = true;
		};
	}, [windowLabel]); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		// Disable context menu globally
		const preventContext = (e: MouseEvent) => e.preventDefault();
		document.addEventListener("contextmenu", preventContext);

		const unlistenVisibility = listen<boolean>("visibility-change", (event) => {
			setIsVisible(event.payload);
		});

		const unlistenNotchOverlap = listen<boolean>("notch-overlap", (event) => {
			setIsOverlapped(event.payload);
		});

		const unlistenNotchEdgeHover = listen<boolean>("notch-edge-hover", (event) => {
			setIsEdgeHovered(event.payload);
		});

		// The backend emits this when the window flips to click-through while
		// the webview still thinks the pointer is inside the notch (it cannot
		// receive the mouseleave once the window is click-through).
		const unlistenNotchPointerLeft = listen("notch-pointer-left", () => {
			releaseNotchHover();
		});

		const unlistenBloomOpenNotch = listen("bloom-open-notch", () => {
			openNotch(openingPanel());
		});

		const unlistenNotchCollapseOutside = listen("notch-collapse-outside", () => {
			if (bloomModeRef.current === "notification") {
				dismissActiveNotificationRef.current();
			} else if (isOpenRef.current) {
				if (!notchCloseOutsideRef.current) return;
				panelCycleStepRef.current = 0;
				notchPinnedRef.current = false;
				releaseDeferredRef.current = false;
				setIsHovered(false);
				setIsNotchHovered(false);
				closeAndCollapseNotchRef.current();
			} else {
				setIsHovered(false);
				setIsNotchHovered(false);
				releaseNotchHover();
			}
		});

		const handleGlobalKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (bloomModeRef.current === "wifi" || bloomModeRef.current === "bluetooth") {
					setBloomMode("command-center");
				} else if (isOpenRef.current) {
					closeAndCollapseNotchRef.current();
				}
			}
		};
		window.addEventListener("keydown", handleGlobalKeyDown);

		return () => {
			window.removeEventListener("keydown", handleGlobalKeyDown);
			unlistenVisibility.then((f) => f());
			unlistenNotchOverlap.then((f) => f());
			unlistenNotchEdgeHover.then((f) => f());
			unlistenNotchPointerLeft.then((f) => f());
			unlistenBloomOpenNotch.then((f) => f());
			unlistenNotchCollapseOutside.then((f) => f());
			document.removeEventListener("contextmenu", preventContext);
		};
	}, [windowLabel]);

	// Ensure Bloom window is Win32 foreground when an input is focused
	useEffect(() => {
		const handleFocusIn = (e: FocusEvent) => {
			const target = e.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.isContentEditable)
			) {
				invoke("focus_notch_input", { focus: true }).catch(() => {});
			}
		};
		document.addEventListener("focusin", handleFocusIn);
		return () => {
			document.removeEventListener("focusin", handleFocusIn);
		};
	}, []);

	// Settings sync — consolidated dispatch for all settings events
	useSettingsSync(
		{
			"bloom-weather-enabled": setSettingsWeatherEnabled,
			"bloom-calendar-enabled": setSettingsCalendarEnabled,
			"bloom-timer-sound-enabled": setSettingsTimerSoundEnabled,
			"bloom-timer-presets": (v: unknown) => {
				try {
					const parsed = typeof v === "string" ? JSON.parse(v) : v;
					if (Array.isArray(parsed) && parsed.length > 0) {
						const nums = parsed.map(Number).filter((n) => !isNaN(n) && n > 0);
						if (nums.length > 0) setTimerPresets(nums);
					}
				} catch {}
			},
			"bloom-music-mode-enabled": setSettingsMusicModeEnabled,
			"bloom-notch-remember-panel": (v: unknown) => {
				const val = typeof v === "boolean" ? v : v !== "false";
				setRememberPanelEnabled(val);
				rememberPanelEnabledRef.current = val;
				localStorage.setItem("bloom-notch-remember-panel", String(val));
			},
			"bloom-notch-default-panel": (v: unknown) => {
				const p = asNotchPanel(v) ?? "command-center";
				setDefaultPanel(p);
				localStorage.setItem("bloom-notch-default-panel", p);
			},
			"bloom-shelf-persist": setShelfPersist,
			"bloom-music-compact-notch": setSettingsMusicCompactNotch,
			"bloom-notch-last-panel": (v: unknown) => setLastPanel(asNotchPanel(v)),
			"bloom-media-visualizer-enabled": setSettingsVisualizerEnabled,
			"bloom-visualizer-enabled": setSettingsVisualizerEnabled,
			"bloom-media-album-art-enabled": setSettingsAlbumArtEnabled,
			"bloom-media-ambience-enabled": setSettingsAmbienceEnabled,
			"bloom-media-compact-glow-enabled": setSettingsCompactGlowEnabled,
			"bloom-media-layout": setMediaLayout,
			"bloom-corners-enabled": setSettingsCornersEnabled,
			"bloom-scale": setScale,
			"bloom-low-battery-threshold": setLowBatteryThreshold,
			"bloom-dock-enabled": setDockEnabled,
			"bloom-dock-mode": setDockMode,
			"bloom-notch-mode": setNotchMode,
			"bloom-status-widgets": (value) => {
				try {
					const parsed = JSON.parse(value);
					if (parsed && Array.isArray(parsed.left) && Array.isArray(parsed.right)) {
						setStatusWidgets(parsed);
					}
				} catch {}
			},
			"bloom-show-update-indicator": (value) => setShowUpdateIndicator(String(value) === "true"),
			"bloom-time-format-24h": setTimeFormat24h,
			"bloom-notch-offset-y": (v: unknown) => {
				const val = Number(v) || 0;
				setNotchOffsetY(val);
				localStorage.setItem("bloom-notch-offset-y", String(val));
			},
			"bloom-notch-width-offset": (v: unknown) => {
				const val = Number(v) || 0;
				setNotchWidthOffset(val);
				localStorage.setItem("bloom-notch-width-offset", String(val));
			},
			"bloom-notch-corner-radius": (v: unknown) => {
				const val = Number(v) || 18;
				setNotchCornerRadius(val);
				localStorage.setItem("bloom-notch-corner-radius", String(val));
			},
			"bloom-notch-close-outside": (v: unknown) => {
				const val = v === true || v === "true";
				setNotchCloseOutside(val);
				notchCloseOutsideRef.current = val;
				localStorage.setItem("bloom-notch-close-outside", String(val));
			},
			"bloom-notch-protect-startmenu": (v: unknown) => {
				const val = v === true || v === "true";
				setNotchProtectStartMenu(val);
				notchProtectStartMenuRef.current = val;
				localStorage.setItem("bloom-notch-protect-startmenu", String(val));
			},
			"bloom-notch-fullscreen-disable": (v: unknown) => {
				const val = v === true || v === "true";
				setNotchFullscreenDisable(val);
				notchFullscreenDisableRef.current = val;
				localStorage.setItem("bloom-notch-fullscreen-disable", String(val));
			},
			"bloom-intercept-notifications": (v: unknown) => {
				const val = v === true || v === "true";
				setInterceptNotifications(val);
				interceptNotificationsRef.current = val;
				localStorage.setItem("bloom-intercept-notifications", String(val));
			},
			"bloom-notif-duration": (v: unknown) => {
				const val = Number(v) || 6;
				setNotifDuration(val);
				notifDurationRef.current = val;
				localStorage.setItem("bloom-notif-duration", String(val));
			},
			"bloom-notif-sound": (v: unknown) => {
				const val = v === true || v === "true";
				setNotifSound(val);
				notifSoundRef.current = val;
				localStorage.setItem("bloom-notif-sound", String(val));
			},
			"bloom-notif-quick-reply": (v: unknown) => {
				const val = v === true || v === "true";
				setNotifQuickReply(val);
				notifQuickReplyRef.current = val;
				localStorage.setItem("bloom-notif-quick-reply", String(val));
			},
			"bloom-notif-cat-messages": (v: unknown) => {
				const val = v === true || v === "true";
				setNotifCatMessages(val);
				notifCatMessagesRef.current = val;
				localStorage.setItem("bloom-notif-cat-messages", String(val));
			},
			"bloom-notif-cat-alarms": (v: unknown) => {
				const val = v === true || v === "true";
				setNotifCatAlarms(val);
				notifCatAlarmsRef.current = val;
				localStorage.setItem("bloom-notif-cat-alarms", String(val));
			},
			"bloom-notif-cat-calls": (v: unknown) => {
				const val = v === true || v === "true";
				setNotifCatCalls(val);
				notifCatCallsRef.current = val;
				localStorage.setItem("bloom-notif-cat-calls", String(val));
			},
			"bloom-notif-cat-system": (v: unknown) => {
				const val = v === true || v === "true";
				setNotifCatSystem(val);
				notifCatSystemRef.current = val;
				localStorage.setItem("bloom-notif-cat-system", String(val));
			},
			"bloom-notif-history-limit": (v: unknown) => {
				const val = Number(v) || 20;
				setNotifHistoryLimit(val);
				notifHistoryLimitRef.current = val;
				localStorage.setItem("bloom-notif-history-limit", String(val));
			}
		},
		[windowLabel]
	);

	// One owner applies the latest window settings. Superseded splash timers and
	// retries are cancelled; an in-flight command finishes before the new state
	// is applied, so an old startup retry cannot overwrite a user change.
	useEffect(() => {
		if (windowLabel !== "main" || !systemSettingsReady) return;

		let cancelled = false;
		let started = false;
		let attempts = 0;
		let startTimer: number | undefined;
		let splashTimer: number | undefined;
		let retryTimer: number | undefined;
		let settleTimer: number | undefined;
		let unlistenSplash: (() => void) | undefined;

		const reconcile = () => {
			systemSyncQueue.current = systemSyncQueue.current
				.catch(() => {})
				.then(async () => {
					if (cancelled) return;
					try {
						if (dockEnabled) {
							if (!appliedDock.current?.enabled) {
								await invoke("init_dock", { mode: dockMode });
								appliedDock.current = { enabled: true, mode: dockMode };
							} else if (appliedDock.current.mode !== dockMode) {
								await invoke("change_dock_mode", { mode: dockMode });
								appliedDock.current = { enabled: true, mode: dockMode };
							}
						} else if (appliedDock.current?.enabled !== false) {
							await invoke("toggle_dock", { enable: false });
							appliedDock.current = { enabled: false, mode: dockMode };
						}
						if (cancelled) return;
						if (appliedNotchMode.current !== notchMode) {
							await invoke("change_notch_mode", { mode: notchMode });
							appliedNotchMode.current = notchMode;
						}
						if (cancelled) return;
						await invoke("sync_appbar");
						if (cancelled) return;
						const wasInitialSync = !initialSystemSyncDone.current;
						initialSystemSyncDone.current = true;
						if (wasInitialSync) {
							settleTimer = window.setTimeout(() => {
								if (!cancelled) {
									systemSyncQueue.current = systemSyncQueue.current
										.catch(() => {})
										.then(() => invoke<void>("sync_appbar"))
										.catch((error) => console.error("AppBar settle failed", error));
								}
							}, 1000);
						}
					} catch (error) {
						console.error("Window reconciliation failed", error);
						if (!cancelled && attempts++ < 1) {
							retryTimer = window.setTimeout(reconcile, 1000);
						}
					}
				});
		};

		const start = () => {
			if (cancelled || started) return;
			started = true;
			splashDone.current = true;
			if (splashTimer !== undefined) window.clearTimeout(splashTimer);
			unlistenSplash?.();
			startTimer = window.setTimeout(reconcile, 0);
		};

		if (waitForStartupSplash && !splashDone.current && !initialSystemSyncDone.current) {
			void listen("splash-done", start)
				.then((unlisten) => {
					if (cancelled || started) unlisten();
					else unlistenSplash = unlisten;
				})
				.catch(() => start());
			splashTimer = window.setTimeout(start, 6000);
		} else {
			start();
		}

		return () => {
			cancelled = true;
			for (const timer of [startTimer, splashTimer, retryTimer, settleTimer]) {
				if (timer !== undefined) window.clearTimeout(timer);
			}
			unlistenSplash?.();
		};
	}, [windowLabel, systemSettingsReady, waitForStartupSplash, dockEnabled, dockMode, notchMode]);



	useEffect(() => {
		if (windowLabel === "main") {
			invoke("set_notch_is_open", { open: isOpen || bloomMode === "notification" }).catch(() => {});
			reportNotchRect.current?.();
		}
	}, [isOpen, bloomMode, windowLabel]);

	const dismissActiveNotification = useCallback(() => {
		if (notifTimeoutRef.current) {
			clearTimeout(notifTimeoutRef.current);
			notifTimeoutRef.current = null;
		}
		if (notifResumeTimeoutRef.current) {
			clearTimeout(notifResumeTimeoutRef.current);
			notifResumeTimeoutRef.current = null;
		}
		setActiveNotification(null);
		setNotifReplyOpen(false);
		setNotifReplyText("");
		if (bloomModeRef.current === "notification") {
			setIsOpen(prevOpenBeforeNotifRef.current);
			setBloomMode(prevModeBeforeNotifRef.current);
		}
	}, []);
	dismissActiveNotificationRef.current = dismissActiveNotification;

	const [notifReplyOpen, setNotifReplyOpen] = useState(false);
	const [notifReplyText, setNotifReplyText] = useState("");

	const handleSendNotificationReply = useCallback(async () => {
		if (!activeNotification || !notifReplyText.trim()) return;
		try {
			await invoke("submit_notification_reply", {
				appName: activeNotification.app_name,
				replyText: notifReplyText.trim()
			});
			await invoke("dismiss_notification", { id: activeNotification.id });
		} catch (e) {
			console.error("Failed to submit notification reply:", e);
		}
		setNotifReplyOpen(false);
		setNotifReplyText("");
		dismissActiveNotification();
	}, [activeNotification, notifReplyText, dismissActiveNotification]);

	const handleNotifPointerEnter = useCallback(() => {
		if (notifTimeoutRef.current) {
			clearTimeout(notifTimeoutRef.current);
			notifTimeoutRef.current = null;
		}
		if (notifResumeTimeoutRef.current) {
			clearTimeout(notifResumeTimeoutRef.current);
			notifResumeTimeoutRef.current = null;
		}
	}, []);

	const handleNotifPointerLeave = useCallback(() => {
		if (notifReplyOpen) return; // Keep open while typing reply
		if (notifResumeTimeoutRef.current) {
			clearTimeout(notifResumeTimeoutRef.current);
		}
		notifResumeTimeoutRef.current = setTimeout(() => {
			dismissActiveNotification();
		}, 3500);
	}, [dismissActiveNotification, notifReplyOpen]);

	const handleNotificationAction = useCallback(
		(action: string) => {
			if (!activeNotification) return;
			invoke("frontend_debug", { msg: `[NOTIF-ACTION] action=${action}, app=${activeNotification.app_name}` }).catch(() => {});
			const lower = action.toLowerCase();
			if (lower === "reply") {
				setNotifReplyOpen(true);
				invoke("focus_notch_input", { focus: true }).catch(() => {});
				return;
			}
			if (lower === "snooze") {
				invoke("snooze_notification", { data: activeNotification, snoozeMinutes: 5 }).catch(() => {});
				dismissActiveNotification();
				return;
			}
			const isActionOpen = lower === "open" || lower === "view" || lower === "accept" || lower === "join" || lower === "answer";
			if (isActionOpen && activeNotification.app_name) {
				invoke("focus_app_by_name", { appName: activeNotification.app_name }).catch(() => {});
			}
			invoke("dismiss_notification", { id: activeNotification.id }).catch(() => {});
			setNotifReplyOpen(false);
			setNotifReplyText("");
			dismissActiveNotification();
		},
		[activeNotification, dismissActiveNotification]
	);

	// Notification Center history list
	const [notificationsList, setNotificationsList] = useState<NotificationItem[]>(() => {
		try {
			const saved = localStorage.getItem("bloom-notifications-history");
			if (saved) {
				const parsed = JSON.parse(saved);
				if (Array.isArray(parsed)) return parsed;
			}
		} catch {}
		return [];
	});

	useEffect(() => {
		try {
			localStorage.setItem("bloom-notifications-history", JSON.stringify(notificationsList.slice(0, 50)));
		} catch {}
	}, [notificationsList]);

	useEffect(() => {
		invoke<NotificationItem[]>("get_active_notifications")
			.then((active) => {
				if (active && active.length > 0) {
					setNotificationsList((prev) => {
						const existingIds = new Set(prev.map((n) => n.id));
						const newOnes = active.filter((n) => !existingIds.has(n.id));
						return [...newOnes, ...prev].slice(0, 50);
					});
				}
			})
			.catch(() => {});
	}, []);

	const handleClearAllNotifications = useCallback(() => {
		invoke("clear_all_notifications").catch(() => {});
		setNotificationsList([]);
	}, []);

	const handleDismissNotificationItem = useCallback(
		(id: number) => {
			invoke("dismiss_notification", { id }).catch(() => {});
			setNotificationsList((prev) => prev.filter((n) => n.id !== id));
			if (activeNotification?.id === id) {
				dismissActiveNotification();
			}
		},
		[activeNotification, dismissActiveNotification]
	);

	const handleOpenNotificationItem = useCallback(
		(item: NotificationItem) => {
			if (item.app_name) {
				invoke("focus_app_by_name", { appName: item.app_name }).catch(() => {});
			}
			invoke("dismiss_notification", { id: item.id }).catch(() => {});
			setNotificationsList((prev) => prev.filter((n) => n.id !== item.id));
			if (activeNotification?.id === item.id) {
				dismissActiveNotification();
			}
		},
		[activeNotification, dismissActiveNotification]
	);

	useEffect(() => {
		const unlistenPromise = listen<NotificationItem>("bloom-new-notification", (event) => {
			if (!interceptNotificationsRef.current) return;
			const data = event.payload;
			invoke("frontend_debug", { msg: `Event bloom-new-notification received in window '${windowLabel}'! dndActive=${dndActiveRef.current}, payload=${JSON.stringify(data)}` }).catch(() => {});
			if (!data || (!data.title && !data.body)) return;

			const cat = data.category || "general";
			if (cat === "message" && !notifCatMessagesRef.current) return;
			if (cat === "alarm" && !notifCatAlarmsRef.current) return;
			if (cat === "call" && !notifCatCallsRef.current) return;
			if (cat === "system" && !notifCatSystemRef.current) return;

			const maxHistory = notifHistoryLimitRef.current || 20;
			setNotificationsList((prev) => [data, ...prev.filter((n) => n.id !== data.id)].slice(0, maxHistory));

			// If Do Not Disturb is active, save to history silently without popping out
			if (dndActiveRef.current) {
				return;
			}

			if (bloomModeRef.current !== "notification") {
				prevModeBeforeNotifRef.current = bloomModeRef.current;
				prevOpenBeforeNotifRef.current = isOpenRef.current;
			}

			setActiveNotification(data);
			setBloomMode("notification");
			setInteractionState("active");

			// Play subtle Dynamic Island notification chime only if sound enabled
			if (notifSoundRef.current) {
				playNotificationChime();
			}

			if (notchMode === "peek") {
				triggerEventPeek(8000);
			}

			setTimeout(() => {
				reportNotchRect.current?.();
			}, 20);

			if (notifTimeoutRef.current) {
				clearTimeout(notifTimeoutRef.current);
			}
			if (notifResumeTimeoutRef.current) {
				clearTimeout(notifResumeTimeoutRef.current);
			}
			const durationSec = notifDurationRef.current || 6;
			if (durationSec > 0) {
				notifTimeoutRef.current = setTimeout(() => {
					dismissActiveNotification();
				}, durationSec * 1000);
			}
		});

		return () => {
			unlistenPromise.then((unlisten) => unlisten());
			if (notifTimeoutRef.current) {
				clearTimeout(notifTimeoutRef.current);
			}
			if (notifResumeTimeoutRef.current) {
				clearTimeout(notifResumeTimeoutRef.current);
			}
		};
	}, [notchMode, triggerEventPeek, dismissActiveNotification]);

	// Shelf: files and selected text stashed in the notch via drag-and-drop.
	// Files are stored as plain paths (references, never copies). Session-scoped
	// by default; the bloom-shelf-persist setting keeps items across restarts.
	const [shelfItems, setShelfItems] = useState<ShelfItem[]>(() => {
		if (localStorage.getItem("bloom-shelf-persist") !== "true") return [];
		try {
			const saved = localStorage.getItem("bloom-shelf-items");
			const parsed = saved ? JSON.parse(saved) : [];
			if (!Array.isArray(parsed)) return [];
			return parsed
				.filter((i): i is ShelfItem => {
					if (typeof i?.id !== "string" || typeof i?.name !== "string") return false;
					// Items stored before text support have no `type`; treat as files.
					if (i.type === "text") return typeof i.text === "string";
					return typeof i.path === "string";
				})
				.map((i) => ({ ...i, type: i.type === "text" ? "text" : "file" }));
		} catch {
			return [];
		}
	});
	useEffect(() => {
		try {
			if (shelfPersist) {
				localStorage.setItem("bloom-shelf-items", JSON.stringify(shelfItems));
			} else {
				localStorage.removeItem("bloom-shelf-items");
			}
		} catch {
			/* storage full or unavailable — shelf just won't persist */
		}
	}, [shelfItems, shelfPersist]);

	// Drop file references whose files are gone (moved/deleted/drive unplugged)
	// once at startup, so a persisted shelf does not accumulate dead entries.
	// Text items are always kept.
	const shelfPrunedRef = useRef(false);
	useEffect(() => {
		if (shelfPrunedRef.current) return;
		shelfPrunedRef.current = true;
		const filePaths = shelfItems
			.filter((i) => i.type === "file" && i.path)
			.map((i) => i.path as string);
		if (filePaths.length === 0) return;
		invoke<string[]>("shelf_prune", { paths: filePaths })
			.then((existing) => {
				const alive = new Set(existing);
				setShelfItems((prev) => {
					const kept = prev.filter(
						(i) => i.type !== "file" || (i.path !== undefined && alive.has(i.path))
					);
					return kept.length === prev.length ? prev : kept;
				});
			})
			.catch(() => {});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Previews are generated lazily per path and cached. Images, PDFs, Office
	// files with a saved thumbnail, and anything Windows can thumbnail (videos,
	// folders...) show a picture; documents and text files show their opening
	// text; the rest fall back to an icon for their type. Text items render
	// their content.
	const [shelfThumbs, setShelfThumbs] = useState<Record<string, ShelfPreview>>({});
	const shelfThumbPending = useRef<Set<string>>(new Set());
	useEffect(() => {
		for (const item of shelfItems) {
			if (item.type !== "file" || !item.path) continue;
			const path = item.path;
			if (shelfThumbs[path] !== undefined || shelfThumbPending.current.has(path)) continue;
			shelfThumbPending.current.add(path);
			// The item may be removed while this is in flight; don't resurrect
			// a stale cache entry.
			const storeThumb = (preview: ShelfPreview) =>
				setShelfThumbs((prev) => {
					if (!shelfItemsRef.current.some((i) => i.path === path)) return prev;
					return { ...prev, [path]: preview };
				});
			invoke<ShelfPreview>("shelf_thumbnail", { path })
				.then(storeThumb)
				.catch(() => storeThumb({ thumb: null, text: null, folder: false }))
				.finally(() => shelfThumbPending.current.delete(path));
		}
	}, [shelfItems, shelfThumbs]);

	// Drop cached thumbnails for items that left the shelf so the cache cannot
	// grow without bound over a long session (each entry is a data URI).
	useEffect(() => {
		const current = new Set(shelfItems.filter((i) => i.path).map((i) => i.path as string));
		setShelfThumbs((prev) => {
			const keys = Object.keys(prev);
			if (keys.every((k) => current.has(k))) return prev;
			const next: Record<string, ShelfPreview> = {};
			for (const k of keys) {
				if (current.has(k)) next[k] = prev[k];
			}
			return next;
		});
	}, [shelfItems]);

	// Native drag preview for items without a thumbnail.
	const [shelfDragIcon, setShelfDragIcon] = useState<string | null>(null);
	useEffect(() => {
		invoke<string | null>("shelf_drag_icon")
			.then(setShelfDragIcon)
			.catch(() => {});
	}, []);

	// Picking a file back up is a drag-out gesture: press, move past a small
	// threshold, and the OS takes over the drag. A press without movement is a
	// plain click that opens the file (or copies text items).
	const shelfPointerRef = useRef<{ id: string; x: number; y: number; dragging: boolean } | null>(
		null
	);
	// Timestamp of the last drop onto the notch. A drop recorded during our
	// own drag-out means the item came back to the notch (pointer still over
	// it), which decides whether the drag cleanup clears the hover flags.
	const shelfSelfDropAtRef = useRef(0);
	// True while our own drag-out is running, so the drag-enter we receive when
	// it starts over the notch does not flash the hover outline or re-open it.
	const shelfSelfDragRef = useRef(false);
	const handleShelfPointerDown = (e: React.PointerEvent<HTMLDivElement>, item: ShelfItem) => {
		if (e.button !== 0) return;
		// Text items have no native drag-out; a click copies them.
		if (item.type !== "file" || !item.path) return;
		// The remove button must keep receiving its own click; capturing the
		// pointer on the tile would retarget it.
		if ((e.target as HTMLElement).closest(".shelf-tile-remove")) return;
		e.stopPropagation();
		e.currentTarget.setPointerCapture(e.pointerId);
		shelfPointerRef.current = { id: item.id, x: e.clientX, y: e.clientY, dragging: false };
	};
	const handleShelfPointerMove = (e: React.PointerEvent<HTMLDivElement>, item: ShelfItem) => {
		const st = shelfPointerRef.current;
		if (!st || st.id !== item.id || st.dragging) return;
		if (Math.hypot(e.clientX - st.x, e.clientY - st.y) < 6) return;
		if (!item.path) return;
		const path = item.path;
		const icon = shelfThumbs[path]?.thumb ?? shelfDragIcon;
		if (!icon) return;
		st.dragging = true;
		// Picking an item up is a deliberate act; don't let the post-drop
		// auto-close fire mid-drag.
		clearShelfCollapse();
		shelfSelfDragRef.current = true;
		const dragStartedAt = Date.now();
		startDrag({ item: [path], icon })
			.catch((err) => console.error("[shelf] drag out failed:", path, err))
			.finally(() => {
				shelfSelfDragRef.current = false;
				// A drop recorded during this drag means it landed back on the
				// notch, so the pointer is still over it. Otherwise the native
				// drag owned the pointer and the webview never saw it leave —
				// release the hover state (flags AND the resting mode) or the
				// shelf panel stays expanded. The command also makes the
				// backend re-evaluate its edge-hover state immediately.
				const droppedOnSelf = shelfSelfDropAtRef.current >= dragStartedAt;
				if (!droppedOnSelf) {
					releaseNotchHover();
					invoke("set_notch_hovered", { hovered: false }).catch(() => {});
				}
			});
	};
	const handleShelfTileClick = (e: React.MouseEvent<HTMLDivElement>, item: ShelfItem) => {
		e.stopPropagation();
		const st = shelfPointerRef.current;
		shelfPointerRef.current = null;
		// Only this tile's own drag suppresses the click; a stale flag from a
		// previous tile's drag-out must not swallow it.
		if (st && st.id === item.id && st.dragging) return;
		openShelfItem(item);
	};

	// Wheel scrolling for the shelf strip: ease towards a target instead of
	// jumping, so wheel and trackpad input both feel fluid.
	const shelfScrollTargetRef = useRef<number | null>(null);
	const shelfGridRef = useRef<HTMLDivElement>(null);
	// Whether the shelf row overflows, so it gets room for its scrollbar.
	const [shelfOverflowing, setShelfOverflowing] = useState(false);
	// Measured against the open shelf's width (380px minus its 14px side
	// padding) rather than the live one, which is still growing while the
	// notch animates open. A removed tile stays in the row until its exit
	// animation ends, so the row is measured again then.
	const measureShelfOverflow = useCallback(() => {
		const el = shelfGridRef.current;
		setShelfOverflowing(!!el && el.scrollWidth > 380 - 28 + 1);
	}, []);
	useLayoutEffect(measureShelfOverflow, [shelfItems, bloomMode, measureShelfOverflow]);
	const shelfScrollRafRef = useRef<number | null>(null);
	// The wheel scrolls the row from anywhere over the shelf view, not just
	// over the tiles. Mice that report lines instead of pixels are scaled up.
	const handleShelfWheel = (e: React.WheelEvent<HTMLDivElement>) => {
		const el = shelfGridRef.current;
		if (!el) return;
		const max = el.scrollWidth - el.clientWidth;
		if (max <= 0) return;
		const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? el.clientWidth : 1;
		const base = shelfScrollTargetRef.current ?? el.scrollLeft;
		shelfScrollTargetRef.current = Math.max(0, Math.min(max, base + (e.deltaY + e.deltaX) * unit));
		if (shelfScrollRafRef.current !== null) return;
		const step = () => {
			const target = shelfScrollTargetRef.current;
			if (target === null) {
				shelfScrollRafRef.current = null;
				return;
			}
			const diff = target - el.scrollLeft;
			if (Math.abs(diff) < 0.5) {
				el.scrollLeft = target;
				shelfScrollTargetRef.current = null;
				shelfScrollRafRef.current = null;
				return;
			}
			const before = el.scrollLeft;
			el.scrollLeft += diff * 0.22;
			// At fractional display scales a small step can round back to the
			// same position; finish the move instead of stalling short of it.
			if (el.scrollLeft === before) {
				el.scrollLeft = target;
				shelfScrollTargetRef.current = null;
				shelfScrollRafRef.current = null;
				return;
			}
			shelfScrollRafRef.current = requestAnimationFrame(step);
		};
		shelfScrollRafRef.current = requestAnimationFrame(step);
	};

	// The shelf closes itself shortly after a drop so the notch does not stay
	// expanded. Hovering it cancels the timer; leaving collapses it.
	const shelfCollapseTimer = useRef<number | null>(null);
	// What the collapsed notch shows (see collapsedMode). Refs let the drop
	// listener and the backend pointer-left event, both mounted once, act on
	// the current state.
	const restingModeRef = useRef<BloomMode>("status");
	const rememberPanelRef = useRef<(panel: NotchPanel) => void>(() => {});
	const notchPinnedRef = useRef(false);
	const releaseDeferredRef = useRef(false);

	// Shared hover-release, called on DOM hover end and when the backend
	// reports the pointer left the (now click-through) notch window. Closes an
	// open notch, remembering its panel, and returns to the resting mode.
	const releaseNotchHover = () => {
		// A view being typed into (a Wi-Fi password) keeps the notch open; the
		// release happens once it lets go, if the pointer is still away.
		if (notchPinnedRef.current) {
			releaseDeferredRef.current = true;
			return;
		}
		setIsHovered(false);
		setIsNotchHovered(false);
		if (isOpenRef.current) {
			// Deliberately opened panel stays open until user clicks outside or explicitly closes it
			return;
		}
		setBloomMode((prev) =>
			prev === "music" ||
			prev === "command-center" ||
			prev === "calendar" ||
			prev === "status" ||
			prev === "shelf" ||
			prev === "wifi" ||
			prev === "bluetooth"
				? restingModeRef.current
				: prev
		);
	};

	// Called by views that take typed input; see releaseNotchHover.
	const setNotchPinned = useCallback((pinned: boolean) => {
		notchPinnedRef.current = pinned;
		if (!pinned && releaseDeferredRef.current) {
			releaseDeferredRef.current = false;
			releaseNotchHover();
		}
		// releaseNotchHover only touches refs and state setters.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const clearShelfCollapse = () => {
		if (shelfCollapseTimer.current !== null) {
			window.clearTimeout(shelfCollapseTimer.current);
			shelfCollapseTimer.current = null;
		}
	};

	const collapseShelfSoon = (delay = 1800) => {
		clearShelfCollapse();
		shelfCollapseTimer.current = window.setTimeout(() => {
			shelfCollapseTimer.current = null;
			if (bloomModeRef.current !== "shelf") return;
			setIsOpen(false);
			setBloomMode(restingModeRef.current);
		}, delay);
	};

	const removeShelfItem = (id: string) => {
		const next = shelfItems.filter((i) => i.id !== id);
		setShelfItems(next);
		if (next.length === 0 && bloomMode === "shelf") {
			// Nothing left to show: an open notch moves to the remembered panel,
			// a closed one to its resting mode, instead of an empty shelf.
			clearShelfCollapse();
			setBloomMode(isOpen ? openingPanel() : restingModeRef.current);
		}
	};

	// A full shelf never evicts silently: whatever fits is added and the rest
	// is reported. Reads through a ref so the drop listener (mounted once) sees
	// the current list.
	const shelfItemsRef = useRef<ShelfItem[]>(shelfItems);
	shelfItemsRef.current = shelfItems;
	// Tiles that were just added get an entrance animation; ones restored when
	// the panel reopens do not (the panel itself already fades in).
	const shelfNewIdsRef = useRef<Set<string>>(new Set());
	const markShelfNew = (ids: string[]) => {
		for (const id of ids) shelfNewIdsRef.current.add(id);
		window.setTimeout(() => {
			for (const id of ids) shelfNewIdsRef.current.delete(id);
		}, 900);
	};
	const [shelfNotice, setShelfNotice] = useState<string | null>(null);
	const shelfNoticeTimer = useRef<number | null>(null);
	const showShelfNotice = (message: string) => {
		setShelfNotice(message);
		if (shelfNoticeTimer.current !== null) window.clearTimeout(shelfNoticeTimer.current);
		shelfNoticeTimer.current = window.setTimeout(() => {
			shelfNoticeTimer.current = null;
			setShelfNotice(null);
		}, 2600);
	};

	const addShelfItems = (paths: string[]) => {
		if (paths.length === 0) return;
		const prev = shelfItemsRef.current;
		const existing = new Set(prev.filter((i) => i.path).map((i) => i.path));
		const fresh: ShelfItem[] = [];
		for (const p of paths) {
			if (existing.has(p)) continue;
			existing.add(p);
			fresh.push({
				id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				type: "file",
				name: p.split("\\").pop()?.split("/").pop() || p,
				path: p,
				timestamp: Date.now()
			});
		}
		if (fresh.length === 0) return;

		const room = Math.max(0, SHELF_MAX_ITEMS - prev.length);
		if (room === 0) {
			showShelfNotice(`Shelf is full (${SHELF_MAX_ITEMS}) — remove an item first`);
			return;
		}
		if (fresh.length > room) {
			showShelfNotice(`Shelf is full — added ${room} of ${fresh.length} items`);
		}
		const added = fresh.slice(0, room);
		markShelfNew(added.map((i) => i.id));
		setShelfItems([...added, ...prev]);
	};

	const addShelfText = (text: string) => {
		const prev = shelfItemsRef.current;
		if (prev.some((i) => i.type === "text" && i.text === text)) return;
		if (prev.length >= SHELF_MAX_ITEMS) {
			showShelfNotice(`Shelf is full (${SHELF_MAX_ITEMS}) — remove an item first`);
			return;
		}
		const item: ShelfItem = {
			id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			type: "text",
			name: text.trim().replace(/\s+/g, " ").slice(0, 48),
			text,
			timestamp: Date.now()
		};
		markShelfNew([item.id]);
		setShelfItems([item, ...prev]);
	};

	// Files open in their default app; text items are copied to the clipboard
	// so they can be pasted anywhere. A file that no longer exists is reported
	// and dropped from the shelf.
	const openShelfItem = (item: ShelfItem) => {
		if (item.type === "text") {
			if (!item.text) return;
			writeText(item.text)
				.then(() => showShelfNotice("Copied to clipboard"))
				.catch((e) => console.error("[shelf] copy failed:", e));
			return;
		}
		if (item.path) {
			const path = item.path;
			invoke("shelf_open", { path }).catch(async (e) => {
				console.error("[shelf] open failed:", path, e);
				// Only a confirmed-missing file leaves the shelf; a transient
				// failure (e.g. no association) must not remove it.
				const alive = await invoke<string[]>("shelf_prune", { paths: [path] }).catch(() => null);
				if (alive && alive.length === 0) {
					showShelfNotice("File no longer exists — removed from shelf");
					removeShelfItem(item.id);
				} else {
					showShelfNotice("Couldn't open the file");
				}
			});
		}
	};

	// Shelf drag-and-drop plumbing. The backend registers its own OLE drop
	// target (src-tauri/src/shelf.rs) because wry's target can go stale when
	// WebView2 recreates its render child; it emits the shelf-drag-* events
	// below. Drag-enter switches to the shelf panel (restoring the previous
	// mode on cancel); drop stashes the real file paths.
	const [isDragHovering, setIsDragHovering] = useState(false);
	const shelfPrevModeRef = useRef<BloomMode>("status");
	const shelfPrevOpenRef = useRef(false);
	const shelfDragActiveRef = useRef(false);
	useEffect(() => {
		let unlisteners: (() => void)[] = [];
		let cancelled = false;

		const enter = (event: { payload: { paths?: string[]; text?: string } }) => {
			// Our own drag-out starts with the cursor over the notch; ignore
			// the enter it causes instead of flashing the hover state.
			if (shelfSelfDragRef.current) return;
			console.info("[shelf] drag-enter:", event.payload.paths ?? event.payload.text);
			setIsDragHovering(true);
			const prev = bloomModeRef.current;
			if (prev === "announcement" || prev === "shelf") return;
			shelfPrevModeRef.current = prev;
			shelfPrevOpenRef.current = isOpenRef.current;
			shelfDragActiveRef.current = true;
			setIsOpen(true);
			setBloomMode("shelf");
		};
		const leave = () => {
			setIsDragHovering(false);
			if (shelfDragActiveRef.current) {
				shelfDragActiveRef.current = false;
				if (bloomModeRef.current === "shelf") {
					setIsOpen(shelfPrevOpenRef.current);
					setBloomMode(shelfPrevModeRef.current);
				}
			}
		};
		const drop = (event: { payload: { paths?: string[]; text?: string } }) => {
			setIsDragHovering(false);
			shelfDragActiveRef.current = false;
			shelfSelfDropAtRef.current = Date.now();
			const paths = event.payload.paths ?? [];
			const text = event.payload.text;
			console.info("[shelf] drop:", paths.length > 0 ? paths : text);
			if (paths.length === 0 && !text) return;
			if (paths.length > 0) addShelfItems(paths);
			if (text) addShelfText(text);
			if (bloomModeRef.current !== "announcement") {
				setIsOpen(true);
				setBloomMode("shelf");
			}
			collapseShelfSoon();
		};

		Promise.all([
			listen<{ paths?: string[]; text?: string }>("shelf-drag-enter", enter),
			listen("shelf-drag-leave", leave),
			listen<{ paths?: string[]; text?: string }>("shelf-drag-drop", drop)
		])
			.then((fns) => {
				if (cancelled) {
					fns.forEach((fn) => fn());
				} else {
					unlisteners = fns;
				}
			})
			.catch((e) => console.error("[shelf] drag-drop listener failed:", e));

		invoke("setup_shelf_drop").catch((e) => console.error("[shelf] drop target setup failed:", e));

		return () => {
			cancelled = true;
			unlisteners.forEach((fn) => fn());
		};
	}, []);

	// Open the notch on an unseen announcement; stays open until dismissed.
	useEffect(() => {
		if (!announcement || announcementDismissed) return;
		if (announcementShownRef.current === announcement.id) return;
		announcementShownRef.current = announcement.id;
		setBloomMode("announcement");
		if (notchMode === "peek") triggerEventPeek(6000);
	}, [announcement, announcementDismissed, notchMode, triggerEventPeek]);

	// Leave the announcement view once it is dismissed (or gone).
	useEffect(() => {
		if (bloomMode === "announcement" && (!announcement || announcementDismissed)) {
			setBloomMode(mediaInfo.has_media && isPlaying ? "music" : "status");
		}
	}, [bloomMode, announcement, announcementDismissed, mediaInfo.has_media, isPlaying]);

	// Window height is now kept constant to prevent rendering layout lag and sharp corners

	const isScrollLockedRef = useRef(false);
	const scrollEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const handleWheel = (e: React.WheelEvent) => {
		const target = e.target as HTMLElement;
		if (
			target.closest(".shelf-content") ||
			target.closest(".qp-list")
		) {
			return;
		}

		// If user is inside the todo scroll list and it actually has vertical overflow to scroll:
		const todoScroll = target.closest(".todo-list-scroll") as HTMLElement | null;
		if (todoScroll && todoScroll.scrollHeight > todoScroll.clientHeight + 4) {
			const isVertical = Math.abs(e.deltaY) >= Math.abs(e.deltaX);
			if (isVertical) {
				const canScrollDown =
					e.deltaY > 0 &&
					todoScroll.scrollTop + todoScroll.clientHeight < todoScroll.scrollHeight - 2;
				const canScrollUp = e.deltaY < 0 && todoScroll.scrollTop > 2;
				if (canScrollDown || canScrollUp) {
					return;
				}
			}
		}

		// Ignore tiny movements / jitter
		const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
		if (Math.abs(delta) < 10) return;

		// Debounce the end of this scroll gesture:
		// Any continuous events extend the lock so that no matter how much the user scrolls,
		// the page only switches once per gesture.
		if (scrollEndTimerRef.current) {
			clearTimeout(scrollEndTimerRef.current);
		}
		scrollEndTimerRef.current = setTimeout(() => {
			isScrollLockedRef.current = false;
			scrollEndTimerRef.current = null;
		}, 500);

		if (isScrollLockedRef.current) {
			return;
		}

		// First event of this gesture: lock and switch page once
		isScrollLockedRef.current = true;
		cycleBloomMode(delta > 0 ? 1 : -1);
	};

	function panelAvailable(panel: NotchPanel) {
		if (panel === "calendar") return settingsCalendarEnabled;
		return true;
	}

	// Wheel and swipe navigate panels, even from a collapsed live activity.
	// Music and shelf remain entry points through their activity affordances.
	const cycleBloomMode = (direction: 1 | -1) => {
		if (bloomMode === "announcement" || bloomMode === "notification") return false;
		const panels = NOTCH_PANELS.filter(panelAvailable);
		const currentIndex = panels.indexOf(bloomMode as NotchPanel);
		const nextMode = currentIndex === -1
			? openingPanel()
			: panels[(currentIndex + direction + panels.length) % panels.length];
		setIsOpen(true);
		setBloomMode(nextMode);
		if (rememberPanelEnabled) {
			rememberPanel(nextMode);
		}
		return true;
	};

	// Arrows and wheel both stay within panels once one is open.
	const cyclePanel = (direction: 1 | -1) => {
		const panels = NOTCH_PANELS.filter(panelAvailable);
		const index = panels.indexOf(bloomMode as NotchPanel);
		if (index === -1 || panels.length < 2) return;
		const nextMode = panels[(index + direction + panels.length) % panels.length];
		panelCycleStepRef.current = 1;
		setBloomMode(nextMode);
		if (rememberPanelEnabled) {
			rememberPanel(nextMode);
		}
	};

	// Timer state
	const [timerSeconds, setTimerSeconds] = useState(0);
	const [isTimerRunning, setIsTimerRunning] = useState(false);
	const [isTimerFinished, setIsTimerFinished] = useState(false);
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
	const prevTimerFinishedRef = useRef(false);

	const formatTimerTime = (totalSeconds: number) => {
		const mins = Math.floor(Math.abs(totalSeconds) / 60);
		const secs = Math.abs(totalSeconds) % 60;
		return `${mins}:${secs.toString().padStart(2, "0")}`;
	};

	const resetTimer = () => {
		setIsTimerRunning(false);
		setTimerSeconds(0);
		setIsTimerFinished(false);
		timerEngine.resetTimer();
		timerEngine.dismissFinished();
	};

	// Synchronize with global TimerEngine (persists across collapse, panel switch, restart)
	useEffect(() => {
		const unsub = timerEngine.subscribe((engine: TimerEngineState) => {
			const pomoPhaseDuration =
				engine.pomoPhase === "focus"
					? engine.pomoFocusMins * 60
					: engine.pomoPhase === "shortBreak"
						? engine.pomoShortMins * 60
						: engine.pomoLongMins * 60;
			const isPomoActive =
				engine.isPomoRunning ||
				engine.isPomoFinished ||
				(engine.pomoSecondsLeft < pomoPhaseDuration && engine.pomoSecondsLeft > 0);

			const isTimerActive =
				engine.isTimerRunning ||
				engine.isTimerFinished ||
				(engine.timerSecondsLeft < engine.timerTotalSeconds && engine.timerSecondsLeft > 0);

			if (engine.activeTab === "pomodoro") {
				if (isPomoActive) {
					setTimerSeconds(engine.pomoSecondsLeft);
					setIsTimerRunning(engine.isPomoRunning);
					setIsTimerFinished(engine.isPomoFinished);
				} else if (isTimerActive) {
					setTimerSeconds(engine.timerSecondsLeft);
					setIsTimerRunning(engine.isTimerRunning);
					setIsTimerFinished(engine.isTimerFinished);
				} else {
					setTimerSeconds(0);
					setIsTimerRunning(false);
					setIsTimerFinished(false);
				}
			} else {
				if (isTimerActive) {
					setTimerSeconds(engine.timerSecondsLeft);
					setIsTimerRunning(engine.isTimerRunning);
					setIsTimerFinished(engine.isTimerFinished);
				} else if (isPomoActive) {
					setTimerSeconds(engine.pomoSecondsLeft);
					setIsTimerRunning(engine.isPomoRunning);
					setIsTimerFinished(engine.isPomoFinished);
				} else {
					setTimerSeconds(0);
					setIsTimerRunning(false);
					setIsTimerFinished(false);
				}
			}
		});
		return unsub;
	}, []);

	// Completion moment: chime once and reveal the notch in peek mode.
	useEffect(() => {
		if (isTimerFinished && !prevTimerFinishedRef.current) {
			if (settingsTimerSoundEnabled) playTimerChime();
			if (notchMode === "peek") triggerEventPeek(6000);
		}
		prevTimerFinishedRef.current = isTimerFinished;
	}, [isTimerFinished, settingsTimerSoundEnabled, notchMode, triggerEventPeek]);

	const lastTrackRef = useRef<string | null>(null);
	const lastPlayingRef = useRef<boolean>(false);
	const [musicActivityVisible, setMusicActivityVisible] = useState(false);

	// Keep a paused media session visible briefly so it can be resumed, then
	// clear its compact activity even if Windows retains the media session.
	useEffect(() => {
		if (!settingsMusicModeEnabled || !mediaInfo.has_media) {
			setMusicActivityVisible(false);
			return;
		}
		setMusicActivityVisible(true);
		if (isPlaying) return;
		const timeout = window.setTimeout(() => setMusicActivityVisible(false), 5000);
		return () => window.clearTimeout(timeout);
	}, [settingsMusicModeEnabled, mediaInfo.has_media, isPlaying]);

	// Like the Dynamic Island, the collapsed notch shows one live activity at a
	// time. Music fades a few seconds after playback stops. A set timer
	// (running, paused or just finished) takes the pill, and music then moves to
	// its own bubble beside it.
	const timerActive = timerSeconds > 0 || isTimerFinished;
	const musicActivity =
		settingsMusicModeEnabled && settingsMusicCompactNotch && mediaInfo.has_media && musicActivityVisible;
	const collapsedMode = musicActivity && !timerActive ? "music" : "status";
	const showMusicBubble = musicActivity && timerActive && !isOpen && isVisible && !isHidden;
	const showShelfBubble =
		shelfItems.length > 0 && !isOpen && isVisible && !isHidden && bloomMode !== "announcement";
	restingModeRef.current = collapsedMode;
	bloomModeRef.current = bloomMode;

	// Every expansion opens the command center (settings control panel) as the default first page.
	const openingPanel = (): NotchPanel => {
		return "command-center";
	};

	// Expands the notch into a panel, or into an activity's own view.
	const openNotch = (view: NotchPanel | "music" | "shelf") => {
		if (bloomMode === "announcement" || bloomMode === "notification") return;
		panelCycleStepRef.current = 1;
		setIsOpen(true);
		setBloomMode(view);
	};

	const rememberPanel = (panel: NotchPanel) => {
		if (panel === lastPanel) return;
		setLastPanel(panel);
		localStorage.setItem("bloom-notch-last-panel", panel);
		invoke("save_setting", { key: "bloom-notch-last-panel", value: panel }).catch(console.error);
	};
	rememberPanelRef.current = rememberPanel;

	// In peek mode, briefly show the notch when a new track starts or playback
	// resumes. The notch itself never switches views for media; the collapsed
	// pill follows the live-activity rule below.
	useEffect(() => {
		const isNewTrackWhilePlaying = mediaInfo.title !== lastTrackRef.current && isPlaying;
		const justStartedPlaying = isPlaying && !lastPlayingRef.current;

		// Peek notch on media events (play start or track change)
		if (notchMode === "peek" && (isNewTrackWhilePlaying || justStartedPlaying)) {
			triggerEventPeek(3000);
		}

		lastTrackRef.current = mediaInfo.title;
		lastPlayingRef.current = isPlaying;
	}, [isPlaying, mediaInfo.title, notchMode, triggerEventPeek]);

	// Reset bloom mode when calendar setting is disabled
	useEffect(() => {
		if (!settingsCalendarEnabled && bloomMode === "calendar") {
			setBloomMode(isOpen ? openingPanel() : collapsedMode);
		}
	}, [settingsCalendarEnabled, bloomMode, isOpen]);

	// Leave the music view when music is turned off or the player ends its media
	// session: an open notch falls back to the remembered panel.
	useEffect(() => {
		if (bloomMode === "music" && !isOpen && !(settingsMusicModeEnabled && mediaInfo.has_media)) {
			setBloomMode(collapsedMode);
		}
	}, [settingsMusicModeEnabled, mediaInfo.has_media, bloomMode, isOpen]);

	// The collapsed notch always shows its current live activity: music while a
	// session exists, the timer (with music in its bubble) once one is set, and
	// the clock otherwise. An open notch is left alone.
	useEffect(() => {
		if (isOpen || announcementOpenRef.current || bloomMode === "notification") return;
		if ((bloomMode === "status" || bloomMode === "music") && bloomMode !== collapsedMode) {
			setBloomMode(collapsedMode);
		}
	}, [collapsedMode, bloomMode, isOpen]);

	// Update time
	useEffect(() => {
		const updateTime = () => {
			const now = new Date();
			setTime(
				now.toLocaleTimeString([], {
					hour: "2-digit",
					minute: "2-digit",
					second: isOpen ? "2-digit" : undefined,
					hour12: !timeFormat24h
				})
			);
			setCurrentDate(
				now.toLocaleDateString(undefined, {
					weekday: "short",
					month: "short",
					day: "numeric"
				})
			);
		};

		updateTime();
		const interval = setInterval(updateTime, 1000);

		return () => {
			clearInterval(interval);
		};
	}, [timeFormat24h, isOpen]);

	// Battery API
	useEffect(() => {
		let battery: any = null;

		const initBattery = async () => {
			try {
				battery = await (navigator as any).getBattery();

				const updateBattery = () => {
					setBatteryLevel(Math.round(battery.level * 100));
					setIsCharging(battery.charging);
				};

				updateBattery();

				battery.addEventListener("levelchange", updateBattery);
				battery.addEventListener("chargingchange", updateBattery);

				return () => {
					battery.removeEventListener("levelchange", updateBattery);
					battery.removeEventListener("chargingchange", updateBattery);
				};
			} catch (e) {
				// Battery API not supported
			}
		};

		initBattery();
	}, []);

	// Listen for Volume Changes
	useEffect(() => {
		const unlisten = listen<{ volume: number; is_muted: boolean }>("volume-change", (event) => {
			setVolume(event.payload.volume);
			setIsMuted(event.payload.is_muted);
		});
		return () => {
			unlisten.then((fn) => fn());
		};
	}, []);

	// Wi-Fi is a three-state control: Off, on-but-not-connected, Connected.
	// The radio state alone can't tell those apart, so get_wifi_status returns
	// both flags, plus the connected network's name. Returns false so the startup loader knows to retry.
	const refreshWifiStatus = useCallback(async (): Promise<boolean> => {
		try {
			setWifiStatus(await invoke<WifiStatus>("get_wifi_status"));
			return true;
		} catch {
			return false;
		}
	}, []);

	// Seed the Wi-Fi pill at startup. The first call can fail while the WLAN
	// service is still coming up, so retry instead of leaving the pill stuck on
	// its default.
	useEffect(() => {
		let cancelled = false;
		let retryTimer: ReturnType<typeof setTimeout> | undefined;
		const initializeWifiStatus = async (attempt: number) => {
			const loaded = await refreshWifiStatus();
			if (!loaded && !cancelled && attempt < 3) {
				retryTimer = setTimeout(() => void initializeWifiStatus(attempt + 1), (attempt + 1) * 1000);
			}
		};
		void initializeWifiStatus(0);
		return () => {
			cancelled = true;
			if (retryTimer) clearTimeout(retryTimer);
		};
	}, [refreshWifiStatus]);

	// Connected Bluetooth devices for the tile, refreshed whenever the backend
	// reports a device connecting, disconnecting, pairing or being removed.
	useEffect(() => {
		if (!bluetoothEnabled) {
			setBtConnectedNames([]);
			return;
		}
		const refresh = () =>
			invoke<{ name: string; connected: boolean }[]>("bluetooth_list_devices")
				.then((devices) =>
					setBtConnectedNames(devices.filter((d) => d.connected).map((d) => d.name))
				)
				.catch(() => {});
		let debounce: ReturnType<typeof setTimeout> | undefined;
		void refresh();
		const unlisten = listen("bluetooth-changed", () => {
			clearTimeout(debounce);
			debounce = setTimeout(() => void refresh(), 400);
		});
		return () => {
			clearTimeout(debounce);
			unlisten.then((f) => f());
		};
	}, [bluetoothEnabled]);

	// The backend reports connection changes and finished scans as they
	// happen, so the pill follows without waiting for the next poll.
	useEffect(() => {
		let debounce: ReturnType<typeof setTimeout> | undefined;
		const unlisten = listen("wifi-changed", () => {
			clearTimeout(debounce);
			debounce = setTimeout(() => void refreshWifiStatus(), 300);
		});
		return () => {
			clearTimeout(debounce);
			unlisten.then((f) => f());
		};
	}, [refreshWifiStatus]);

	// Load bluetooth/volume/brightness state on mount
	useEffect(() => {
		invoke<boolean>("get_bluetooth_state")
			.then(setBluetoothEnabled)
			.catch(() => {});
		invoke<boolean>("get_battery_saver_state")
			.then(setBatterySaverEnabled)
			.catch(() => {});
		invoke<{ volume: number; is_muted: boolean }>("get_volume_state")
			.then((state) => {
				setVolume(state.volume);
				setIsMuted(state.is_muted);
			})
			.catch(() => {});
		invoke<number>("get_brightness")
			.then(setCurrentBrightness)
			.catch(() => {});

		// Poll battery saver state every 5s (since we can't listen for changes)
		const interval = setInterval(() => {
			invoke<boolean>("get_battery_saver_state")
				.then(setBatterySaverEnabled)
				.catch(() => {});
		}, 5000);
		return () => clearInterval(interval);
	}, []);

	// Refresh Wi-Fi status while the command center is open so changes made
	// outside Bloom (keyboard toggle, Windows quick settings) show up.
	useEffect(() => {
		if (bloomMode !== "command-center") return;
		void refreshWifiStatus();
		const interval = setInterval(() => void refreshWifiStatus(), 5000);
		return () => clearInterval(interval);
	}, [bloomMode, refreshWifiStatus]);

	// Poll system metrics for status widgets
	useEffect(() => {
		const fetchMetrics = () => {
			invoke<number>("get_cpu_usage")
				.then(setCpuUsage)
				.catch((e) => console.warn("CPU:", e));
			invoke<number>("get_ram_usage")
				.then(setRamUsage)
				.catch((e) => console.warn("RAM:", e));
			invoke<number>("get_disk_space")
				.then(setDiskSpace)
				.catch((e) => console.warn("Disk:", e));
			invoke<[number, number]>("get_network_speed")
				.then(([up, down]) => {
					setNetUpSpeed(up);
					setNetDownSpeed(down);
				})
				.catch(() => {});
		};
		fetchMetrics();
		const interval = setInterval(fetchMetrics, 3000);
		return () => clearInterval(interval);
	}, []);

	// Listen for brightness changes
	useEffect(() => {
		const unlisten = listen<{ brightness: number }>("brightness-change", (event) => {
			setCurrentBrightness(event.payload.brightness);
		});
		return () => {
			unlisten.then((fn) => fn());
		};
	}, []);

	// Native Windows Media Controls - Listen for updates from background worker
	useEffect(() => {
		const unlisten = listen<MediaInfo>("media-update", (event) => {
			const info = event.payload;
			if (!info) return;

			setMediaInfo((prev) => {
				// Find if artwork changed by checking the first element
				const prevArt = prev.artwork?.[0];
				const nextArt = info.artwork?.[0];
				const artChanged = prevArt !== nextArt;

				if (
					prev.title === info.title &&
					prev.artist === info.artist &&
					prev.is_playing === info.is_playing &&
					prev.has_media === info.has_media &&
					!artChanged &&
					prev.position_ms === info.position_ms &&
					prev.duration_ms === info.duration_ms
				) {
					return prev;
				}

				// Update playing state separately for the hook triggers
				setIsPlaying(info.is_playing);

				if (info.artwork && info.artwork.length > 0) {
					const newArt = info.artwork[0];
					setAlbumArtUrl((prev) => {
						if (prev !== newArt) {
							setAlbumArtKey((k) => k + 1);
							return newArt;
						}
						return prev;
					});
				} else {
					setAlbumArtUrl(null);
				}

				return info;
			});
		});

		return () => {
			unlisten.then((fn) => fn());
		};
	}, []);

	// Media controls via Tauri commands
	/* Unused saveAndBroadcast removed to fix TS build error */
	const togglePlayPause = useCallback(async () => {
		try {
			await invoke("media_play_pause");
			setIsPlaying(!isPlaying);
		} catch (e) {
			console.error("Failed to toggle play/pause:", e);
		}
	}, [isPlaying]);

	const skipNext = useCallback(async () => {
		try {
			await invoke("media_next");
		} catch (e) {
			console.error("Failed to skip next:", e);
		}
	}, []);

	const skipPrevious = useCallback(async () => {
		try {
			await invoke("media_previous");
		} catch (e) {
			console.error("Failed to skip previous:", e);
		}
	}, []);

	// Slide-push animation for prev/next buttons
	const prevFront = useAnimation();
	const prevBack = useAnimation();
	const nextFront = useAnimation();
	const nextBack = useAnimation();

	const animatePrev = useCallback(async () => {
		prevFront.set({ x: 0 });
		prevBack.set({ x: 30 });
		prevFront.start({ x: -30, transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] } });
		await prevBack.start({ x: 0, transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] } });
		skipPrevious();
	}, [skipPrevious, prevFront, prevBack]);

	const animateNext = useCallback(async () => {
		nextFront.set({ x: 0 });
		nextBack.set({ x: -30 });
		nextFront.start({ x: 30, transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] } });
		await nextBack.start({ x: 0, transition: { duration: 0.18, ease: [0.4, 0, 0.2, 1] } });
		skipNext();
	}, [skipNext, nextFront, nextBack]);

	const sendVolume = useTrailingThrottle((newVol: number) => {
		invoke("set_volume", { volume: newVol }).catch(() => {});
	}, 50);

	const handleVolumeChange = useCallback(
		(newVol: number) => {
			setVolume(newVol);
			// set_volume unmutes for any non-zero level.
			setIsMuted(newVol === 0);
			sendVolume(newVol);
		},
		[sendVolume]
	);

	// WiFi toggle
	const toggleWifi = useCallback(async () => {
		const previous = wifiStatus;
		const newState = !(previous?.enabled ?? false);
		setWifiStatus({
			enabled: newState,
			connected: newState ? (previous?.connected ?? false) : false,
			ssid: newState ? (previous?.ssid ?? null) : null
		});
		try {
			await invoke("set_wifi_state", { enabled: newState });
			// The radio and association take a moment to settle.
			setTimeout(() => void refreshWifiStatus(), 800);
		} catch (e) {
			setWifiStatus(previous);
			console.error("Failed to toggle WiFi:", e);
		}
	}, [wifiStatus, refreshWifiStatus]);

	// Bluetooth toggle
	const toggleBluetooth = useCallback(async () => {
		const newState = !bluetoothEnabled;
		setBluetoothEnabled(newState);
		try {
			await invoke("set_bluetooth_state", { enabled: newState });
		} catch (e) {
			setBluetoothEnabled(!newState);
			console.error("Failed to toggle Bluetooth:", e);
		}
	}, [bluetoothEnabled]);

	// The notch never takes focus, and native `title` tooltips only show for an
	// active window, so the status widgets draw their own. A tooltip opens
	// after a tooltip-like delay, by which time the battery details fetched on
	// enter are in. Under the status strip it hangs below the pill; once the
	// notch is open the pill is the tall panel, so it sits beside the pill on
	// the widget's side instead, level with the widget.
	const showStatusTooltip = useCallback(
		(id: string, widget: HTMLElement) => {
			if (statusTooltipTimerRef.current) clearTimeout(statusTooltipTimerRef.current);
			statusTooltipTimerRef.current = setTimeout(() => {
				const pill = bloomRef.current?.getBoundingClientRect();
				const own = widget.getBoundingClientRect();
				// Client rects are zoomed by the notch scale; offsets are not.
				if (!pill) {
					setStatusTooltip({ id, side: "below", offset: 8 });
				} else if (!isOpen) {
					const gap = (pill.bottom - own.bottom) / scale;
					setStatusTooltip({ id, side: "below", offset: Math.max(0, gap) + 8 });
				} else if (own.left + own.width / 2 >= pill.left + pill.width / 2) {
					const gap = (pill.right - own.right) / scale;
					setStatusTooltip({ id, side: "right", offset: Math.max(0, gap) + 10 });
				} else {
					const gap = (own.left - pill.left) / scale;
					setStatusTooltip({ id, side: "left", offset: Math.max(0, gap) + 10 });
				}
			}, 400);
		},
		[scale, isOpen]
	);

	const hideStatusTooltip = useCallback(() => {
		if (statusTooltipTimerRef.current) clearTimeout(statusTooltipTimerRef.current);
		statusTooltipTimerRef.current = null;
		setStatusTooltip(null);
	}, []);

	// Widgets unmount when the notch collapses, without a mouse leave, and an
	// open card is placed for the notch's shape when it opened.
	useEffect(() => {
		hideStatusTooltip();
	}, [isHovered, isOpen, hideStatusTooltip]);

	// Both sides of the status strip get equal width around the centered
	// clock, so the notch must fit the clock plus twice the wider side. Widget
	// widths vary (network speed especially), so they are measured rather than
	// counted. The width only grows during a hover, so a live label getting
	// shorter doesn't make the notch jitter. Layout widths are unaffected by
	// the notch scale.
	useLayoutEffect(() => {
		if (!isHovered || isOpen) {
			if (statusFitWidth !== 0) setStatusFitWidth(0);
			return;
		}
		// offsetWidth, not scrollWidth: an open tooltip card overflows its
		// widget and must not widen the notch.
		const side = Math.max(
			leftWidgetsRef.current?.offsetWidth ?? 0,
			rightWidgetsRef.current?.offsetWidth ?? 0
		);
		const clock = timeCenterRef.current?.offsetWidth ?? 0;
		// The pill's 12px padding on each side, and a 10px gap to the clock.
		const needed = Math.ceil(clock + 2 * (side + 10) + 24);
		if (side > 0 && needed > statusFitWidth) setStatusFitWidth(needed);
	});

	const refreshBatteryDetails = useCallback(() => {
		invoke<BatteryDetails>("get_battery_details")
			.then(setBatteryDetails)
			.catch((err) => console.error("Failed to read battery details:", err));
	}, []);

	// Battery Saver - opens settings
	const openBatterySaverSettings = useCallback(async () => {
		try {
			await invoke("open_battery_saver_settings");
		} catch (e) {
			console.error("Failed to open Battery Saver settings:", e);
		}
	}, []);

	// Battery Saver - native direct toggle
	const toggleBatterySaver = useCallback(async () => {
		try {
			const next = !batterySaverEnabled;
			setBatterySaverEnabled(next);
			const res = await invoke<boolean>("set_battery_saver_state", { enabled: next });
			setBatterySaverEnabled(res);
		} catch (e) {
			console.error("Failed to toggle Battery Saver:", e);
		}
	}, [batterySaverEnabled]);

	// Brightness change with throttling
	const sendBrightness = useTrailingThrottle((newVal: number) => {
		invoke("set_brightness", { brightness: newVal }).catch(() => {});
	}, 50);

	const handleBrightnessChange = useCallback(
		(newVal: number) => {
			setCurrentBrightness(newVal);
			sendBrightness(newVal);
		},
		[sendBrightness]
	);

	// Open system tray (unhide taskbar and invoke Win+B)
	const openSystemTray = useCallback(async (e: React.MouseEvent) => {
		e.stopPropagation();
		try {
			await invoke("open_system_tray");
		} catch (e) {
			console.error("Failed to open system tray:", e);
		}
	}, []);

	const openSettingsWindow = useCallback(async () => {
		try {
			await invoke("open_settings_window");
		} catch (e) {
			console.error("Failed to open settings window:", e);
		}
	}, []);

	// Dock Mode and Notch Mode settings helpers
	const toggleDockModeSetting = useCallback(
		async (e: React.MouseEvent) => {
			e.stopPropagation();
			const nextMode = dockMode === "fixed" ? "smart" : dockMode === "smart" ? "peek" : "fixed";
			setDockMode(nextMode);
			localStorage.setItem("bloom-dock-mode", nextMode);
			invoke("save_setting", { key: "bloom-dock-mode", value: nextMode }).catch(console.error);
			try {
				await invoke("change_dock_mode", { mode: nextMode });
			} catch (err) {
				console.error("Failed to change dock mode:", err);
			}
		},
		[dockMode]
	);

	const toggleNotchModeSetting = useCallback(
		async (e: React.MouseEvent) => {
			e.stopPropagation();
			const nextMode = notchMode === "fixed" ? "smart" : notchMode === "smart" ? "peek" : "fixed";
			setNotchMode(nextMode);
			localStorage.setItem("bloom-notch-mode", nextMode);
			invoke("save_setting", { key: "bloom-notch-mode", value: nextMode }).catch(console.error);
			try {
				await invoke("change_notch_mode", { mode: nextMode });
			} catch (err) {
				console.error("Failed to change notch mode:", err);
			}
		},
		[notchMode]
	);

	const closeAndCollapseNotch = useCallback(() => {
		panelCycleStepRef.current = 0;
		const currentPanel = asNotchPanel(bloomMode);
		if (currentPanel && rememberPanelEnabled) {
			rememberPanel(currentPanel);
		}
		setIsOpen(false);
		setBloomMode(restingModeRef.current);
		invoke("focus_notch_input", { focus: false }).catch(() => {});
	}, [bloomMode, rememberPanelEnabled, rememberPanel]);
	closeAndCollapseNotchRef.current = closeAndCollapseNotch;

	const handleNotchCycleClick = (e: React.MouseEvent) => {
		e.stopPropagation();
		if (isTimerFinished) {
			resetTimer();
			return;
		}

		// The time/header is part of the notch: clicking it opens, cycles panels, or collapses
		if (!isOpen) {
			invoke("dismiss_start_menu").catch(() => {});
			openNotch(openingPanel());
			return;
		}

		const panels = NOTCH_PANELS.filter(panelAvailable);
		const totalPanels = panels.length;
		if (totalPanels <= 1) {
			closeAndCollapseNotch();
			return;
		}

		// Adaptive multi-panel cycle:
		// If user has stepped through all available panels, close and collapse
		if (panelCycleStepRef.current >= totalPanels) {
			closeAndCollapseNotch();
			return;
		}

		// Otherwise, advance to the next panel in sequence
		const currentIndex = panels.indexOf(bloomMode as NotchPanel);
		const targetMode: NotchPanel =
			currentIndex === -1
				? openingPanel()
				: panels[(currentIndex + 1) % totalPanels] || "command-center";

		panelCycleStepRef.current += 1;
		setBloomMode(targetMode);
		if (rememberPanelEnabled) {
			rememberPanel(targetMode);
		}
	};

	const toggleCalendarMode = handleNotchCycleClick;

	// Where a status tooltip card sits and how it slides in, by placement.
	const statusTooltipMotion = (side: "below" | "left" | "right", offset: number) => {
		if (side === "below") {
			return {
				style: { top: `calc(100% + ${offset}px)`, left: "50%" },
				hidden: { opacity: 0, x: "-50%", y: -4 },
				shown: { opacity: 1, x: "-50%", y: 0 }
			};
		}
		// Top-aligned with the widget rather than centered on it: the widgets
		// sit near the top of the screen, which would cut a centered card off.
		const nudge = side === "right" ? -4 : 4;
		return {
			style: { top: -8, [side === "right" ? "left" : "right"]: `calc(100% + ${offset}px)` },
			hidden: { opacity: 0, x: nudge, y: 0 },
			shown: { opacity: 1, x: 0, y: 0 }
		};
	};

	// A status widget with its tooltip card, which hangs outside the pill.
	const statusWidget = (
		id: string,
		tooltip: string,
		content: React.ReactNode,
		onEnter?: () => void
	) => (
		<div
			className="passive-feature"
			key={id}
			onMouseEnter={(e) => {
				onEnter?.();
				showStatusTooltip(id, e.currentTarget);
			}}
			onMouseLeave={hideStatusTooltip}
		>
			{content}
			<AnimatePresence>
				{statusTooltip?.id === id &&
					(() => {
						const placed = statusTooltipMotion(statusTooltip.side, statusTooltip.offset);
						return (
							<motion.div
								className="status-tooltip"
								style={placed.style}
								initial={placed.hidden}
								animate={placed.shown}
								exit={placed.hidden}
								transition={{ duration: 0.15 }}
							>
								{tooltip}
							</motion.div>
						);
					})()}
			</AnimatePresence>
		</div>
	);

	// Render a status widget by ID
	const renderStatusWidget = (id: string) => {
		switch (id) {
			case "weather":
				if (!settingsWeatherEnabled || temperature === null) return null;
				return statusWidget(
					"weather",
					cityName ? `${weatherCondition} — ${cityName}` : weatherCondition,
					<>
						<WeatherIcon size={12} strokeWidth={2.2} />
						<span className="label">
							{temperature}°{tempUnit === "fahrenheit" ? "F" : "C"}
						</span>
					</>
				);
			case "battery":
				return statusWidget(
					"battery",
					batteryTooltip(
						batteryDetails,
						{ level: batteryLevel, charging: isCharging },
						batterySaverEnabled
					),
					<>
						<BatteryIcon
							charging={isCharging}
							level={batteryLevel}
							threshold={lowBatteryThreshold}
						/>
						<span className="label">{batteryLevel}%</span>
					</>,
					refreshBatteryDetails
				);
			case "cpu":
				return statusWidget(
					"cpu",
					"CPU Usage",
					<>
						<Cpu size={12} strokeWidth={2} />
						<span className="label">{cpuUsage}%</span>
					</>
				);
			case "ram":
				return statusWidget(
					"ram",
					"RAM Usage",
					<>
						<MemoryStick size={12} strokeWidth={2} />
						<span className="label">{Math.round(ramUsage)}%</span>
					</>
				);
			case "disk":
				return statusWidget(
					"disk",
					"Free Disk Space",
					<>
						<HardDrive size={12} strokeWidth={2} />
						<span className="label">{diskSpace}GB</span>
					</>
				);
			case "net":
				return statusWidget(
					"net",
					"Network Speed",
					<>
						<ArrowUpDown size={12} strokeWidth={2} />
						<span className="label">
							↑{formatBytes(netUpSpeed)} ↓{formatBytes(netDownSpeed)}
						</span>
					</>
				);
			default:
				return null;
		}
	};

	const formatBytes = (bytes: number) => {
		if (bytes < 1024) return `${bytes}B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
		return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
	};

	// Music mode shows any time we have media info (playing or paused) and music mode setting is enabled
	const isMusicMode = mediaInfo.has_media && bloomMode === "music" && settingsMusicModeEnabled;
	// A media session remains reachable on hover after its activity fades, or
	// whenever the compact music display is disabled.
	const showMusicOnStatusHover =
		!isOpen && isHovered && bloomMode === "status" && settingsMusicModeEnabled &&
		mediaInfo.has_media && (!musicActivityVisible || !settingsMusicCompactNotch);
	const showCompactMusicIcons = isMusicMode || showMusicOnStatusHover;

	// The 24-hour clock is ~16px narrower than the 12-hour one.
	const clock24hTrim = timeFormat24h ? 16 : 0;

	// Calculate width dynamically based on enabled features
	const getDynamicWidth = () => {
		let w = 140 - clock24hTrim;
		if (activeRingingAlarm) w = 380;
		else if (bloomMode === "notification" && activeNotification) w = 410;
		else if (bloomMode === "notifications" && isOpen) w = 380;
		else if (bloomMode === "timers" && isOpen) w = 380;
		else if (bloomMode === "announcement" && announcement && !announcementDismissed) w = 380;
		else if (isCalendarMode && isOpen) w = 480;
		else if (bloomMode === "shelf") w = 380;
		else if (bloomMode === "command-center" && isOpen) w = 380;
		else if (bloomMode === "wifi" || bloomMode === "bluetooth") w = 350;
		else if ((bloomMode === "music" || isMusicMode) && isOpen) w = mediaLayout === "compact" ? 300 : 340;
		else if (bloomMode === "music" && !isOpen) {
			w = 140 - clock24hTrim;
			if (settingsVisualizerEnabled && isPlaying) w += 30;
			if (settingsAlbumArtEnabled) w += 30;
		}
		else if (showMusicOnStatusHover) {
			w = 170 + (settingsVisualizerEnabled ? 30 : 0);
		}
		else if (!isOpen && isHovered) {
			const totalWidgets = statusWidgets.left.length + statusWidgets.right.length;
			if (totalWidgets > 0) {
				w = Math.max(Math.min(220 + totalWidgets * 50, 480) - clock24hTrim, statusFitWidth);
			}
		}
		else if ((showPowerPulse || showLowBatteryPulse || showUpdatePulse) && !isHovered) {
			w = 200;
		} else if (isMusicMode) {
			if (settingsVisualizerEnabled && isPlaying) w += 30;
			if (settingsAlbumArtEnabled) w += 30;
		}

		return Math.max(100, Math.round(w + notchWidthOffset));
	};

	const getDynamicHeight = () => {
		if (activeRingingAlarm) return 120;
		if (bloomMode === "notification" && activeNotification) return notifReplyOpen ? 182 : 138;
		if (!isNotchActive && (!isExpanded || !isVisible || isHidden)) {
			return isImpacted ? 28.9 : 44.2;
		}
		// Announcement card: body is line-clamped, so a fixed size fits both cases.
		if (bloomMode === "announcement" && announcement && !announcementDismissed) {
			return announcement.url ? 168 : 148;
		}
		// Sized to the to-do list / timer content.
		if (bloomMode === "calendar") return isOpen ? 305 : 36;
		// Shelf expands on mode alone (no hover needed: there is no cursor
		// hover during an OS drag) and is sized to exactly one row of tiles,
		// plus room for the scrollbar once the tiles overflow it.
		if (bloomMode === "shelf") {
			if (shelfItems.length === 0) return 130;
			return shelfOverflowing ? 190 : 176;
		}
		if (bloomMode === "command-center") return isOpen ? 385 : 36;
		if (bloomMode === "notifications") return isOpen ? 310 : 36;
		if (bloomMode === "timers") return isOpen ? 340 : 36;
		if (bloomMode === "wifi" || bloomMode === "bluetooth") return 300;
		if (bloomMode === "status") return 36;
		if ((bloomMode === "music" || isMusicMode) && isOpen) {
			const hasProgressBar = (mediaInfo.duration_ms ?? 0) > 0;
			let h = mediaLayout === "compact" ? (hasProgressBar ? 132 : 116) : 120;
			if (mediaLayout === "compact") {
				if (compactVolumeExpanded) h += 36;
			}
			return h;
		}
		return 36;
	};

	const isCalendarMode = bloomMode === "calendar";
	// Arrows switch between the two tool panels; wheel/swipe can also open one
	// directly from the collapsed pill or a live activity.
	const showPanelArrows =
		isOpen && asNotchPanel(bloomMode) !== null && NOTCH_PANELS.filter(panelAvailable).length > 1;

	// Close compact media player expansions when notch is unhovered or mode changes
	useEffect(() => {
		if (mediaLayout === "compact") {
			setCompactVolumeExpanded(false);
		}
	}, [isHovered, mediaLayout, bloomMode]);

	// The pill's target geometry: the animation springs toward it, and the
	// window region below is cut from it, so the region is already at the
	// final size while the pill animates.
	const pillTargetY = !isReady
		? 250
		: isNotchActive
			? notchOffsetY
			: isVisible
				? (isHidden ? -100 : notchOffsetY)
				: -150;
	const pillTargetWidth = !isReady
		? 34
		: ((isExpanded && isVisible && !isHidden) || isNotchActive)
			? getDynamicWidth()
			: isImpacted
				? Math.max(30, 39.1 + notchWidthOffset)
				: Math.max(25, 30.6 + notchWidthOffset);
	const pillTargetHeight = !isReady ? 34 : getDynamicHeight();
	// Shadow and the edge flares beside the pill.
	pillTargetRef.current = notchPillBox(
		window.innerWidth,
		scale,
		pillTargetY,
		pillTargetWidth,
		pillTargetHeight,
		24
	);

	// Clip the notch window to what it draws (see window_region.rs): outside
	// these rectangles the window takes no clicks, whatever its click-through
	// state. Sent after every render, but only when the region changes.
	useEffect(() => {
		if (windowLabel === "main") updateNotchRegion();
	});

	useEffect(() => {
		if (bloomMode === "notification") {
			invoke("frontend_debug", {
				msg: `[MAIN-NOTIF-MODE] windowLabel=${windowLabel}, isHidden=${isHidden}, activeNotif=${!!activeNotification}, pillTargetY=${pillTargetY}, pillTargetW=${pillTargetWidth}, pillTargetH=${pillTargetHeight}`
			}).catch(() => {});
		}
	}, [bloomMode, isHidden, activeNotification, pillTargetY, pillTargetWidth, pillTargetHeight, windowLabel]);

	return (
		<div className="screen" style={{ overflow: "hidden" }}>
			{/* Screen Corners (Top) */}
			<AnimatePresence>
				{isVisible && settingsCornersEnabled && (
					<>
						<motion.div
							className="screen-corner top-left"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1, filter: "blur(0px)" }}
							exit={{ opacity: 0, filter: "blur(10px)" }}
						/>
						<motion.div
							className="screen-corner top-right"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1, filter: "blur(0px)" }}
							exit={{ opacity: 0, filter: "blur(10px)" }}
						/>
					</>
				)}
			</AnimatePresence>

			<div
				style={{
					zoom: scale,
					width: "100%",
					display: "flex",
					justifyContent: "center",
					position: "relative"
				}}
			>
				<motion.div
					ref={bloomRef}
					className={`bloom ${isHovered ? "expanded" : ""} ${isImpacted ? "is-impacted" : ""} ${isDragHovering ? "drag-hover" : ""} ${bloomMode === "notification" && activeNotification ? `bloom-droplet-mode cat-${activeNotification.category || "general"}` : ""}`}
					onMouseEnter={() => setIsNotchHovered(true)}
					onMouseLeave={() => setIsNotchHovered(false)}
					onPointerDown={() => invoke("dismiss_start_menu").catch(() => {})}
					onWheel={handleWheel}
					initial={{
						y: 250,
						width: 30.6,
						height: 44.2,
						borderTopLeftRadius: 18,
						borderTopRightRadius: 18,
						borderBottomLeftRadius: 18,
						borderBottomRightRadius: 18,
						scaleX: 1,
						scaleY: 1,
						opacity: 0
					}}
					animate={{
						y: pillTargetY,
						width: pillTargetWidth,
						height: pillTargetHeight,
						opacity: (isVisible || isNotchActive) ? 1 : 0,
						scaleX: 1,
						scaleY: 1,
						borderTopLeftRadius: (isImpacted && notchOffsetY === 0) ? 0 : notchCornerRadius,
						borderTopRightRadius: (isImpacted && notchOffsetY === 0) ? 0 : notchCornerRadius,
						borderBottomLeftRadius: isCalendarMode ? Math.max(28, notchCornerRadius) : notchCornerRadius,
						borderBottomRightRadius: isCalendarMode ? Math.max(28, notchCornerRadius) : notchCornerRadius,
						filter: (isVisible || isNotchActive) ? "blur(0px)" : "blur(8px)",
						pointerEvents: (isVisible || isNotchActive) ? "auto" : "none"
					}}
					onClick={(e) => {
						e.stopPropagation();
						handleNotchCycleClick(e);
					}}
					onHoverStart={() => {
						releaseDeferredRef.current = false;
						setIsHovered(true);
						// Hovering the shelf cancels its post-drop auto-close.
						if (bloomMode === "shelf") clearShelfCollapse();
					}}
					onHoverEnd={releaseNotchHover}
					style={{ originY: 0 }}
					transition={{
						width: { type: "spring", stiffness: 400, damping: 31 },
						height: { type: "spring", stiffness: 450, damping: 29 },
						y: { type: "spring", stiffness: 550, damping: 45, mass: 0.8, restDelta: 0.001 },
						opacity: { duration: 0.2 },
						borderTopLeftRadius: { type: "spring", stiffness: 1000, damping: 40 },
						borderTopRightRadius: { type: "spring", stiffness: 1000, damping: 40 },
						borderBottomLeftRadius: { type: "spring", stiffness: 1000, damping: 40 },
						borderBottomRightRadius: { type: "spring", stiffness: 1000, damping: 40 },
						default: { type: "spring", stiffness: 500, damping: 30, mass: 1 }
					}}
				>
					<EdgeSurface edge="top" flares={isImpacted} />
					<AnimatePresence>
						{isMusicMode && settingsAmbienceEnabled && albumArtUrl && isOpen && !isCalendarMode && (
							<motion.div
								className="notch-ambient-glow"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
								transition={{ duration: 0.15 }}
							>
								<AnimatePresence mode="wait">
									<motion.img
										key={albumArtUrl}
										src={albumArtUrl}
										alt=""
										draggable={false}
										initial={{ opacity: 0, scale: 1.1 }}
										animate={{ opacity: 1, scale: 1.8 }}
										exit={{ opacity: 0 }}
										transition={{ duration: 0.3 }}
									/>
								</AnimatePresence>
							</motion.div>
						)}
					</AnimatePresence>
					<AnimatePresence mode="wait">
						{(isExpanded || isNotchActive) && (
							<motion.div
								key="bloom-content"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
								transition={{ duration: 0.1 }}
								style={{
									width: "100%",
									height: "100%",
									display: "flex",
									flexDirection: "column",
									alignItems: "center",
									position: "relative",
									borderRadius: "inherit"
								}}
							>
								{/* Faster Waiting Transition Area */}
								<AnimatePresence mode="wait">
									{isOpen && (bloomMode === "music" || isMusicMode) && !isCalendarMode ? (
										<motion.div
											key="expanded-music"
											className="expanded-music-container"
											initial={{ opacity: 0, scale: 0.98 }}
											animate={{ opacity: 1, scale: 1 }}
											exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
											transition={{ type: "spring", stiffness: 500, damping: 30 }}
										>
											{mediaLayout === "compact" ? (
												<CompactMediaPlayer
													mediaInfo={mediaInfo}
													albumArtUrl={albumArtUrl}
													albumArtKey={albumArtKey}
													isPlaying={isPlaying}
													volume={displayVolume}
													volumeExpanded={compactVolumeExpanded}
													onVolumeExpandedChange={setCompactVolumeExpanded}
													onTogglePlayPause={togglePlayPause}
													onVolumeChange={handleVolumeChange}
													prevFront={prevFront}
													prevBack={prevBack}
													nextFront={nextFront}
													nextBack={nextBack}
													onAnimatePrev={animatePrev}
													onAnimateNext={animateNext}
													onLayoutChange={(layout) => {
														setMediaLayout(layout);
														localStorage.setItem("bloom-media-layout", layout);
														invoke("save_setting", {
															key: "bloom-media-layout",
															value: layout
														}).catch(console.error);
														window.dispatchEvent(
															new CustomEvent("settings-changed", {
																detail: { key: "media-layout", value: layout }
															})
														);
													}}
												/>
											) : (
												<div className="compact-premium-layout">
													<div className="album-art-section">
														<motion.div
															className="premium-album-art"
															whileHover={{ scale: 1.05 }}
															whileTap={{ scale: 0.95 }}
															onClick={(e) => {
																e.stopPropagation();
																setMediaLayout("compact");
																localStorage.setItem("bloom-media-layout", "compact");
																invoke("save_setting", {
																	key: "bloom-media-layout",
																	value: "compact"
																}).catch(console.error);
																window.dispatchEvent(
																	new CustomEvent("settings-changed", {
																		detail: { key: "media-layout", value: "compact" }
																	})
																);
															}}
															style={{ cursor: "pointer" }}
														>
															<AnimatePresence mode="wait" initial={false}>
																{albumArtUrl ? (
																	<motion.img
																		key={`art-${albumArtKey}`}
																		src={albumArtUrl}
																		alt="Art"
																		initial={{ rotateY: 90, opacity: 0 }}
																		animate={{ rotateY: 0, opacity: 1 }}
																		exit={{ rotateY: -90, opacity: 0 }}
																		transition={{ duration: 0.3, ease: "easeInOut" }}
																		style={{ width: "100%", height: "100%", objectFit: "cover" }}
																	/>
																) : (
																	<motion.div
																		key="placeholder"
																		className="art-placeholder-mini"
																		initial={{ rotateY: 90, opacity: 0 }}
																		animate={{ rotateY: 0, opacity: 1 }}
																		exit={{ rotateY: -90, opacity: 0 }}
																		transition={{ duration: 0.3, ease: "easeInOut" }}
																	>
																		<MusicNoteIcon size={32} className="music-placeholder-svg" />
																	</motion.div>
																)}
															</AnimatePresence>
														</motion.div>
													</div>

													<div className="metadata-controls-section-middle">
														<div className="track-header-row">
															<div className="track-info-middle">
																<TitleMarquee title={mediaInfo.title} />
																<span className="premium-artist">{mediaInfo.artist}</span>
															</div>
															<div className="header-visualizer-wrap">
																<div className="header-visualizer">
																	<Visualizer isPlaying={isPlaying} bars={5} height={18} />
																</div>
																<motion.button
																	className="classic-audio-output-btn"
																	onClick={(e) => {
																		e.stopPropagation();
																		invoke("open_sound_settings").catch(() => {});
																	}}
																	whileTap={{ scale: 0.9 }}
																	title="Audio Output"
																>
																	<HeadphonesIcon size={20} style={{ opacity: 0.5 }} />
																</motion.button>
															</div>
														</div>

														<div className="controls-row-sleek">
															<motion.button
																className="sleek-btn previous-btn"
																onClick={(e) => {
																	e.stopPropagation();
																	animatePrev();
																}}
																whileHover={{ scale: 1.2 }}
																whileTap={{ scale: 0.9 }}
																transition={{ type: "spring", stiffness: 400, damping: 25 }}
															>
																<div
																	style={{
																		position: "relative",
																		width: 32,
																		height: 16,
																		overflow: "hidden"
																	}}
																>
																	<motion.div
																		animate={prevBack}
																		style={{
																			position: "absolute",
																			inset: 0,
																			display: "flex",
																			alignItems: "center",
																			justifyContent: "center"
																		}}
																	>
																		<SkipBackIcon size={32} />
																	</motion.div>
																	<motion.div
																		animate={prevFront}
																		style={{
																			position: "absolute",
																			inset: 0,
																			display: "flex",
																			alignItems: "center",
																			justifyContent: "center"
																		}}
																	>
																		<SkipBackIcon size={32} />
																	</motion.div>
																</div>
															</motion.button>

															<motion.button
																className="sleek-btn play-pause-btn-floating"
																onClick={(e) => {
																	e.stopPropagation();
																	togglePlayPause();
																}}
																whileHover={{ scale: 1.2 }}
																whileTap={{ scale: 0.95 }}
																transition={{ type: "spring", stiffness: 400, damping: 25 }}
															>
																<AnimatePresence mode="wait" initial={false}>
																	<motion.div
																		key={isPlaying ? "pause" : "play"}
																		initial={{ opacity: 0, scale: 0.8 }}
																		animate={{ opacity: 1, scale: 1 }}
																		exit={{ opacity: 0, scale: 0.8 }}
																		transition={{ duration: 0.15 }}
																		style={{
																			display: "flex",
																			alignItems: "center",
																			justifyContent: "center"
																		}}
																	>
																		{isPlaying ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
																	</motion.div>
																</AnimatePresence>
															</motion.button>

															<motion.button
																className="sleek-btn next-btn"
																onClick={(e) => {
																	e.stopPropagation();
																	animateNext();
																}}
																whileHover={{ scale: 1.2 }}
																whileTap={{ scale: 0.9 }}
																transition={{ type: "spring", stiffness: 400, damping: 25 }}
															>
																<div
																	style={{
																		position: "relative",
																		width: 32,
																		height: 16,
																		overflow: "hidden"
																	}}
																>
																	<motion.div
																		animate={nextBack}
																		style={{
																			position: "absolute",
																			inset: 0,
																			display: "flex",
																			alignItems: "center",
																			justifyContent: "center"
																		}}
																	>
																		<SkipForwardIcon size={32} />
																	</motion.div>
																	<motion.div
																		animate={nextFront}
																		style={{
																			position: "absolute",
																			inset: 0,
																			display: "flex",
																			alignItems: "center",
																			justifyContent: "center"
																		}}
																	>
																		<SkipForwardIcon size={32} />
																	</motion.div>
																</div>
															</motion.button>
														</div>

														<div className="volume-slider-container">
															<VolumeLowIcon size={12} style={{ opacity: 0.5 }} />
															<div className="slider-track-premium">
																<input
																	type="range"
																	min="0"
																	max="1"
																	step="0.01"
																	value={displayVolume}
																	onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
																	onPointerDown={(e) => e.stopPropagation()}
																	onClick={(e) => e.stopPropagation()}
																	className="premium-slider"
																/>
																<div
																	className="slider-progress-fill"
																	style={{ width: `${displayVolume * 100}%` }}
																/>
															</div>
															<VolumeHighIcon size={14} style={{ opacity: 0.5 }} />
														</div>
													</div>
												</div>
											)}
										</motion.div>
									) : (bloomMode === "notification" || activeRingingAlarm) ? null : (
										<motion.div
											key="standard-view-group"
											initial={{ opacity: 0, y: -5 }}
											animate={{ opacity: 1, y: 0 }}
											exit={{ opacity: 0, y: 5, transition: { duration: 0.1 } }}
											transition={{ duration: 0.2 }}
											style={{ width: "100%" }}
										>
											<div className="main-row">
												<AnimatePresence mode="wait">
													{(showPowerPulse || showLowBatteryPulse || showUpdatePulse) &&
													!isHovered ? (
														showUpdatePulse ? (
															<motion.div
																key="update-pulse-view"
																initial={{ opacity: 0, scale: 0.95, filter: "blur(4px)" }}
																animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
																exit={{ opacity: 0, scale: 1.05, filter: "blur(4px)" }}
																className="power-pulse-content"
															>
																<GreenDownArrowIcon />
																<span className="label" style={{ color: "#32D74B" }}>
																	Update Available
																</span>
															</motion.div>
														) : (
															<motion.div
																key="pulse-view"
																initial={{ opacity: 0, scale: 0.95, filter: "blur(4px)" }}
																animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
																exit={{ opacity: 0, scale: 1.05, filter: "blur(4px)" }}
																className="power-pulse-content"
															>
																{updateAvailable && <GreenDownArrowIcon />}
																<BatteryIcon
																	charging={isCharging}
																	level={batteryLevel}
																	threshold={lowBatteryThreshold}
																/>
																<span
																	className="label"
																	style={{ color: showLowBatteryPulse ? "#FF453A" : "inherit" }}
																>
																	{showLowBatteryPulse
																		? "Low Battery"
																		: isCharging
																			? "Charging"
																			: "On Battery"}{" "}
																	• {batteryLevel}%
																</span>
															</motion.div>
														)
													) : (
														<motion.div
															key="standard-view"
															className="main-row-inner"
															initial={{ opacity: 0 }}
															animate={{ opacity: 1 }}
															exit={{ opacity: 0 }}
														>
															{/* Left: music on hover while a paused session remains, otherwise status widgets */}
															<div className="side-content left">
																{showCompactMusicIcons && settingsVisualizerEnabled ? (
																	<AnimatePresence>
																		{settingsVisualizerEnabled && (
																			<motion.div
																				key="visualizer"
																				initial={{ scale: 0.8, opacity: 0 }}
																				animate={{ scale: 1, opacity: 1 }}
																				exit={{ scale: 0.8, opacity: 0 }}
																			>
																				<Visualizer isPlaying={isPlaying} />
																			</motion.div>
																		)}
																	</AnimatePresence>
																) : !showCompactMusicIcons && isHovered && statusWidgets.left.length > 0 ? (
																	<motion.div
																		key="left-widgets"
																		ref={leftWidgetsRef}
																		className="passive-features-group"
																		initial={{ opacity: 0 }}
																		animate={{ opacity: 1 }}
																		exit={{ opacity: 0 }}
																		transition={{ duration: 0.2 }}
																	>
																		{statusWidgets.left.map(renderStatusWidget)}
																	</motion.div>
																) : null}
															</div>

															{/* Center - Time (always visible) */}
															<div className="time-center" ref={timeCenterRef}>
																<AnimatePresence>
																	{showPanelArrows && (
																		<motion.button
																			key="panel-prev"
																			type="button"
																			className="panel-arrow prev"
																			aria-label="Previous panel"
																			initial={{ opacity: 0, x: 4 }}
																			animate={{ opacity: 1, x: 0 }}
																			exit={{ opacity: 0, x: 4 }}
																			transition={{ duration: 0.15 }}
																			onClick={(e) => {
																				e.stopPropagation();
																				cyclePanel(-1);
																			}}
																		>
																			<ChevronLeft size={12} strokeWidth={2.5} />
																		</motion.button>
																	)}
																</AnimatePresence>
																<div
																	className={`time-flip-container ${isOpen ? "expanded-time-container" : ""}`}
																	onClick={(e) => {
																		e.stopPropagation();
																		toggleCalendarMode(e);
																	}}
																>
																	<AnimatePresence initial={false}>
																		{!isOpen && (timerSeconds > 0 || isTimerFinished) ? (
																			<motion.span
																				key="timer"
																				className={`time compact-timer ${isTimerFinished ? "timer-finished" : isTimerRunning ? "timer-running" : "timer-paused"}`}
																				initial={{ rotateX: -90, opacity: 0 }}
																				animate={{ rotateX: 0, opacity: 1 }}
																				exit={{ rotateX: 90, opacity: 0 }}
																				transition={{ type: "spring", stiffness: 600, damping: 30 }}
																			>
																				{isTimerFinished && (
																					<BellRing
																						size={13}
																						strokeWidth={2.5}
																						className="timer-bell"
																					/>
																				)}
																				{formatTimerTime(timerSeconds)}
																			</motion.span>
																		) : (
																			<motion.span
																				key="clock"
																				className={`time ${isOpen ? "time-expanded-top" : ""}`}
																				initial={{ rotateX: -90, opacity: 0 }}
																				animate={{ rotateX: 0, opacity: 1 }}
																				exit={{ rotateX: 90, opacity: 0 }}
																				transition={{ type: "spring", stiffness: 600, damping: 30 }}
																			>
																				{time}
																			</motion.span>
																		)}
																	</AnimatePresence>
																	{isOpen && (
																		<motion.span
																			key="notch-date"
																			className="notch-date-subtext"
																			initial={{ opacity: 0, y: -2 }}
																			animate={{ opacity: 1, y: 0 }}
																			exit={{ opacity: 0, y: -2 }}
																			transition={{ duration: 0.15 }}
																		>
																			{currentDate}
																		</motion.span>
																	)}
																	{(privacyIndicators.mic_active || privacyIndicators.camera_active) && (
																		<span
																			className="notch-privacy-dot"
																			style={{
																				display: "inline-block",
																				width: 6,
																				height: 6,
																				borderRadius: "50%",
																				background: privacyIndicators.camera_active ? "#34d399" : "#fbbf24",
																				marginLeft: 4,
																				boxShadow: `0 0 6px ${privacyIndicators.camera_active ? "#34d399" : "#fbbf24"}`,
																				verticalAlign: "middle"
																			}}
																			title={privacyIndicators.camera_active ? "Camera in use" : "Microphone in use"}
																		/>
																	)}
																</div>
																<AnimatePresence>
																	{showPanelArrows && (
																		<motion.button
																			key="panel-next"
																			type="button"
																			className="panel-arrow next"
																			aria-label="Next panel"
																			initial={{ opacity: 0, x: -4 }}
																			animate={{ opacity: 1, x: 0 }}
																			exit={{ opacity: 0, x: -4 }}
																			transition={{ duration: 0.15 }}
																			onClick={(e) => {
																				e.stopPropagation();
																				cyclePanel(1);
																			}}
																		>
																			<ChevronRight size={12} strokeWidth={2.5} />
																		</motion.button>
																	)}
																</AnimatePresence>
																{updateAvailable && showUpdateIndicator && (
																	<div className="update-dot" />
																)}
															</div>

															{/* Right: album art on a retained music session, otherwise status widgets */}
															<div className="side-content right">
																{showCompactMusicIcons && (settingsAlbumArtEnabled || showMusicOnStatusHover) ? (
																	<AnimatePresence mode="wait">
																		<motion.div
																			key="album-art"
																			className="album-art-glow-wrapper"
																			initial={{ opacity: 0, scale: 0.8 }}
																			animate={{ opacity: 1, scale: 1 }}
																			exit={{ opacity: 0, y: -20, scale: 0.8, filter: "blur(8px)" }}
																			transition={{ duration: 0.12 }}
																			onPointerDown={(e) => e.stopPropagation()}
																			onMouseDown={(e) => e.stopPropagation()}
																			onClick={(e) => {
																				e.stopPropagation();
																				openNotch("music");
																			}}
																		>
																			{settingsAlbumArtEnabled && albumArtUrl && settingsCompactGlowEnabled && (
																				<img
																					src={albumArtUrl}
																					alt=""
																					className="album-art-glow-bg"
																					draggable={false}
																				/>
																			)}
																			<button
																				className={`album-art album-art-activity${!isPlaying ? " paused" : ""}`}
																				aria-label="Open music"
																				onPointerDown={(e) => e.stopPropagation()}
																				onMouseDown={(e) => e.stopPropagation()}
																				onClick={(e) => {
																					e.stopPropagation();
																					openNotch("music");
																				}}
																				onContextMenu={(e) => {
																					e.preventDefault();
																					e.stopPropagation();
																					skipPrevious();
																				}}
																			>
																				<div className="album-art-inner">
																					<AnimatePresence mode="wait" initial={false}>
																						{settingsAlbumArtEnabled && albumArtUrl ? (
																							<motion.img
																								key={`compact-art-${albumArtKey}`}
																								src={albumArtUrl}
																								alt="Art"
																								draggable={false}
																								initial={{ rotateY: 90, opacity: 0 }}
																								animate={{ rotateY: 0, opacity: 1 }}
																								exit={{ rotateY: -90, opacity: 0 }}
																								transition={{ duration: 0.25, ease: "easeInOut" }}
																								style={{
																									width: "100%",
																									height: "100%",
																									objectFit: "cover"
																								}}
																							/>
																						) : (
																							<motion.div
																								key="compact-placeholder"
																								className="album-art-placeholder"
																								initial={{ rotateY: 90, opacity: 0 }}
																								animate={{ rotateY: 0, opacity: 1 }}
																								exit={{ rotateY: -90, opacity: 0 }}
																								transition={{ duration: 0.25, ease: "easeInOut" }}
																							>
																								<MusicNoteIcon className="music-placeholder-svg-small" />
																							</motion.div>
																						)}
																					</AnimatePresence>
																				</div>
																			</button>
																		</motion.div>
																	</AnimatePresence>
																) : !showCompactMusicIcons && isHovered && statusWidgets.right.length > 0 ? (
																	<motion.div
																		key="right-widgets"
																		ref={rightWidgetsRef}
																		className="passive-features-group"
																		initial={{ opacity: 0 }}
																		animate={{ opacity: 1 }}
																		exit={{ opacity: 0 }}
																		transition={{ duration: 0.2 }}
																	>
																		{statusWidgets.right.map(renderStatusWidget)}
																	</motion.div>
																) : null}
															</div>
														</motion.div>
													)}
												</AnimatePresence>
											</div>
										</motion.div>
									)}
								</AnimatePresence>

								{/* Wi-Fi networks, opened from the controls panel's Wi-Fi tile */}
								<AnimatePresence>
									{bloomMode === "wifi" && (
										<motion.div
											key="wifi-view"
											initial={{ opacity: 0 }}
											animate={{ opacity: 1 }}
											exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.1 } }}
											transition={{ type: "spring", stiffness: 400, damping: 30 }}
										>
											<WifiPanel
												enabled={wifiEnabled}
												onToggle={toggleWifi}
												onBack={() => setBloomMode("command-center")}
												onPinChange={setNotchPinned}
											/>
										</motion.div>
									)}
								</AnimatePresence>

								{/* Bluetooth devices, opened from the controls panel's Bluetooth tile */}
								<AnimatePresence>
									{bloomMode === "bluetooth" && (
										<motion.div
											key="bluetooth-view"
											initial={{ opacity: 0 }}
											animate={{ opacity: 1 }}
											exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.1 } }}
											transition={{ type: "spring", stiffness: 400, damping: 30 }}
										>
											<BluetoothPanel
												enabled={bluetoothEnabled}
												onToggle={toggleBluetooth}
												onBack={() => setBloomMode("command-center")}
												onPinChange={setNotchPinned}
											/>
										</motion.div>
									)}
								</AnimatePresence>

								{/* Command Center Panel */}
								<AnimatePresence>
									{bloomMode === "command-center" && (
										<motion.div
											className="command-center-content-full"
											onClick={(e) => e.stopPropagation()}
											initial={{ opacity: 0 }}
											animate={{ opacity: 1 }}
											exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.1 } }}
											transition={{ type: "spring", stiffness: 400, damping: 30 }}
											style={{ width: "100%", height: "100%" }}
										>
											<CommandCenterFull
												wifiEnabled={wifiEnabled}
												wifiConnected={wifiConnected}
												wifiSsid={wifiStatus?.ssid ?? undefined}
												onToggleWifi={toggleWifi}
												onOpenWifiList={() => setBloomMode("wifi")}
												bluetoothEnabled={bluetoothEnabled}
												btConnectedNames={btConnectedNames}
												onToggleBluetooth={toggleBluetooth}
												onOpenBluetoothList={() => setBloomMode("bluetooth")}
												dockMode={dockMode}
												onToggleDockMode={() => void toggleDockModeSetting({} as any)}
												notchMode={notchMode}
												onToggleNotchMode={() => void toggleNotchModeSetting({} as any)}
												dndActive={dndActive}
												onToggleDnd={() => setDndActive((prev) => !prev)}
												batterySaverActive={batterySaverEnabled}
												onOpenBatterySaver={openBatterySaverSettings}
												onToggleBatterySaver={toggleBatterySaver}
												onOpenSystemTray={openSystemTray}
												onOpenNotificationCenter={() => {
													setBloomMode("notifications");
													if (rememberPanelEnabled) {
														rememberPanel("notifications");
													}
												}}
												onOpenSettings={openSettingsWindow}
												onRestartBloom={() => invoke("restart_bloom")}
												displayVolume={displayVolume}
												onVolumeChange={handleVolumeChange}
												displayBrightness={currentBrightness}
												onBrightnessChange={handleBrightnessChange}
												onPinNotch={setNotchPinned}
											/>
										</motion.div>
									)}
								</AnimatePresence>

								{/* Notification Center Panel */}
								<AnimatePresence>
									{bloomMode === "notifications" && isOpen && (
										<motion.div
											className="notification-center-content"
											onClick={(e) => e.stopPropagation()}
											initial={{ opacity: 0 }}
											animate={{ opacity: 1 }}
											exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.1 } }}
											transition={{ type: "spring", stiffness: 400, damping: 30 }}
										>
											<NotificationCenter
												notifications={notificationsList}
												onClearAll={handleClearAllNotifications}
												onDismissItem={handleDismissNotificationItem}
												onOpenItem={handleOpenNotificationItem}
											/>
										</motion.div>
									)}
								</AnimatePresence>

								{/* Dynamic Island Liquid Droplet Notification Card */}
								<AnimatePresence>
									{bloomMode === "notification" && activeNotification && (
										<motion.div
											className="notch-notification-content"
											onClick={(e) => {
												const target = e.target as HTMLElement;
												if (target.closest('.notif-actions-row') || target.closest('.notif-reply-container') || target.closest('.notif-close-btn')) {
													return;
												}
												handleNotificationAction("Open");
											}}
											onPointerEnter={handleNotifPointerEnter}
											onPointerLeave={handleNotifPointerLeave}
											initial={{ opacity: 0, y: -16, scale: 0.94 }}
											animate={{ opacity: 1, y: 0, scale: 1 }}
											exit={{
												opacity: 0,
												y: -16,
												scale: 0.94,
												filter: "blur(6px)",
												transition: { duration: 0.18 }
											}}
											transition={{ type: "spring", stiffness: 420, damping: 28 }}
										>
											<div className="notif-header">
												<div className="notif-app-info">
													<div className={`notif-badge cat-badge-${activeNotification.category || "general"}`}>
														{(() => {
															const cat = (activeNotification.category || "").toLowerCase();
															const lower = (activeNotification.app_name || "").toLowerCase();
															if (cat === "alarm") {
																return <Clock size={12} strokeWidth={2.5} />;
															}
															if (cat === "call") {
																return <PhoneCall size={12} strokeWidth={2.5} />;
															}
															if (cat === "reminder") {
																return <BellRing size={12} strokeWidth={2.5} />;
															}
															if (
																cat === "message" ||
																lower.includes("telegram") ||
																lower.includes("message") ||
																lower.includes("chat") ||
																lower.includes("whatsapp") ||
																lower.includes("discord") ||
																lower.includes("slack") ||
																lower.includes("teams")
															) {
																return <MessageSquare size={12} strokeWidth={2.5} />;
															}
															if (lower.includes("mail") || lower.includes("outlook") || lower.includes("gmail")) {
																return <Mail size={12} strokeWidth={2.5} />;
															}
															if (lower.includes("music") || lower.includes("spotify")) {
																return <Music size={12} strokeWidth={2.5} />;
															}
															return <Bell size={12} strokeWidth={2.5} />;
														})()}
													</div>
													<span className="notif-app-name">{activeNotification.app_name}</span>
													{activeNotification.category && activeNotification.category !== "general" && (
														<span className="notif-cat-tag">
															{activeNotification.category === "alarm"
																? "Alarm"
																: activeNotification.category === "call"
																? "Call"
																: activeNotification.category === "reminder"
																? "Reminder"
																: activeNotification.category}
														</span>
													)}
													<span className="notif-dot">•</span>
													<span className="notif-time">Just now</span>
												</div>
												<button
													className="notif-close-btn"
													onClick={(e) => {
														e.stopPropagation();
														dismissActiveNotification();
													}}
													title="Dismiss"
													aria-label="Dismiss notification"
												>
													<X size={12} strokeWidth={2.4} />
												</button>
											</div>

											<div className="notif-body-container">
												<div className="notif-title" title={activeNotification.title}>
													{activeNotification.title}
												</div>
												{activeNotification.body && (
													<div className="notif-message" title={activeNotification.body}>
														{activeNotification.body}
													</div>
												)}
											</div>

											{notifReplyOpen ? (
												<div className="notif-reply-container" onClick={(e) => e.stopPropagation()}>
													<input
														type="text"
														className="notif-reply-input"
														placeholder={activeNotification.placeholder || "Type your reply..."}
														value={notifReplyText}
														onChange={(e) => setNotifReplyText(e.target.value)}
														onKeyDown={(e) => {
															if (e.key === "Enter") handleSendNotificationReply();
															if (e.key === "Escape") setNotifReplyOpen(false);
														}}
														onFocus={() => invoke("focus_notch_input", { focus: true }).catch(() => {})}
														autoFocus
													/>
													<button
														className="notif-action-btn accent notif-send-btn"
														onClick={handleSendNotificationReply}
													>
														<Send size={11} strokeWidth={2.2} /> Send
													</button>
													<button
														className="notif-action-btn secondary notif-cancel-btn"
														onClick={() => setNotifReplyOpen(false)}
													>
														Cancel
													</button>
												</div>
											) : (
												<div className="notif-actions-row">
													{activeNotification.actions && activeNotification.actions.length > 0 ? (
														activeNotification.actions
															.filter((action) => notifQuickReplyRef.current || action.toLowerCase() !== "reply")
															.map((action, idx) => {
															const actLower = action.toLowerCase();
															let btnClass = "secondary";
															if (actLower === "open" || actLower === "view") btnClass = "primary";
															else if (actLower === "reply") btnClass = "accent";
															else if (actLower === "snooze") btnClass = "warning";
															else if (actLower === "accept" || actLower === "answer") btnClass = "success";
															else if (actLower === "decline") btnClass = "danger";

															return (
																<button
																	key={idx}
																	type="button"
																	className={`notif-action-btn ${btnClass}`}
																	onClick={(e) => {
																		e.stopPropagation();
																		invoke("frontend_debug", { msg: `[BUTTON-CLICKED] action=${action}` }).catch(() => {});
																		handleNotificationAction(action);
																	}}
																>
																	{action}
																</button>
															);
														})
													) : (
														<>
															<button
																className="notif-action-btn primary"
																onClick={(e) => {
																	e.stopPropagation();
																	handleNotificationAction("Open");
																}}
															>
																Open
															</button>
															<button
																className="notif-action-btn secondary"
																onClick={(e) => {
																	e.stopPropagation();
																	handleNotificationAction("Dismiss");
																}}
															>
																Dismiss
															</button>
														</>
													)}
												</div>
											)}

											{!notifReplyOpen && (
												<motion.div
													className="notif-progress-bar"
													initial={{ scaleX: 1 }}
													animate={{ scaleX: 0 }}
													transition={{ duration: 6.5, ease: "linear" }}
												/>
											)}
										</motion.div>
									)}
								</AnimatePresence>

								{/* Ringing Alarm Global Card */}
								<AnimatePresence>
									{activeRingingAlarm && (
										<motion.div
											className="notch-alarm-ringing-card"
											onClick={(e) => e.stopPropagation()}
											initial={{ opacity: 0, y: -8, scale: 0.98 }}
											animate={{ opacity: 1, y: 0, scale: 1 }}
											exit={{
												opacity: 0,
												y: -8,
												scale: 0.98,
												filter: "blur(4px)",
												transition: { duration: 0.15 }
											}}
											transition={{ type: "spring", stiffness: 450, damping: 32 }}
										>
											<div className="alarm-card-header">
												<div className="alarm-card-badge">
													<BellRing size={18} strokeWidth={2.4} className="alarm-card-ringing-icon" />
												</div>
												<div className="alarm-card-title-group">
													<span className="alarm-card-time">{activeRingingAlarm.time}</span>
													<span className="alarm-card-label">{activeRingingAlarm.label || "Alarm"}</span>
												</div>
											</div>
											<div className="alarm-card-actions">
												<button
													type="button"
													className="alarm-card-btn snooze"
													onClick={(e) => {
														e.stopPropagation();
														alarmEngine.snoozeActiveAlarm(5);
													}}
												>
													Snooze 5m
												</button>
												<button
													type="button"
													className="alarm-card-btn dismiss"
													onClick={(e) => {
														e.stopPropagation();
														alarmEngine.dismissActiveAlarm();
													}}
												>
													Dismiss
												</button>
											</div>
										</motion.div>
									)}
								</AnimatePresence>

								{/* Announcement Card */}
								<AnimatePresence>
									{bloomMode === "announcement" && announcement && !announcementDismissed && (
										<motion.div
											className={`announcement-content severity-${announcement.severity}`}
											onClick={(e) => e.stopPropagation()}
											initial={{ opacity: 0 }}
											animate={{ opacity: 1 }}
											exit={{
												opacity: 0,
												filter: "blur(4px)",
												transition: { duration: 0.1 }
											}}
											transition={{ type: "spring", stiffness: 400, damping: 30 }}
										>
											<div className="announcement-header">
												<div className="announcement-heading">
													<Megaphone size={14} className="announcement-icon" />
													<span className="announcement-title">{announcement.title}</span>
												</div>
												<button
													className="announcement-close"
													onClick={dismissAnnouncement}
													title="Dismiss"
												>
													<X size={13} strokeWidth={2.2} />
												</button>
											</div>
											{announcement.body && (
												<p className="announcement-body">{announcement.body}</p>
											)}
											{announcement.url && (
												<button
													className="announcement-link"
													onClick={() => openUrl(announcement.url!)}
												>
													Learn more
												</button>
											)}
										</motion.div>
									)}
								</AnimatePresence>

								{/* Calendar & Timer Split View */}
								<AnimatePresence>
									{settingsCalendarEnabled && isCalendarMode && isOpen && (
										<motion.div
											className={`calendar-timer-content split-view ${isTimerCollapsed ? "timer-collapsed" : ""}`}
											onClick={(e) =>
												e.stopPropagation()
											} /* Block mode switches when clicking inside */
											initial={{ opacity: 0 }}
											animate={{ opacity: 1 }}
											exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.1 } }}
											transition={{ type: "spring", stiffness: 400, damping: 30 }}
										>
											<div className={`calendar-column ${isTimerCollapsed ? "full-width" : ""}`}>
												<TodoList
													isTimerCollapsed={isTimerCollapsed}
													onToggleTimer={toggleTimerCollapsed}
													onPinNotch={setNotchPinned}
												/>
											</div>

											{!isTimerCollapsed && (
												<div className="notes-column">
													<MyNotes onPinNotch={setNotchPinned} />
												</div>
											)}
										</motion.div>
									)}
								</AnimatePresence>

								{/* Timers & Alarms Panel */}
								<AnimatePresence>
									{bloomMode === "timers" && isOpen && (
										<motion.div
											className="timers-panel-content"
											onClick={(e) => e.stopPropagation()}
											initial={{ opacity: 0 }}
											animate={{ opacity: 1 }}
											exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.1 } }}
											transition={{ type: "spring", stiffness: 400, damping: 30 }}
										>
											<TimersPanel
												onPinNotch={setNotchPinned}
												timeFormat24h={timeFormat24h}
												timerPresets={timerPresets}
												onTimerStatusChange={(status) => {
													if (status.type === "timer" || status.type === "pomodoro") {
														setTimerSeconds(status.seconds);
														setIsTimerRunning(status.isRunning);
														setIsTimerFinished(status.isFinished);
													}
												}}
												onRingingAlarmChange={(alarm) => {
													setActiveRingingAlarm(alarm);
												}}
											/>
										</motion.div>
									)}
								</AnimatePresence>

								{/* Shelf Panel */}
								<AnimatePresence>
									{bloomMode === "shelf" && (
										<motion.div
											className="shelf-content"
											onClick={(e) => e.stopPropagation()}
											onWheel={handleShelfWheel}
											initial={{ opacity: 0 }}
											animate={{ opacity: 1 }}
											exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.1 } }}
											transition={{ type: "spring", stiffness: 400, damping: 30 }}
										>
											{shelfNotice && <div className="shelf-notice">{shelfNotice}</div>}
											{shelfItems.length === 0 ? (
												<div className="shelf-empty">
													<span>Drop files or selected text here</span>
												</div>
											) : (
												<div
													className={`shelf-items-grid ${shelfOverflowing ? "overflowing" : ""}`}
													ref={shelfGridRef}
												>
													<AnimatePresence mode="popLayout" onExitComplete={measureShelfOverflow}>
														{shelfItems.map((item) => {
															const preview = item.path ? shelfThumbs[item.path] : undefined;
															const thumb = preview?.thumb;
															return (
																<motion.div
																	key={item.id}
																	layout
																	initial={
																		shelfNewIdsRef.current.has(item.id)
																			? { opacity: 0, scale: 0.82 }
																			: false
																	}
																	animate={{ opacity: 1, scale: 1 }}
																	exit={{
																		opacity: 0,
																		scale: 0.82,
																		transition: { duration: 0.16, ease: "easeOut" }
																	}}
																	transition={{
																		type: "spring",
																		stiffness: 520,
																		damping: 38,
																		mass: 0.7
																	}}
																	className={`shelf-tile ${item.type === "text" || (!thumb && preview?.text) ? "is-text" : ""}`}
																	title={
																		item.type === "text" ? item.text?.slice(0, 1000) : item.path
																	}
																	onPointerDown={(e) => handleShelfPointerDown(e, item)}
																	onPointerMove={(e) => handleShelfPointerMove(e, item)}
																	onClick={(e) => handleShelfTileClick(e, item)}
																>
																	<div className="shelf-tile-preview">
																		{item.type === "text" ? (
																			<div className="shelf-tile-text">
																				<Type
																					size={11}
																					strokeWidth={2}
																					className="shelf-tile-text-icon"
																				/>
																				<span className="shelf-tile-text-body">{item.text}</span>
																			</div>
																		) : !thumb && preview?.text ? (
																			// A document or text file: its opening text,
																			// marked with its type's icon.
																			<div className="shelf-tile-text">
																				<ShelfTypeIcon
																					name={item.name}
																					folder={false}
																					size={11}
																					className="shelf-tile-text-icon"
																				/>
																				<span className="shelf-tile-text-body">{preview.text}</span>
																			</div>
																		) : (
																			<>
																				<div className="shelf-tile-placeholder">
																					{preview && !thumb ? (
																						<ShelfTypeIcon
																							name={item.name}
																							folder={preview.folder}
																						/>
																					) : null}
																				</div>
																				{thumb ? (
																					<img src={thumb} alt="" draggable={false} />
																				) : null}
																			</>
																		)}
																	</div>
																	<span className="shelf-tile-name">
																		{item.type === "text"
																			? `Text · ${item.text?.length ?? 0} chars`
																			: item.name}
																	</span>
																	<button
																		className="shelf-tile-remove"
																		title="Remove from shelf"
																		onClick={(e) => {
																			e.stopPropagation();
																			removeShelfItem(item.id);
																		}}
																	>
																		<X size={11} strokeWidth={2.5} />
																	</button>
																</motion.div>
															);
														})}
													</AnimatePresence>
												</div>
											)}
										</motion.div>
									)}
								</AnimatePresence>
							</motion.div>
						)}
					</AnimatePresence>
				</motion.div>
				{/* The shelf's items, as a bubble on the left of the collapsed pill */}
				<AnimatePresence onExitComplete={() => reportNotchRect.current()}>
					{showShelfBubble && (
						<motion.button
							key="shelf-bubble"
							ref={shelfBubbleRef}
							type="button"
							className={`activity-bubble shelf-bubble ${isHovered ? "expanded" : ""}`}
							aria-label={`Open shelf: ${shelfItems.length} item${shelfItems.length === 1 ? "" : "s"}`}
							// Anchored at the pill's centre, offset past its left edge.
							style={{ right: "50%" }}
							initial={{ opacity: 0, scale: 0.4, x: 28, marginRight: getDynamicWidth() / 2 + 8 }}
							animate={{ opacity: 1, scale: 1, x: 0, marginRight: getDynamicWidth() / 2 + 8 }}
							exit={{ opacity: 0, scale: 0.4, x: 28 }}
							transition={{
								type: "spring",
								stiffness: 400,
								damping: 31,
								opacity: { duration: 0.15 }
							}}
							onAnimationComplete={() => reportNotchRect.current()}
							onClick={(e) => {
								e.stopPropagation();
								setIsHovered(true);
								openNotch("shelf");
							}}
						>
							<Inbox size={12} strokeWidth={2.4} />
							<span>{shelfItems.length}</span>
						</motion.button>
					)}
				</AnimatePresence>
				{/* Music in its own bubble while a timer holds the collapsed pill */}
				<AnimatePresence onExitComplete={() => reportNotchRect.current()}>
					{showMusicBubble && (
						<motion.button
							key="music-bubble"
							ref={musicBubbleRef}
							type="button"
							className={`activity-bubble ${isHovered ? "expanded" : ""}`}
							aria-label={mediaInfo.title ? `Open music: ${mediaInfo.title}` : "Open music"}
							// Anchored at the pill's centre, offset past its right edge.
							style={{ left: "50%" }}
							initial={{ opacity: 0, scale: 0.4, x: -28, marginLeft: getDynamicWidth() / 2 + 8 }}
							animate={{ opacity: 1, scale: 1, x: 0, marginLeft: getDynamicWidth() / 2 + 8 }}
							exit={{ opacity: 0, scale: 0.4, x: -28 }}
							transition={{
								type: "spring",
								stiffness: 400,
								damping: 31,
								opacity: { duration: 0.15 }
							}}
							onAnimationComplete={() => reportNotchRect.current()}
							onPointerDown={(e) => e.stopPropagation()}
							onMouseDown={(e) => e.stopPropagation()}
							onClick={(e) => {
								e.stopPropagation();
								setIsHovered(true);
								openNotch("music");
							}}
						>
							{settingsAlbumArtEnabled && albumArtUrl ? (
								<img src={albumArtUrl} alt="" draggable={false} />
							) : (
								<Music size={14} strokeWidth={2.2} />
							)}
						</motion.button>
					)}
				</AnimatePresence>
			</div>
		</div>
	);
}

export default App;
