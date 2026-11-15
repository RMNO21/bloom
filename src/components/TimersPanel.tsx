import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
	Hourglass,
	Flame,
	AlarmClock,
	Play,
	Pause,
	RotateCcw,
	Plus,
	Trash2,
	BellRing,
	SkipForward,
	Volume2,
	VolumeX
} from "lucide-react";
import { alarmEngine, AlarmItem } from "../alarmEngine";
import "./TimersPanel.css";

export type { AlarmItem };

export type TimersTab = "timer" | "pomodoro" | "alarm";

interface TimersPanelProps {
	onPinNotch?: (pinned: boolean) => void;
	timeFormat24h?: boolean;
	timerPresets?: number[];
	onTimerStatusChange?: (status: {
		type: "timer" | "pomodoro" | null;
		seconds: number;
		isRunning: boolean;
		isFinished: boolean;
		label?: string;
	}) => void;
	onRingingAlarmChange?: (alarm: AlarmItem | null) => void;
}

/* Web Audio Synthesizers for Timer Chime and Repeating Alarm */
let audioCtx: AudioContext | null = null;
const getAudioContext = (): AudioContext | null => {
	try {
		if (!audioCtx) audioCtx = new AudioContext();
		if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
		return audioCtx;
	} catch {
		return null;
	}
};

const playChimeTone = () => {
	const ctx = getAudioContext();
	if (!ctx) return;
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
};

