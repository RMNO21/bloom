use serde::{Deserialize, Serialize};
use std::os::windows::process::CommandExt;
use windows::core::{GUID, PCWSTR};
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::Media::Audio::{
    eCapture, eConsole, eRender,
    IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
    Endpoints::IAudioEndpointVolume,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ,
};

const CREATE_NO_WINDOW: u32 = 0x08000000;
const DRIVE_REMOVABLE: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioOutputDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub device_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemovableDrive {
    pub letter: String,
    pub label: String,
    pub total_gb: f64,
    pub free_gb: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VpnProfile {
    pub name: String,
    pub connected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PrivacyStatus {
    pub microphone: bool,
    pub mic_app: Option<String>,
    pub camera: bool,
    pub cam_app: Option<String>,
    pub location: bool,
}

#[allow(non_snake_case, non_upper_case_globals)]
#[repr(u32)]
#[allow(dead_code)]
pub enum ERole {
    EConsole = 0,
    EMultimedia = 1,
    ECommunications = 2,
}

#[windows::core::interface("f8679f50-850a-41cf-9c72-430f290290c8")]
unsafe trait IPolicyConfig: windows::core::IUnknown {
    unsafe fn GetMixFormat(&self, wszdeviceid: PCWSTR, ppwf: *mut *mut std::ffi::c_void) -> windows::core::HRESULT;
    unsafe fn GetDeviceFormat(&self, wszdeviceid: PCWSTR, fdefault: i32, ppwf: *mut *mut std::ffi::c_void) -> windows::core::HRESULT;
    unsafe fn ResetDeviceFormat(&self, wszdeviceid: PCWSTR) -> windows::core::HRESULT;
    unsafe fn SetDeviceFormat(&self, wszdeviceid: PCWSTR, pwf: *mut std::ffi::c_void, ppwf: *mut std::ffi::c_void) -> windows::core::HRESULT;
    unsafe fn GetProcessingPeriod(&self, wszdeviceid: PCWSTR, fdefault: i32, pftdefaultperiod: *mut i64, pftminimumperiod: *mut i64) -> windows::core::HRESULT;
    unsafe fn SetProcessingPeriod(&self, wszdeviceid: PCWSTR, pftperiod: *mut i64) -> windows::core::HRESULT;
    unsafe fn GetShareMode(&self, wszdeviceid: PCWSTR, pmode: *mut std::ffi::c_void) -> windows::core::HRESULT;
    unsafe fn SetShareMode(&self, wszdeviceid: PCWSTR, pmode: *mut std::ffi::c_void) -> windows::core::HRESULT;
    unsafe fn GetPropertyValue(&self, wszdeviceid: PCWSTR, dwflags: i32, pkey: *const std::ffi::c_void, pprop: *mut std::ffi::c_void) -> windows::core::HRESULT;
    unsafe fn SetPropertyValue(&self, wszdeviceid: PCWSTR, dwflags: i32, pkey: *const std::ffi::c_void, pprop: *const std::ffi::c_void) -> windows::core::HRESULT;
    unsafe fn SetDefaultEndpoint(&self, wszdeviceid: PCWSTR, erole: ERole) -> windows::core::HRESULT;
}

const CLSID_CPolicyConfigClient: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);

const PKEY_DEVICE_FRIENDLY_NAME: PROPERTYKEY = PROPERTYKEY {
    fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
    pid: 14,
};

// -------------------------------------------------------------
// 1. AUDIO OUTPUT DEVICES & SELECTOR
// -------------------------------------------------------------
#[tauri::command]
pub async fn get_audio_output_devices() -> Result<Vec<AudioOutputDevice>, String> {
    tauri::async_runtime::spawn_blocking(|| unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| e.to_string())?;

        let default_id = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .and_then(|dev| dev.GetId())
            .map(|pwstr| pwstr.to_string().unwrap_or_default())
            .unwrap_or_default();

        let devices = enumerator
            .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
            .map_err(|e| e.to_string())?;

        let count = devices.GetCount().unwrap_or(0);
        let mut list = Vec::new();

        for i in 0..count {
            let Ok(device) = devices.Item(i) else { continue };
            let Ok(id_pwstr) = device.GetId() else { continue };
            let id = id_pwstr.to_string().unwrap_or_default();
            if id.is_empty() { continue; }

            let is_default = !default_id.is_empty() && id == default_id;

            let name = if let Ok(store) = device.OpenPropertyStore(STGM_READ) {
                if let Ok(prop) = store.GetValue(&PKEY_DEVICE_FRIENDLY_NAME) {
                    let raw_ptr = prop.Anonymous.Anonymous.Anonymous.pwszVal;
                    if !raw_ptr.is_null() {
                        PCWSTR::from_raw(raw_ptr.0).to_string().unwrap_or_else(|_| format!("Audio Device {i}"))
                    } else {
                        format!("Audio Device {i}")
                    }
                } else {
                    format!("Audio Device {i}")
                }
            } else {
                format!("Audio Device {i}")
            };

            let name_lower = name.to_lowercase();
            let device_type = if name_lower.contains("headphone") || name_lower.contains("headset") || name_lower.contains("earbuds") {
                "headphones"
            } else if name_lower.contains("bluetooth") || name_lower.contains("hands-free") {
                "bluetooth"
            } else if name_lower.contains("tv") || name_lower.contains("display") || name_lower.contains("hdmi") || name_lower.contains("nvidia") || name_lower.contains("amd") {
                "display"
            } else {
                "speaker"
            };

            list.push(AudioOutputDevice {
                id,
                name,
                is_default,
                device_type: device_type.to_string(),
            });
        }

        // Put default at top
        list.sort_by(|a, b| b.is_default.cmp(&a.is_default));
        Ok(list)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_default_audio_device(device_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || unsafe {
        use windows::core::HSTRING;
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let policy_config: IPolicyConfig = CoCreateInstance(&CLSID_CPolicyConfigClient, None, CLSCTX_ALL)
            .map_err(|e| format!("Failed to create CPolicyConfig: {e}"))?;

        let hstr = HSTRING::from(device_id.as_str());
        let pcwstr = PCWSTR::from_raw(hstr.as_ptr());

        let _ = policy_config.SetDefaultEndpoint(pcwstr, ERole::EConsole);
        let _ = policy_config.SetDefaultEndpoint(pcwstr, ERole::EMultimedia);
        let _ = policy_config.SetDefaultEndpoint(pcwstr, ERole::ECommunications);

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

// -------------------------------------------------------------
// 2. GLOBAL MIC MUTE
// -------------------------------------------------------------
#[tauri::command]
pub async fn get_global_mic_mute() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| e.to_string())?;
        let mic = enumerator.GetDefaultAudioEndpoint(eCapture, eConsole)
            .map_err(|e| e.to_string())?;
        let volume: IAudioEndpointVolume = mic.Activate(CLSCTX_ALL, None)
            .map_err(|e| e.to_string())?;
        let muted = volume.GetMute().map_err(|e| e.to_string())?;
        Ok(muted.as_bool())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_global_mic_mute(muted: bool) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| e.to_string())?;
        let mic = enumerator.GetDefaultAudioEndpoint(eCapture, eConsole)
            .map_err(|e| e.to_string())?;
        let volume: IAudioEndpointVolume = mic.Activate(CLSCTX_ALL, None)
            .map_err(|e| e.to_string())?;
        volume.SetMute(muted, std::ptr::null()).map_err(|e| e.to_string())?;
        Ok(muted)
    })
    .await
    .map_err(|e| e.to_string())?
}

