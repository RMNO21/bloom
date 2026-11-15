use serde::{Deserialize, Serialize};
use std::collections::{HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use windows::UI::Notifications::Management::{
    UserNotificationListener, UserNotificationListenerAccessStatus,
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NotificationData {
    pub id: u32,
    pub app_name: String,
    pub title: String,
    pub body: String,
    pub category: String, // "alarm", "call", "message", "reminder", "general"
    pub actions: Vec<String>,
    pub has_reply: bool,
    pub placeholder: String,
    pub timestamp: i64,
}

static NOTIF_APP: Mutex<Option<AppHandle>> = Mutex::new(None);
static IS_LISTENING: AtomicBool = AtomicBool::new(false);

fn log_to_file(msg: &str) {
    use std::io::Write;
    let log_path = r"C:\Users\User\.gemini\antigravity\brain\30653cb6-647b-438a-8b6c-bbc302688951\scratch\notif_engine.log";
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
        let ts = chrono_now_ms();
        let _ = writeln!(f, "[{}] {}", ts, msg);
        let _ = f.flush();
    }
}

/// Enforces or restores Windows system-wide toast popup banner suppression
pub fn set_windows_toast_suppression(suppress: bool) {
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyW, RegEnumKeyExW, RegOpenKeyExW, RegSetValueExW, HKEY,
        HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, REG_DWORD,
    };
    unsafe {
        let val: u32 = if suppress { 0 } else { 1 };
        let key_path = "Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings\0"
            .encode_utf16()
            .collect::<Vec<u16>>();
        let mut hkey = HKEY::default();
        if RegCreateKeyW(
            HKEY_CURRENT_USER,
            windows::core::PCWSTR(key_path.as_ptr()),
            &mut hkey,
        )
        .is_ok()
        {
            let val_name = "NOC_GLOBAL_SETTING_TOASTS_ENABLED\0"
                .encode_utf16()
                .collect::<Vec<u16>>();
            let _ = RegSetValueExW(
                hkey,
                windows::core::PCWSTR(val_name.as_ptr()),
                None,
                REG_DWORD,
                Some(std::slice::from_raw_parts(&val as *const u32 as *const u8, 4)),
            );

            // Also disable critical and lockscreen banners so Windows doesn't spawn banners
            let crit_name = "NOC_GLOBAL_SETTING_ALLOW_CRITICAL_TOASTS_ENABLED\0"
                .encode_utf16()
                .collect::<Vec<u16>>();
            let _ = RegSetValueExW(
                hkey,
                windows::core::PCWSTR(crit_name.as_ptr()),
                None,
                REG_DWORD,
                Some(std::slice::from_raw_parts(&val as *const u32 as *const u8, 4)),
            );
            let _ = RegCloseKey(hkey);
        }

        // Also update QuietHours flag so Focus Assist routes toasts silently
        let qh_path = "Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\QuietHours\0"
            .encode_utf16()
            .collect::<Vec<u16>>();
        let mut qh_key = HKEY::default();
        if RegCreateKeyW(
            HKEY_CURRENT_USER,
            windows::core::PCWSTR(qh_path.as_ptr()),
            &mut qh_key,
        )
        .is_ok()
        {
            let qh_val: u32 = if suppress { 1 } else { 0 };
            let val_name = "QuietHoursServiceState\0"
                .encode_utf16()
                .collect::<Vec<u16>>();
            let _ = RegSetValueExW(
                qh_key,
                windows::core::PCWSTR(val_name.as_ptr()),
                None,
                REG_DWORD,
                Some(std::slice::from_raw_parts(&qh_val as *const u32 as *const u8, 4)),
            );
            let _ = RegCloseKey(qh_key);
        }

        // Deep Source Suppression: set ShowBanner = 0 on all application subkeys in Settings
        // This instructs the Windows Shell notification dispatcher NOT to spawn the toast window for any app!
        let mut settings_key = HKEY::default();
        if RegOpenKeyExW(
            HKEY_CURRENT_USER,
            windows::core::PCWSTR(key_path.as_ptr()),
            Some(0),
            KEY_READ,
            &mut settings_key,
        )
        .is_ok()
        {
            let mut index = 0u32;
            let mut subkey_name = [0u16; 256];
            let banner_val: u32 = if suppress { 0 } else { 1 };
            let banner_name = "ShowBanner\0".encode_utf16().collect::<Vec<u16>>();

            loop {
                let mut name_len = subkey_name.len() as u32;
                if RegEnumKeyExW(
                    settings_key,
                    index,
                    Some(windows::core::PWSTR(subkey_name.as_mut_ptr())),
                    &mut name_len,
                    None,
                    None,
                    None,
                    None,
                )
                .is_err()
                {
                    break;
                }
                index += 1;

                let mut app_key = HKEY::default();
                if RegOpenKeyExW(
                    settings_key,
                    windows::core::PCWSTR(subkey_name.as_ptr()),
                    Some(0),
                    KEY_WRITE,
                    &mut app_key,
                )
                .is_ok()
                {
                    let _ = RegSetValueExW(
                        app_key,
                        windows::core::PCWSTR(banner_name.as_ptr()),
                        None,
                        REG_DWORD,
                        Some(std::slice::from_raw_parts(
                            &banner_val as *const u32 as *const u8,
                            4,
                        )),
                    );
                    let _ = RegCloseKey(app_key);
                }
            }
            let _ = RegCloseKey(settings_key);
        }
    }
}

