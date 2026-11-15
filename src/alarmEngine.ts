import { invoke } from "@tauri-apps/api/core";

export interface AlarmItem {
	id: string;
	time: string; // "HH:MM" (24h)
	label: string;
	enabled: boolean;
	repeat: "once" | "daily" | "weekdays";
}

const STORAGE_KEY = "bloom_alarms";

const DEFAULT_ALARMS: AlarmItem[] = [
	{
		id: "sample-alarm-1",
		time: "08:00",
		label: "Morning Wakeup",
		enabled: false,
		repeat: "daily"
	}
];

class AlarmEngine {
	private alarms: AlarmItem[] = [];
	private activeRingingAlarm: AlarmItem | null = null;
	private dismissedMinuteKeys = new Set<string>();
	private listeners = new Set<(alarm: AlarmItem | null) => void>();
	private alarmsListeners = new Set<(alarms: AlarmItem[]) => void>();
	private audioCtx: AudioContext | null = null;
	private currentGain: GainNode | null = null;
	private melodyInterval: any = null;
	private clockInterval: any = null;
	private isInitialized = false;

	constructor() {
		// Load cached from localStorage first
		try {
			const saved = localStorage.getItem(STORAGE_KEY);
			if (saved) {
				const parsed = JSON.parse(saved);
				if (Array.isArray(parsed) && parsed.length > 0) {
					this.alarms = parsed;
				} else {
					this.alarms = DEFAULT_ALARMS;
				}
			} else {
				this.alarms = DEFAULT_ALARMS;
			}
		} catch {
			this.alarms = DEFAULT_ALARMS;
		}
	}

	public init() {
		if (this.isInitialized) return;
		this.isInitialized = true;

		// Load from disk
		invoke<AlarmItem[] | null>("load_alarms")
			.then((diskAlarms) => {
				if (Array.isArray(diskAlarms) && diskAlarms.length > 0) {
					this.alarms = diskAlarms;
					this.persist();
					this.notifyAlarmsChanged();
				}
			})
			.catch(() => {});

		// Start background clock
		this.clockInterval = setInterval(() => this.checkClock(), 1000);

		// Unlock audio context on any user interaction
		window.addEventListener(
			"pointerdown",
			() => {
				if (this.audioCtx && this.audioCtx.state === "suspended") {
					this.audioCtx.resume().catch(() => {});
				}
			},
			{ passive: true }
		);
	}