// -------------------------------------------------------------
// 3. SPATIAL SOUND TOGGLE
// -------------------------------------------------------------
#[tauri::command]
pub fn open_spatial_sound_settings() {
    unsafe {
        use windows::Win32::UI::Shell::ShellExecuteA;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let _ = ShellExecuteA(
            None,
            windows::core::PCSTR(c"open".as_ptr() as *const u8),
            windows::core::PCSTR(c"ms-settings:sound".as_ptr() as *const u8),
            windows::core::PCSTR::null(),
            windows::core::PCSTR::null(),
            SW_SHOWNORMAL,
        );
    }
}

// -------------------------------------------------------------
// 4. MOBILE HOTSPOT
// -------------------------------------------------------------
#[tauri::command]
pub async fn get_mobile_hotspot_state() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let output = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle", "Hidden",
                "-Command",
                "$p = [Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType=WindowsRuntime]::GetInternetConnectionProfile(); \
                 if ($p) { \
                     $t = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType=WindowsRuntime]::CreateFromConnectionProfile($p); \
                     if ($t.TetheringOperationalState -eq 1 -or $t.TetheringOperationalState -eq 'On') { Write-Output '1' } else { Write-Output '0' } \
                 } else { Write-Output '0' }"
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        match output {
            Ok(out) => {
                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                Ok(s == "1")
            }
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_mobile_hotspot_state(enable: bool) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let action = if enable { "$t.StartTetheringAsync()" } else { "$t.StopTetheringAsync()" };
        let cmd = format!(
            "$p = [Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType=WindowsRuntime]::GetInternetConnectionProfile(); \
             if ($p) {{ \
                 $t = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType=WindowsRuntime]::CreateFromConnectionProfile($p); \
                 {action} | Out-Null; \
                 Start-Sleep -Milliseconds 600; \
                 if ($t.TetheringOperationalState -eq 1 -or $t.TetheringOperationalState -eq 'On') {{ Write-Output '1' }} else {{ Write-Output '0' }} \
             }} else {{ Write-Output '0' }}"
        );

        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &cmd])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        match output {
            Ok(out) => {
                let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                Ok(s == "1")
            }
            Err(e) => Err(e.to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// -------------------------------------------------------------
// 5. WINDOWS VPN QUICK TOGGLE
// -------------------------------------------------------------
#[tauri::command]
pub async fn get_vpn_connections() -> Result<Vec<VpnProfile>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let output = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle", "Hidden",
                "-Command",
                "Get-VpnConnection -ErrorAction SilentlyContinue | ForEach-Object { \"$($_.Name)|$($_.ConnectionStatus)\" }"
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        let mut list = Vec::new();
        if let Ok(out) = output {
            let s = String::from_utf8_lossy(&out.stdout);
            for line in s.lines() {
                let parts: Vec<&str> = line.trim().split('|').collect();
                if parts.len() >= 2 && !parts[0].is_empty() {
                    list.push(VpnProfile {
                        name: parts[0].to_string(),
                        connected: parts[1].eq_ignore_ascii_case("Connected"),
                    });
                }
            }
        }
        Ok(list)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn toggle_vpn_connection(name: String, connect: bool) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let args = if connect {
            vec!["rasdial".to_string(), format!("\"{name}\"")]
        } else {
            vec!["rasdial".to_string(), format!("\"{name}\""), "/disconnect".to_string()]
        };

        let cmd = args.join(" ");
        let _ = std::process::Command::new("cmd")
            .args(["/C", &cmd])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        Ok(connect)
    })
    .await
    .map_err(|e| e.to_string())?
}