/// Active Window Toast Suppressor: immediately hides and closes any Windows native toast popup window
pub fn suppress_native_toast_windows() {
    unsafe {
        use windows::core::BOOL;
        use windows::Win32::Foundation::{HWND, LPARAM, RECT, WPARAM};
        use windows::Win32::UI::WindowsAndMessaging::{
            EnumWindows, FindWindowExW, GetClassNameW, GetWindowRect, GetWindowTextW,
            IsWindowVisible, PostMessageW, SetWindowPos, ShowWindow, SWP_HIDEWINDOW, SWP_NOACTIVATE,
            SWP_NOSIZE, SW_HIDE, WM_CLOSE,
        };
        extern "system" {
            fn OpenDesktopW(
                ldesktop: *const u16,
                dwflags: u32,
                finherit: BOOL,
                dwdesiredaccess: u32,
            ) -> HWND;
            fn SetThreadDesktop(hdesktop: HWND) -> BOOL;
        }

        let wide_desktop: Vec<u16> = "Default\0".encode_utf16().collect();
        let hdesk = OpenDesktopW(wide_desktop.as_ptr(), 0, BOOL(0), 0x01FF);
        if !hdesk.0.is_null() {
            let _ = SetThreadDesktop(hdesk);
        }

        unsafe fn hide_and_close(hwnd: HWND) {
            let _ = PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0));
            let _ = ShowWindow(hwnd, SW_HIDE);
            let _ = SetWindowPos(
                hwnd,
                None,
                -32000,
                -32000,
                0,
                0,
                SWP_NOSIZE | SWP_NOACTIVATE | SWP_HIDEWINDOW,
            );
        }

        unsafe extern "system" fn enum_toast_proc(hwnd: HWND, _: LPARAM) -> BOOL {
            if !IsWindowVisible(hwnd).as_bool() {
                return BOOL(1);
            }
            let mut cls = [0u16; 128];
            GetClassNameW(hwnd, &mut cls);
            let cls_str = String::from_utf16_lossy(&cls);

            let mut title = [0u16; 128];
            GetWindowTextW(hwnd, &mut title);
            let title_str = String::from_utf16_lossy(&title).to_lowercase();

            let mut rect = RECT::default();
            let _ = GetWindowRect(hwnd, &mut rect);

            let is_toast_class = cls_str.contains("Windows.UI.Core.CoreWindow")
                || cls_str.contains("Shell_ToastView")
                || cls_str.contains("ToastView");

            let is_bottom_right = rect.left >= 1200 && rect.top >= 600;
            let is_toast_title = title_str.contains("notification")
                || title_str.contains("toast")
                || title_str.contains("shell experience host");

            if (is_toast_class && is_bottom_right) || (is_toast_class && is_toast_title) {
                hide_and_close(hwnd);
            }

            BOOL(1)
        }

        let _ = EnumWindows(Some(enum_toast_proc), LPARAM(0));

        // Also inspect direct windows via FindWindowExW
        let mut cur_hwnd = HWND(std::ptr::null_mut());
        while let Ok(next) = FindWindowExW(None, Some(cur_hwnd), None, None) {
            if next.0.is_null() {
                break;
            }
            cur_hwnd = next;
            if !IsWindowVisible(cur_hwnd).as_bool() {
                continue;
            }
            let mut cls = [0u16; 128];
            GetClassNameW(cur_hwnd, &mut cls);
            let cls_str = String::from_utf16_lossy(&cls);

            let mut title = [0u16; 128];
            GetWindowTextW(cur_hwnd, &mut title);
            let title_str = String::from_utf16_lossy(&title).to_lowercase();

            let mut rect = RECT::default();
            let _ = GetWindowRect(cur_hwnd, &mut rect);

            let is_toast_class = cls_str.contains("Windows.UI.Core.CoreWindow")
                || cls_str.contains("Shell_ToastView")
                || cls_str.contains("ToastView");

            let is_bottom_right = rect.left >= 1200 && rect.top >= 600;
            let is_toast_title = title_str.contains("notification")
                || title_str.contains("toast")
                || title_str.contains("shell experience host");

            if (is_toast_class && is_bottom_right) || (is_toast_class && is_toast_title) {
                hide_and_close(cur_hwnd);
            }
        }
    }
}

