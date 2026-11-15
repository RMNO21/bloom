#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod battery;
mod bluetooth;
mod commands;
mod diagnostics;
mod dock_extras;
mod notifications;
mod services;
mod shelf;
mod shelf_preview;
mod state;
mod tray;
mod types;
mod updater;
mod utils;
mod wifi;
mod window_region;
mod quick_settings;

use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager};
use windows::core::BOOL;
use windows::Win32::System::Console::SetConsoleCtrlHandler;
use windows::Win32::System::Console::{CTRL_BREAK_EVENT, CTRL_CLOSE_EVENT, CTRL_C_EVENT};

use crate::commands::*;
use crate::services::*;
use crate::state::*;
use crate::utils::*;

unsafe extern "system" fn ctrl_handler(ctrl_type: u32) -> BOOL {
    if ctrl_type == CTRL_C_EVENT || ctrl_type == CTRL_BREAK_EVENT || ctrl_type == CTRL_CLOSE_EVENT {
        set_taskbar_visibility(true, true);
        NATIVE_TASKBAR_HIDDEN.store(false, Ordering::Relaxed);
        set_native_osd_suppressed(false);
        crate::notifications::set_windows_toast_suppression(false);
    }
    BOOL(0)
}

fn main() {
    #[cfg(target_os = "windows")]
    unsafe {
        use windows::Win32::System::Threading::{
            GetCurrentProcess, SetPriorityClass, HIGH_PRIORITY_CLASS,
        };
        let _ = SetPriorityClass(GetCurrentProcess(), HIGH_PRIORITY_CLASS);
    }

    let mut args = std::env::args_os();
    if args.nth(1).as_deref() == Some(std::ffi::OsStr::new("--taskbar-watchdog")) {
        if let (Some(pid), Some(marker)) = (args.next(), args.next()) {
            if let Ok(pid) = pid.to_string_lossy().parse::<u32>() {
                utils::run_taskbar_watchdog(pid, marker.into());
            }
        }
        return;
    }
    unsafe {
        let _ = SetConsoleCtrlHandler(Some(ctrl_handler), true);
    }

    // Single-instance enforcement
    unsafe {
        use windows::Win32::Foundation::{CloseHandle, GetLastError};
        use windows::Win32::System::Threading::{
            CreateEventW, CreateMutexW, OpenEventW, SetEvent, SYNCHRONIZATION_ACCESS_RIGHTS,
        };

        let mutex_name: Vec<u16> = "BloomSingleInstance"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let event_name: Vec<u16> = "BloomOpenSettings"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        let h_mutex = CreateMutexW(None, true, windows::core::PCWSTR(mutex_name.as_ptr())).ok();
        let err = GetLastError();

        if err.0 == 183 {
            // Another instance is already running — only signal settings if explicitly requested
            let is_boot_or_autostart = std::env::args().any(|a| {
                a == "--boot" || a == "--autostart" || a == "--silent" || a == "--minimized"
            });
            let has_settings_flag = std::env::args().any(|a| a == "--settings" || a == "--show-settings");

            if has_settings_flag && !is_boot_or_autostart {
                if let Ok(h_event) = OpenEventW(
                    SYNCHRONIZATION_ACCESS_RIGHTS(0x00100002),
                    false,
                    windows::core::PCWSTR(event_name.as_ptr()),
                ) {
                    let _ = SetEvent(h_event);
                    let _ = CloseHandle(h_event);
                }
            }
            if let Some(h) = h_mutex {
                let _ = CloseHandle(h);
            }
            return;
        }

        if let Ok(h_event) = CreateEventW(
            None,
            false,
            false,
            windows::core::PCWSTR(event_name.as_ptr()),
        ) {
            let _ = SINGLE_INSTANCE_EVENT_HANDLE.set(h_event.0 as isize);
        }
        if let Some(h) = h_mutex {
            let _ = SINGLE_INSTANCE_MUTEX_HANDLE.set(h.0 as isize);
        }
    }

    // Ensure priority autostart registry and startup shortcut
    #[cfg(target_os = "windows")]
    {
        crate::utils::ensure_priority_startup();
    }

    // Instantly hide the native taskbar in main() on boot/autostart before webview initializes!
    let is_boot = std::env::args().any(|a| a == "--boot" || a == "--autostart");
    if is_boot || crate::utils::taskbar_marker_exists() {
        let _ = crate::utils::set_taskbar_visibility(false, false);
        crate::state::NATIVE_TASKBAR_HIDDEN.store(true, Ordering::Relaxed);
    }

    diagnostics::initialize();
    setup_brightness_worker();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .invoke_handler(tauri::generate_handler![
            hide_native_osd,
            open_settings_window,
            focus_notch_input,
            open_wifi_settings,
            open_sound_settings,
            open_display_settings,
            open_notification_center,
            open_system_tray,
            set_ignore_cursor_events,
            set_window_height,
            resize_settings_window,
            hide_overlay,
            set_splash_fullscreen,
            sync_overlay_position,
            media_play_pause,
            media_next,
            media_previous,
            media_seek,
            open_media_source_app,
            init_dock,
            toggle_dock,
            change_dock_mode,
            change_notch_mode,
            sync_appbar,
            open_app,
            launch_new_instance,
            run_as_admin,
            kill_app_process,
            update_dock_rect,
            update_notch_rect,
            window_region::set_window_region,
            set_dock_hovered,
            set_notch_hovered,
            set_notch_visible,
            set_notch_is_open,
            setup_shelf_drop,
            shelf_thumbnail,
            shelf_drag_icon,
            shelf_prune,
            shelf_open,
            get_active_windows,
            get_tray_apps,
            show_tray_context_menu,
            activate_tray_icon,
            open_system_action,
            get_app_icon,
            get_installed_apps,
            save_pinned_apps,
            load_pinned_apps,
            save_todos,
            load_todos,
            save_notes,
            load_notes,
            save_alarms,
            load_alarms,
            dismiss_start_menu,
            notifications::dismiss_notification,
            notifications::clear_all_notifications,
            notifications::get_active_notifications,
            notifications::focus_app_by_name,
            notifications::emit_test_notification,
            notifications::submit_notification_reply,
            notifications::snooze_notification,
            clear_icon_cache,
            set_custom_icon,
            remove_custom_icon,
            get_custom_icons,
            set_menu_open,
            focus_window,
            focus_app_windows,
            close_window,
            quit_bloom,
            restart_bloom,
            get_volume,
            get_volume_state,
            get_brightness,
            set_volume,
            get_audio_sessions,
            set_app_volume,
            set_app_mute,
            set_volume_mixer_rect,
            clear_volume_mixer_rect,
            save_setting,
            load_settings,
            settings_file_readable,
            capture_window_thumbnail,
            get_wifi_status,
            set_wifi_state,
            get_bluetooth_state,
            set_bluetooth_state,
            open_bluetooth_settings,
            open_airplane_mode_settings,
            quick_settings::get_audio_output_devices,
            quick_settings::set_default_audio_device,
            quick_settings::get_global_mic_mute,
            quick_settings::set_global_mic_mute,
            quick_settings::open_spatial_sound_settings,
            quick_settings::get_mobile_hotspot_state,
            quick_settings::set_mobile_hotspot_state,
            quick_settings::get_vpn_connections,
            quick_settings::toggle_vpn_connection,
            quick_settings::get_airplane_mode_state,
            quick_settings::set_airplane_mode_state,
            quick_settings::set_projection_mode,
            quick_settings::get_night_light_state,
            quick_settings::set_night_light_state,
            quick_settings::open_wireless_display_cast,
            quick_settings::get_removable_drives,
            quick_settings::eject_removable_drive,
            quick_settings::get_power_mode,
            quick_settings::set_power_mode,
            quick_settings::get_keyboard_language,
            quick_settings::toggle_keyboard_language,
            quick_settings::open_touch_keyboard,
            quick_settings::get_privacy_indicators,
            set_brightness,
            get_battery_saver_state,
            set_battery_saver_state,
            open_battery_saver_settings,
            battery::get_battery_details,
            get_system_accent_color,
            get_cpu_usage,
            get_ram_usage,
            get_disk_space,
            get_network_speed,
            export_settings_to_file,
            import_settings_from_file,
            reset_settings,
            updater::check_for_updates,
            updater::install_update,
            updater::get_update_state,
            frontend_debug,
            set_windows_toast_suppression_cmd,
            set_taskbar_visibility_cmd,
            clear_notification_history_cmd,
            dock_extras::get_dock_extras,
            dock_extras::open_dock_extra,
            dock_extras::eject_dock_extra,
            dock_extras::get_dock_drives,
            wifi::wifi_list_networks,
            wifi::wifi_scan,
            wifi::wifi_connect,
            wifi::wifi_disconnect,
            wifi::wifi_forget,
            wifi::wifi_open_settings,
            bluetooth::bluetooth_list_devices,
            bluetooth::bluetooth_set_connected,
            bluetooth::bluetooth_discovery,
            bluetooth::bluetooth_pair,
            bluetooth::bluetooth_pairing_respond,
            bluetooth::bluetooth_unpair
        ])
        .setup(|app| {
            #[cfg(target_os = "windows")]
            unsafe {
                use windows::Win32::System::Threading::{
                    GetCurrentProcess, SetPriorityClass, HIGH_PRIORITY_CLASS,
                };
                let _ = SetPriorityClass(GetCurrentProcess(), HIGH_PRIORITY_CLASS);
            }

            init_taskbar_marker(app.handle());
            clean_stale_taskbar_marker();
            // Populate the settings cache before anything else: a webview can
            // invoke save_setting as soon as it loads, which happens before the
            // rest of this hook runs.
            crate::utils::init_settings_cache(app.handle());

            let is_dock_on = crate::utils::dock_enabled();
            if is_dock_on {
                // Instantly hide the native taskbar right at startup before explorer renders over it!
                let _ = crate::utils::set_taskbar_visibility(false, false);
                NATIVE_TASKBAR_HIDDEN.store(true, Ordering::Relaxed);

                // Start an assertive watchdog for the first 10 seconds of startup to ensure Explorer
                // never reveals the Windows taskbar during shell initialization.
                std::thread::spawn(|| {
                    for _ in 0..20 {
                        std::thread::sleep(std::time::Duration::from_millis(500));
                        if crate::state::SHUTTING_DOWN.load(Ordering::Relaxed) {
                            break;
                        }
                        if crate::utils::dock_enabled() && !crate::state::TRAY_INTERACTION_ACTIVE.load(Ordering::Relaxed) {
                            unsafe {
                                use windows::Win32::UI::WindowsAndMessaging::{FindWindowA, IsWindowVisible};
                                let tray_class = windows::core::PCSTR(c"Shell_TrayWnd".as_ptr() as *const u8);
                                if let Ok(tray) = FindWindowA(tray_class, windows::core::PCSTR::null()) {
                                    if IsWindowVisible(tray).as_bool() {
                                        let _ = crate::utils::set_taskbar_visibility(false, false);
                                        NATIVE_TASKBAR_HIDDEN.store(true, Ordering::Relaxed);
                                    }
                                }
                            }
                        }
                    }
                });

                // Immediately trigger dock initialization in Rust in parallel with webview startup
                let dock_mode = crate::utils::get_setting_str(&app.handle(), "bloom-dock-mode")
                    .unwrap_or_else(|| "smart".to_string());
                let h = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    crate::commands::init_dock(h, dock_mode).await;
                });
            } else if taskbar_marker_exists() {
                // Only restore native taskbar if the user actually disabled Bloom's dock
                restore_taskbar_after_crash();
                NATIVE_TASKBAR_HIDDEN.store(false, Ordering::Relaxed);
            }

            // Update check on startup (non-blocking). Always runs so the UI can
            // show an update badge; auto-install only happens when the user
            // enabled it and the release has aged past the rollout gate.
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    updater::run_startup_check(app_handle).await;
                });
            }

            let window = app.get_webview_window("main").unwrap();
            if let Ok(hwnd) = window.hwnd() {
                crate::utils::strip_window_decorations(hwnd);
                MAIN_HWND.store(hwnd.0 as isize, Ordering::Relaxed);
                crate::utils::re_assert_topmost(hwnd);
            }
            let _ = window.show();
            let dock_win = app.get_webview_window("dock").unwrap();
            // Same for the dock window, which has a region too.
            let _ = dock_win.set_ignore_cursor_events(true);
            if let Ok(hwnd) = dock_win.hwnd() {
                crate::utils::strip_window_decorations(hwnd);
                DOCK_HWND.store(hwnd.0 as isize, Ordering::Relaxed);
            }

            // Sync window rects initially and on event
            let win_clone = window.clone();
            let update_main_rect = move || {
                if let (Ok(p), Ok(s)) = (win_clone.outer_position(), win_clone.outer_size()) {
                    if let Ok(mut lock) = MAIN_WINDOW_RECT.lock() {
                        *lock = Some((p, s));
                    }
                }
            };

            let dock_clone = dock_win.clone();
            let update_dock_window_rect = move || {
                if let (Ok(p), Ok(s)) = (dock_clone.outer_position(), dock_clone.outer_size()) {
                    if let Ok(mut lock) = DOCK_WINDOW_RECT.lock() {
                        *lock = Some((p, s));
                    }
                }
            };

            update_main_rect();
            update_dock_window_rect();

            let u_main = update_main_rect.clone();
            let handle_for_events = app.handle().clone();
            window.on_window_event(move |e| match e {
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                    u_main();
                    sync_overlays(&handle_for_events);
                }
                tauri::WindowEvent::Focused(_) => {}
                tauri::WindowEvent::ScaleFactorChanged { .. } => {
                    // Re-evaluate against the configured notch mode instead of
                    // registering unconditionally: on wake / display re-init a
                    // scale change in smart/peek mode must not reserve the top
                    // strip (issue #109).
                    let h = handle_for_events.clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                        reconcile_main_appbar(&h);
                        sync_overlays(&h);
                    });
                }
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    restore_taskbar_and_exit(&handle_for_events);
                }
                _ => {}
            });

            let u_dock = update_dock_window_rect.clone();
            let dock_for_events = dock_win.clone();
            let handle_for_dock_events = app.handle().clone();
            dock_win.on_window_event(move |e| match e {
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                    u_dock();
                    sync_overlays(&handle_for_dock_events);
                }
                tauri::WindowEvent::ScaleFactorChanged { .. } => {
                    let h = handle_for_dock_events.clone();
                    if DOCK_APPBAR_REGISTERED.load(Ordering::Relaxed) {
                        let w = dock_for_events.clone();
                        tauri::async_runtime::spawn(async move {
                            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                            register_dock_appbar(w);
                            sync_overlays(&h);
                        });
                    } else {
                        sync_overlays(&h);
                    }
                }
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    restore_taskbar_and_exit(&handle_for_dock_events);
                }
                _ => {}
            });

            sync_overlays(app.handle());

            // Initialize the overlay window — on Windows, set_position doesn't
            // take effect on a window that has never been shown. Show it once
            // to register it with the compositor, then hide immediately.
            if let Some(ov_win) = app.get_webview_window("overlay") {
                // Layered from the start, like the notch and dock (see
                // set_click_through): the overlay has a window region too.
                let _ = ov_win.set_ignore_cursor_events(true);
                let _ = ov_win.show();
                let _ = ov_win.hide();
                let overlay_handle = app.handle().clone();
                ov_win.on_window_event(move |e| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = e {
                        api.prevent_close();
                        restore_taskbar_and_exit(&overlay_handle);
                    }
                });
            }

            watch_webview_processes(app.handle());
            setup_mouse_hook(app.handle().clone());
            setup_display_change_monitor(app.handle().clone());
            setup_window_change_hook(app.handle().clone());
            {
                let _ = crate::state::THUMBNAIL_CACHE
                    .set(std::sync::Mutex::new(std::collections::HashMap::new()));
                let _ = crate::state::FOCUS_TIMESTAMPS
                    .set(std::sync::Mutex::new(std::collections::HashMap::new()));
                // Initialize before the scan so its results are actually stored.
                let _ = crate::state::INSTALLED_APPS_CACHE.set(std::sync::Mutex::new(Vec::new()));
            }
            setup_thumbnail_capture(app.handle().clone());
            trigger_app_scan();
            let tx = setup_system_worker(app.handle().clone());
            let _ = COMMAND_SENDER.set(tx.clone());
            services::setup_keyboard_hook(app.handle().clone());
            setup_taskbar_hook();
            setup_audio_visualization(app.handle().clone());
            setup_settings_watcher(app.handle().clone());
            diagnostics::record("services_ready", "hooks and settings watcher initialized");
            wifi::setup_wifi_notifications(app.handle().clone());
            bluetooth::setup_bluetooth_notifications(app.handle().clone());
            notifications::setup_notifications(app.handle().clone());

            // Listen for second-instance signal to open settings
            if let Some(&h_event) = SINGLE_INSTANCE_EVENT_HANDLE.get() {
                if h_event != 0 {
                    let app_handle = app.handle().clone();
                    std::thread::spawn(move || {
                        use windows::Win32::Foundation::{HANDLE, WAIT_OBJECT_0};
                        use windows::Win32::System::Threading::{WaitForSingleObject, INFINITE};
                        let h_event = HANDLE(h_event as *mut _);
                        loop {
                            let result = unsafe { WaitForSingleObject(h_event, INFINITE) };
                            if result == WAIT_OBJECT_0 {
                                let _ = app_handle.emit("bloom-open-notch", ());
                                crate::commands::open_settings_window(app_handle.clone());
                            }
                        }
                    });
                }
            }

            if let Some(settings_win) = app.get_webview_window("settings") {
                #[cfg(target_os = "windows")]
                {
                    let _ = window_vibrancy::apply_mica(&settings_win, None);
                }
                let win_clone = settings_win.clone();
                settings_win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win_clone.hide();
                    }
                });
            }
            {
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
                let quit_item = MenuItem::with_id(app, "quit", "Quit Bloom", true, None::<&str>)?;
                let restart_item =
                    MenuItem::with_id(app, "restart", "Restart Bloom", true, None::<&str>)?;
                let settings_item =
                    MenuItem::with_id(app, "settings", "Open Settings", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&settings_item, &restart_item, &quit_item])?;
                let ah = app.handle().clone();
                TrayIconBuilder::new()
                    .icon(app.default_window_icon().unwrap().clone())
                    .tooltip("Bloom")
                    .menu(&menu)
                    .on_menu_event(move |_, event| match event.id().as_ref() {
                        "quit" => {
                            diagnostics::record("shutdown", "source=tray");
                            SHUTTING_DOWN.store(true, Ordering::Relaxed);
                            crate::commands::release_appbars(&ah);
                            set_taskbar_visibility(true, true);
                            NATIVE_TASKBAR_HIDDEN.store(false, Ordering::Relaxed);
                            set_native_osd_suppressed(false);

                            ah.exit(0);
                        }
                        "restart" => {
                            diagnostics::record("restart", "source=tray");
                            SHUTTING_DOWN.store(true, Ordering::Relaxed);
                            crate::commands::release_appbars(&ah);
                            if let Some(w) = ah.get_webview_window("settings") {
                                let _ = w.destroy();
                            }
                            set_taskbar_visibility(true, true);
                            NATIVE_TASKBAR_HIDDEN.store(false, Ordering::Relaxed);
                            set_native_osd_suppressed(false);
                            close_single_instance_handles();

                            ah.restart();
                        }
                        "settings" => {
                            crate::commands::open_settings_window(ah.clone());
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            crate::commands::open_settings_window(tray.app_handle().clone());
                        }
                    })
                    .build(app)?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(|_, event| {
        if let tauri::RunEvent::Exit = event {
            diagnostics::record("exit", "restoring native taskbar");
            set_taskbar_visibility(true, true);
            NATIVE_TASKBAR_HIDDEN.store(false, Ordering::Relaxed);
            set_native_osd_suppressed(false);
            crate::notifications::set_windows_toast_suppression(false);
        }
    });
}
