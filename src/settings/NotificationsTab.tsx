import { useState } from "react";
import {
	Bell,
	BellRing,
	Clock,
	Volume2,
	MessageSquare,
	ShieldCheck,
	Sparkles,
	Sliders,
	Trash2,
	Check,
	Send,
	AlertCircle,
	PhoneCall
} from "lucide-react";
import { SettingRow } from "./SettingRow";

export interface NotificationsTabProps {
	interceptNotifications: boolean;
	toggleInterceptNotifications: () => void;
	notifSuppressWindows: boolean;
	toggleNotifSuppressWindows: () => void;
	notifDuration: number;
	changeNotifDuration: (sec: number) => void;
	notifSound: boolean;
	toggleNotifSound: () => void;
	notifQuickReply: boolean;
	toggleNotifQuickReply: () => void;
	notifCatMessages: boolean;
	toggleNotifCatMessages: () => void;
	notifCatAlarms: boolean;
	toggleNotifCatAlarms: () => void;
	notifCatCalls: boolean;
	toggleNotifCatCalls: () => void;
	notifCatSystem: boolean;
	toggleNotifCatSystem: () => void;
	notifHistoryLimit: number;
	changeNotifHistoryLimit: (limit: number) => void;
	clearNotificationHistory: () => Promise<void>;
	sendTestNotification: (category?: string) => Promise<void>;
}

