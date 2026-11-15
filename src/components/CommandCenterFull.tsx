import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import {
	Wifi,
	Bluetooth,
	Radio,
	Shield,
	Plane,
	Volume2,
	VolumeX,
	Mic,
	MicOff,
	Headphones,
	Speaker,
	Monitor,
	Tv,
	Sun,
	Moon,
	Cast,
	Layers,
	Copy,
	Laptop,
	BatteryCharging,
	HardDrive,
	ChevronRight,
	Compass,
	Check,
	RefreshCw,
	Settings as SettingsIcon,
	Bell,
	RotateCcw,
	SlidersHorizontal
} from "lucide-react";
import "./CommandCenterFull.css";

export interface AudioOutputDevice {
	id: string;
	name: string;
	is_default: boolean;
	device_type: string;
}

export interface AudioSessionItem {
	pid: number;
	name: string;
	process_path?: string;
	volume: number;
	is_muted: boolean;
}

export interface VpnProfile {
	name: string;
	connected: boolean;
}

export interface RemovableDrive {
	letter: string;
	label: string;
	total_gb: number;
	free_gb: number;
}

export interface CommandCenterFullProps {
	wifiEnabled: boolean;
	wifiConnected: boolean;
	wifiSsid?: string;
	onToggleWifi: () => void;
	onOpenWifiList: () => void;
	bluetoothEnabled: boolean;
	btConnectedNames: string[];
	onToggleBluetooth: () => void;
	onOpenBluetoothList: () => void;
	dockMode: string;
	onToggleDockMode: () => void;
	notchMode: string;
	onToggleNotchMode: () => void;
	dndActive: boolean;
	onToggleDnd: () => void;
	batterySaverActive: boolean;
	onOpenBatterySaver: () => void;
	onToggleBatterySaver?: () => void;
	onOpenSystemTray: (e: React.MouseEvent) => void;
	onOpenNotificationCenter: () => void;
	onOpenSettings: () => void;
	onRestartBloom: () => void;
	displayVolume: number;
	onVolumeChange: (vol: number) => void;
	displayBrightness: number;
	onBrightnessChange: (bright: number) => void;
	onPinNotch?: (pinned: boolean) => void;
}

type CCTab = "quick" | "sound" | "display";

