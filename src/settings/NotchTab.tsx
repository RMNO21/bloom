import { useState, useEffect, useRef } from "react";
import {
	PanelTop,
	Calendar,
	BellRing,
	Music,
	Minimize2,
	LayoutList,
	Sparkles,
	Circle,
	CloudSun,
	Timer,
	Archive,
	X,
	Flame,
	RotateCcw,
	Sliders,
	MoveVertical,
	Shield,
	Box
} from "lucide-react";
import { SettingRow } from "./SettingRow";
import { StatusWidgetConfig } from "../components/StatusWidgetConfig";
import type { WidgetConfig } from "./types";
import { NotchPanelId, DEFAULT_NOTCH_PANELS_ORDER } from "./useSettings";

interface NotchTabProps {
	notchMode: string;
	setNotchModeValue: (mode: string) => void;
	notchEdgeDelay: number;
	handleNotchEdgeDelayChange: (val: number) => void;
	notchOffsetY?: number;
	handleNotchOffsetYChange?: (val: number) => void;
	notchWidthOffset?: number;
	handleNotchWidthOffsetChange?: (val: number) => void;
	notchCornerRadius?: number;
	handleNotchCornerRadiusChange?: (val: number) => void;
	notchCloseOutside?: boolean;
	toggleNotchCloseOutside?: () => void;
	notchProtectStartMenu?: boolean;
	toggleNotchProtectStartMenu?: () => void;
	notchFullscreenDisable?: boolean;
	toggleNotchFullscreenDisable?: () => void;
	calendarEnabled: boolean;
	toggleCalendar: () => void;
	timerPresets: number[];
	updateTimerPresets: (presets: number[]) => void;
	notchRememberPanel: boolean;
	toggleNotchRememberPanel: () => void;
	notchDefaultPanel: "calendar" | "command-center" | "timers" | "notifications";
	changeNotchDefaultPanel: (panel: "calendar" | "command-center" | "timers" | "notifications") => void;
	notchPanelsOrder?: NotchPanelId[];
	updateNotchPanelsOrder?: (order: NotchPanelId[]) => void;
	timerSoundEnabled: boolean;
	toggleTimerSound: () => void;
	musicModeEnabled: boolean;
	toggleMusicMode: () => void;
	musicCompactNotch: boolean;
	toggleMusicCompactNotch: () => void;
	shelfPersist: boolean;
	toggleShelfPersist: () => void;
	mediaLayout: "classic" | "compact";
	toggleMediaLayout: (layout: "classic" | "compact") => void;
	mediaAmbienceEnabled: boolean;
	toggleAmbience: () => void;
	mediaCompactGlowEnabled: boolean;
	toggleCompactGlow: () => void;
	weatherEnabled: boolean;
	toggleWeather: () => void;
	tempUnitFahrenheit: boolean;
	toggleTempUnit: () => void;
	cityName: string;
	setCityName: (name: string) => void;
	citySearchResults: Array<{ name: string; country: string; latitude: number; longitude: number }>;
	showCityDropdown: boolean;
	setShowCityDropdown: (show: boolean) => void;
	selectCity: (city: {
		name: string;
		country: string;
		latitude: number;
		longitude: number;
	}) => void;
	handleCityClear: () => void;
	statusWidgets: WidgetConfig;
	handleWidgetsChange: (config: WidgetConfig) => void;
	pomoFocusMins?: number;
	pomoShortMins?: number;
	pomoLongMins?: number;
	pomoCycles?: number;
	updatePomoSettings?: (focus: number, shortB: number, longB: number, cycles: number) => void;
	resetPomoProgress?: () => void;
}

const PANEL_DEFINITIONS: Record<NotchPanelId, { name: string; icon: any }> = {
	"command-center": {
		name: "Command Center (Dashboard)",
		icon: Sliders
	},
	"calendar": {
		name: "To-Do & Notes",
		icon: Calendar
	},
	"timers": {
		name: "Timers & Alarms",
		icon: Timer
	},
	"notifications": {
		name: "Notification Center",
		icon: BellRing
	}
};

