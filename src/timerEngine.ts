export type PomoPhase = "focus" | "shortBreak" | "longBreak";

export interface TimerEngineState {
	// Regular Countdown Timer
	timerTotalSeconds: number;
	timerSecondsLeft: number;
	isTimerRunning: boolean;
	isTimerFinished: boolean;
	timerEndTime: number | null;
	inputHours: number;
	inputMinutes: number;
	inputSeconds: number;

	// Pomodoro Timer
	pomoPhase: PomoPhase;
	pomoFocusMins: number;
	pomoShortMins: number;
	pomoLongMins: number;
	pomoCycleCount: number;
	pomoSecondsLeft: number;
	isPomoRunning: boolean;
	isPomoFinished: boolean;
	pomoEndTime: number | null;
	pomoTodayCompleted: number;

	// Sound & UI Tab
	soundEnabled: boolean;
	activeTab: "timer" | "pomodoro" | "alarm";
}

const STORAGE_KEY = "bloom_timer_engine_state";

const DEFAULT_STATE: TimerEngineState = {
	timerTotalSeconds: 25 * 60,
	timerSecondsLeft: 25 * 60,
	isTimerRunning: false,
	isTimerFinished: false,
	timerEndTime: null,
	inputHours: 0,
	inputMinutes: 25,
	inputSeconds: 0,

	pomoPhase: "focus",
	pomoFocusMins: 25,
	pomoShortMins: 5,
	pomoLongMins: 15,
	pomoCycleCount: 1,
	pomoSecondsLeft: 25 * 60,
	isPomoRunning: false,
	isPomoFinished: false,
	pomoEndTime: null,
	pomoTodayCompleted: 0,

	soundEnabled: true,
	activeTab: "timer"
};

class TimerEngine {
	private state: TimerEngineState;
	private listeners = new Set<(state: TimerEngineState) => void>();
	private finishListeners = new Set<(type: "timer" | "pomodoro") => void>();
	private tickInterval: any = null;
	private audioCtx: AudioContext | null = null;
	private isInitialized = false;

	constructor() {
		this.state = this.loadInitialState();
	}

	private loadInitialState(): TimerEngineState {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw);
				const now = Date.now();

				// Restore regular timer
				let timerSecondsLeft = parsed.timerSecondsLeft ?? DEFAULT_STATE.timerTotalSeconds;
				let isTimerRunning = Boolean(parsed.isTimerRunning);
				let isTimerFinished = Boolean(parsed.isTimerFinished);
				let timerEndTime = parsed.timerEndTime ? Number(parsed.timerEndTime) : null;

				if (isTimerRunning && timerEndTime) {
					if (now >= timerEndTime) {
						timerSecondsLeft = 0;
						isTimerRunning = false;
						isTimerFinished = true;
						timerEndTime = null;
					} else {
						timerSecondsLeft = Math.max(0, Math.ceil((timerEndTime - now) / 1000));
					}
				}

				// Restore Pomodoro
				let pomoSecondsLeft = parsed.pomoSecondsLeft ?? 25 * 60;
				let isPomoRunning = Boolean(parsed.isPomoRunning);
				let isPomoFinished = Boolean(parsed.isPomoFinished);
				let pomoEndTime = parsed.pomoEndTime ? Number(parsed.pomoEndTime) : null;

				if (isPomoRunning && pomoEndTime) {
					if (now >= pomoEndTime) {
						pomoSecondsLeft = 0;
						isPomoRunning = false;
						isPomoFinished = true;
						pomoEndTime = null;
					} else {
						pomoSecondsLeft = Math.max(0, Math.ceil((pomoEndTime - now) / 1000));
					}
				}