pub fn setup_notifications(app: AppHandle) {
    if let Ok(mut lock) = NOTIF_APP.lock() {
        *lock = Some(app.clone());
    }

    // Suppress native Windows toast popups on startup
    set_windows_toast_suppression(true);

    std::thread::spawn(move || {
        // Initialize COM
        let _ = unsafe {
            windows::Win32::System::Com::CoInitializeEx(
                None,
                windows::Win32::System::Com::COINIT_MULTITHREADED,
            )
        };

        log_to_file("setup_notifications thread spawned, calling Current()...");

        let listener = match UserNotificationListener::Current() {
            Ok(l) => l,
            Err(e) => {
                log_to_file(&format!("UserNotificationListener::Current failed: {:?}", e));
                return;
            }
        };

        let status = match listener.GetAccessStatus() {
            Ok(s) => s,
            Err(e) => {
                log_to_file(&format!("GetAccessStatus failed: {:?}", e));
                return;
            }
        };

        log_to_file(&format!("UserNotificationListener initial status: {:?}", status));

        let final_status = if status != UserNotificationListenerAccessStatus::Allowed {
            match listener.RequestAccessAsync().and_then(|op| op.get()) {
                Ok(s) => s,
                Err(e) => {
                    log_to_file(&format!("RequestAccessAsync failed: {:?}", e));
                    status
                }
            }
        } else {
            status
        };

        log_to_file(&format!("UserNotificationListener final status: {:?}", final_status));

        if final_status != UserNotificationListenerAccessStatus::Allowed {
            log_to_file("UserNotificationListener access was not allowed.");
            return;
        }

        IS_LISTENING.store(true, Ordering::Relaxed);

        // Pre-populate seen_ids with currently existing notifications so old toasts aren't spammed on start
        let mut seen_ids: HashSet<u32> = HashSet::new();
        let mut seen_queue: VecDeque<u32> = VecDeque::new();

        log_to_file("Calling listener.GetNotificationsAsync (seeding)...");

        match listener.GetNotificationsAsync(windows::UI::Notifications::NotificationKinds::Toast) {
            Ok(op) => {
                match op.get() {
                    Ok(initial_notifs) => {
                        let count = initial_notifs.Size().unwrap_or(0);
                        for notif in initial_notifs {
                            if let Ok(id) = notif.Id() {
                                if id > 0 {
                                    seen_ids.insert(id);
                                    seen_queue.push_back(id);
                                }
                            }
                        }
                        log_to_file(&format!("Seeded {} existing notifications into history filter (total: {}).", seen_ids.len(), count));
                    }
                    Err(e) => {
                        log_to_file(&format!("Seeding op.get() failed: {:?}", e));
                    }
                }
            }
            Err(e) => {
                log_to_file(&format!("Seeding GetNotificationsAsync failed: {:?}", e));
            }
        }

        log_to_file("Notification engine active (fast 35ms interceptor loop).");

        let mut loop_count: u64 = 0;
        while !crate::state::SHUTTING_DOWN.load(Ordering::Relaxed) {
            // High-frequency 35ms interceptor loop: catches incoming notifications INSTANTLY
            // before Windows native Shell can render its bottom-right toast banner!
            std::thread::sleep(std::time::Duration::from_millis(35));
            loop_count += 1;

            // Also actively suppress any rogue Windows toast window
            if loop_count % 10 == 0 {
                suppress_native_toast_windows();
            }

            match listener.GetNotificationsAsync(windows::UI::Notifications::NotificationKinds::Toast) {
                Ok(op) => match op.get() {
                    Ok(notifs) => {
                        for notif in notifs {
                            let id = match notif.Id() {
                                Ok(i) if i > 0 => i,
                                _ => continue,
                            };

                            if !seen_ids.contains(&id) {
                                seen_ids.insert(id);
                                seen_queue.push_back(id);
                                if seen_queue.len() > 1000 {
                                    if let Some(old_id) = seen_queue.pop_front() {
                                        seen_ids.remove(&old_id);
                                    }
                                }

                                process_new_notification(&app, &listener, &notif, id);
                            }
                        }
                    }
                    Err(e) => {
                        if loop_count % 500 == 0 {
                            log_to_file(&format!("Polling op.get() error on tick #{}: {:?}", loop_count, e));
                        }
                    }
                },
                Err(e) => {
                    if loop_count % 500 == 0 {
                        log_to_file(&format!("Polling GetNotificationsAsync error on tick #{}: {:?}", loop_count, e));
                    }
                }
            }
        }
    });
}

