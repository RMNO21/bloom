use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use windows::Foundation::TypedEventHandler;
use windows::UI::Notifications::Management::{
    UserNotificationListener, UserNotificationListenerAccessStatus,
};
use windows::UI::Notifications::{
    UserNotificationChangedEventArgs, UserNotificationChangedKind,
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NotificationData {
    pub id: u32,
    pub app_name: String,
    pub title: String,
    pub body: String,
    pub actions: Vec<String>,
    pub timestamp: i64,
}

static NOTIF_APP: Mutex<Option<AppHandle>> = Mutex::new(None);
static IS_LISTENING: AtomicBool = AtomicBool::new(false);

pub fn setup_notifications(app: AppHandle) {
    if let Ok(mut lock) = NOTIF_APP.lock() {
        *lock = Some(app.clone());
    }

    std::thread::spawn(move || {
        // Initialize COM
        let _ = unsafe {
            windows::Win32::System::Com::CoInitializeEx(
                None,
                windows::Win32::System::Com::COINIT_MULTITHREADED,
            )
        };

        let listener = match UserNotificationListener::Current() {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[Bloom] UserNotificationListener::Current failed: {:?}", e);
                return;
            }
        };

        let status = match listener.GetAccessStatus() {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[Bloom] GetAccessStatus failed: {:?}", e);
                return;
            }
        };

        println!("[Bloom] UserNotificationListener initial status: {:?}", status);

        let final_status = if status != UserNotificationListenerAccessStatus::Allowed {
            match listener.RequestAccessAsync().and_then(|op| op.get()) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[Bloom] RequestAccessAsync failed: {:?}", e);
                    status
                }
            }
        } else {
            status
        };

        println!("[Bloom] UserNotificationListener final status: {:?}", final_status);

        if final_status != UserNotificationListenerAccessStatus::Allowed {
            eprintln!("[Bloom] UserNotificationListener access was not allowed.");
            return;
        }

        IS_LISTENING.store(true, Ordering::Relaxed);

        let app_handle_for_events = app.clone();
        let token = listener.NotificationChanged(&TypedEventHandler::new(
            move |sender: windows::core::Ref<UserNotificationListener>,
                  args: windows::core::Ref<UserNotificationChangedEventArgs>| {
                if let (Some(listener), Some(args)) = (sender.as_ref(), args.as_ref()) {
                    if let Ok(kind) = args.ChangeKind() {
                        if kind == UserNotificationChangedKind::Added {
                            let notif_id = args.UserNotificationId().unwrap_or(0);
                            if notif_id > 0 {
                                process_new_notification(&app_handle_for_events, listener, notif_id);
                            }
                        }
                    }
                }
                Ok(())
            },
        ));

        if let Err(e) = token {
            eprintln!("[Bloom] NotificationChanged subscription failed: {:?}", e);
        } else {
            println!("[Bloom] Successfully subscribed to NotificationChanged!");
        }

        // Loop to keep background thread alive if needed or check existing
        while !crate::state::SHUTTING_DOWN.load(Ordering::Relaxed) {
            std::thread::sleep(std::time::Duration::from_secs(1));
        }
    });
}