export function NotchTab({
	notchMode,
	setNotchModeValue,
	notchEdgeDelay,
	handleNotchEdgeDelayChange,
	notchOffsetY = 0,
	handleNotchOffsetYChange,
	notchWidthOffset = 0,
	handleNotchWidthOffsetChange,
	notchCornerRadius = 18,
	handleNotchCornerRadiusChange,
	notchCloseOutside = true,
	toggleNotchCloseOutside,
	notchProtectStartMenu = true,
	toggleNotchProtectStartMenu,
	notchFullscreenDisable = true,
	toggleNotchFullscreenDisable,
	calendarEnabled,
	toggleCalendar,
	timerPresets,
	updateTimerPresets,
	notchRememberPanel,
	toggleNotchRememberPanel,
	notchDefaultPanel,
	changeNotchDefaultPanel,
	notchPanelsOrder,
	updateNotchPanelsOrder,
	timerSoundEnabled,
	toggleTimerSound,
	musicModeEnabled,
	toggleMusicMode,
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
	statusWidgets,
	handleWidgetsChange,
	pomoFocusMins = 25,
	pomoShortMins = 5,
	pomoLongMins = 15,
	pomoCycles = 4,
	updatePomoSettings,
	resetPomoProgress
}: NotchTabProps) {
	const [newPresetVal, setNewPresetVal] = useState("");
	const [presetsInput, setPresetsInput] = useState(() => (timerPresets || [5, 15, 25, 50]).join(", "));
	const isInputFocusedRef = useRef(false);

	const currentPanelsOrder = (notchPanelsOrder && notchPanelsOrder.length === 4)
		? notchPanelsOrder
		: DEFAULT_NOTCH_PANELS_ORDER;

	const handleMovePanel = (idx: number, direction: -1 | 1) => {
		if (!updateNotchPanelsOrder) return;
		const targetIdx = idx + direction;
		if (targetIdx < 0 || targetIdx >= currentPanelsOrder.length) return;
		const next = [...currentPanelsOrder];
		const temp = next[idx];
		next[idx] = next[targetIdx];
		next[targetIdx] = temp;
		updateNotchPanelsOrder(next);
	};

	const handleResetPanelOrder = () => {
		if (!updateNotchPanelsOrder) return;
		updateNotchPanelsOrder(DEFAULT_NOTCH_PANELS_ORDER);
	};

	useEffect(() => {
		if (!isInputFocusedRef.current) {
			setPresetsInput((timerPresets || [5, 15, 25, 50]).join(", "));
		}
	}, [timerPresets]);

	const removePreset = (indexToRemove: number) => {
		const next = timerPresets.filter((_, idx) => idx !== indexToRemove);
		if (next.length > 0) {
			updateTimerPresets(next);
		}
	};

	const addPreset = () => {
		const val = parseFloat(newPresetVal.trim());
		if (!isNaN(val) && val > 0 && val <= 720) {
			const next = Array.from(new Set([...timerPresets, val])).sort((a, b) => a - b);
			updateTimerPresets(next);
			setNewPresetVal("");
		}
	};

	const resetPresets = () => {
		const defaults = [5, 15, 25, 50];
		updateTimerPresets(defaults);
		setPresetsInput(defaults.join(", "));
	};

	const handlePresetsChange = (val: string) => {
		setPresetsInput(val);
	};

	const handlePresetsCommit = () => {
		const nums = presetsInput
			.split(/[\s,]+/)
			.map((s) => parseFloat(s.trim()))
			.filter((n) => !isNaN(n) && n > 0 && n <= 720);
		if (nums.length > 0) {
			const unique = Array.from(new Set(nums)).sort((a, b) => a - b);
			setPresetsInput(unique.join(", "));
			updateTimerPresets(unique);
		} else {
			setPresetsInput((timerPresets || [5, 15, 25, 50]).join(", "));
		}
	};

	return (
		<>
			<div className="setting-group-label">Notch Behavior</div>
			<div className="setting-group">
				<SettingRow icon={PanelTop} label="Trigger Mode" desc="Choose how the notch activates and expands">
					<select
						className="settings-select"
						value={notchMode}
						onChange={(e) => setNotchModeValue(e.target.value)}
					>
						<option value="smart">Smart (Expand on hover / click)</option>
						<option value="fixed">Fixed (Always expanded)</option>
						<option value="peek">Peek (Show only on edge contact)</option>
					</select>
				</SettingRow>

				{notchMode !== "fixed" && (
					<SettingRow
						icon={Timer}
						label="Hover Delay"
						desc={
							notchEdgeDelay === 0
								? "Reveal instantly on top-edge contact"
								: `Wait ${notchEdgeDelay}ms on screen edge before expanding`
						}
					>
						<input
							type="range"
							min="0"
							max="800"
							step="50"
							value={notchEdgeDelay}
							onChange={(e) => handleNotchEdgeDelayChange(parseInt(e.target.value))}
							className="settings-slider"
						/>
					</SettingRow>
				)}

				<SettingRow
					icon={Shield}
					label="Suppress in Fullscreen Games"
					desc="Disable mouse hover activation while gaming or watching fullscreen videos"
				>
					<label className="toggle-switch">
						<input
							type="checkbox"
							checked={notchFullscreenDisable}
							onChange={toggleNotchFullscreenDisable}
						/>
						<span className="slider"></span>
					</label>
				</SettingRow>

				<SettingRow
					icon={PanelTop}
					label="Close on Outside Click"
					desc="Automatically collapse the notch when clicking anywhere else on screen"
				>
					<label className="toggle-switch">
						<input
							type="checkbox"
							checked={notchCloseOutside}
							onChange={toggleNotchCloseOutside}
						/>
						<span className="slider"></span>
					</label>
				</SettingRow>

				<SettingRow
					icon={Shield}
					label="Protect on Start Menu"
					desc="Prevent notch from accidentally closing when opening the Windows Start Menu"
					divider={false}
				>
					<label className="toggle-switch">
						<input
							type="checkbox"
							checked={notchProtectStartMenu}
							onChange={toggleNotchProtectStartMenu}
						/>
						<span className="slider"></span>
					</label>
				</SettingRow>
			</div>

			<div className="setting-group-label setting-group-label--spaced">Dimensions & Position</div>
			<div className="setting-group">
				<SettingRow
					icon={MoveVertical}
					label="Top Screen Offset (Y)"
					desc={`Vertical margin from top screen bezel (${notchOffsetY}px)`}
				>
					<input
						type="range"
						min="0"
						max="24"
						step="2"
						value={notchOffsetY}
						onChange={(e) => handleNotchOffsetYChange?.(parseInt(e.target.value))}
						className="settings-slider"
					/>
				</SettingRow>

				<SettingRow
					icon={Sliders}
					label="Width Adjustment"
					desc={`Fine-tune notch base width (${notchWidthOffset > 0 ? `+${notchWidthOffset}` : notchWidthOffset}px)`}
				>
					<input
						type="range"
						min="-40"
						max="60"
						step="5"
						value={notchWidthOffset}
						onChange={(e) => handleNotchWidthOffsetChange?.(parseInt(e.target.value))}
						className="settings-slider"
					/>
				</SettingRow>

				<SettingRow
					icon={Box}
					label="Corner Curvature"
					desc={`Bottom border radius curvature (${notchCornerRadius}px)`}
					divider={false}
				>
					<input
						type="range"
						min="12"
						max="26"
						step="1"
						value={notchCornerRadius}
						onChange={(e) => handleNotchCornerRadiusChange?.(parseInt(e.target.value))}
						className="settings-slider"
					/>
				</SettingRow>
			</div>

			<div className="setting-group-label setting-group-label--spaced">Panels & Navigation</div>
			<div className="setting-group">

				<div className="panel-order-section">
					<div className="panel-order-header">
						<div className="panel-order-info">
							<div className="setting-label">Panel Navigation Order</div>
							<div className="setting-desc">Reorder the sequence when cycling through notch panels</div>
						</div>
						<button
							type="button"
							className="settings-btn settings-btn-subtle panel-order-reset-btn"
							onClick={handleResetPanelOrder}
							title="Reset order to default"
						>
							<RotateCcw size={11} />
							<span>Reset Order</span>
						</button>
					</div>

					<div className="panel-order-list">
						{currentPanelsOrder.map((id, idx) => {
							const meta = PANEL_DEFINITIONS[id] || { name: id, icon: PanelTop };
							const Icon = meta.icon;
							const isStart = !notchRememberPanel && id === notchDefaultPanel;
							const isDisabled = id === "calendar" && !calendarEnabled;

							return (
								<div key={id} className={`panel-order-row-item ${isDisabled ? "is-disabled" : ""}`}>
									<div className="panel-order-item-left">
										<span className="panel-order-item-num">{idx + 1}</span>
										<div className="panel-order-item-icon-box">
											<Icon size={14} />
										</div>
										<span className="panel-order-item-name">{meta.name}</span>
										{isStart && <span className="panel-order-item-start-badge">Default Start</span>}
										{isDisabled && <span className="panel-order-item-disabled-badge">Disabled</span>}
									</div>

									<div className="panel-order-item-actions">
										<button
											type="button"
											className="panel-order-move-btn"
											disabled={idx === 0}
											onClick={() => handleMovePanel(idx, -1)}
											title="Move earlier in cycle"
										>
											▲
										</button>
										<button
											type="button"
											className="panel-order-move-btn"
											disabled={idx === currentPanelsOrder.length - 1}
											onClick={() => handleMovePanel(idx, 1)}
											title="Move later in cycle"
										>
											▼
										</button>
									</div>
								</div>
							);
						})}
					</div>
				</div>

				<div className="setting-divider" />

				<SettingRow
					icon={PanelTop}
					label="Remember Last Panel"
					desc="Reopen the panel you last used; turn off to choose a fixed default start tab"
				>
					<label className="toggle-switch">
						<input type="checkbox" checked={notchRememberPanel} onChange={toggleNotchRememberPanel} />
						<span className="slider"></span>
					</label>
				</SettingRow>

				{!notchRememberPanel && (
					<SettingRow icon={PanelTop} label="Default Start Panel" desc="Designate which panel opens first when expanding the notch">
						<select
							className="settings-select"
							value={calendarEnabled ? notchDefaultPanel : (notchDefaultPanel === "calendar" ? "command-center" : notchDefaultPanel)}
							onChange={(e) =>
								changeNotchDefaultPanel(e.target.value as "calendar" | "command-center" | "timers" | "notifications")
							}
						>
							<option value="command-center">Command Center (Dashboard)</option>
							<option value="calendar" disabled={!calendarEnabled}>To-Do & Notes</option>
							<option value="timers">Timers & Alarms</option>
							<option value="notifications">Notification Center</option>
						</select>
					</SettingRow>
				)}

				<SettingRow icon={Calendar} label="To-Do & Notes" desc="Enable productivity split-view with tasks and notes">
					<label className="toggle-switch">
						<input type="checkbox" checked={calendarEnabled} onChange={toggleCalendar} />
						<span className="slider"></span>
					</label>
				</SettingRow>

				{calendarEnabled && (
					<>
						<SettingRow
							icon={Timer}
							label="Timer Presets"
							desc="Quick durations in minutes for the timer"
						>
							<div className="timer-presets-manager">
								<div className="timer-presets-chips">
									{timerPresets.map((preset, idx) => (
										<span key={idx} className="timer-preset-chip">
											<span className="preset-chip-num">{preset}m</span>
											{timerPresets.length > 1 && (
												<button
													type="button"
													className="preset-chip-remove"
													onClick={() => removePreset(idx)}
													title={`Remove ${preset}m`}
												>
													<X size={11} strokeWidth={2.4} />
												</button>
											)}
										</span>
									))}
								</div>

								<div className="timer-presets-add-row">
									<div className="timer-add-field-group">
										<input
											type="number"
											min="1"
											max="720"
											className="timer-add-input"
											value={newPresetVal}
											onChange={(e) => setNewPresetVal(e.target.value)}
											onKeyDown={(e) => {
												if (e.key === "Enter") {
													e.preventDefault();
													addPreset();
												}
											}}
											placeholder="Min (e.g. 45)"
										/>
										<button
											type="button"
											className="timer-add-btn"
											onClick={addPreset}
											disabled={!newPresetVal.trim()}
										>
											+ Add
										</button>
									</div>

									<button
										type="button"
										className="timer-presets-reset-btn"
										onClick={resetPresets}
										title="Reset to 5, 15, 25, 50"
									>
										Reset
									</button>
								</div>

								<div className="timer-presets-manual-row">
									<span className="timer-presets-manual-label">Or edit comma list:</span>
									<input
										type="text"
										className="timer-presets-input"
										value={presetsInput}
										onFocus={() => {
											isInputFocusedRef.current = true;
										}}
										onChange={(e) => handlePresetsChange(e.target.value)}
										onBlur={() => {
											isInputFocusedRef.current = false;
											handlePresetsCommit();
										}}
										onKeyDown={(e) => {
											if (e.key === "Enter") {
												(e.target as HTMLInputElement).blur();
											}
										}}
										placeholder="5, 15, 25, 50"
									/>
								</div>
							</div>
						</SettingRow>

						<SettingRow
							icon={BellRing}
							label="Timer Sound"
							desc="Play a chime when the timer finishes"
						>
							<label className="toggle-switch">
								<input type="checkbox" checked={timerSoundEnabled} onChange={toggleTimerSound} />
								<span className="slider"></span>
							</label>
						</SettingRow>

						<SettingRow
							icon={Flame}
							label="Pomodoro Focus"
							desc={`${pomoFocusMins} minutes focus work duration`}
						>
							<input
								type="range"
								min="5"
								max="90"
								step="5"
								value={pomoFocusMins}
								onChange={(e) =>
									updatePomoSettings?.(parseInt(e.target.value), pomoShortMins, pomoLongMins, pomoCycles)
								}
								className="settings-slider"
							/>
						</SettingRow>

						<SettingRow
							icon={Timer}
							label="Short Break"
							desc={`${pomoShortMins} minutes short pause`}
						>
							<input
								type="range"
								min="1"
								max="30"
								step="1"
								value={pomoShortMins}
								onChange={(e) =>
									updatePomoSettings?.(pomoFocusMins, parseInt(e.target.value), pomoLongMins, pomoCycles)
								}
								className="settings-slider"
							/>
						</SettingRow>

						<SettingRow
							icon={Timer}
							label="Long Break"
							desc={`${pomoLongMins} minutes long rest`}
						>
							<input
								type="range"
								min="5"
								max="60"
								step="5"
								value={pomoLongMins}
								onChange={(e) =>
									updatePomoSettings?.(pomoFocusMins, pomoShortMins, parseInt(e.target.value), pomoCycles)
								}
								className="settings-slider"
							/>
						</SettingRow>

						<SettingRow
							icon={RotateCcw}
							label="Reset Pomodoro Daily Cycles"
							desc="Clear today's completed cycle steps and start fresh"
							action
							onClick={resetPomoProgress}
						/>
					</>
				)}

				<SettingRow icon={Music} label="Music Mode" desc="Interactive live music widget">
					<label className="toggle-switch">
						<input type="checkbox" checked={musicModeEnabled} onChange={toggleMusicMode} />
						<span className="slider"></span>
					</label>
				</SettingRow>

				{musicModeEnabled && (
					<>
						<SettingRow
							icon={Minimize2}
							label="Compact Mode"
							desc="Show visualizer & artwork when collapsed"
						>
							<label className="toggle-switch">
								<input
									type="checkbox"
									checked={musicCompactNotch}
									onChange={toggleMusicCompactNotch}
								/>
								<span className="slider"></span>
							</label>
						</SettingRow>

						<SettingRow icon={LayoutList} label="Media Layout" desc="Choose expanded player style">
							<div className="unit-toggle-minimal wide">
								<span
									className={mediaLayout === "classic" ? "active" : ""}
									onClick={() => toggleMediaLayout("classic")}
								>
									Classic
								</span>
								<span
									className={mediaLayout === "compact" ? "active" : ""}
									onClick={() => toggleMediaLayout("compact")}
								>
									Compact
								</span>
							</div>
						</SettingRow>

						<SettingRow
							icon={Sparkles}
							label="Ambient Glow"
							desc="Colored glow behind expanded album art"
						>
							<label className="toggle-switch">
								<input type="checkbox" checked={mediaAmbienceEnabled} onChange={toggleAmbience} />
								<span className="slider"></span>
							</label>
						</SettingRow>

						<SettingRow
							icon={Circle}
							label="Compact Glow"
							desc="Glow around collapsed thumbnail"
							divider={false}
						>
							<label className="toggle-switch">
								<input
									type="checkbox"
									checked={mediaCompactGlowEnabled}
									onChange={toggleCompactGlow}
								/>
								<span className="slider"></span>
							</label>
						</SettingRow>
					</>
				)}
			</div>

			<div className="setting-group-label">Shelf</div>
			<div className="setting-group">
				<SettingRow
					icon={Archive}
					label="Keep Items"
					desc="Keep shelf items after Bloom closes"
					divider={false}
				>
					<label className="toggle-switch">
						<input type="checkbox" checked={shelfPersist} onChange={toggleShelfPersist} />
						<span className="slider"></span>
					</label>
				</SettingRow>
			</div>

			<div className="setting-group-label">Weather</div>
			<div className="setting-group">
				<SettingRow
					icon={CloudSun}
					label="Weather Status"
					desc={cityName || "Auto-detect location"}
				>
					<div className="weather-controls">
						<div className="unit-toggle-minimal" onClick={toggleTempUnit}>
							<span className={!tempUnitFahrenheit ? "active" : ""}>C</span>
							<span className={tempUnitFahrenheit ? "active" : ""}>F</span>
						</div>
						<label className="toggle-switch">
							<input type="checkbox" checked={weatherEnabled} onChange={toggleWeather} />
							<span className="slider"></span>
						</label>
					</div>
				</SettingRow>

				{weatherEnabled && (
					<div className="manual-city-input">
						<div className="city-input-row">
							<input
								type="text"
								placeholder="Search city..."
								value={cityName}
								onChange={(e) => setCityName(e.target.value)}
								onFocus={() => citySearchResults.length > 0 && setShowCityDropdown(true)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && citySearchResults.length > 0) {
										e.preventDefault();
										selectCity(citySearchResults[0]);
									}
									if (e.key === "Escape") {
										setShowCityDropdown(false);
									}
								}}
								onBlur={() => setTimeout(() => setShowCityDropdown(false), 150)}
							/>
							{cityName && (
								<button
									className="city-clear-btn"
									onMouseDown={(e) => {
										e.preventDefault();
										handleCityClear();
									}}
									title="Clear city"
								>
									<X size={10} strokeWidth={2.5} />
								</button>
							)}
						</div>
						{showCityDropdown && citySearchResults.length > 0 && (
							<div className="city-dropdown">
								{citySearchResults.map((city) => (
									<button
										key={`${city.name}-${city.latitude}`}
										className="city-dropdown-item"
										onMouseDown={(e) => {
											e.preventDefault();
											selectCity(city);
										}}
									>
										<span className="city-dropdown-name">{city.name}</span>
										<span className="city-dropdown-country">{city.country}</span>
									</button>
								))}
							</div>
						)}
					</div>
				)}
			</div>

			<div className="setting-group-label">Widgets</div>
			<div className="setting-group">
				<StatusWidgetConfig value={statusWidgets} onChange={handleWidgetsChange} />
			</div>
		</>
	);
}