// -------------------------------------------------------------
// 6. AIRPLANE MODE
// -------------------------------------------------------------
#[tauri::command]
pub async fn get_airplane_mode_state() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| unsafe {
        use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD};
        use windows::core::w;

        let mut val: u32 = 0;
        let mut size = std::mem::size_of::<u32>() as u32;
        let status = RegGetValueW(
            HKEY_LOCAL_MACHINE,
            w!("System\\CurrentControlSet\\Control\\RadioManagement\\SystemRadioState"),
            None,
            RRF_RT_REG_DWORD,
            None,
            Some(&mut val as *mut _ as *mut _),
            Some(&mut size),
        );
        if status.is_ok() {
            Ok(val == 1)
        } else {
            Ok(false)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_airplane_mode_state(enable: bool) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state_val = if enable { "Off" } else { "On" };
        let cmd = format!(
            "[Windows.Devices.Radios.Radio,Windows.Devices.Radios,ContentType=WindowsRuntime] | Out-Null; \
             $op = [Windows.Devices.Radios.Radio]::GetRadiosAsync(); \
             $radios = $op.GetResults(); \
             if ($radios) {{ \
                 foreach ($r in $radios) {{ $r.SetStateAsync('{state_val}') | Out-Null }} \
             }}"
        );

        let _ = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &cmd])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        Ok(enable)
    })
    .await
    .map_err(|e| e.to_string())?
}

// -------------------------------------------------------------
// 7. PROJECTION & MULTI-MONITOR MODES
// -------------------------------------------------------------
#[tauri::command]
pub fn set_projection_mode(mode: String) {
    let arg = match mode.to_lowercase().as_str() {
        "internal" => "/internal",
        "clone" => "/clone",
        "extend" => "/extend",
        "external" => "/external",
        _ => "",
    };
    if arg.is_empty() {
        let _ = std::process::Command::new("DisplaySwitch.exe")
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    } else {
        let _ = std::process::Command::new("DisplaySwitch.exe")
            .arg(arg)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }
}