fn extract_notification_data(notif: &windows::UI::Notifications::UserNotification) -> Option<NotificationData> {
    let mut app_name = notif
        .AppInfo()
        .ok()
        .and_then(|info| info.DisplayInfo().ok())
        .and_then(|disp| disp.DisplayName().ok())
        .map(|s| s.to_string())
        .unwrap_or_default();

    if app_name.trim().is_empty() {
        if let Ok(app_info) = notif.AppInfo() {
            if let Ok(id) = app_info.Id() {
                let id_str = id.to_string();
                if !id_str.trim().is_empty() {
                    if let Some(leaf) = id_str.split('\\').last() {
                        let clean = leaf.trim_end_matches(".exe");
                        app_name = clean.to_string();
                    } else {
                        app_name = id_str;
                    }
                }
            }
        }
    }

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

    // Try reading XML content if text elements were empty
    use windows::core::Interface;
    let toast_xml = notif
        .Notification()
        .ok()
        .and_then(|n| n.cast::<windows::UI::Notifications::ToastNotification>().ok())
        .and_then(|t| t.Content().ok())
        .and_then(|c| c.GetXml().ok())
        .map(|s| s.to_string())
        .unwrap_or_default();

    if title.is_empty() && !toast_xml.is_empty() {
        // Simple XML tag scanner for <text> elements
        let mut parts = Vec::new();
        let mut cur = toast_xml.as_str();
        while let Some(start) = cur.find("<text") {
            if let Some(close_tag) = cur[start..].find('>') {
                let text_start = start + close_tag + 1;
                if let Some(end) = cur[text_start..].find("</text>") {
                    let val = &cur[text_start..text_start + end];
                    if !val.trim().is_empty() {
                        parts.push(val.trim().to_string());
                    }
                    cur = &cur[text_start + end + 7..];
                    continue;
                }
            }
            break;
        }
        if let Some(t) = parts.first() {
            title = t.clone();
        }
        if parts.len() > 1 {
            body = parts[1..].join(" ");
        }
    }

    if title.is_empty() && body.is_empty() {
        return None;
    }

    // Heuristic App Name Cleanup
    let lower_app = app_name.to_lowercase();
    let lower_title = title.to_lowercase();
    if lower_app.trim().is_empty()
        || lower_app == "notification"
        || lower_app.contains("shell experience")
        || lower_app.contains("shellexperiencehost")
        || lower_app.contains("windows")
    {
        if lower_title.contains("telegram") {
            app_name = "Telegram".to_string();
        } else if lower_title.contains("whatsapp") {
            app_name = "WhatsApp".to_string();
        } else if lower_title.contains("discord") {
            app_name = "Discord".to_string();
        } else if lower_title.contains("slack") {
            app_name = "Slack".to_string();
        } else if lower_title.contains("teams") {
            app_name = "Teams".to_string();
        } else if lower_title.contains("clock") || lower_title.contains("alarm") {
            app_name = "Alarms & Clock".to_string();
        } else if lower_title.contains("spotify") || lower_title.contains("music") {
            app_name = "Spotify".to_string();
        } else if lower_title.contains("mail") || lower_title.contains("outlook") {
            app_name = "Outlook".to_string();
        } else if app_name.trim().is_empty() || lower_app.contains("shell experience") {
            app_name = "Notification".to_string();
        }
    }

    if title.is_empty() {
        title = app_name.clone();
    }

    let notif_id = notif.Id().unwrap_or(0);

    let lower_all = format!("{} {} {}", app_name, title, body).to_lowercase();
    let is_alarm = toast_xml.contains("scenario=\"alarm\"")
        || lower_all.contains("alarm")
        || lower_all.contains("clock")
        || lower_all.contains("timer")
        || lower_all.contains("ساعت")
        || lower_all.contains("آلارم")
        || lower_all.contains("تایمر")
        || lower_all.contains("wake up");

    let is_call = toast_xml.contains("scenario=\"incomingCall\"")
        || lower_all.contains("incoming call")
        || lower_all.contains("calling")
        || lower_all.contains("video call")
        || lower_all.contains("audio call")
        || lower_all.contains("تماس");

    let is_reminder = toast_xml.contains("scenario=\"reminder\"")
        || lower_all.contains("calendar")
        || lower_all.contains("reminder")
        || lower_all.contains("یادآوری")
        || lower_all.contains("meeting")
        || lower_all.contains("event");

    let is_messaging = (lower_all.contains("telegram")
        || lower_all.contains("whatsapp")
        || lower_all.contains("discord")
        || lower_all.contains("slack")
        || lower_all.contains("teams")
        || lower_all.contains("skype")
        || lower_all.contains("message")
        || lower_all.contains("chat")
        || lower_all.contains("mail")
        || lower_all.contains("gmail")
        || lower_all.contains("outlook")
        || toast_xml.contains("<input"))
        && !is_call;

    // Extract explicit actions from XML if present
    let mut xml_actions = Vec::new();
    let mut cur_xml = toast_xml.as_str();
    while let Some(pos) = cur_xml.find("<action") {
        if let Some(content_pos) = cur_xml[pos..].find("content=\"") {
            let start = pos + content_pos + 9;
            if let Some(end) = cur_xml[start..].find('"') {
                let act = cur_xml[start..start + end].trim().to_string();
                if !act.is_empty() && !xml_actions.contains(&act) {
                    xml_actions.push(act);
                }
            }
        }
        cur_xml = &cur_xml[pos + 7..];
    }

    let category = if is_call {
        "call"
    } else if is_alarm {
        "alarm"
    } else if is_reminder {
        "call"
    } else if is_reminder {
        "reminder"
    } else if is_messaging {
        "message"
    } else {
        "general"
    };

    let actions = if !xml_actions.is_empty() {
        // Ensure Dismiss/Close is present
        let mut final_acts = xml_actions;
        if !final_acts.iter().any(|a| a.eq_ignore_ascii_case("dismiss") || a.eq_ignore_ascii_case("close")) {
            final_acts.push("Dismiss".to_string());
        }
        final_acts
    } else if is_alarm {
        vec!["Dismiss".to_string(), "Snooze".to_string()]
    } else if is_call {
        vec!["Accept".to_string(), "Decline".to_string()]
    } else if is_reminder {
        vec!["Snooze".to_string(), "Open".to_string(), "Dismiss".to_string()]
    } else if is_messaging {
        vec!["Reply".to_string(), "Open".to_string(), "Dismiss".to_string()]
    } else {
        vec!["Open".to_string(), "Dismiss".to_string()]
    };

    let has_reply = is_messaging || toast_xml.contains("<input");
    let placeholder = format!("Reply to {}...", title);

    Some(NotificationData {
        id: notif_id,
        app_name,
        title,
        body,
        category: category.to_string(),
        actions,
        has_reply,
        placeholder,
        timestamp: chrono_now_ms(),
    })
}

