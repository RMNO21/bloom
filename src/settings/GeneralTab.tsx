import {
	Power,
	Download,
	Clock,
	BatteryWarning,
	RefreshCw,
	RotateCcw,
	LogOut,
	Zap,
	Bell,
	Upload,
	Check
} from "lucide-react";
import { SettingRow } from "./SettingRow";

interface GeneralTabProps {
	autostart: boolean;
	toggleAutostart: () => void;
	fastBoot?: boolean;
	toggleFastBoot?: () => void;
	interceptNotifications?: boolean;
	toggleInterceptNotifications?: () => void;
	timeFormat24h: boolean;
	toggleTimeFormat24h: () => void;
	showUpdateIndicator: boolean;
	toggleUpdateIndicator: () => void;
	lowBatteryThreshold: number;
	handleThresholdChange: (val: number) => void;
	restartBloom: () => void;
	resetToDefaults: () => void;
	quitBloom: () => void;
	handleExportSettings?: () => Promise<void>;
	handleImportSettings?: () => Promise<void>;
	exportStatus?: string;
	importStatus?: string;
}

export function GeneralTab({
	autostart,
	toggleAutostart,
	fastBoot = true,
	toggleFastBoot,
	interceptNotifications = true,
	toggleInterceptNotifications,
	timeFormat24h,
	toggleTimeFormat24h,
	showUpdateIndicator,
	toggleUpdateIndicator,
	lowBatteryThreshold,
	handleThresholdChange,
	restartBloom,
	resetToDefaults,
	quitBloom,
	handleExportSettings,
	handleImportSettings,
	exportStatus = "idle",
	importStatus = "idle"
}: GeneralTabProps) {
	return (
		<>
			<div className="setting-group-label">System</div>
			<div className="setting-group">
				<SettingRow icon={Power} label="Launch at Login" desc="Open Bloom automatically when Windows starts">
					<label className="toggle-switch">
						<input type="checkbox" checked={autostart} onChange={toggleAutostart} />
						<span className="slider"></span>
					</label>
				</SettingRow>

				<SettingRow
					icon={Zap}
					label="Instant Boot (Zero Delay)"
					desc="Launch immediately upon Windows login without 10-second Explorer startup delay"
				>
					<label className="toggle-switch">
						<input type="checkbox" checked={fastBoot} onChange={toggleFastBoot} />
						<span className="slider"></span>
					</label>
				</SettingRow>

				<SettingRow
					icon={Bell}
					label="Live Notch Notifications"
					desc="Show interactive alert banner with inline reply instead of Windows toast"
				>
					<label className="toggle-switch">
						<input
							type="checkbox"
							checked={interceptNotifications}
							onChange={toggleInterceptNotifications}
						/>
						<span className="slider"></span>
					</label>
				</SettingRow>

				<SettingRow
					icon={Download}
					label="Update Indicator"
					desc="Show green dot on clock when an update is ready"
				>
					<label className="toggle-switch">
						<input type="checkbox" checked={showUpdateIndicator} onChange={toggleUpdateIndicator} />
						<span className="slider"></span>
					</label>
				</SettingRow>

				<SettingRow icon={Clock} label="24-Hour Time" desc="Use 24-hour clock format (14:30 vs 2:30 PM)">
					<label className="toggle-switch">
						<input type="checkbox" checked={timeFormat24h} onChange={toggleTimeFormat24h} />
						<span className="slider"></span>
					</label>
				</SettingRow>

				<SettingRow
					icon={BatteryWarning}
					label="Low Battery Alert"
					desc={`Trigger low battery notification at ${lowBatteryThreshold}%`}
					divider={false}
				>
					<input
						type="range"
						min="5"
						max="50"
						step="5"
						value={lowBatteryThreshold}
						onChange={(e) => handleThresholdChange(parseInt(e.target.value))}
						className="settings-slider"
					/>
				</SettingRow>
			</div>

			<div className="setting-group-label setting-group-label--spaced">Backup & Restore</div>
			<div className="setting-group">
				<SettingRow
					icon={Download}
					label="Export Configuration"
					desc="Save all settings, customizations, and layouts to a JSON file"
					action
					onClick={handleExportSettings}
				>
					<button
						type="button"
						className="settings-btn"
						onClick={handleExportSettings}
						disabled={exportStatus === "exporting"}
					>
						{exportStatus === "success" ? (
							<span style={{ color: "#34d399", display: "flex", alignItems: "center", gap: 4 }}>
								<Check size={12} /> Exported
							</span>
						) : (
							"Export JSON"
						)}
					</button>
				</SettingRow>

				<SettingRow
					icon={Upload}
					label="Import Configuration"
					desc="Restore your settings from a previously saved JSON file"
					action
					onClick={handleImportSettings}
					divider={false}
				>
					<button
						type="button"
						className="settings-btn"
						onClick={handleImportSettings}
						disabled={importStatus === "importing"}
					>
						{importStatus === "success" ? (
							<span style={{ color: "#34d399", display: "flex", alignItems: "center", gap: 4 }}>
								<Check size={12} /> Imported
							</span>
						) : (
							"Import JSON"
						)}
					</button>
				</SettingRow>
			</div>

			<div className="setting-group-label setting-group-label--spaced">App Management</div>
			<div className="setting-group">
				<SettingRow
					icon={RotateCcw}
					label="Reset to Defaults"
					desc="Restore factory settings and restart Bloom"
					action
					danger
					onClick={resetToDefaults}
				/>
				<SettingRow
					icon={RefreshCw}
					label="Restart Bloom"
					desc="Reinitialize notch, dock, and notification hooks"
					action
					onClick={restartBloom}
				/>
				<SettingRow
					icon={LogOut}
					label="Quit Bloom"
					desc="Exit Bloom and restore native Windows taskbar"
					action
					danger
					onClick={quitBloom}
					divider={false}
				/>
			</div>
		</>
	);
}