				return {
					...DEFAULT_STATE,
					...parsed,
					timerSecondsLeft,
					isTimerRunning,
					isTimerFinished,
					timerEndTime,
					pomoSecondsLeft,
					isPomoRunning,
					isPomoFinished,
					pomoEndTime
				};
			}
		} catch {}
		return { ...DEFAULT_STATE };
	}

	public init() {
		if (this.isInitialized) return;
		this.isInitialized = true;

		// Start background wall-clock tick loop
		this.tickInterval = setInterval(() => this.tick(), 500);

		// Unlock audio on interaction
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

	public destroy() {
		if (this.tickInterval) {
			clearInterval(this.tickInterval);
			this.tickInterval = null;
		}
		this.isInitialized = false;
	}

	private tick() {
		const now = Date.now();
		let changed = false;

		// 1. Regular Timer
		if (this.state.isTimerRunning && this.state.timerEndTime) {
			const remaining = Math.max(0, Math.ceil((this.state.timerEndTime - now) / 1000));
			if (remaining !== this.state.timerSecondsLeft) {
				this.state.timerSecondsLeft = remaining;
				changed = true;
			}
			if (remaining <= 0) {
				this.state.isTimerRunning = false;
				this.state.isTimerFinished = true;
				this.state.timerEndTime = null;
				changed = true;
				if (this.state.soundEnabled) this.playChimeTone();
				this.notifyFinished("timer");
			}
		}

		// 2. Pomodoro Timer
		if (this.state.isPomoRunning && this.state.pomoEndTime) {
			const remaining = Math.max(0, Math.ceil((this.state.pomoEndTime - now) / 1000));
			if (remaining !== this.state.pomoSecondsLeft) {
				this.state.pomoSecondsLeft = remaining;
				changed = true;
			}
			if (remaining <= 0) {
				this.state.isPomoRunning = false;
				this.state.isPomoFinished = true;
				this.state.pomoEndTime = null;
				changed = true;
				if (this.state.soundEnabled) this.playChimeTone();
				this.notifyFinished("pomodoro");
			}
		}

		if (changed) {
			this.persist();
			this.notify();
		}
	}

	private persist() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
		} catch {}
	}

	private notify() {
		const snapshot = { ...this.state };
		this.listeners.forEach((fn) => fn(snapshot));
	}

	private notifyFinished(type: "timer" | "pomodoro") {
		this.finishListeners.forEach((fn) => fn(type));
	}

	public subscribe(fn: (state: TimerEngineState) => void): () => void {
		this.listeners.add(fn);
		fn({ ...this.state });
		return () => {
			this.listeners.delete(fn);
		};
	}

	public onFinished(fn: (type: "timer" | "pomodoro") => void): () => void {
		this.finishListeners.add(fn);
		return () => {
			this.finishListeners.delete(fn);
		};
	}

	public getState(): TimerEngineState {
		return { ...this.state };
	}

	/* -------------------------------------------------------------
	   REGULAR TIMER ACTIONS
	------------------------------------------------------------- */
	public startTimer() {
		this.initAudioContext();
		if (this.state.timerSecondsLeft <= 0) {
			this.state.timerSecondsLeft = this.state.timerTotalSeconds;
		}
		this.state.isTimerRunning = true;
		this.state.isTimerFinished = false;
		this.state.timerEndTime = Date.now() + this.state.timerSecondsLeft * 1000;
		this.persist();
		this.notify();
	}

	public pauseTimer() {
		if (this.state.isTimerRunning && this.state.timerEndTime) {
			const remaining = Math.max(0, Math.ceil((this.state.timerEndTime - Date.now()) / 1000));
			this.state.timerSecondsLeft = remaining;
		}
		this.state.isTimerRunning = false;
		this.state.timerEndTime = null;
		this.persist();
		this.notify();
	}

	public resetTimer() {
		this.state.isTimerRunning = false;
		this.state.isTimerFinished = false;
		this.state.timerEndTime = null;
		this.state.timerSecondsLeft = this.state.timerTotalSeconds;
		this.persist();
		this.notify();
	}

	public setTimerPreset(minutes: number) {
		const total = minutes * 60;
		this.state.timerTotalSeconds = total;
		this.state.timerSecondsLeft = total;
		this.state.isTimerRunning = false;
		this.state.isTimerFinished = false;
		this.state.timerEndTime = null;
		this.state.inputHours = Math.floor(minutes / 60);
		this.state.inputMinutes = minutes % 60;
		this.state.inputSeconds = 0;
		this.persist();
		this.notify();
	}

	public setCustomDuration(hours: number, minutes: number, seconds: number) {
		const total = hours * 3600 + minutes * 60 + seconds;
		if (total > 0) {
			this.state.timerTotalSeconds = total;
			this.state.timerSecondsLeft = total;
			this.state.isTimerRunning = false;
			this.state.isTimerFinished = false;
			this.state.timerEndTime = null;
			this.state.inputHours = hours;
			this.state.inputMinutes = minutes;
			this.state.inputSeconds = seconds;
			this.persist();
			this.notify();
		}
	}

	public adjustTimer(deltaSec: number) {
		let next = Math.max(0, this.state.timerSecondsLeft + deltaSec);
		this.state.timerSecondsLeft = next;
		this.state.timerTotalSeconds = Math.max(this.state.timerTotalSeconds, next);
		if (this.state.isTimerRunning) {
			this.state.timerEndTime = Date.now() + next * 1000;
		}
		if (next === 0) {
			this.state.isTimerRunning = false;
			this.state.isTimerFinished = true;
			this.state.timerEndTime = null;
		}
		this.persist();
		this.notify();
	}

	/* -------------------------------------------------------------
	   POMODORO ACTIONS
	------------------------------------------------------------- */
	public startPomo() {
		this.initAudioContext();
		if (this.state.pomoSecondsLeft <= 0) {
			let dur = this.state.pomoFocusMins * 60;
			if (this.state.pomoPhase === "shortBreak") dur = this.state.pomoShortMins * 60;
			if (this.state.pomoPhase === "longBreak") dur = this.state.pomoLongMins * 60;
			this.state.pomoSecondsLeft = dur;
		}
		this.state.isPomoRunning = true;
		this.state.isPomoFinished = false;
		this.state.pomoEndTime = Date.now() + this.state.pomoSecondsLeft * 1000;
		this.persist();
		this.notify();
	}

	public pausePomo() {
		if (this.state.isPomoRunning && this.state.pomoEndTime) {
			const remaining = Math.max(0, Math.ceil((this.state.pomoEndTime - Date.now()) / 1000));
			this.state.pomoSecondsLeft = remaining;
		}
		this.state.isPomoRunning = false;
		this.state.pomoEndTime = null;
		this.persist();
		this.notify();
	}

	public resetPomo() {
		this.state.isPomoRunning = false;
		this.state.isPomoFinished = false;
		this.state.pomoEndTime = null;
		let dur = this.state.pomoFocusMins * 60;
		if (this.state.pomoPhase === "shortBreak") dur = this.state.pomoShortMins * 60;
		if (this.state.pomoPhase === "longBreak") dur = this.state.pomoLongMins * 60;
		this.state.pomoSecondsLeft = dur;
		this.persist();
		this.notify();
	}

	public switchPomoPhase(newPhase: PomoPhase) {
		this.state.pomoPhase = newPhase;
		this.state.isPomoRunning = false;
		this.state.isPomoFinished = false;
		this.state.pomoEndTime = null;
		let dur = this.state.pomoFocusMins * 60;
		if (newPhase === "shortBreak") dur = this.state.pomoShortMins * 60;
		if (newPhase === "longBreak") dur = this.state.pomoLongMins * 60;
		this.state.pomoSecondsLeft = dur;
		this.persist();
		this.notify();
	}

	public adjustPomoDuration(type: "focus" | "short" | "long", deltaMin: number) {
		if (type === "focus") {
			const next = Math.max(5, Math.min(90, this.state.pomoFocusMins + deltaMin));
			this.state.pomoFocusMins = next;
			if (!this.state.isPomoRunning && this.state.pomoPhase === "focus") {
				this.state.pomoSecondsLeft = next * 60;
			}
		} else if (type === "short") {
			const next = Math.max(1, Math.min(30, this.state.pomoShortMins + deltaMin));
			this.state.pomoShortMins = next;
			if (!this.state.isPomoRunning && this.state.pomoPhase === "shortBreak") {
				this.state.pomoSecondsLeft = next * 60;
			}
		} else {
			const next = Math.max(5, Math.min(60, this.state.pomoLongMins + deltaMin));
			this.state.pomoLongMins = next;
			if (!this.state.isPomoRunning && this.state.pomoPhase === "longBreak") {
				this.state.pomoSecondsLeft = next * 60;
			}
		}
		this.persist();
		this.notify();
	}

	public advancePomoPhase(startImmediately: boolean) {
		if (this.state.pomoPhase === "focus") {
			this.state.pomoTodayCompleted += 1;
			if (this.state.pomoCycleCount >= 4) {
				this.state.pomoPhase = "longBreak";
				this.state.pomoSecondsLeft = this.state.pomoLongMins * 60;
			} else {
				this.state.pomoPhase = "shortBreak";
				this.state.pomoSecondsLeft = this.state.pomoShortMins * 60;
			}
		} else if (this.state.pomoPhase === "shortBreak") {
			this.state.pomoCycleCount = Math.min(4, this.state.pomoCycleCount + 1);
			this.state.pomoPhase = "focus";
			this.state.pomoSecondsLeft = this.state.pomoFocusMins * 60;
		} else {
			this.state.pomoCycleCount = 1;
			this.state.pomoPhase = "focus";
			this.state.pomoSecondsLeft = this.state.pomoFocusMins * 60;
		}

		this.state.isPomoFinished = false;
		this.state.isPomoRunning = startImmediately;
		this.state.pomoEndTime = startImmediately
			? Date.now() + this.state.pomoSecondsLeft * 1000
			: null;

		this.persist();
		this.notify();
	}

	public resetPomoCycle() {
		this.state.pomoCycleCount = 1;
		this.state.pomoPhase = "focus";
		this.state.isPomoRunning = false;
		this.state.isPomoFinished = false;
		this.state.pomoEndTime = null;
		this.state.pomoSecondsLeft = this.state.pomoFocusMins * 60;
		this.persist();
		this.notify();
	}

	public skipPomoPhase() {
		if (this.state.soundEnabled) this.playChimeTone();
		this.advancePomoPhase(false);
	}

	/* -------------------------------------------------------------
	   GENERAL SETTINGS
	------------------------------------------------------------- */
	public setActiveTab(tab: "timer" | "pomodoro" | "alarm") {
		this.state.activeTab = tab;
		this.persist();
		this.notify();
	}

	public toggleSound() {
		this.state.soundEnabled = !this.state.soundEnabled;
		this.persist();
		this.notify();
	}

	public dismissFinished() {
		this.state.isTimerFinished = false;
		this.state.isPomoFinished = false;
		this.persist();
		this.notify();
	}

	private initAudioContext() {
		try {
			if (!this.audioCtx) this.audioCtx = new AudioContext();
			if (this.audioCtx.state === "suspended") this.audioCtx.resume().catch(() => {});
		} catch {}
	}

	public playChimeTone() {
		try {
			this.initAudioContext();
			if (!this.audioCtx) return;
			const ctx = this.audioCtx;
			const start = ctx.currentTime + 0.02;
			const master = ctx.createGain();
			master.gain.value = 0.45;
			master.connect(ctx.destination);

			const notes = [
				{ freq: 880.0, at: 0 },
				{ freq: 1108.73, at: 0.18 },
				{ freq: 1318.51, at: 0.36 }
			];
			notes.forEach(({ freq, at }) => {
				const osc = ctx.createOscillator();
				const gain = ctx.createGain();
				osc.type = "sine";
				osc.frequency.value = freq;
				gain.gain.setValueAtTime(0.0001, start + at);
				gain.gain.exponentialRampToValueAtTime(0.35, start + at + 0.02);
				gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 1.2);
				osc.connect(gain);
				gain.connect(master);
				osc.start(start + at);
				osc.stop(start + at + 1.25);
			});
		} catch {}
	}
}

export const timerEngine = new TimerEngine();