export function TimersPanel({
	onPinNotch,
	timeFormat24h = false,
	timerPresets = [5, 15, 25, 45],
	onTimerStatusChange,
	onRingingAlarmChange
}: TimersPanelProps) {
	const [activeTab, setActiveTab] = useState<TimersTab>("timer");
	const [soundEnabled, setSoundEnabled] = useState(true);

	/* -------------------------------------------------------------
	   1. COUNTDOWN TIMER STATE
	------------------------------------------------------------- */
	const [timerTotalSeconds, setTimerTotalSeconds] = useState(25 * 60);
	const [timerSecondsLeft, setTimerSecondsLeft] = useState(25 * 60);
	const [isTimerRunning, setIsTimerRunning] = useState(false);
	const [isTimerFinished, setIsTimerFinished] = useState(false);

	// Custom duration input states (hours, minutes, seconds)
	const [inputHours, setInputHours] = useState(0);
	const [inputMinutes, setInputMinutes] = useState(25);
	const [inputSeconds, setInputSeconds] = useState(0);

	// Timer interval
	useEffect(() => {
		let interval: any = null;
		if (isTimerRunning && timerSecondsLeft > 0) {
			interval = setInterval(() => {
				setTimerSecondsLeft((prev) => {
					if (prev <= 1) {
						setIsTimerRunning(false);
						setIsTimerFinished(true);
						if (soundEnabled) playChimeTone();
						return 0;
					}
					return prev - 1;
				});
			}, 1000);
		}
		return () => {
			if (interval) clearInterval(interval);
		};
	}, [isTimerRunning, timerSecondsLeft, soundEnabled]);

	// Broadcast timer state
	useEffect(() => {
		if (activeTab === "timer") {
			onTimerStatusChange?.({
				type: isTimerRunning || isTimerFinished ? "timer" : null,
				seconds: timerSecondsLeft,
				isRunning: isTimerRunning,
				isFinished: isTimerFinished,
				label: "Timer"
			});
		}
	}, [timerSecondsLeft, isTimerRunning, isTimerFinished, activeTab, onTimerStatusChange]);

	const handleStartTimer = () => {
		getAudioContext();
		if (timerSecondsLeft === 0) {
			setTimerSecondsLeft(timerTotalSeconds);
		}
		setIsTimerRunning(true);
		setIsTimerFinished(false);
	};

	const handlePauseTimer = () => {
		setIsTimerRunning(false);
	};

	const handleResetTimer = () => {
		setIsTimerRunning(false);
		setIsTimerFinished(false);
		setTimerSecondsLeft(timerTotalSeconds);
	};

	const handleSetPreset = (minutes: number) => {
		const total = minutes * 60;
		setTimerTotalSeconds(total);
		setTimerSecondsLeft(total);
		setIsTimerRunning(false);
		setIsTimerFinished(false);
		setInputHours(Math.floor(minutes / 60));
		setInputMinutes(minutes % 60);
		setInputSeconds(0);
	};

	const handleApplyCustomDuration = () => {
		const total = inputHours * 3600 + inputMinutes * 60 + inputSeconds;
		if (total > 0) {
			setTimerTotalSeconds(total);
			setTimerSecondsLeft(total);
			setIsTimerRunning(false);
			setIsTimerFinished(false);
		}
	};

	const handleAdjustTimer = (deltaSec: number) => {
		setTimerSecondsLeft((prev) => {
			const next = Math.max(0, prev + deltaSec);
			if (next === 0) {
				setIsTimerRunning(false);
				setIsTimerFinished(true);
			}
			return next;
		});
		setTimerTotalSeconds((prev) => Math.max(prev, prev + deltaSec));
	};

	/* -------------------------------------------------------------
	   2. POMODORO STATE & PERSISTENCE
	------------------------------------------------------------- */
	type PomoPhase = "focus" | "shortBreak" | "longBreak";

	const getTodayString = () => new Date().toISOString().split("T")[0];

	const [pomoFocusMins, setPomoFocusMins] = useState<number>(() => {
		try {
			const v = localStorage.getItem("bloom_pomo_focus_mins");
			return v ? Math.max(1, parseInt(v) || 25) : 25;
		} catch {
			return 25;
		}
	});

	const [pomoShortMins, setPomoShortMins] = useState<number>(() => {
		try {
			const v = localStorage.getItem("bloom_pomo_short_mins");
			return v ? Math.max(1, parseInt(v) || 5) : 5;
		} catch {
			return 5;
		}
	});

	const [pomoLongMins, setPomoLongMins] = useState<number>(() => {
		try {
			const v = localStorage.getItem("bloom_pomo_long_mins");
			return v ? Math.max(1, parseInt(v) || 15) : 15;
		} catch {
			return 15;
		}
	});

	const [pomoCycleCount, setPomoCycleCount] = useState<number>(() => {
		try {
			const v = localStorage.getItem("bloom_pomo_cycle_count");
			return v ? Math.max(1, Math.min(4, parseInt(v) || 1)) : 1;
		} catch {
			return 1;
		}
	});

	const [pomoPhase, setPomoPhase] = useState<PomoPhase>(() => {
		try {
			const v = localStorage.getItem("bloom_pomo_phase") as PomoPhase;
			if (v === "focus" || v === "shortBreak" || v === "longBreak") return v;
		} catch {}
		return "focus";
	});

	const [pomoTodayCompleted, setPomoTodayCompleted] = useState<number>(() => {
		try {
			const savedDate = localStorage.getItem("bloom_pomo_today_date");
			const today = getTodayString();
			if (savedDate === today) {
				const v = localStorage.getItem("bloom_pomo_today_completed");
				return v ? parseInt(v) || 0 : 0;
			}
		} catch {}
		return 0;
	});

	const [pomoSecondsLeft, setPomoSecondsLeft] = useState<number>(() => {
		const savedPhase = (() => {
			try {
				const v = localStorage.getItem("bloom_pomo_phase") as PomoPhase;
				if (v === "focus" || v === "shortBreak" || v === "longBreak") return v;
			} catch {}
			return "focus";
		})();
		const focusM = (() => {
			try {
				const v = localStorage.getItem("bloom_pomo_focus_mins");
				return v ? Math.max(1, parseInt(v) || 25) : 25;
			} catch { return 25; }
		})();
		const shortM = (() => {
			try {
				const v = localStorage.getItem("bloom_pomo_short_mins");
				return v ? Math.max(1, parseInt(v) || 5) : 5;
			} catch { return 5; }
		})();
		const longM = (() => {
			try {
				const v = localStorage.getItem("bloom_pomo_long_mins");
				return v ? Math.max(1, parseInt(v) || 15) : 15;
			} catch { return 15; }
		})();
		if (savedPhase === "shortBreak") return shortM * 60;
		if (savedPhase === "longBreak") return longM * 60;
		return focusM * 60;
	});

	const [isPomoRunning, setIsPomoRunning] = useState(false);
	const [isPomoFinished, setIsPomoFinished] = useState(false);

	// Persist changes to localStorage
	useEffect(() => {
		try {
			localStorage.setItem("bloom_pomo_focus_mins", pomoFocusMins.toString());
			localStorage.setItem("bloom_pomo_short_mins", pomoShortMins.toString());
			localStorage.setItem("bloom_pomo_long_mins", pomoLongMins.toString());
			localStorage.setItem("bloom_pomo_cycle_count", pomoCycleCount.toString());
			localStorage.setItem("bloom_pomo_phase", pomoPhase);
			localStorage.setItem("bloom_pomo_today_completed", pomoTodayCompleted.toString());
			localStorage.setItem("bloom_pomo_today_date", getTodayString());
		} catch {}
	}, [pomoFocusMins, pomoShortMins, pomoLongMins, pomoCycleCount, pomoPhase, pomoTodayCompleted]);

	const pomoPhaseDuration = useMemo(() => {
		if (pomoPhase === "focus") return pomoFocusMins * 60;
		if (pomoPhase === "shortBreak") return pomoShortMins * 60;
		return pomoLongMins * 60;
	}, [pomoPhase, pomoFocusMins, pomoShortMins, pomoLongMins]);

	// Switch phase manually
	const handleSwitchPomoPhase = (newPhase: PomoPhase) => {
		setPomoPhase(newPhase);
		setIsPomoRunning(false);
		setIsPomoFinished(false);
		let dur = pomoFocusMins * 60;
		if (newPhase === "shortBreak") dur = pomoShortMins * 60;
		if (newPhase === "longBreak") dur = pomoLongMins * 60;
		setPomoSecondsLeft(dur);
	};

	// Adjust custom duration for focus / short / long break
	const handleAdjustPomoDuration = (type: "focus" | "short" | "long", deltaMin: number) => {
		if (type === "focus") {
			const next = Math.max(5, Math.min(90, pomoFocusMins + deltaMin));
			setPomoFocusMins(next);
			if (!isPomoRunning && pomoPhase === "focus") setPomoSecondsLeft(next * 60);
		} else if (type === "short") {
			const next = Math.max(1, Math.min(30, pomoShortMins + deltaMin));
			setPomoShortMins(next);
			if (!isPomoRunning && pomoPhase === "shortBreak") setPomoSecondsLeft(next * 60);
		} else {
			const next = Math.max(5, Math.min(60, pomoLongMins + deltaMin));
			setPomoLongMins(next);
			if (!isPomoRunning && pomoPhase === "longBreak") setPomoSecondsLeft(next * 60);
		}
	};

	// Dismiss finished notification
	const handleDismissPomoFinished = () => {
		setIsPomoFinished(false);
		advancePomoPhase(false);
	};

	// Advance and start immediately
	const handlePomoAdvanceAndStart = () => {
		setIsPomoFinished(false);
		advancePomoPhase(true);
	};

	// Helper to advance pomo phase
	const advancePomoPhase = (startImmediately: boolean) => {
		if (pomoPhase === "focus") {
			setPomoTodayCompleted((c) => c + 1);
			if (pomoCycleCount >= 4) {
				setPomoPhase("longBreak");
				setPomoSecondsLeft(pomoLongMins * 60);
			} else {
				setPomoPhase("shortBreak");
				setPomoSecondsLeft(pomoShortMins * 60);
			}
		} else if (pomoPhase === "shortBreak") {
			setPomoCycleCount((prev) => Math.min(4, prev + 1));
			setPomoPhase("focus");
			setPomoSecondsLeft(pomoFocusMins * 60);
		} else {
			// After long break, reset to cycle 1 focus
			setPomoCycleCount(1);
			setPomoPhase("focus");
			setPomoSecondsLeft(pomoFocusMins * 60);
		}
		setIsPomoRunning(startImmediately);
	};

	// Reset cycle back to session 1
	const handleResetCycle = () => {
		setPomoCycleCount(1);
		setPomoPhase("focus");
		setIsPomoRunning(false);
		setIsPomoFinished(false);
		setPomoSecondsLeft(pomoFocusMins * 60);
	};

	// Skip to next phase manually
	const handleNextPomoPhase = () => {
		if (soundEnabled) playChimeTone();
		advancePomoPhase(false);
	};

	// Pomodoro countdown interval
	useEffect(() => {
		let interval: any = null;
		if (isPomoRunning && pomoSecondsLeft > 0) {
			interval = setInterval(() => {
				setPomoSecondsLeft((prev) => {
					if (prev <= 1) {
						setIsPomoRunning(false);
						setIsPomoFinished(true);
						if (soundEnabled) playChimeTone();
						return 0;
					}
					return prev - 1;
				});
			}, 1000);
		}
		return () => {
			if (interval) clearInterval(interval);
		};
	}, [isPomoRunning, pomoSecondsLeft, soundEnabled]);

	// Broadcast pomodoro state
	useEffect(() => {
		if (activeTab === "pomodoro") {
			onTimerStatusChange?.({
				type: isPomoRunning || isPomoFinished ? "pomodoro" : null,
				seconds: pomoSecondsLeft,
				isRunning: isPomoRunning,
				isFinished: isPomoFinished,
				label: pomoPhase === "focus" ? "Focus" : pomoPhase === "shortBreak" ? "Short Break" : "Long Break"
			});
		}
	}, [pomoSecondsLeft, isPomoRunning, isPomoFinished, pomoPhase, activeTab, onTimerStatusChange]);

	/* -------------------------------------------------------------
	   3. ALARMS STATE & ENGINE (CONNECTED TO GLOBAL ALARM ENGINE)
	------------------------------------------------------------- */
	const [alarms, setAlarms] = useState<AlarmItem[]>(() => alarmEngine.getAlarms());
	const [ringingAlarm, setRingingAlarm] = useState<AlarmItem | null>(() => alarmEngine.getActiveRingingAlarm());
	const [isAddingAlarm, setIsAddingAlarm] = useState(false);
	const [newAlarmTime, setNewAlarmTime] = useState("08:00");
	const [newAlarmLabel, setNewAlarmLabel] = useState("");
	const [newAlarmRepeat, setNewAlarmRepeat] = useState<"once" | "daily" | "weekdays">("daily");

	useEffect(() => {
		const unsubAlarms = alarmEngine.subscribeAlarms((list) => setAlarms(list));
		const unsubRinging = alarmEngine.subscribeRinging((alarm) => {
			setRingingAlarm(alarm);
			onRingingAlarmChange?.(alarm);
		});
		return () => {
			unsubAlarms();
			unsubRinging();
		};
	}, [onRingingAlarmChange]);

	const handleDismissAlarm = () => {
		alarmEngine.dismissActiveAlarm();
	};

	const handleSnoozeAlarm = () => {
		alarmEngine.snoozeActiveAlarm(5);
	};

	const handleToggleAlarmEnabled = (id: string) => {
		alarmEngine.toggleAlarm(id);
	};

	const handleDeleteAlarm = (id: string) => {
		alarmEngine.deleteAlarm(id);
	};

	const handleSaveNewAlarm = () => {
		alarmEngine.addAlarm({
			time: newAlarmTime,
			label: newAlarmLabel.trim() || "Alarm",
			enabled: true,
			repeat: newAlarmRepeat
		});
		setIsAddingAlarm(false);
		setNewAlarmLabel("");
	};

	// Format display helpers
	const formatSeconds = (sec: number) => {
		const h = Math.floor(sec / 3600);
		const m = Math.floor((sec % 3600) / 60);
		const s = sec % 60;
		if (h > 0) {
			return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
		}
		return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
	};

	const formatAlarmTimeDisplay = (time24: string) => {
		if (timeFormat24h) return time24;
		const [hStr, mStr] = time24.split(":");
		const h = parseInt(hStr, 10);
		const ampm = h >= 12 ? "PM" : "AM";
		const h12 = h % 12 || 12;
		return `${h12}:${mStr} ${ampm}`;
	};

	return (
		<div className="timers-panel-root">
			{/* Top Navigation Tabs */}
			<div className="timers-nav-tabs">
				<button
					className={`timers-tab-btn ${activeTab === "timer" ? "active" : ""}`}
					onClick={() => setActiveTab("timer")}
				>
					<Hourglass size={13} />
					<span>Timer</span>
				</button>
				<button
					className={`timers-tab-btn ${activeTab === "pomodoro" ? "active" : ""}`}
					onClick={() => setActiveTab("pomodoro")}
				>
					<Flame size={13} />
					<span>Pomodoro</span>
				</button>
				<button
					className={`timers-tab-btn ${activeTab === "alarm" ? "active" : ""}`}
					onClick={() => setActiveTab("alarm")}
				>
					<AlarmClock size={13} />
					<span>Alarms</span>
					{alarms.filter((a) => a.enabled).length > 0 && (
						<span className="timers-tab-badge">
							{alarms.filter((a) => a.enabled).length}
						</span>
					)}
				</button>
			</div>

			{/* Ringing Alarm Alert Banner */}
			<AnimatePresence>
				{ringingAlarm && (
					<motion.div
						className="ringing-alarm-banner"
						initial={{ opacity: 0, y: -10 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -10 }}
					>
						<div className="ringing-alarm-info">
							<BellRing size={16} className="ringing-bell-icon" />
							<div>
								<div className="ringing-alarm-title">
									{ringingAlarm.label || "Alarm"}
								</div>
								<div className="ringing-alarm-time">
									{formatAlarmTimeDisplay(ringingAlarm.time)}
								</div>
							</div>
						</div>
						<div className="ringing-alarm-btns">
							<button className="alarm-snooze-btn" onClick={handleSnoozeAlarm}>
								Snooze 5m
							</button>
							<button className="alarm-dismiss-btn" onClick={handleDismissAlarm}>
								Dismiss
							</button>
						</div>
					</motion.div>
				)}
			</AnimatePresence>

			{/* ================= TAB 1: COUNTDOWN TIMER ================= */}
			{activeTab === "timer" && (
				<motion.div
					key="tab-timer"
					className="timers-tab-content timer-tab"
					initial={{ opacity: 0, scale: 0.98 }}
					animate={{ opacity: 1, scale: 1 }}
					transition={{ duration: 0.15 }}
				>
					<div className="timer-main-display">
						<span
							className={`timer-digital-time ${isTimerFinished ? "finished" : ""}`}
						>
							{formatSeconds(timerSecondsLeft)}
						</span>
						<span className="timer-status-hint">
							{isTimerFinished
								? "Time's up!"
								: isTimerRunning
									? `Ends ${new Date(Date.now() + timerSecondsLeft * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
									: timerSecondsLeft < timerTotalSeconds
										? "Paused"
										: "Ready"}
						</span>
					</div>

					{/* Presets Chips */}
					<div className="timer-presets-row">
						{timerPresets.map((mins) => (
							<button
								key={mins}
								className={`timer-preset-chip ${timerTotalSeconds === mins * 60 && !isTimerFinished ? "active" : ""}`}
								onClick={() => handleSetPreset(mins)}
							>
								{mins}m
							</button>
						))}
					</div>

					{/* Running Quick Adjustments */}
					{isTimerRunning && (
						<div className="timer-adjust-row">
							<button onClick={() => handleAdjustTimer(-60)}>-1m</button>
							<button onClick={() => handleAdjustTimer(60)}>+1m</button>
							<button onClick={() => handleAdjustTimer(300)}>+5m</button>
						</div>
					)}

					{/* Custom Duration Stepper when idle */}
					{!isTimerRunning && timerSecondsLeft === timerTotalSeconds && (
						<div className="timer-custom-inputs">
							<div className="timer-input-group">
								<input
									type="number"
									min="0"
									max="23"
									value={inputHours}
									onChange={(e) => setInputHours(Math.max(0, parseInt(e.target.value) || 0))}
									onFocus={() => {
										onPinNotch?.(true);
									}}
									onBlur={() => {
										onPinNotch?.(false);
										handleApplyCustomDuration();
									}}
								/>
								<span>h</span>
							</div>
							<span className="colon">:</span>
							<div className="timer-input-group">
								<input
									type="number"
									min="0"
									max="59"
									value={inputMinutes}
									onChange={(e) => setInputMinutes(Math.max(0, parseInt(e.target.value) || 0))}
									onFocus={() => {
										onPinNotch?.(true);
									}}
									onBlur={() => {
										onPinNotch?.(false);
										handleApplyCustomDuration();
									}}
								/>
								<span>m</span>
							</div>
							<span className="colon">:</span>
							<div className="timer-input-group">
								<input
									type="number"
									min="0"
									max="59"
									value={inputSeconds}
									onChange={(e) => setInputSeconds(Math.max(0, parseInt(e.target.value) || 0))}
									onFocus={() => {
										onPinNotch?.(true);
									}}
									onBlur={() => {
										onPinNotch?.(false);
										handleApplyCustomDuration();
									}}
								/>
								<span>s</span>
							</div>
						</div>
					)}

					{/* Primary Controls */}
					<div className="timer-action-controls">
						<button
							className={`timer-play-btn ${isTimerRunning ? "running" : ""}`}
							onClick={isTimerRunning ? handlePauseTimer : handleStartTimer}
						>
							{isTimerRunning ? (
								<>
									<Pause size={15} fill="currentColor" />
									<span>Pause</span>
								</>
							) : (
								<>
									<Play size={15} fill="currentColor" />
									<span>{isTimerFinished ? "Restart" : "Start"}</span>
								</>
							)}
						</button>
						<button
							className="timer-reset-btn"
							onClick={handleResetTimer}
							title="Reset Timer"
						>
							<RotateCcw size={14} />
						</button>
						<button
							className={`timer-sound-btn ${soundEnabled ? "on" : "off"}`}
							onClick={() => setSoundEnabled(!soundEnabled)}
							title={soundEnabled ? "Sound enabled" : "Sound muted"}
						>
							{soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
						</button>
					</div>
				</motion.div>
			)}

			{/* ================= TAB 2: POMODORO ================= */}
			{activeTab === "pomodoro" && (
				<motion.div
					key="tab-pomodoro"
					className="timers-tab-content pomodoro-tab"
					initial={{ opacity: 0, scale: 0.98 }}
					animate={{ opacity: 1, scale: 1 }}
					transition={{ duration: 0.15 }}
				>
					{/* Phase Switcher */}
					<div className="pomo-phase-selector">
						<button
							className={`pomo-phase-btn ${pomoPhase === "focus" ? "active focus" : ""}`}
							onClick={() => handleSwitchPomoPhase("focus")}
						>
							Focus
						</button>
						<button
							className={`pomo-phase-btn ${pomoPhase === "shortBreak" ? "active short" : ""}`}
							onClick={() => handleSwitchPomoPhase("shortBreak")}
						>
							Short Break
						</button>
						<button
							className={`pomo-phase-btn ${pomoPhase === "longBreak" ? "active long" : ""}`}
							onClick={() => handleSwitchPomoPhase("longBreak")}
						>
							Long Break
						</button>
					</div>

					{/* Completion Alert Banner if finished */}
					<AnimatePresence>
						{isPomoFinished && (
							<motion.div
								className="pomo-finished-banner"
								initial={{ opacity: 0, y: -6, scale: 0.96 }}
								animate={{ opacity: 1, y: 0, scale: 1 }}
								exit={{ opacity: 0, y: -6, scale: 0.96 }}
							>
								<div className="pomo-finished-info">
									<BellRing size={15} className="pomo-finished-bell" />
									<span className="pomo-finished-text">
										{pomoPhase === "focus"
											? `Session ${pomoCycleCount} finished!`
											: "Break finished! Ready to focus?"}
									</span>
								</div>
								<div className="pomo-finished-actions">
									<button
										className="pomo-dismiss-btn"
										onClick={handleDismissPomoFinished}
									>
										Dismiss
									</button>
									<button
										className="pomo-next-btn"
										onClick={handlePomoAdvanceAndStart}
									>
										{pomoPhase === "focus"
											? pomoCycleCount >= 4
												? "Start Long Break"
												: "Start Short Break"
											: "Start Focus"}
									</button>
								</div>
							</motion.div>
						)}
					</AnimatePresence>

					{/* Big Pomodoro Display */}
					<div className={`pomo-display phase-${pomoPhase} ${isPomoFinished ? "finished" : ""}`}>
						<span className="pomo-digital-time">
							{formatSeconds(pomoSecondsLeft)}
						</span>
						<div className="pomo-cycle-indicator">
							<div className="pomo-dots">
								{[1, 2, 3, 4].map((dot) => (
									<span
										key={dot}
										className={`pomo-dot ${dot < pomoCycleCount ? "completed" : dot === pomoCycleCount ? "active" : ""}`}
									/>
								))}
							</div>
							<div className="pomo-cycle-info-row">
								<span className="pomo-cycle-text">
									{pomoPhase === "longBreak"
										? "Long Break"
										: `Session ${pomoCycleCount} of 4`}
									{pomoTodayCompleted > 0 && ` · ${pomoTodayCompleted} done today`}
								</span>
								<button
									className="pomo-cycle-reset-btn"
									onClick={handleResetCycle}
									title="Reset cycle to Session 1"
								>
									Reset
								</button>
							</div>
						</div>
					</div>

					{/* Customizable Duration Steppers */}
					<div className="pomo-durations-row">
						<div className="pomo-duration-item">
							<span className="pomo-dur-label">Focus</span>
							<div className="pomo-dur-stepper">
								<button
									type="button"
									disabled={isPomoRunning || pomoFocusMins <= 5}
									onClick={() => handleAdjustPomoDuration("focus", -5)}
								>
									-
								</button>
								<span className="pomo-dur-val">{pomoFocusMins}m</span>
								<button
									type="button"
									disabled={isPomoRunning || pomoFocusMins >= 90}
									onClick={() => handleAdjustPomoDuration("focus", 5)}
								>
									+
								</button>
							</div>
						</div>
						<div className="pomo-duration-item">
							<span className="pomo-dur-label">Short</span>
							<div className="pomo-dur-stepper">
								<button
									type="button"
									disabled={isPomoRunning || pomoShortMins <= 1}
									onClick={() => handleAdjustPomoDuration("short", -1)}
								>
									-
								</button>
								<span className="pomo-dur-val">{pomoShortMins}m</span>
								<button
									type="button"
									disabled={isPomoRunning || pomoShortMins >= 30}
									onClick={() => handleAdjustPomoDuration("short", 1)}
								>
									+
								</button>
							</div>
						</div>
						<div className="pomo-duration-item">
							<span className="pomo-dur-label">Long</span>
							<div className="pomo-dur-stepper">
								<button
									type="button"
									disabled={isPomoRunning || pomoLongMins <= 5}
									onClick={() => handleAdjustPomoDuration("long", -5)}
								>
									-
								</button>
								<span className="pomo-dur-val">{pomoLongMins}m</span>
								<button
									type="button"
									disabled={isPomoRunning || pomoLongMins >= 60}
									onClick={() => handleAdjustPomoDuration("long", 5)}
								>
									+
								</button>
							</div>
						</div>
					</div>

					{/* Pomodoro Action Buttons */}
					<div className="timer-action-controls">
						<button
							className={`timer-play-btn ${isPomoRunning ? "running" : ""}`}
							onClick={() => {
								getAudioContext();
								setIsPomoRunning(!isPomoRunning);
								setIsPomoFinished(false);
							}}
						>
							{isPomoRunning ? (
								<>
									<Pause size={15} fill="currentColor" />
									<span>Pause</span>
								</>
							) : (
								<>
									<Play size={15} fill="currentColor" />
									<span>Start</span>
								</>
							)}
						</button>
						<button
							className="timer-reset-btn"
							onClick={handleNextPomoPhase}
							title="Skip to next phase"
						>
							<SkipForward size={14} />
						</button>
						<button
							className="timer-reset-btn"
							onClick={() => {
								setIsPomoRunning(false);
								setIsPomoFinished(false);
								setPomoSecondsLeft(pomoPhaseDuration);
							}}
							title="Reset phase"
						>
							<RotateCcw size={14} />
						</button>
						<button
							className={`timer-sound-btn ${soundEnabled ? "on" : "off"}`}
							onClick={() => setSoundEnabled(!soundEnabled)}
							title={soundEnabled ? "Sound enabled" : "Sound muted"}
						>
							{soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
						</button>
					</div>
				</motion.div>
			)}

			{/* ================= TAB 3: ALARMS ================= */}
			{activeTab === "alarm" && (
				<motion.div
					key="tab-alarm"
					className="timers-tab-content alarm-tab"
					initial={{ opacity: 0, scale: 0.98 }}
					animate={{ opacity: 1, scale: 1 }}
					transition={{ duration: 0.15 }}
				>
					{/* Add Alarm Form Drawer */}
					<AnimatePresence>
						{isAddingAlarm && (
							<motion.div
								className="alarm-add-form"
								initial={{ height: 0, opacity: 0 }}
								animate={{ height: "auto", opacity: 1 }}
								exit={{ height: 0, opacity: 0 }}
								transition={{ duration: 0.2 }}
							>
								<div className="alarm-form-row">
									<input
										type="time"
										className="alarm-time-input"
										value={newAlarmTime}
										onChange={(e) => setNewAlarmTime(e.target.value)}
										onFocus={() => {
											onPinNotch?.(true);
										}}
										onBlur={() => {
											onPinNotch?.(false);
										}}
									/>
									<input
										type="text"
										className="alarm-label-input"
										placeholder="Alarm label..."
										value={newAlarmLabel}
										onChange={(e) => setNewAlarmLabel(e.target.value)}
										onFocus={() => {
											onPinNotch?.(true);
										}}
										onBlur={() => {
											onPinNotch?.(false);
										}}
									/>
								</div>
								<div className="alarm-form-bottom">
									<div className="alarm-repeat-chips">
										{(["once", "daily", "weekdays"] as const).map((r) => (
											<button
												key={r}
												className={`repeat-chip ${newAlarmRepeat === r ? "active" : ""}`}
												onClick={() => setNewAlarmRepeat(r)}
											>
												{r === "once" ? "Once" : r === "daily" ? "Daily" : "Mon–Fri"}
											</button>
										))}
									</div>
									<div className="alarm-form-actions">
										<button
											className="alarm-btn-cancel"
											onClick={() => setIsAddingAlarm(false)}
										>
											Cancel
										</button>
										<button
											className="alarm-btn-save"
											onClick={handleSaveNewAlarm}
										>
											Save
										</button>
									</div>
								</div>
							</motion.div>
						)}
					</AnimatePresence>

					{/* Header with + Add Alarm */}
					<div className="alarm-list-header">
						<span className="alarm-list-title">My Alarms</span>
						{!isAddingAlarm && (
							<button
								className="alarm-add-btn"
								onClick={() => setIsAddingAlarm(true)}
							>
								<Plus size={13} />
								<span>Add Alarm</span>
							</button>
						)}
					</div>

					{/* Alarms List */}
					<div className="alarm-items-scroll">
						{alarms.length === 0 ? (
							<div className="alarm-empty-state">
								<AlarmClock size={24} className="alarm-empty-icon" />
								<span>No alarms scheduled</span>
								<button
									className="alarm-add-btn"
									onClick={() => setIsAddingAlarm(true)}
								>
									<Plus size={13} />
									<span>New Alarm</span>
								</button>
							</div>
						) : (
							alarms.map((alarm) => (
								<div
									key={alarm.id}
									className={`alarm-card ${alarm.enabled ? "enabled" : "disabled"}`}
								>
									<div className="alarm-card-left">
										<span className="alarm-card-time">
											{formatAlarmTimeDisplay(alarm.time)}
										</span>
										<div className="alarm-card-meta">
											<span className="alarm-card-label">{alarm.label}</span>
											<span className="alarm-card-repeat">
												{alarm.repeat === "once"
													? "Once"
													: alarm.repeat === "daily"
														? "Everyday"
														: "Weekdays"}
											</span>
										</div>
									</div>

									<div className="alarm-card-right">
										{/* Toggle Switch */}
										<button
											className={`alarm-switch ${alarm.enabled ? "active" : ""}`}
											onClick={() => handleToggleAlarmEnabled(alarm.id)}
											title={alarm.enabled ? "Turn off" : "Turn on"}
										>
											<span className="alarm-switch-knob" />
										</button>
										<button
											className="alarm-delete-btn"
											onClick={() => handleDeleteAlarm(alarm.id)}
											title="Delete alarm"
										>
											<Trash2 size={12} />
										</button>
									</div>
								</div>
							))
						)}
					</div>
				</motion.div>
			)}
		</div>
	);
}