export function CommandCenterFull({
	wifiEnabled,
	wifiConnected,
	wifiSsid,
	onToggleWifi,
	onOpenWifiList,
	bluetoothEnabled,
	btConnectedNames,
	onToggleBluetooth,
	onOpenBluetoothList,
	dockMode,
	onToggleDockMode,
	notchMode,
	onToggleNotchMode,
	dndActive,
	onToggleDnd,
	batterySaverActive,
	onOpenBatterySaver,
	onToggleBatterySaver,
	onOpenSystemTray,
	onOpenNotificationCenter,
	onOpenSettings,
	onRestartBloom,
	displayVolume,
	onVolumeChange,
	displayBrightness,
	onBrightnessChange,
	onPinNotch
}: CommandCenterFullProps) {
	const [activeTab, setActiveTab] = useState<CCTab>("quick");

	/* -----------------------------------------------------------------
	   1. AUDIO OUTPUT DEVICES & PER-APP MIXER & GLOBAL MIC MUTE
	------------------------------------------------------------------ */
	const [outputDevices, setOutputDevices] = useState<AudioOutputDevice[]>([]);
	const [audioSessions, setAudioSessions] = useState<AudioSessionItem[]>([]);
	const [micMuted, setMicMuted] = useState(false);

	const fetchAudioOutputs = async () => {
		try {
			const list = await invoke<AudioOutputDevice[]>("get_audio_output_devices");
			setOutputDevices(list);
		} catch (e) {
			console.error("Failed to load audio outputs:", e);
		}
	};

	const fetchAudioSessions = async () => {
		try {
			const sessions = await invoke<AudioSessionItem[]>("get_audio_sessions");
			setAudioSessions(sessions);
		} catch (e) {
			console.error("Failed to load audio sessions:", e);
		}
	};

	const fetchMicState = async () => {
		try {
			const muted = await invoke<boolean>("get_global_mic_mute");
			setMicMuted(muted);
		} catch {}
	};

	useEffect(() => {
		fetchAudioOutputs();
		fetchMicState();
		if (activeTab === "sound") {
			fetchAudioSessions();
			const interval = setInterval(fetchAudioSessions, 2000);
			return () => clearInterval(interval);
		}
	}, [activeTab]);

	const handleSelectOutput = async (id: string) => {
		try {
			await invoke("set_default_audio_device", { deviceId: id });
			setOutputDevices((prev) =>
				prev.map((d) => ({ ...d, is_default: d.id === id }))
			);
		} catch (e) {
			console.error("Failed to select output device:", e);
		}
	};

	const handleToggleMicMute = async () => {
		try {
			const next = !micMuted;
			await invoke("set_global_mic_mute", { muted: next });
			setMicMuted(next);
		} catch (e) {
			console.error("Failed to toggle mic mute:", e);
		}
	};

	const handleAppVolume = async (pid: number, vol: number) => {
		try {
			await invoke("set_app_volume", { pid, volume: vol });
			setAudioSessions((prev) =>
				prev.map((s) => (s.pid === pid ? { ...s, volume: vol, is_muted: false } : s))
			);
		} catch {}
	};

	const handleAppMute = async (pid: number, currentMuted: boolean) => {
		try {
			const next = !currentMuted;
			await invoke("set_app_mute", { pid, muted: next });
			setAudioSessions((prev) =>
				prev.map((s) => (s.pid === pid ? { ...s, is_muted: next } : s))
			);
		} catch {}
	};

	const handleSpatialSound = () => {
		invoke("open_spatial_sound_settings").catch(() => {});
	};

	/* -----------------------------------------------------------------
	   2. CONNECTIVITY (HOTSPOT, VPN, AIRPLANE)
	------------------------------------------------------------------ */
	const [hotspotActive, setHotspotActive] = useState(false);
	const [airplaneActive, setAirplaneActive] = useState(false);
	const [vpnList, setVpnList] = useState<VpnProfile[]>([]);

	const fetchConnectivity = async () => {
		try {
			const [hs, ap, vpns] = await Promise.all([
				invoke<boolean>("get_mobile_hotspot_state").catch(() => false),
				invoke<boolean>("get_airplane_mode_state").catch(() => false),
				invoke<VpnProfile[]>("get_vpn_connections").catch(() => [])
			]);
			setHotspotActive(hs);
			setAirplaneActive(ap);
			setVpnList(vpns);
		} catch {}
	};

	useEffect(() => {
		fetchConnectivity();
	}, [activeTab]);

	const handleToggleHotspot = async () => {
		try {
			const next = !hotspotActive;
			setHotspotActive(next);
			const res = await invoke<boolean>("set_mobile_hotspot_state", { enable: next });
			setHotspotActive(res);
		} catch (e) {
			console.error("Failed to toggle hotspot:", e);
			fetchConnectivity();
		}
	};

	const handleToggleAirplane = async () => {
		try {
			const next = !airplaneActive;
			setAirplaneActive(next);
			const res = await invoke<boolean>("set_airplane_mode_state", { enable: next });
			setAirplaneActive(res);
		} catch (e) {
			console.error("Failed to toggle airplane mode:", e);
			fetchConnectivity();
		}
	};

	const handleToggleVpn = async (name: string, connected: boolean) => {
		try {
			const next = !connected;
			setVpnList((prev) =>
				prev.map((v) => (v.name === name ? { ...v, connected: next } : v))
			);
			await invoke("toggle_vpn_connection", { name, connect: next });
			setTimeout(fetchConnectivity, 1500);
		} catch {}
	};

	/* -----------------------------------------------------------------
	   3. DISPLAY & MONITORS (NIGHT LIGHT, WIN+P, CAST)
	------------------------------------------------------------------ */
	const [nightLightActive, setNightLightActive] = useState(false);

	const fetchDisplay = async () => {
		try {
			const nl = await invoke<boolean>("get_night_light_state");
			setNightLightActive(nl);
		} catch {}
	};

	useEffect(() => {
		fetchDisplay();
	}, [activeTab]);

	const handleToggleNightLight = async () => {
		try {
			const next = !nightLightActive;
			setNightLightActive(next);
			await invoke("set_night_light_state", { enable: next });
		} catch (e) {
			console.error("Failed to toggle night light:", e);
			fetchDisplay();
		}
	};

	const handleProjection = (mode: string) => {
		invoke("set_projection_mode", { mode }).catch(() => {});
	};

	const handleCast = () => {
		invoke("open_wireless_display_cast").catch(() => {});
	};

	/* -----------------------------------------------------------------
	   4. HARDWARE (POWER MODE, USB EJECT, TOUCH KEYBOARD)
	------------------------------------------------------------------ */
	const [powerMode, setPowerMode] = useState<string>("balanced");
	const [removableDrives, setRemovableDrives] = useState<RemovableDrive[]>([]);

	const fetchHardware = async () => {
		try {
			const [pm, drives] = await Promise.all([
				invoke<string>("get_power_mode").catch(() => "balanced"),
				invoke<RemovableDrive[]>("get_removable_drives").catch(() => [])
			]);
			setPowerMode(pm);
			setRemovableDrives(drives);
		} catch {}
	};

	useEffect(() => {
		fetchHardware();
	}, [activeTab]);

	const handleSetPowerMode = async (mode: string) => {
		try {
			setPowerMode(mode);
			await invoke("set_power_mode", { mode });
		} catch {}
	};

	const handleEjectDrive = async (letter: string) => {
		try {
			await invoke("eject_removable_drive", { driveLetter: letter });
			setRemovableDrives((prev) => prev.filter((d) => d.letter !== letter));
		} catch {}
	};

	const currentOutput = outputDevices.find((d) => d.is_default) || outputDevices[0];

	return (
		<div className="cc-full-container" onClick={(e) => e.stopPropagation()}>
			{/* Top Segmented Navigation Tabs */}
			<div className="cc-tabs-header">
				<button
					className={`cc-tab-btn ${activeTab === "quick" ? "active" : ""}`}
					onClick={() => setActiveTab("quick")}
				>
					<Compass size={13} strokeWidth={2.4} />
					<span>Quick</span>
				</button>
				<button
					className={`cc-tab-btn ${activeTab === "sound" ? "active" : ""}`}
					onClick={() => setActiveTab("sound")}
				>
					<Volume2 size={13} strokeWidth={2.4} />
					<span>Sound</span>
				</button>
				<button
					className={`cc-tab-btn ${activeTab === "display" ? "active" : ""}`}
					onClick={() => setActiveTab("display")}
				>
					<Monitor size={13} strokeWidth={2.4} />
					<span>Display</span>
				</button>
			</div>

			{/* ================= TAB 1: QUICK CONTROLS ================= */}
			{activeTab === "quick" && (
				<motion.div
					key="tab-quick"
					className="cc-tab-page"
					initial={{ opacity: 0, y: 6 }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: -6 }}
					transition={{ duration: 0.15 }}
				>
					{/* Pills Grid (6 Quick Tiles) */}
					<div className="cc-grid-2col">
						{/* Wi-Fi Tile */}
						<div
							className={`cc-tile-card ${wifiEnabled ? "active" : ""}`}
							onClick={onToggleWifi}
							onContextMenu={(e) => {
								e.preventDefault();
								invoke("open_wifi_settings").catch(() => {});
							}}
							title={`Wi-Fi: ${wifiEnabled ? "On" : "Off"} · Right-click for Settings`}
						>
							<div className="cc-tile-icon-bubble">
								<Wifi size={14} strokeWidth={2.5} />
							</div>
							<div className="cc-tile-text">
								<span className="cc-tile-label">Wi-Fi</span>
								<span className="cc-tile-sub">
									{!wifiEnabled ? "Off" : wifiConnected ? wifiSsid || "Connected" : "On"}
								</span>
							</div>
							<button
								className="cc-tile-more-btn"
								title="Available Networks"
								onPointerDown={(e) => e.stopPropagation()}
								onMouseDown={(e) => e.stopPropagation()}
								onClick={(e) => {
									e.stopPropagation();
									onOpenWifiList();
								}}
							>
								<ChevronRight size={15} strokeWidth={2.5} />
							</button>
						</div>

						{/* Bluetooth Tile */}
						<div
							className={`cc-tile-card ${bluetoothEnabled ? "active" : ""}`}
							onClick={onToggleBluetooth}
							onContextMenu={(e) => {
								e.preventDefault();
								invoke("open_bluetooth_settings").catch(() => {});
							}}
							title={`Bluetooth: ${bluetoothEnabled ? "On" : "Off"} · Right-click for Settings`}
						>
							<div className="cc-tile-icon-bubble">
								<Bluetooth size={14} strokeWidth={2.5} />
							</div>
							<div className="cc-tile-text">
								<span className="cc-tile-label">Bluetooth</span>
								<span className="cc-tile-sub">
									{!bluetoothEnabled
										? "Off"
										: btConnectedNames.length > 0
											? btConnectedNames[0]
											: "On"}
								</span>
							</div>
							<button
								className="cc-tile-more-btn"
								title="Bluetooth Devices"
								onPointerDown={(e) => e.stopPropagation()}
								onMouseDown={(e) => e.stopPropagation()}
								onClick={(e) => {
									e.stopPropagation();
									onOpenBluetoothList();
								}}
							>
								<ChevronRight size={15} strokeWidth={2.5} />
							</button>
						</div>

						{/* Mobile Hotspot Tile */}
						<div
							className={`cc-tile-card ${hotspotActive ? "active" : ""}`}
							onClick={handleToggleHotspot}
							title="Toggle Mobile Hotspot"
						>
							<div className="cc-tile-icon-bubble">
								<Radio size={14} strokeWidth={2.5} />
							</div>
							<div className="cc-tile-text">
								<span className="cc-tile-label">Hotspot</span>
								<span className="cc-tile-sub">{hotspotActive ? "Sharing" : "Off"}</span>
							</div>
						</div>

						{/* Airplane Mode Tile */}
						<div
							className={`cc-tile-card ${airplaneActive ? "active" : ""}`}
							onClick={handleToggleAirplane}
							title="Toggle Airplane Mode"
						>
							<div className="cc-tile-icon-bubble">
								<Plane size={14} strokeWidth={2.5} />
							</div>
							<div className="cc-tile-text">
								<span className="cc-tile-label">Airplane</span>
								<span className="cc-tile-sub">{airplaneActive ? "On" : "Off"}</span>
							</div>
						</div>

						{/* Night Light Tile */}
						<div
							className={`cc-tile-card ${nightLightActive ? "active" : ""}`}
							onClick={handleToggleNightLight}
							title="Toggle Night Light Filter"
						>
							<div className="cc-tile-icon-bubble">
								<Moon size={14} strokeWidth={2.5} />
							</div>
							<div className="cc-tile-text">
								<span className="cc-tile-label">Night Light</span>
								<span className="cc-tile-sub">{nightLightActive ? "Active" : "Off"}</span>
							</div>
						</div>

						{/* Windows VPN Tile */}
						<div
							className={`cc-tile-card ${vpnList.some((v) => v.connected) ? "active" : ""}`}
							onClick={() => {
								if (vpnList.length > 0) {
									handleToggleVpn(vpnList[0].name, vpnList[0].connected);
								} else {
									invoke("open_vpn_settings").catch(() => {});
								}
							}}
							title={vpnList.length > 0 ? `VPN: ${vpnList[0].name}` : "Windows VPN"}
						>
							<div className="cc-tile-icon-bubble">
								<Shield size={14} strokeWidth={2.5} />
							</div>
							<div className="cc-tile-text">
								<span className="cc-tile-label">VPN</span>
								<span className="cc-tile-sub">
									{vpnList.find((v) => v.connected)?.name || (vpnList.length > 0 ? "Disconnected" : "Configure")}
								</span>
							</div>
						</div>
					</div>

					{/* Sliders Area */}
					<div className="cc-sliders-container">
						{/* Volume Slider with Quick Output Badge */}
						<div
							className="cc-slider-card"
							onWheel={(e) => {
								e.preventDefault();
								const step = e.deltaY < 0 ? 0.05 : -0.05;
								onVolumeChange(Math.max(0, Math.min(1, displayVolume + step)));
							}}
							onContextMenu={(e) => {
								e.preventDefault();
								invoke("open_sound_settings").catch(() => {});
							}}
							title="Volume · Scroll to adjust · Right-click for Sound settings"
						>
							<div className="cc-slider-header">
								<div className="cc-slider-title">
									<Volume2 size={13} strokeWidth={2.2} />
									<span>Volume</span>
								</div>
								{currentOutput && (
									<button
										className="cc-device-badge"
										onClick={() => setActiveTab("sound")}
										title="Switch Audio Output"
									>
										{currentOutput.device_type === "headphones" ? (
											<Headphones size={11} />
										) : currentOutput.device_type === "display" ? (
											<Tv size={11} />
										) : (
											<Speaker size={11} />
										)}
										<span className="cc-badge-text">{currentOutput.name}</span>
									</button>
								)}
								<span className="cc-slider-val">{Math.round(displayVolume * 100)}%</span>
							</div>
							<div className="cc-slider-bar-track">
								<input
									type="range"
									min="0"
									max="1"
									step="0.01"
									value={displayVolume}
									onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
									onPointerDown={(e) => e.stopPropagation()}
									className="cc-slider-input"
								/>
								<div
									className="cc-slider-fill"
									style={{ width: `${displayVolume * 100}%` }}
								/>
							</div>
						</div>

						{/* Brightness Slider */}
						<div
							className="cc-slider-card"
							onWheel={(e) => {
								e.preventDefault();
								const step = e.deltaY < 0 ? 5 : -5;
								onBrightnessChange(Math.max(0, Math.min(100, displayBrightness + step)));
							}}
							onContextMenu={(e) => {
								e.preventDefault();
								invoke("open_display_settings").catch(() => {});
							}}
							title="Brightness · Scroll to adjust · Right-click for Display settings"
						>
							<div className="cc-slider-header">
								<div className="cc-slider-title">
									<Sun size={13} strokeWidth={2.2} />
									<span>Brightness</span>
								</div>
								<span className="cc-slider-val">{Math.round(displayBrightness)}%</span>
							</div>
							<div className="cc-slider-bar-track">
								<input
									type="range"
									min="0"
									max="100"
									step="1"
									value={displayBrightness}
									onChange={(e) => onBrightnessChange(parseInt(e.target.value))}
									onPointerDown={(e) => e.stopPropagation()}
									className="cc-slider-input"
								/>
								<div
									className="cc-slider-fill"
									style={{ width: `${displayBrightness}%` }}
								/>
							</div>
						</div>
					</div>

					{/* Circular Quick Action Buttons */}
					<div className="cc-actions-bar">
						<button
							className={`cc-action-circle-btn ${dndActive ? "active" : ""}`}
							onClick={onToggleDnd}
							title={`Focus / Do Not Disturb: ${dndActive ? "On" : "Off"}`}
						>
							<Moon size={14} strokeWidth={2.4} />
						</button>
						<button
							className={`cc-action-circle-btn ${batterySaverActive ? "active" : ""}`}
							onClick={onToggleBatterySaver || onOpenBatterySaver}
							onContextMenu={(e) => {
								e.preventDefault();
								onOpenBatterySaver?.();
							}}
							title={`Energy Saver: ${batterySaverActive ? "Active (Click to Turn Off)" : "Off (Click to Turn On)"} · Right-click for Settings`}
						>
							<BatteryCharging size={14} strokeWidth={2.4} />
						</button>
						<button
							className={`cc-action-circle-btn ${micMuted ? "muted-alert" : ""}`}
							onClick={handleToggleMicMute}
							title={`Microphone: ${micMuted ? "MUTED" : "Active"}`}
						>
							{micMuted ? (
								<MicOff size={14} strokeWidth={2.4} color="#f87171" />
							) : (
								<Mic size={14} strokeWidth={2.4} />
							)}
						</button>
						<button
							className="cc-action-circle-btn"
							onClick={onOpenSystemTray}
							title="System Tray"
						>
							<SlidersHorizontal size={14} strokeWidth={2.4} />
						</button>
						<button
							className="cc-action-circle-btn"
							onClick={onOpenNotificationCenter}
							title="Notification Center"
						>
							<Bell size={14} strokeWidth={2.4} />
						</button>
						<button
							className="cc-action-circle-btn"
							onClick={onOpenSettings}
							title="Bloom Settings"
						>
							<SettingsIcon size={14} strokeWidth={2.4} />
						</button>
						<button
							className="cc-action-circle-btn"
							onClick={onRestartBloom}
							title="Restart Bloom"
						>
							<RotateCcw size={14} strokeWidth={2.4} />
						</button>
					</div>
				</motion.div>
			)}

			{/* ================= TAB 2: SOUND & MIXER ================= */}
			{activeTab === "sound" && (
				<motion.div
					key="tab-sound"
					className="cc-tab-page sound-page"
					initial={{ opacity: 0, y: 6 }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: -6 }}
					transition={{ duration: 0.15 }}
				>
					{/* Audio Output Devices List */}
					<div className="cc-section-block">
						<div className="cc-section-title-row">
							<span className="cc-section-title">Playback Output Device</span>
							<button
								className="cc-action-chip"
								onClick={handleToggleMicMute}
								title="Toggle Default Microphone Mute"
							>
								{micMuted ? (
									<>
										<MicOff size={11} color="#f87171" />
										<span style={{ color: "#f87171" }}>Mic Muted</span>
									</>
								) : (
									<>
										<Mic size={11} />
										<span>Mic On</span>
									</>
								)}
							</button>
						</div>

						<div className="cc-devices-list">
							{outputDevices.map((dev) => (
								<div
									key={dev.id}
									className={`cc-device-item ${dev.is_default ? "selected" : ""}`}
									onClick={() => handleSelectOutput(dev.id)}
								>
									<div className="cc-device-item-left">
										<div className="cc-device-icon">
											{dev.device_type === "headphones" ? (
												<Headphones size={13} />
											) : dev.device_type === "display" ? (
												<Tv size={13} />
											) : (
												<Speaker size={13} />
											)}
										</div>
										<span className="cc-device-name" title={dev.name}>
											{dev.name}
										</span>
									</div>
									{dev.is_default && (
										<div className="cc-check-dot">
											<Check size={12} strokeWidth={3} />
										</div>
									)}
								</div>
							))}
						</div>
					</div>

					{/* Spatial Sound & App Mixer Expand Header */}
					<div className="cc-section-block">
						<div className="cc-section-title-row">
							<span className="cc-section-title">App Volume Mixer</span>
							<button
								className="cc-action-chip"
								onClick={handleSpatialSound}
								title="Configure Spatial Sound (Windows Sonic / Dolby)"
							>
								<SlidersHorizontal size={11} />
								<span>Spatial Sound</span>
							</button>
						</div>

						{/* App Volume Mixer Rows */}
						<div className="cc-mixer-list">
							{audioSessions.length === 0 ? (
								<div className="cc-empty-hint">No active applications playing audio</div>
							) : (
								audioSessions.map((session) => (
									<div key={session.pid} className="cc-mixer-row">
										<div className="cc-mixer-app-info" title={session.name}>
											<span className="cc-mixer-app-name">{session.name}</span>
											<span className="cc-mixer-pct">
												{Math.round(session.volume * 100)}%
											</span>
										</div>
										<div className="cc-mixer-controls">
											<div className="cc-mixer-track">
												<input
													type="range"
													min="0"
													max="1"
													step="0.01"
													value={session.is_muted ? 0 : session.volume}
													onChange={(e) =>
														handleAppVolume(session.pid, parseFloat(e.target.value))
													}
													onPointerDown={(e) => e.stopPropagation()}
													className="cc-slider-input mini"
												/>
												<div
													className="cc-slider-fill"
													style={{
														width: `${(session.is_muted ? 0 : session.volume) * 100}%`
													}}
												/>
											</div>
											<button
												className={`cc-mixer-mute-btn ${session.is_muted ? "muted" : ""}`}
												onClick={() => handleAppMute(session.pid, session.is_muted)}
												title={session.is_muted ? "Unmute" : "Mute"}
											>
												{session.is_muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
											</button>
										</div>
									</div>
								))
							)}
						</div>
					</div>
				</motion.div>
			)}

			{/* ================= TAB 3: DISPLAY & HARDWARE ================= */}
			{activeTab === "display" && (
				<motion.div
					key="tab-display"
					className="cc-tab-page display-page"
					initial={{ opacity: 0, y: 6 }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: -6 }}
					transition={{ duration: 0.15 }}
				>
					{/* Projection & Multi-Monitor Modes */}
					<div className="cc-section-block">
						<div className="cc-section-title-row">
							<span className="cc-section-title">Project & Multimonitor (Win+P)</span>
							<button
								className="cc-action-chip"
								onClick={handleCast}
								title="Wireless Display / Cast Flyout (Win+K)"
							>
								<Cast size={11} />
								<span>Wireless Cast</span>
							</button>
						</div>

						<div className="cc-projection-grid">
							<button
								className="cc-proj-btn"
								onClick={() => handleProjection("internal")}
								title="PC Screen Only"
							>
								<Laptop size={14} />
								<span>PC Only</span>
							</button>
							<button
								className="cc-proj-btn"
								onClick={() => handleProjection("clone")}
								title="Duplicate Across Displays"
							>
								<Copy size={14} />
								<span>Duplicate</span>
							</button>
							<button
								className="cc-proj-btn"
								onClick={() => handleProjection("extend")}
								title="Extend Desktop"
							>
								<Layers size={14} />
								<span>Extend</span>
							</button>
							<button
								className="cc-proj-btn"
								onClick={() => handleProjection("external")}
								title="Second Screen Only"
							>
								<Monitor size={14} />
								<span>Second Only</span>
							</button>
						</div>
					</div>

					{/* Power Mode */}
					<div className="cc-section-block">
						<div className="cc-section-title-row">
							<span className="cc-section-title">Power Mode</span>
						</div>

						<div className="cc-power-mode-group">
							<button
								className={`cc-pm-segment ${powerMode === "efficiency" ? "active" : ""}`}
								onClick={() => handleSetPowerMode("efficiency")}
							>
								Efficiency
							</button>
							<button
								className={`cc-pm-segment ${powerMode === "balanced" ? "active" : ""}`}
								onClick={() => handleSetPowerMode("balanced")}
							>
								Balanced
							</button>
							<button
								className={`cc-pm-segment ${powerMode === "performance" ? "active" : ""}`}
								onClick={() => handleSetPowerMode("performance")}
							>
								Performance
							</button>
						</div>
					</div>

					{/* Removable Media & Safe USB Eject */}
					<div className="cc-section-block">
						<div className="cc-section-title-row">
							<span className="cc-section-title">Removable Storage</span>
							<button
								className="cc-action-chip"
								onClick={fetchHardware}
								title="Refresh connected USB drives"
							>
								<RefreshCw size={11} />
								<span>Refresh</span>
							</button>
						</div>

						<div className="cc-drives-list">
							{removableDrives.length === 0 ? (
								<div className="cc-empty-hint">No removable USB drives connected</div>
							) : (
								removableDrives.map((drive) => (
									<div key={drive.letter} className="cc-drive-row">
										<div className="cc-drive-info">
											<HardDrive size={13} />
											<span className="cc-drive-label">{drive.label}</span>
											<span className="cc-drive-size">
												{drive.free_gb.toFixed(1)}GB free of {drive.total_gb.toFixed(1)}GB
											</span>
										</div>
										<button
											className="cc-eject-btn"
											onClick={() => handleEjectDrive(drive.letter)}
											title="Safely Remove / Eject USB"
										>
											Eject
										</button>
									</div>
								))
							)}
						</div>
					</div>

					{/* Bloom Appearance Controls */}
					<div className="cc-section-block">
						<div className="cc-section-title-row">
							<span className="cc-section-title">Bloom Appearance</span>
						</div>
						<div className="cc-power-mode-group">
							<button
								className="cc-pm-segment"
								onClick={onToggleDockMode}
								title="Cycle dock mode: Fixed / Smart / Peek"
							>
								Dock: {dockMode}
							</button>
							<button
								className="cc-pm-segment"
								onClick={onToggleNotchMode}
								title="Cycle notch mode: Fixed / Smart / Peek"
							>
								Notch: {notchMode}
							</button>
							{onPinNotch && (
								<button
									className="cc-pm-segment"
									onClick={() => onPinNotch(true)}
									title="Pin Notch open"
								>
									Pin Notch
								</button>
							)}
						</div>
					</div>
				</motion.div>
			)}
		</div>
	);
}
