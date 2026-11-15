import React, { useState, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import {
	StickyNote,
	Plus,
	Trash2,
	ChevronLeft,
	Copy,
	Check,
	Pin,
	PinOff,
	Search,
	X
} from "lucide-react";
import "./MyNotes.css";

export interface NoteItem {
	id: string;
	title: string;
	content: string;
	createdAt: number;
	updatedAt: number;
	isPinned?: boolean;
	color?: string;
}

const STORAGE_KEY = "bloom_notes";

const DEFAULT_NOTES: NoteItem[] = [
	{
		id: "1",
		title: "Welcome to My Notes",
		content: "Quickly capture ideas, links, code snippets, or draft messages right here in your notch.",
		createdAt: Date.now() - 60000,
		updatedAt: Date.now() - 60000,
		isPinned: true,
		color: "blue"
	}
];

const NOTE_COLORS = [
	{ id: "default", bg: "rgba(255, 255, 255, 0.08)", border: "rgba(255, 255, 255, 0.15)" },
	{ id: "amber", bg: "rgba(245, 158, 11, 0.15)", border: "rgba(245, 158, 11, 0.4)" },
	{ id: "emerald", bg: "rgba(16, 185, 129, 0.15)", border: "rgba(16, 185, 129, 0.4)" },
	{ id: "blue", bg: "rgba(59, 130, 246, 0.15)", border: "rgba(59, 130, 246, 0.4)" },
	{ id: "purple", bg: "rgba(168, 85, 247, 0.15)", border: "rgba(168, 85, 247, 0.4)" },
	{ id: "rose", bg: "rgba(244, 63, 94, 0.15)", border: "rgba(244, 63, 94, 0.4)" }
];

interface MyNotesProps {
	onPinNotch?: (pinned: boolean) => void;
}

export function MyNotes({ onPinNotch }: MyNotesProps) {
	const isLoadedFromDiskRef = useRef(false);
	const [notes, setNotes] = useState<NoteItem[]>(() => {
		try {
			const saved = localStorage.getItem(STORAGE_KEY);
			if (saved) {
				const parsed = JSON.parse(saved);
				if (Array.isArray(parsed)) return parsed;
			}
		} catch (e) {
			console.error("Failed to load notes from localStorage:", e);
		}
		return DEFAULT_NOTES;
	});

	const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [isSearching, setIsSearching] = useState(false);
	const [copied, setCopied] = useState(false);

	const titleInputRef = useRef<HTMLInputElement>(null);
	const contentTextareaRef = useRef<HTMLTextAreaElement>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);

	// Load from persistent disk file (%APPDATA%/com.sehaz.bloom/notes.json) on mount
	useEffect(() => {
		invoke<NoteItem[] | null>("load_notes")
			.then((diskNotes) => {
				isLoadedFromDiskRef.current = true;
				if (Array.isArray(diskNotes) && diskNotes.length > 0) {
					setNotes(diskNotes);
					try {
						localStorage.setItem(STORAGE_KEY, JSON.stringify(diskNotes));
					} catch {}
				} else {
					invoke("save_notes", { notes }).catch(() => {});
				}
			})
			.catch((e) => {
				isLoadedFromDiskRef.current = true;
				console.error("Failed to load notes from disk:", e);
			});
	}, []);

	// Persist notes to both localStorage and disk JSON file whenever updated
	useEffect(() => {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
		} catch (e) {
			console.error("Failed to save notes to localStorage:", e);
		}
		if (isLoadedFromDiskRef.current) {
			invoke("save_notes", { notes }).catch((e) => {
				console.error("Failed to save notes to disk:", e);
			});
		}
	}, [notes]);

	// Auto-focus search input when search is opened
	useEffect(() => {
		if (isSearching) {
			searchInputRef.current?.focus();
		}
	}, [isSearching]);

	// Active note object
	const activeNote = useMemo(() => {
		return notes.find((n) => n.id === activeNoteId) || null;
	}, [notes, activeNoteId]);

	// Filtered and sorted notes list
	const filteredNotes = useMemo(() => {
		const q = searchQuery.trim().toLowerCase();
		let list = notes;
		if (q) {
			list = list.filter(
				(n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)
			);
		}
		return [...list].sort((a, b) => {
			if (a.isPinned && !b.isPinned) return -1;
			if (!a.isPinned && b.isPinned) return 1;
			return b.updatedAt - a.updatedAt;
		});
	}, [notes, searchQuery]);

	const handleInputFocus = () => {
		onPinNotch?.(true);
	};

	const handleInputBlur = () => {
		onPinNotch?.(false);
	};

	// Create a new note
	const handleCreateNote = () => {
		const newNote: NoteItem = {
			id: Date.now().toString() + Math.random().toString(36).substring(2, 6),
			title: "",
			content: "",
			createdAt: Date.now(),
			updatedAt: Date.now(),
			isPinned: false,
			color: "default"
		};
		setNotes((prev) => [newNote, ...prev]);
		setActiveNoteId(newNote.id);
		setIsSearching(false);
		setSearchQuery("");
		setTimeout(() => {
			titleInputRef.current?.focus();
		}, 60);
	};

	// Update active note fields
	const updateActiveNote = (updates: Partial<NoteItem>) => {
		if (!activeNoteId) return;
		setNotes((prev) =>
			prev.map((n) =>
				n.id === activeNoteId ? { ...n, ...updates, updatedAt: Date.now() } : n
			)
		);
	};

	// Toggle pin
	const handleTogglePin = (id: string, e?: React.MouseEvent) => {
		if (e) e.stopPropagation();
		setNotes((prev) =>
			prev.map((n) => (n.id === id ? { ...n, isPinned: !n.isPinned } : n))
		);
	};

	// Delete note
	const handleDeleteNote = (id: string, e?: React.MouseEvent) => {
		if (e) e.stopPropagation();
		setNotes((prev) => prev.filter((n) => n.id !== id));
		if (activeNoteId === id) {
			setActiveNoteId(null);
		}
	};

	// Copy active note content
	const handleCopyContent = () => {
		if (!activeNote) return;
		const fullText = activeNote.title
			? `${activeNote.title}\n\n${activeNote.content}`
			: activeNote.content;
		navigator.clipboard.writeText(fullText).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		});
	};

	// Format relative/display date
	const formatNoteDate = (ts: number) => {
		const diff = Date.now() - ts;
		if (diff < 60000) return "Just now";
		if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
		if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
		return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
	};

	// Word & character counts
	const wordCount = activeNote?.content.trim()
		? activeNote.content.trim().split(/\s+/).length
		: 0;
	const charCount = activeNote?.content.length || 0;

	return (
		<div className="notes-container">
			<AnimatePresence mode="wait" initial={false}>
				{activeNoteId === null || !activeNote ? (
					/* ================= LIST VIEW ================= */
					<motion.div
						key="list-view"
						className="notes-view notes-list-view"
						initial={{ opacity: 0, x: -8 }}
						animate={{ opacity: 1, x: 0 }}
						exit={{ opacity: 0, x: -8 }}
						transition={{ duration: 0.15 }}
					>
						{/* Header */}
						<div className="notes-header">
							<div className="notes-title-wrap">
								<StickyNote size={15} className="notes-header-icon" />
								<span className="notes-title">Notes</span>
								<span className="notes-badge">{notes.length}</span>
							</div>

							<div className="notes-header-actions">
								<button
									className={`notes-btn-action ${isSearching ? "active" : ""}`}
									onClick={() => {
										setIsSearching(!isSearching);
										if (isSearching) setSearchQuery("");
									}}
									title="Search notes"
								>
									<Search size={13} />
								</button>
								<button
									className="notes-btn-action notes-btn-new"
									onClick={handleCreateNote}
									title="Create new note"
								>
									<Plus size={14} />
									<span>New</span>
								</button>
							</div>
						</div>

						{/* Search bar */}
						<AnimatePresence>
							{isSearching && (
								<motion.div
									className="notes-search-bar"
									initial={{ height: 0, opacity: 0 }}
									animate={{ height: "auto", opacity: 1 }}
									exit={{ height: 0, opacity: 0 }}
									transition={{ duration: 0.15 }}
								>
									<Search size={12} className="notes-search-icon" />
									<input
										ref={searchInputRef}
										type="text"
										className="notes-search-input"
										placeholder="Filter notes..."
										value={searchQuery}
										onChange={(e) => setSearchQuery(e.target.value)}
										onFocus={handleInputFocus}
										onBlur={handleInputBlur}
									/>
									{searchQuery && (
										<button
											className="notes-search-clear"
											onClick={() => setSearchQuery("")}
										>
											<X size={12} />
										</button>
									)}
								</motion.div>
							)}
						</AnimatePresence>

						{/* Cards List or Empty State */}
						<div className="notes-list-scroll">
							{filteredNotes.length === 0 ? (
								<div className="notes-empty-state">
									<StickyNote size={24} className="notes-empty-icon" />
									<span className="notes-empty-title">
										{searchQuery ? "No matching notes" : "No notes yet"}
									</span>
									<span className="notes-empty-desc">
										{searchQuery
											? "Try a different search term"
											: "Quickly capture ideas and snippets"}
									</span>
									{!searchQuery && (
										<button
											className="notes-empty-btn"
											onClick={handleCreateNote}
										>
											<Plus size={13} />
											<span>Create Note</span>
										</button>
									)}
								</div>
							) : (
								filteredNotes.map((note) => {
									const previewText =
										note.content.trim() || "(Empty note)";
									const displayTitle =
										note.title.trim() ||
										(note.content.trim().slice(0, 24) || "Untitled Note");

									return (
										<motion.div
											key={note.id}
											layout
											className={`note-card ${note.color ? `color-${note.color}` : ""}`}
											onClick={() => setActiveNoteId(note.id)}
										>
											<div className="note-card-top">
												<span className="note-card-title">{displayTitle}</span>
												<div className="note-card-actions">
													{note.isPinned && (
														<span className="note-card-pin" title="Pinned">
															<Pin size={11} fill="currentColor" />
														</span>
													)}
													<button
														className="note-card-delete"
														onClick={(e) => handleDeleteNote(note.id, e)}
														title="Delete note"
													>
														<Trash2 size={12} />
													</button>
												</div>
											</div>
											<p className="note-card-snippet">{previewText}</p>
											<div className="note-card-footer">
												<span className="note-card-date">
													{formatNoteDate(note.updatedAt)}
												</span>
											</div>
										</motion.div>
									);
								})
							)}
						</div>
					</motion.div>
				) : (
					/* ================= EDITOR VIEW ================= */
					<motion.div
						key="editor-view"
						className={`notes-view notes-editor-view ${activeNote.color ? `color-${activeNote.color}` : ""}`}
						initial={{ opacity: 0, x: 8 }}
						animate={{ opacity: 1, x: 0 }}
						exit={{ opacity: 0, x: 8 }}
						transition={{ duration: 0.15 }}
					>
						{/* Editor Header */}
						<div className="notes-editor-header">
							<button
								className="notes-editor-back"
								onClick={() => setActiveNoteId(null)}
								title="Back to all notes"
							>
								<ChevronLeft size={14} />
								<span>Notes</span>
							</button>

							<div className="notes-editor-actions">
								{/* Color Picker */}
								<div className="notes-color-dots">
									{NOTE_COLORS.map((c) => (
										<button
											key={c.id}
											className={`notes-color-dot ${activeNote.color === c.id ? "active" : ""}`}
											style={{ background: c.border }}
											onClick={() => updateActiveNote({ color: c.id })}
											title={`Color: ${c.id}`}
										/>
									))}
								</div>

								{/* Pin button */}
								<button
									className={`notes-editor-btn ${activeNote.isPinned ? "active" : ""}`}
									onClick={() => handleTogglePin(activeNote.id)}
									title={activeNote.isPinned ? "Unpin note" : "Pin note"}
								>
									{activeNote.isPinned ? (
										<Pin size={13} fill="currentColor" />
									) : (
										<PinOff size={13} />
									)}
								</button>

								{/* Copy button */}
								<button
									className="notes-editor-btn"
									onClick={handleCopyContent}
									title="Copy to clipboard"
								>
									{copied ? <Check size={13} className="text-emerald" /> : <Copy size={13} />}
								</button>

								{/* Delete button */}
								<button
									className="notes-editor-btn delete"
									onClick={() => handleDeleteNote(activeNote.id)}
									title="Delete note"
								>
									<Trash2 size={13} />
								</button>
							</div>
						</div>

						{/* Note Title Input */}
						<input
							ref={titleInputRef}
							type="text"
							className="notes-editor-title"
							placeholder="Note title..."
							value={activeNote.title}
							onChange={(e) => updateActiveNote({ title: e.target.value })}
							onFocus={handleInputFocus}
							onBlur={handleInputBlur}
						/>

						{/* Note Content Textarea */}
						<textarea
							ref={contentTextareaRef}
							className="notes-editor-textarea"
							placeholder="Write your note here..."
							value={activeNote.content}
							onChange={(e) => updateActiveNote({ content: e.target.value })}
							onFocus={handleInputFocus}
							onBlur={handleInputBlur}
						/>

						{/* Editor Footer / Info */}
						<div className="notes-editor-footer">
							<span className="notes-editor-meta">
								{wordCount} {wordCount === 1 ? "word" : "words"} · {charCount} chars
							</span>
							<span className="notes-editor-saved">
								Edited {formatNoteDate(activeNote.updatedAt)}
							</span>
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
