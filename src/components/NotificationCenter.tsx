import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, BellOff, Trash2, X } from "lucide-react";

export interface NotificationItem {
	id: number;
	app_name: string;
	title: string;
	body: string;
	actions: string[];
	timestamp: number;
}

interface NotificationCenterProps {
	notifications: NotificationItem[];
	onClearAll: () => void;
	onDismissItem: (id: number) => void;
	onOpenItem: (item: NotificationItem) => void;
}

function formatRelativeTime(timestamp: number): string {
	const diff = Math.max(0, Date.now() - timestamp);
	const seconds = Math.floor(diff / 1000);
	if (seconds < 45) return "Just now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days === 1) return "Yesterday";
	return `${days}d ago`;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
	notifications,
	onClearAll,
	onDismissItem,
	onOpenItem
}) => {
	return (
		<div className="notif-center-container" onClick={(e) => e.stopPropagation()}>
			{/* Header */}
			<div className="notif-center-header">
				<div className="notif-center-title-group">
					<div className="notif-center-icon-badge">
						<Bell size={13} strokeWidth={2.5} />
					</div>
					<span className="notif-center-title">Notifications</span>
					{notifications.length > 0 && (
						<span className="notif-center-count-pill">{notifications.length}</span>
					)}
				</div>

				{notifications.length > 0 && (
					<button
						type="button"
						className="notif-center-clear-btn"
						onClick={(e) => {
							e.stopPropagation();
							onClearAll();
						}}
						title="Clear all notifications"
					>
						<Trash2 size={12} strokeWidth={2.2} />
						<span>Clear all</span>
					</button>
				)}
			</div>

			{/* Scrollable list */}
			<div className="notif-center-scroll">
				{notifications.length === 0 ? (
					<div className="notif-center-empty">
						<div className="empty-bell-wrap">
							<BellOff size={26} strokeWidth={1.8} />
						</div>
						<span className="empty-title">No notifications</span>
						<span className="empty-desc">You're all caught up!</span>
					</div>
				) : (
					<AnimatePresence mode="popLayout" initial={false}>
						{notifications.map((item) => (
							<motion.div
								key={item.id}
								layout
								initial={{ opacity: 0, y: 10, scale: 0.98 }}
								animate={{ opacity: 1, y: 0, scale: 1 }}
								exit={{ opacity: 0, scale: 0.94, filter: "blur(4px)", transition: { duration: 0.15 } }}
								transition={{ type: "spring", stiffness: 450, damping: 32 }}
								className="notif-center-card"
								onClick={() => onOpenItem(item)}
							>
								{/* Card header */}
								<div className="notif-card-header">
									<div className="notif-card-app-group">
										<div className="notif-card-badge">
											<Bell size={11} strokeWidth={2.5} />
										</div>
										<span className="notif-card-app-name">{item.app_name}</span>
										<span className="notif-card-dot">•</span>
										<span className="notif-card-time">{formatRelativeTime(item.timestamp)}</span>
									</div>
									<button
										type="button"
										className="notif-card-dismiss-btn"
										onClick={(e) => {
											e.stopPropagation();
											onDismissItem(item.id);
										}}
										title="Dismiss"
									>
										<X size={11} strokeWidth={2.4} />
									</button>
								</div>

								{/* Card content */}
								<div className="notif-card-body">
									<div className="notif-card-title">{item.title}</div>
									{item.body && <div className="notif-card-message">{item.body}</div>}
								</div>

								{/* Card actions */}
								<div className="notif-card-actions">
									<button
										type="button"
										className="notif-card-action-btn primary"
										onClick={(e) => {
											e.stopPropagation();
											onOpenItem(item);
										}}
									>
										Open
									</button>
									<button
										type="button"
										className="notif-card-action-btn secondary"
										onClick={(e) => {
											e.stopPropagation();
											onDismissItem(item.id);
										}}
									>
										Dismiss
									</button>
								</div>
							</motion.div>
						))}
					</AnimatePresence>
				)}
			</div>
		</div>
	);
};