// -------------------------------------------------------------
// 8. NIGHT LIGHT TOGGLE
// -------------------------------------------------------------
#[tauri::command]
pub async fn get_night_light_state() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| unsafe {
        use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_BINARY};
        use windows::core::w;

        let mut buf = [0u8; 128];
        let mut size = buf.len() as u32;
        let status = RegGetValueW(
            HKEY_CURRENT_USER,
            w!(r"Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\DefaultAccount\Current\default$windows.data.bluelightreduction.bluelightreductionstate\windows.data.bluelightreduction.bluelightreductionstate"),
            w!("Data"),
            RRF_RT_REG_BINARY,
            None,
            Some(buf.as_mut_ptr() as *mut _),
            Some(&mut size),
        );

        if status.is_ok() && size >= 19 {
            Ok(buf[18] == 0x15)
        } else {
            Ok(false)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_night_light_state(enable: bool) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || unsafe {
        use windows::Win32::System::Registry::{
            RegOpenKeyExW, RegQueryValueExW, RegSetValueExW, RegCloseKey,
            HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, REG_BINARY, HKEY,
        };
        use windows::core::w;

        let mut hkey = HKEY::default();
        let status = RegOpenKeyExW(
            HKEY_CURRENT_USER,
            w!(r"Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\DefaultAccount\Current\default$windows.data.bluelightreduction.bluelightreductionstate\windows.data.bluelightreduction.bluelightreductionstate"),
            None,
            KEY_READ | KEY_WRITE,
            &mut hkey,
        );

        if status.is_ok() && !hkey.is_invalid() {
            let mut buf = [0u8; 128];
            let mut size = buf.len() as u32;
            let q_res = RegQueryValueExW(
                hkey,
                w!("Data"),
                None,
                None,
                Some(buf.as_mut_ptr()),
                Some(&mut size),
            );
            if q_res.is_ok() && size >= 19 {
                buf[18] = if enable { 0x15 } else { 0x13 };
                let _ = RegSetValueExW(
                    hkey,
                    w!("Data"),
                    None,
                    REG_BINARY,
                    Some(&buf[..size as usize]),
                );
            }
            RegCloseKey(hkey);
        }
        Ok(enable)
    })
    .await
    .map_err(|e| e.to_string())?
}

// -------------------------------------------------------------
// 9. CAST / WIRELESS DISPLAY
// -------------------------------------------------------------
#[tauri::command]
pub fn open_wireless_display_cast() {
    unsafe {
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            keybd_event, KEYEVENTF_KEYUP, VK_LWIN,
        };
        // Win + K
        keybd_event(VK_LWIN.0 as u8, 0, Default::default(), 0);
        keybd_event(0x4B /* 'K' */, 0, Default::default(), 0);
        keybd_event(0x4B, 0, KEYEVENTF_KEYUP, 0);
        keybd_event(VK_LWIN.0 as u8, 0, KEYEVENTF_KEYUP, 0);
    }
}

