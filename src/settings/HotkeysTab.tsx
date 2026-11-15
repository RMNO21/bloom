import { Keyboard, Shield, CornerDownLeft } from "lucide-react";
import { SettingRow } from "./SettingRow";

export interface HotkeysTabProps {
	hotkeyNotch: string;
	hotkeyDock: string;
	hotkeyNotifs: string;
	hotkeySettings: string;
	updateHotkey?: (key: string, val: string) => void;
	notchFullscreenDisable: boolean;
	toggleNotchFullscreenDisable: () => void;
}

export function HotkeysTab({
	hotkeyNotch,
	hotkeyDock,
	hotkeyNotifs,
	hotkeySettings,
	notchFullscreenDisable,
	toggleNotchFullscreenDisable
}: HotkeysTabProps) {
	return (
		<>
			<div className="setting-group-label">Global Shortcuts</div>
			<div className="setting-group">
				<SettingRow
					icon={Keyboard}
					label="Toggle Notch"
					desc="Expand or collapse the Dynamic Island notch from anywhere"
				>
					<div className="hotkey-badge-container">
						<span className="hotkey-badge">{hotkeyNotch}</span>
					</div>
				</SettingRow>

				<SettingRow
					icon={Keyboard}
					label="Toggle Dock"
					desc="Show or hide the Bloom application dock"
				>
					<div className="hotkey-badge-container">
						<span className="hotkey-badge">{hotkeyDock}</span>
					</div>
				</SettingRow>

				<SettingRow
					icon={Keyboard}
					label="Notification Center"
					desc="Open the notification center panel in the notch directly"
				>
					<div className="hotkey-badge-container">
						<span className="hotkey-badge">{hotkeyNotifs}</span>
					</div>
				</SettingRow>

				<SettingRow
					icon={Keyboard}
					label="Open Settings"
					desc="Open this settings window instantly"
				>
					<div className="hotkey-badge-container">
						<span className="hotkey-badge">{hotkeySettings}</span>
					</div>
				</SettingRow>

				<SettingRow
					icon={CornerDownLeft}
					label="Quick Close / Collapse"
					desc="Collapse an open notch or close flyout panels immediately"
					divider={false}
				>
					<div className="hotkey-badge-container">
						<span className="hotkey-badge">Esc</span>
					</div>
				</SettingRow>
			</div>

			<div className="setting-group-label setting-group-label--spaced">Fullscreen Behavior</div>
			<div className="setting-group">
				<SettingRow
					icon={Shield}
					label="Suppress Hover in Fullscreen Games"
					desc="Prevent the notch from popping out when playing full-screen games or video players"
					divider={false}
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
			</div>
		</>
	);
}