export function NotificationsTab({
	interceptNotifications,
	toggleInterceptNotifications,
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
	sendTestNotification
}: NotificationsTabProps) {
	const [cleared, setCleared] = useState(false);
	const [testSending, setTestSending] = useState<string | null>(null);

	const handleClear = async () => {
		await clearNotificationHistory();
		setCleared(true);
		setTimeout(() => setCleared(false), 2000);
	};

	const handleTest = async (cat: string) => {
		setTestSending(cat);
		await sendTestNotification(cat);
		setTimeout(() => setTestSending(null), 1000);
	};

	return (
		<>
			<div className="setting-group-label">Dynamic Island Droplet</div>
			<div className="setting-group">
				<SettingRow
					icon={Bell}
					label="Live Notch Notifications"
					desc="Show interactive droplet banner expanding from the notch instead of Windows toast"
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
					icon={Clock}
					label="Display Duration"
					desc={
						notifDuration === 0
							? "Stay until manually dismissed"
							: `Auto-dismiss after ${notifDuration} seconds`
					}
				>
					<div className="notif-duration-selector">
						{[3, 5, 8, 12, 0].map((sec) => (
							<button
								key={sec}
								type="button"
								className={`notif-pill-btn ${notifDuration === sec ? "active" : ""}`}
								onClick={() => changeNotifDuration(sec)}
							>
								{sec === 0 ? "Manual" : `${sec}s`}
							</button>
						))}
					</div>
				</SettingRow>

				<SettingRow
					icon={Volume2}
					label="Notification Sound"
					desc="Play subtle audio chime when a notification arrives"
				>
					<label className="toggle-switch">
						<input type="checkbox" checked={notifSound} onChange={toggleNotifSound} />
						<span className="slider"></span>
					</label>
				</SettingRow>

				<SettingRow
					icon={MessageSquare}
					label="Inline Quick Reply"
					desc="Enable text input to reply directly inside notch for Telegram, WhatsApp and messaging apps"
					divider={false}
				>
					<label className="toggle-switch">
						<input
							type="checkbox"
							checked={notifQuickReply}
							onChange={toggleNotifQuickReply}
						/>
						<span className="slider"></span>
					</label>
				</SettingRow>
			</div>

			<div className="setting-group-label setting-group-label--spaced">Windows Integration</div>
			<div className="setting-group">
				<SettingRow
					icon={ShieldCheck}
					label="Suppress Native Windows Toasts"
					desc="Disable Windows shell popup banners from source so no toast flashes in the corner"
					divider={false}
				>
					<label className="toggle-switch">
						<input
							type="checkbox"
							checked={notifSuppressWindows}
							onChange={toggleNotifSuppressWindows}
						/>
						<span className="slider"></span>
					</label>
				</SettingRow>
			</div>

			<div className="setting-group-label setting-group-label--spaced">Categories & Filters</div>
			<div className="setting-group">
				<SettingRow
					icon={MessageSquare}
					label="Messaging Apps"
					desc="Show notifications from Telegram, WhatsApp, Discord, and chat apps"
				>
					<label className="toggle-switch">
						<input
							type="checkbox"
							checked={notifCatMessages}
							onChange={toggleNotifCatMessages}
						/>
						<span className="slider"></span>
					</label>
				</SettingRow>

				<SettingRow
					icon={AlertCircle}
					label="Alarms & Timers"
					desc="Show alarms, countdown alerts, and stopwatch alerts in the notch"
				>
					<label className="toggle-switch">
						<input type="checkbox" checked={notifCatAlarms} onChange={toggleNotifCatAlarms} />
						<span className="slider"></span>
					</label>
				</SettingRow>

				<SettingRow
					icon={PhoneCall}
					label="Incoming Calls"
					desc="Show incoming voice and video call notifications with answer/decline"
				>
					<label className="toggle-switch">
						<input type="checkbox" checked={notifCatCalls} onChange={toggleNotifCatCalls} />
						<span className="slider"></span>
					</label>
				</SettingRow>

				<SettingRow
					icon={BellRing}
					label="System & Calendar Alerts"
					desc="Show Windows system reminders, calendar events, and other notifications"
					divider={false}
				>
					<label className="toggle-switch">
						<input type="checkbox" checked={notifCatSystem} onChange={toggleNotifCatSystem} />
						<span className="slider"></span>
					</label>
				</SettingRow>
			</div>

			<div className="setting-group-label setting-group-label--spaced">History & Center</div>
			<div className="setting-group">
				<SettingRow
					icon={Sliders}
					label="Notification Center Capacity"
					desc="Maximum notifications kept in the notch Notification Center"
				>
					<select
						className="settings-select"
						value={notifHistoryLimit}
						onChange={(e) => changeNotifHistoryLimit(Number(e.target.value))}
					>
						<option value="10">10 notifications</option>
						<option value="20">20 notifications</option>
						<option value="50">50 notifications</option>
						<option value="100">100 notifications</option>
					</select>
				</SettingRow>

				<SettingRow
					icon={Trash2}
					label="Clear History"
					desc="Remove all saved notifications from history"
					action
					onClick={handleClear}
					divider={false}
				>
					<button className="settings-btn settings-btn-subtle" onClick={handleClear}>
						{cleared ? (
							<span style={{ color: "#34d399", display: "flex", alignItems: "center", gap: 4 }}>
								<Check size={13} /> Cleared
							</span>
						) : (
							"Clear Now"
						)}
					</button>
				</SettingRow>
			</div>

			<div className="setting-group-label setting-group-label--spaced">Test & Preview</div>
			<div className="setting-group">
				<SettingRow
					icon={Sparkles}
					label="Trigger Test Notification"
					desc="Fire a live test notification to verify your droplet styling and sound"
					divider={false}
				>
					<div className="test-notif-buttons">
						<button
							type="button"
							className="settings-btn settings-btn-accent"
							onClick={() => handleTest("message")}
							disabled={testSending !== null}
						>
							<Send size={12} style={{ marginRight: 4 }} />
							{testSending === "message" ? "Sending..." : "Message"}
						</button>
						<button
							type="button"
							className="settings-btn"
							onClick={() => handleTest("alarm")}
							disabled={testSending !== null}
						>
							<AlertCircle size={12} style={{ marginRight: 4 }} />
							{testSending === "alarm" ? "Sending..." : "Alarm"}
						</button>
						<button
							type="button"
							className="settings-btn"
							onClick={() => handleTest("call")}
							disabled={testSending !== null}
						>
							<PhoneCall size={12} style={{ marginRight: 4 }} />
							{testSending === "call" ? "Sending..." : "Call"}
						</button>
					</div>
				</SettingRow>
			</div>
		</>
	);
}