fn process_new_notification(
    app: &AppHandle,
    listener: &UserNotificationListener,
    notif: &windows::UI::Notifications::UserNotification,
    notif_id: u32,
) {
    log_to_file(&format!("Raw notification received: ID={}", notif_id));

    if let Some(data) = extract_notification_data(notif) {
        log_to_file(&format!(
            "Live toast intercepted: ID={}, App='{}', Cat='{}', Title='{}', Actions={:?}",
            notif_id, data.app_name, data.category, data.title, data.actions
        ));

        // Suppress Windows 11 default bottom-right toast banner by removing from Windows Action Center
        let _ = listener.RemoveNotification(notif_id);
        suppress_native_toast_windows();

        if let Some(main_win) = app.get_webview_window("main") {
            let _ = main_win.show();
            let _ = main_win.set_always_on_top(true);
        }

        match app.emit("bloom-new-notification", &data) {
            Ok(_) => log_to_file("Successfully emitted bloom-new-notification event to frontend!"),
            Err(e) => log_to_file(&format!("FAILED to emit bloom-new-notification: {:?}", e)),
        }
    } else {
        log_to_file(&format!("Notification ID={} had no valid content, skipped.", notif_id));
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
    suppress_native_toast_windows();
}

#[tauri::command]
pub fn clear_all_notifications() {
    if let Ok(listener) = UserNotificationListener::Current() {
        let _ = listener.ClearNotifications();
    }
    suppress_native_toast_windows();
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

/// Robust Universal Focus & Launch:
/// 1. Finds existing window by title OR process name (e.g. telegram.exe, whatsapp.exe)
/// 2. If minimized/in tray, restores and brings to foreground
/// 3. If not running, launches from installed apps or shell
#[tauri::command]
pub fn focus_app_by_name(app_name: String) {
    if app_name.trim().is_empty() {
        return;
    }
    let lower_name = app_name.to_lowercase();
    let found = unsafe { focus_window_by_name_or_proc(&lower_name) };
    if !found {
        // App is not open as a window; launch it!
        if let Some(apps_cache) = crate::state::INSTALLED_APPS_CACHE.get() {
            if let Ok(apps) = apps_cache.lock() {
                if let Some(app) = apps.iter().find(|a| {
                    let a_low = a.name.to_lowercase();
                    a_low.contains(&lower_name)
                        || lower_name.contains(&a_low)
                        || a.executable.as_deref().map(|e| e.to_lowercase().contains(&lower_name)).unwrap_or(false)
                }) {
                    crate::commands::launch_path(&app.path);
                    return;
                }
            }
        }
        // Fallback: ShellExecute open
        let wide_cmd: Vec<u16> = app_name.encode_utf16().chain(std::iter::once(0)).collect();
        let wide_verb: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            use windows::Win32::UI::Shell::ShellExecuteW;
            use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
            let _ = ShellExecuteW(
                None,
                windows::core::PCWSTR(wide_verb.as_ptr()),
                windows::core::PCWSTR(wide_cmd.as_ptr()),
                None,
                None,
                SW_SHOWNORMAL,
            );
        }
    }
}

unsafe fn focus_window_by_name_or_proc(target: &str) -> bool {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, EnumWindows, GetWindowTextLengthW, GetWindowTextW,
        GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow,
        SW_RESTORE, SW_SHOW,
    };

    struct WindowSearchContext<'a> {
        target: &'a str,
        found_hwnd: Option<HWND>,
    }

    unsafe extern "system" fn search_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = &mut *(lparam.0 as *mut WindowSearchContext);

        // 1. Check window title
        let len = GetWindowTextLengthW(hwnd);
        if len > 0 {
            let mut buf = vec![0u16; (len + 1) as usize];
            GetWindowTextW(hwnd, &mut buf);
            let title = String::from_utf16_lossy(&buf[..len as usize]).to_lowercase();
            if title.contains(ctx.target) || ctx.target.contains(&title) {
                ctx.found_hwnd = Some(hwnd);
                return BOOL(0);
            }
        }

        // 2. Check process executable name
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid > 0 {
            if let Ok(hproc) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                let mut buf = [0u16; 1024];
                let mut size = buf.len() as u32;
                extern "system" {
                    fn QueryFullProcessImageNameW(
                        hprocess: windows::Win32::Foundation::HANDLE,
                        dwflags: u32,
                        lpexe: *mut u16,
                        lpsize: *mut u32,
                    ) -> BOOL;
                }
                if QueryFullProcessImageNameW(hproc, 0, buf.as_mut_ptr(), &mut size).as_bool() && size > 0 {
                    let path = String::from_utf16_lossy(&buf[..size as usize]).to_lowercase();
                    if let Some(file_name) = path.split('\\').last() {
                        let clean_name = file_name.trim_end_matches(".exe");
                        if clean_name.contains(ctx.target) || ctx.target.contains(clean_name) {
                            let _ = windows::Win32::Foundation::CloseHandle(hproc);
                            ctx.found_hwnd = Some(hwnd);
                            return BOOL(0);
                        }
                    }
                }
                let _ = windows::Win32::Foundation::CloseHandle(hproc);
            }
        }

        BOOL(1)
    }

    let mut ctx = WindowSearchContext {
        target,
        found_hwnd: None,
    };

    let _ = EnumWindows(Some(search_proc), LPARAM(&mut ctx as *mut _ as isize));

    if let Some(hwnd) = ctx.found_hwnd {
        if IsIconic(hwnd).as_bool() || !IsWindowVisible(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        } else {
            let _ = ShowWindow(hwnd, SW_SHOW);
        }
        let _ = SetForegroundWindow(hwnd);
        let _ = BringWindowToTop(hwnd);
        true
    } else {
        false
    }
}

