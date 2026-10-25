import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Plus, Trash2, ListTodo, Timer } from "lucide-react";
import "./TodoList.css";

export interface TodoItem {
	id: string;
	text: string;
	completed: boolean;
	createdAt: number;
}

const STORAGE_KEY = "bloom_todos";

const DEFAULT_TODOS: TodoItem[] = [
	{ id: "1", text: "Welcome to Bloom To-Do! ✨", completed: false, createdAt: Date.now() },
	{ id: "2", text: "Click circle to complete a task", completed: true, createdAt: Date.now() - 1000 }
];

interface TodoListProps {
	isTimerCollapsed?: boolean;
	onToggleTimer?: () => void;
	onPinNotch?: (pinned: boolean) => void;
}

export function TodoList({ isTimerCollapsed, onToggleTimer, onPinNotch }: TodoListProps) {
	const isLoadedFromDiskRef = useRef(false);
	const [todos, setTodos] = useState<TodoItem[]>(() => {
		try {
			const saved = localStorage.getItem(STORAGE_KEY);
			if (saved) {
				const parsed = JSON.parse(saved);
				if (Array.isArray(parsed)) return parsed;
			}
		} catch (e) {
			console.error("Failed to load todos:", e);
		}
		return DEFAULT_TODOS;
	});

	const [inputText, setInputText] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	// Load from persistent disk file (%APPDATA%/com.sehaz.bloom/todos.json) on mount
	useEffect(() => {
		invoke<TodoItem[] | null>("load_todos")
			.then((diskTodos) => {
				isLoadedFromDiskRef.current = true;
				if (Array.isArray(diskTodos)) {
					setTodos(diskTodos);
					try {
						localStorage.setItem(STORAGE_KEY, JSON.stringify(diskTodos));
					} catch {}
				} else {
					// File does not exist on disk yet (very first run). Save current default to disk.
					invoke("save_todos", { todos }).catch(() => {});
				}
			})
			.catch((e) => {
				isLoadedFromDiskRef.current = true;
				console.error("Failed to load todos from disk:", e);
			});
	}, []);

	// Persist todos to both localStorage and disk JSON file whenever updated
	useEffect(() => {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
		} catch (e) {
			console.error("Failed to save todos to localStorage:", e);
		}
		// Save to disk once loaded from disk (or if already initialized)
		if (isLoadedFromDiskRef.current) {
			invoke("save_todos", { todos }).catch((e) => {
				console.error("Failed to save todos to disk:", e);
			});
		}
	}, [todos]);

	const handleAddTodo = (e?: React.FormEvent) => {
		if (e) e.preventDefault();
		const trimmed = inputText.trim();
		if (!trimmed) return;

		const newTodo: TodoItem = {
			id: Date.now().toString() + Math.random().toString(36).substring(2, 6),
			text: trimmed,
			completed: false,
			createdAt: Date.now()
		};

		setTodos((prev) => [newTodo, ...prev]);
		setInputText("");
	};

	const handleToggleTodo = (id: string) => {
		setTodos((prev) =>
			prev.map((item) => (item.id === id ? { ...item, completed: !item.completed } : item))
		);
	};

	const handleDeleteTodo = (id: string, e: React.MouseEvent) => {
		e.stopPropagation();
		setTodos((prev) => prev.filter((item) => item.id !== id));
	};

	const handleClearCompleted = (e: React.MouseEvent) => {
		e.stopPropagation();
		setTodos((prev) => prev.filter((item) => !item.completed));
	};

	const remainingCount = todos.filter((t) => !t.completed).length;
	const completedCount = todos.length - remainingCount;

	return (
		<div className="todo-container">
			{/* Header */}
			<div className="todo-header">
				<div className="todo-title-wrap">
					<ListTodo size={15} className="todo-header-icon" />
					<span className="todo-title">Tasks</span>
					<span className="todo-badge">
						{remainingCount === 0 ? "All done" : `${remainingCount} left`}
					</span>
				</div>

				<div className="todo-header-actions">
					{completedCount > 0 && (
						<button
							className="todo-btn-clear"
							onClick={handleClearCompleted}
							title="Clear completed tasks"
						>
							Clear
						</button>
					)}
					{onToggleTimer && (
						<button
							className={`todo-btn-timer-toggle ${!isTimerCollapsed ? "active" : ""}`}
							onClick={onToggleTimer}
							title={isTimerCollapsed ? "Show Timer" : "Hide Timer"}
						>
							<Timer size={14} />
						</button>
					)}
				</div>
			</div>

			{/* Input row */}
			<form className="todo-input-form" onSubmit={handleAddTodo}>
				<input
					ref={inputRef}
					type="text"
					className="todo-input"
					placeholder="Add a new task..."
					value={inputText}
					onChange={(e) => setInputText(e.target.value)}
					onFocus={() => {
						onPinNotch?.(true);
						invoke("focus_notch_input", { focus: true }).catch(() => {});
					}}
					onBlur={() => {
						onPinNotch?.(false);
						invoke("focus_notch_input", { focus: false }).catch(() => {});
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter") handleAddTodo();
					}}
					onWheel={(e) => e.stopPropagation()}
				/>
				<button
					type="submit"
					className={`todo-add-btn ${inputText.trim() ? "has-text" : ""}`}
					disabled={!inputText.trim()}
					title="Add task"
				>
					<Plus size={14} strokeWidth={2.5} />
				</button>
			</form>

			{/* Task list */}
			<div className="todo-list-scroll">
				<AnimatePresence initial={false}>
					{todos.length === 0 ? (
						<motion.div
							className="todo-empty-state"
							initial={{ opacity: 0, y: 6 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0 }}
						>
							<Check size={24} className="todo-empty-icon" />
							<span>No tasks yet. Stay productive!</span>
						</motion.div>
					) : (
						todos.map((todo) => (
							<motion.div
								key={todo.id}
								className={`todo-item ${todo.completed ? "completed" : ""}`}
								onClick={() => handleToggleTodo(todo.id)}
								initial={{ opacity: 0, y: 6 }}
								animate={{ opacity: 1, y: 0 }}
								exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.12 } }}
								layout
								transition={{ type: "spring", stiffness: 500, damping: 35 }}
							>
								<div className="todo-checkbox">
									{todo.completed && <Check size={11} strokeWidth={3} />}
								</div>
								<span className="todo-text">{todo.text}</span>
								<button
									className="todo-delete-btn"
									onClick={(e) => handleDeleteTodo(todo.id, e)}
									title="Delete task"
								>
									<Trash2 size={13} />
								</button>
							</motion.div>
						))
					)}
				</AnimatePresence>
			</div>
		</div>
	);
}