// -------------------------------------------------------------
// 10. REMOVABLE MEDIA & USB SAFE EJECT
// -------------------------------------------------------------
#[tauri::command]
pub async fn get_removable_drives() -> Result<Vec<RemovableDrive>, String> {
    tauri::async_runtime::spawn_blocking(|| unsafe {
        use windows::Win32::Storage::FileSystem::{
            GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW,
        };
        use windows::core::HSTRING;

        let drives_mask = GetLogicalDrives();
        let mut list = Vec::new();

        for i in 0..26 {
            if (drives_mask & (1 << i)) != 0 {
                let letter_char = (b'A' + i) as char;
                let root_path = format!("{letter_char}:\\");
                let root_hstr = HSTRING::from(root_path.as_str());

                let drive_type = GetDriveTypeW(windows::core::PCWSTR::from_raw(root_hstr.as_ptr()));
                if drive_type == DRIVE_REMOVABLE {
                    let mut vol_name = [0u16; 260];
                    let _ = GetVolumeInformationW(
                        windows::core::PCWSTR::from_raw(root_hstr.as_ptr()),
                        Some(&mut vol_name),
                        None,
                        None,
                        None,
                        None,
                    );
                    let label = String::from_utf16_lossy(&vol_name)
                        .trim_matches('\0')
                        .trim()
                        .to_string();
                    let final_label = if label.is_empty() {
                        format!("USB Drive ({letter_char}:)")
                    } else {
                        format!("{label} ({letter_char}:)")
                    };

                    let mut free_bytes = 0u64;
                    let mut total_bytes = 0u64;
                    let _ = GetDiskFreeSpaceExW(
                        windows::core::PCWSTR::from_raw(root_hstr.as_ptr()),
                        Some(&mut free_bytes),
                        Some(&mut total_bytes),
                        None,
                    );

                    list.push(RemovableDrive {
                        letter: format!("{letter_char}:"),
                        label: final_label,
                        total_gb: (total_bytes as f64) / (1024.0 * 1024.0 * 1024.0),
                        free_gb: (free_bytes as f64) / (1024.0 * 1024.0 * 1024.0),
                    });
                }
            }
        }
        Ok(list)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn eject_removable_drive(drive_letter: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let clean = drive_letter.trim().trim_end_matches('\\').to_uppercase();
        let cmd = format!("(New-Object -comObject Shell.Application).Namespace(17).ParseName('{clean}').InvokeVerb('Eject')");
        let _ = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &cmd])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

// -------------------------------------------------------------
// 11. POWER MODE (EFFICIENCY / BALANCED / PERFORMANCE)
// -------------------------------------------------------------
#[tauri::command]
pub async fn get_power_mode() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| unsafe {
        use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
        use windows::core::w;

        let mut buffer = [0u16; 64];
        let mut size = std::mem::size_of_val(&buffer) as u32;
        let status = RegGetValueW(
            HKEY_LOCAL_MACHINE,
            w!("SYSTEM\\CurrentControlSet\\Control\\Power\\User\\PowerSchemes"),
            w!("ActiveOverlayAcPowerScheme"),
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr().cast()),
            Some(&mut size),
        );
        if status.is_err() {
            return Ok("balanced".to_string());
        }
        let len = buffer.iter().position(|c| *c == 0).unwrap_or(buffer.len());
        let guid = String::from_utf16_lossy(&buffer[..len]).to_lowercase();

        if guid.contains("961cc777") {
            Ok("efficiency".to_string())
        } else if guid.contains("ded574b5") || guid.contains("3af9b8d9") {
            Ok("performance".to_string())
        } else {
            Ok("balanced".to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_power_mode(mode: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use windows::core::GUID;
        type PowerSetActiveOverlaySchemeFn = unsafe extern "system" fn(*const GUID) -> u32;

        let overlay_guid = match mode.to_lowercase().as_str() {
            "efficiency" => GUID::from_u128(0x961cc777_2547_4f9d_8174_7d86181b8a7a),
            "performance" => GUID::from_u128(0xded574b5_45a0_4f42_8737_46345c09c238),
            _ => GUID::zeroed(),
        };

        unsafe {
            use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
            use windows::core::w;
            if let Ok(h_module) = LoadLibraryW(w!("powrprof.dll")) {
                if let Some(set_overlay) = GetProcAddress(
                    h_module,
                    windows::core::PCSTR(c"PowerSetActiveOverlayScheme".as_ptr() as *const u8),
                ) {
                    let set_overlay_fn: PowerSetActiveOverlaySchemeFn = std::mem::transmute(set_overlay);
                    let _ = set_overlay_fn(&overlay_guid);
                }
            }
        }

        Ok(mode)
    })
    .await
    .map_err(|e| e.to_string())?
}

// -------------------------------------------------------------
// 12. KEYBOARD LANGUAGE INDICATOR & SWITCHER
// -------------------------------------------------------------
#[tauri::command]
pub fn get_keyboard_language() -> String {
    unsafe {
        use windows::Win32::UI::Input::KeyboardAndMouse::GetKeyboardLayout;
        use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

        let fg = GetForegroundWindow();
        let tid = GetWindowThreadProcessId(fg, None);
        let hkl = GetKeyboardLayout(tid);
        let lang_id = (hkl.0 as usize) & 0xFFFF;

        match lang_id {
            0x0429 => "FA".to_string(), // Persian
            0x0409 | 0x0809 => "EN".to_string(), // English (US/UK)
            0x0407 => "DE".to_string(), // German
            0x040C => "FR".to_string(), // French
            0x0410 => "IT".to_string(), // Italian
            0x0419 => "RU".to_string(), // Russian
            0x0401 => "AR".to_string(), // Arabic
            0x0411 => "JA".to_string(), // Japanese
            0x0412 => "KO".to_string(), // Korean
            0x0804 | 0x0404 => "ZH".to_string(), // Chinese
            0x041F => "TR".to_string(), // Turkish
            _ => "EN".to_string(),
        }
    }
}

#[tauri::command]
pub fn toggle_keyboard_language() -> String {
    unsafe {
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            keybd_event, KEYEVENTF_KEYUP, VK_LWIN, VK_SPACE,
        };
        // Press Win + Space to cycle language
        keybd_event(VK_LWIN.0 as u8, 0, Default::default(), 0);
        keybd_event(VK_SPACE.0 as u8, 0, Default::default(), 0);
        keybd_event(VK_SPACE.0 as u8, 0, KEYEVENTF_KEYUP, 0);
        keybd_event(VK_LWIN.0 as u8, 0, KEYEVENTF_KEYUP, 0);
    }
    std::thread::sleep(std::time::Duration::from_millis(150));
    get_keyboard_language()
}

// -------------------------------------------------------------
// 13. TOUCH KEYBOARD
// -------------------------------------------------------------
#[tauri::command]
pub fn open_touch_keyboard() {
    let tabtip = "C:\\Program Files\\Common Files\\microsoft shared\\ink\\TabTip.exe";
    let _ = std::process::Command::new(tabtip)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

// -------------------------------------------------------------
// 14. PRIVACY INDICATORS (MIC / WEBCAM / LOCATION IN USE)
// 100% Native Win32 Registry - Zero Processes Spawns
// -------------------------------------------------------------
fn check_capability_native(cap: &str) -> (bool, Option<String>) {
    use windows::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER,
        KEY_READ,
    };
    use windows::core::PCWSTR;

    let paths = [
        format!("Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\{}", cap),
        format!("Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\{}\\NonPackaged", cap),
    ];

    for path in &paths {
        let wide_path: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
        let mut hkey = HKEY::default();
        let status = unsafe {
            RegOpenKeyExW(
                HKEY_CURRENT_USER,
                PCWSTR(wide_path.as_ptr()),
                None,
                KEY_READ,
                &mut hkey,
            )
        };
        if status.is_ok() && !hkey.is_invalid() {
            let mut index = 0;
            let mut key_name = [0u16; 260];
            loop {
                let mut key_len = key_name.len() as u32;
                let enum_res = unsafe {
                    RegEnumKeyExW(
                        hkey,
                        index,
                        Some(windows::core::PWSTR(key_name.as_mut_ptr())),
                        &mut key_len,
                        None,
                        None,
                        None,
                        None,
                    )
                };
                if enum_res.is_err() {
                    break;
                }
                index += 1;

                let app_name = String::from_utf16_lossy(&key_name[..key_len as usize]);
                if app_name.eq_ignore_ascii_case("NonPackaged") {
                    continue;
                }

                let sub_wide: Vec<u16> = app_name.encode_utf16().chain(Some(0)).collect();
                let mut hsubkey = HKEY::default();
                let sub_res = unsafe {
                    RegOpenKeyExW(
                        hkey,
                        PCWSTR(sub_wide.as_ptr()),
                        None,
                        KEY_READ,
                        &mut hsubkey,
                    )
                };
                if sub_res.is_ok() && !hsubkey.is_invalid() {
                    let mut start: u64 = 0;
                    let mut stop: u64 = 0;
                    let mut size = 8u32;
                    let val_start: Vec<u16> = "LastUsedTimeStart".encode_utf16().chain(Some(0)).collect();
                    let val_stop: Vec<u16> = "LastUsedTimeStop".encode_utf16().chain(Some(0)).collect();

                    let q1 = unsafe {
                        RegQueryValueExW(
                            hsubkey,
                            PCWSTR(val_start.as_ptr()),
                            None,
                            None,
                            Some(&mut start as *mut u64 as *mut u8),
                            Some(&mut size),
                        )
                    };
                    size = 8;
                    let q2 = unsafe {
                        RegQueryValueExW(
                            hsubkey,
                            PCWSTR(val_stop.as_ptr()),
                            None,
                            None,
                            Some(&mut stop as *mut u64 as *mut u8),
                            Some(&mut size),
                        )
                    };
                    unsafe { RegCloseKey(hsubkey) };

                    if q1.is_ok() && q2.is_ok() && start > 0 && stop == 0 {
                        unsafe { RegCloseKey(hkey) };
                        let clean = app_name
                            .split('#')
                            .last()
                            .unwrap_or(&app_name)
                            .trim_end_matches(".exe")
                            .to_string();
                        return (true, Some(clean));
                    }
                }
            }
            unsafe { RegCloseKey(hkey) };
        }
    }
    (false, None)
}

#[tauri::command]
pub async fn get_privacy_indicators() -> Result<PrivacyStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let (mic_active, mic_app) = check_capability_native("microphone");
        let (cam_active, cam_app) = check_capability_native("webcam");
        let (loc_active, _) = check_capability_native("location");

        Ok(PrivacyStatus {
            microphone: mic_active,
            mic_app,
            camera: cam_active,
            cam_app,
            location: loc_active,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