/// Universal Notification Reply:
/// Copies reply text to clipboard, activates the app window, and automatically
/// pastes (Ctrl+V) and sends (Enter) the reply into the chat!
#[tauri::command]
pub fn submit_notification_reply(app_name: String, reply_text: String) {
    if reply_text.trim().is_empty() {
        return;
    }
    unsafe {
        use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData};
        use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
        use windows::Win32::Foundation::HWND;

        let wide: Vec<u16> = reply_text.encode_utf16().chain(std::iter::once(0)).collect();
        let bytes_len = wide.len() * 2;
        if let Ok(h_mem) = GlobalAlloc(GMEM_MOVEABLE, bytes_len) {
            let ptr = GlobalLock(h_mem);
            if !ptr.is_null() {
                std::ptr::copy_nonoverlapping(wide.as_ptr() as *const u8, ptr as *mut u8, bytes_len);
                let _ = GlobalUnlock(h_mem);
                if OpenClipboard(Some(HWND(std::ptr::null_mut()))).is_ok() {
                    let _ = EmptyClipboard();
                    let _ = SetClipboardData(13 /* CF_UNICODETEXT */, Some(windows::Win32::Foundation::HANDLE(h_mem.0)));
                    let _ = CloseClipboard();
                }
            }
        }
    }

    // Bring app window to front
    focus_app_by_name(app_name);

    // Simulate Paste (Ctrl+V) and Send (Enter) in target app
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(160));
        use windows::Win32::UI::Input::KeyboardAndMouse::{keybd_event, KEYEVENTF_KEYUP, VK_CONTROL, VK_RETURN};
        unsafe {
            // Press Ctrl + V
            keybd_event(VK_CONTROL.0 as u8, 0, Default::default(), 0);
            keybd_event(0x56 /* V */, 0, Default::default(), 0);
            keybd_event(0x56, 0, KEYEVENTF_KEYUP, 0);
            keybd_event(VK_CONTROL.0 as u8, 0, KEYEVENTF_KEYUP, 0);

            std::thread::sleep(std::time::Duration::from_millis(50));

            // Press Enter to submit
            keybd_event(VK_RETURN.0 as u8, 0, Default::default(), 0);
            keybd_event(VK_RETURN.0 as u8, 0, KEYEVENTF_KEYUP, 0);
        }
    });
}