	private persist() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.alarms));
		} catch {}
		invoke("save_alarms", { alarms: this.alarms }).catch(() => {});
	}

	private notifyAlarmsChanged() {
		this.alarmsListeners.forEach((fn) => fn([...this.alarms]));
	}

	private notifyRingingChanged() {
		this.listeners.forEach((fn) => fn(this.activeRingingAlarm));
	}

	public subscribeRinging(fn: (alarm: AlarmItem | null) => void): () => void {
		this.listeners.add(fn);
		fn(this.activeRingingAlarm);
		return () => this.listeners.delete(fn);
	}

	public subscribeAlarms(fn: (alarms: AlarmItem[]) => void): () => void {
		this.alarmsListeners.add(fn);
		fn([...this.alarms]);
		return () => this.alarmsListeners.delete(fn);
	}

	public getAlarms(): AlarmItem[] {
		return [...this.alarms];
	}

	public getActiveRingingAlarm(): AlarmItem | null {
		return this.activeRingingAlarm;
	}

	public addAlarm(alarm: Omit<AlarmItem, "id">): AlarmItem {
		const newAlarm: AlarmItem = {
			...alarm,
			id: Date.now().toString()
		};
		this.alarms = [newAlarm, ...this.alarms];
		this.persist();
		this.notifyAlarmsChanged();
		return newAlarm;
	}

	public updateAlarm(id: string, updates: Partial<AlarmItem>) {
		this.alarms = this.alarms.map((a) => (a.id === id ? { ...a, ...updates } : a));
		this.persist();
		this.notifyAlarmsChanged();
	}

	public toggleAlarm(id: string) {
		this.alarms = this.alarms.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a));
		this.persist();
		this.notifyAlarmsChanged();
	}

	public deleteAlarm(id: string) {
		if (this.activeRingingAlarm?.id === id) {
			this.dismissActiveAlarm();
		}
		this.alarms = this.alarms.filter((a) => a.id !== id);
		this.persist();
		this.notifyAlarmsChanged();
	}

	/* --- Audio Melody Generation --- */
	private getAudioContext(): AudioContext | null {
		try {
			if (!this.audioCtx) {
				const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
				if (AudioContextClass) this.audioCtx = new AudioContextClass();
			}
			if (this.audioCtx && this.audioCtx.state === "suspended") {
				this.audioCtx.resume().catch(() => {});
			}
			return this.audioCtx;
		} catch {
			return null;
		}
	}

	private playBeep() {
		const ctx = this.getAudioContext();
		if (!ctx) return;

		const now = ctx.currentTime;
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		this.currentGain = gain;

		osc.type = "sine";
		osc.frequency.setValueAtTime(880, now);
		osc.frequency.exponentialRampToValueAtTime(1320, now + 0.15);

		gain.gain.setValueAtTime(0.001, now);
		gain.gain.linearRampToValueAtTime(0.35, now + 0.03);
		gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

		osc.connect(gain);
		gain.connect(ctx.destination);

		osc.start(now);
		osc.stop(now + 0.3);
		osc.onended = () => {
			if (this.currentGain === gain) {
				this.currentGain = null;
			}
		};
	}

	private startAlarmSound() {
		this.stopAlarmSound();
		this.playBeep();
		this.melodyInterval = setInterval(() => {
			this.playBeep();
		}, 1200);
	}

	private stopAlarmSound() {
		if (this.melodyInterval) {
			clearInterval(this.melodyInterval);
			this.melodyInterval = null;
		}
		if (this.currentGain && this.audioCtx) {
			try {
				this.currentGain.gain.setValueAtTime(0, this.audioCtx.currentTime);
			} catch {}
			this.currentGain = null;
		}
	}

	/* --- Background Clock Trigger --- */
	private checkClock() {
		const now = new Date();
		const hours = now.getHours().toString().padStart(2, "0");
		const mins = now.getMinutes().toString().padStart(2, "0");
		const dayOfWeek = now.getDay(); // 0 = Sun, 6 = Sat
		const currentMinuteStr = `${hours}:${mins}`;

		// If an alarm is already ringing, do not trigger another one
		if (this.activeRingingAlarm) return;

		const match = this.alarms.find((a) => {
			if (!a.enabled) return false;
			if (a.time !== currentMinuteStr) return false;
			if (a.repeat === "weekdays" && (dayOfWeek === 0 || dayOfWeek === 6)) return false;

			const triggerKey = `${a.id}_${now.toDateString()}_${currentMinuteStr}`;
			if (this.dismissedMinuteKeys.has(triggerKey)) return false;

			return true;
		});

		if (match) {
			const triggerKey = `${match.id}_${now.toDateString()}_${currentMinuteStr}`;
			this.dismissedMinuteKeys.add(triggerKey);

			// Clean older keys if set gets large
			if (this.dismissedMinuteKeys.size > 50) {
				const arr = Array.from(this.dismissedMinuteKeys);
				this.dismissedMinuteKeys = new Set(arr.slice(-20));
			}

			this.activeRingingAlarm = match;
			this.startAlarmSound();
			this.notifyRingingChanged();

			// If repeat is once, toggle off immediately
			if (match.repeat === "once") {
				this.alarms = this.alarms.map((a) => (a.id === match.id ? { ...a, enabled: false } : a));
				this.persist();
				this.notifyAlarmsChanged();
			}
		}
	}

	public dismissActiveAlarm() {
		this.stopAlarmSound();
		if (this.activeRingingAlarm) {
			const now = new Date();
			const hours = now.getHours().toString().padStart(2, "0");
			const mins = now.getMinutes().toString().padStart(2, "0");
			const triggerKey = `${this.activeRingingAlarm.id}_${now.toDateString()}_${hours}:${mins}`;
			this.dismissedMinuteKeys.add(triggerKey);
		}
		this.activeRingingAlarm = null;
		this.notifyRingingChanged();
	}

	public snoozeActiveAlarm(snoozeMinutes: number = 5) {
		const current = this.activeRingingAlarm;
		this.dismissActiveAlarm();

		if (current) {
			const now = new Date(Date.now() + snoozeMinutes * 60000);
			const h = now.getHours().toString().padStart(2, "0");
			const m = now.getMinutes().toString().padStart(2, "0");

			const snoozedAlarm: AlarmItem = {
				id: `snooze-${Date.now()}`,
				time: `${h}:${m}`,
				label: `${current.label} (Snoozed)`,
				enabled: true,
				repeat: "once"
			};

			this.alarms = [snoozedAlarm, ...this.alarms];
			this.persist();
			this.notifyAlarmsChanged();
		}
	}

	public destroy() {
		if (this.clockInterval) {
			clearInterval(this.clockInterval);
			this.clockInterval = null;
		}
		this.stopAlarmSound();
	}
}

export const alarmEngine = new AlarmEngine();