fn extract_notification_data(notif: &windows::UI::Notifications::UserNotification) -> Option<NotificationData> {
    let app_name = notif
        .AppInfo()
        .ok()
        .and_then(|info| info.DisplayInfo().ok())
        .and_then(|disp| disp.DisplayName().ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "Notification".to_string());

    let mut title = String::new();
    let mut body = String::new();

    if let Ok(visual) = notif.Notification().and_then(|n| n.Visual()) {
        if let Ok(bindings) = visual.Bindings() {
            for binding in bindings {
                if let Ok(texts) = binding.GetTextElements() {
                    for (idx, text_elem) in texts.into_iter().enumerate() {
                        if let Ok(text) = text_elem.Text() {
                            let t = text.to_string();
                            if !t.is_empty() {
                                if idx == 0 && title.is_empty() {
                                    title = t;
                                } else if body.is_empty() {
                                    body = t;
                                } else {
                                    body.push_str(" ");
                                    body.push_str(&t);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if title.is_empty() && body.is_empty() {
        return None;
    }

    if title.is_empty() {
        title = app_name.clone();
    }

    let notif_id = notif.Id().unwrap_or(0);

    Some(NotificationData {
        id: notif_id,
        app_name,
        title,
        body,
        actions: vec!["Open".to_string(), "Dismiss".to_string()],
        timestamp: chrono_now_ms(),
    })
}

fn process_new_notification(
    app: &AppHandle,
    listener: &UserNotificationListener,
    notif_id: u32,
) {
    let Ok(notif) = listener.GetNotification(notif_id) else {
        return;
    };
    if let Some(data) = extract_notification_data(&notif) {
        let _ = app.emit("bloom-new-notification", data);
    }
}

fn chrono_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[tauri::command]
pub fn dismiss_notification(id: u32) {
    if let Ok(listener) = UserNotificationListener::Current() {
        let _ = listener.RemoveNotification(id);
    }
}

#[tauri::command]
pub fn clear_all_notifications() {
    if let Ok(listener) = UserNotificationListener::Current() {
        let _ = listener.ClearNotifications();
    }
}

#[tauri::command]
pub async fn get_active_notifications() -> Vec<NotificationData> {
    tokio::task::spawn_blocking(|| {
        let mut result = Vec::new();
        if let Ok(listener) = UserNotificationListener::Current() {
            if let Ok(op) = listener.GetNotificationsAsync(windows::UI::Notifications::NotificationKinds::Toast) {
                if let Ok(notifs) = op.get() {
                    for notif in notifs {
                        if let Some(data) = extract_notification_data(&notif) {
                            result.push(data);
                        }
                    }
                }
            }
        }
        result
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub fn focus_app_by_name(app_name: String) {
    if app_name.is_empty() {
        return;
    }
    let lower_name = app_name.to_lowercase();
    unsafe {
        use windows::core::BOOL;
        use windows::Win32::Foundation::{HWND, LPARAM};
        use windows::Win32::UI::WindowsAndMessaging::{
            EnumWindows, GetWindowTextLengthW, GetWindowTextW, IsIconic, IsWindowVisible,
            SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOW,
        };

        struct SearchContext {
            target: String,
            found: Option<HWND>,
        }

        unsafe extern "system" fn search_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let ctx = &mut *(lparam.0 as *mut SearchContext);
            if !IsWindowVisible(hwnd).as_bool() {
                return BOOL(1);
            }
            let len = GetWindowTextLengthW(hwnd);
            if len > 0 {
                let mut buf = vec![0u16; (len + 1) as usize];
                GetWindowTextW(hwnd, &mut buf);
                let title = String::from_utf16_lossy(&buf[..len as usize]).to_lowercase();
                if title.contains(&ctx.target) || ctx.target.contains(&title) {
                    ctx.found = Some(hwnd);
                    return BOOL(0);
                }
            }
            BOOL(1)
        }

        let mut ctx = SearchContext {
            target: lower_name,
            found: None,
        };

        let _ = EnumWindows(Some(search_proc), LPARAM(&mut ctx as *mut _ as isize));

        if let Some(hwnd) = ctx.found {
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            } else {
                let _ = ShowWindow(hwnd, SW_SHOW);
            }
            let _ = SetForegroundWindow(hwnd);
        }
    }
}

#[tauri::command]
pub fn emit_test_notification(app: AppHandle, app_name: String, title: String, body: String) {
    let data = NotificationData {
        id: (chrono_now_ms() % 100000) as u32,
        app_name,
        title,
        body,
        actions: vec!["Open".to_string(), "Dismiss".to_string()],
        timestamp: chrono_now_ms(),
    };
    let _ = app.emit("bloom-new-notification", data);
}