/// Universal Snooze: dismisses now and re-triggers notification after minutes
#[tauri::command]
pub fn snooze_notification(app: AppHandle, data: NotificationData, snooze_minutes: Option<u32>) {
    let minutes = snooze_minutes.unwrap_or(5);
    dismiss_notification(data.id);

    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs((minutes as u64) * 60));
        let _ = app.emit("bloom-new-notification", &data);
    });
}

#[tauri::command]
pub fn emit_test_notification(app: AppHandle, app_name: String, title: String, body: String, category: Option<String>) {
    let cat = category.unwrap_or_else(|| "message".to_string());
    let actions = match cat.as_str() {
        "alarm" => vec!["Dismiss".to_string(), "Snooze".to_string()],
        "call" => vec!["Accept".to_string(), "Decline".to_string()],
        "reminder" => vec!["Snooze".to_string(), "Open".to_string(), "Dismiss".to_string()],
        _ => vec!["Reply".to_string(), "Open".to_string(), "Dismiss".to_string()],
    };
    let has_reply = cat == "message";
    let placeholder = format!("Reply to {}...", title);

    let data = NotificationData {
        id: (chrono_now_ms() % 100000) as u32,
        app_name,
        title,
        body,
        category: cat,
        actions,
        has_reply,
        placeholder,
        timestamp: chrono_now_ms(),
    };
    let _ = app.emit("bloom-new-notification", data);
}
