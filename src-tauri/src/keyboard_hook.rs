use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::OnceLock;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    VK_CONTROL, VK_LCONTROL, VK_LMENU, VK_LSHIFT, VK_MENU, VK_RCONTROL, VK_RMENU, VK_RSHIFT,
    VK_SHIFT,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetMessageW, SetWindowsHookExW, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL,
    WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
};

static HOOK_STATE: OnceLock<HookState> = OnceLock::new();
const HOLD_START_DELAY_MS: u64 = 320;

struct HookState {
    app: AppHandle,
    enabled: AtomicBool,
    active: AtomicBool,
    pressed: AtomicBool,
    generation: AtomicU64,
    hold_vk: AtomicU32,
}

#[derive(Clone, Serialize)]
struct VoiceTriggerEvent {
    source: &'static str,
}

pub fn start(app: AppHandle) {
    let _ = HOOK_STATE.set(HookState {
        app,
        enabled: AtomicBool::new(false),
        active: AtomicBool::new(false),
        pressed: AtomicBool::new(false),
        generation: AtomicU64::new(0),
        hold_vk: AtomicU32::new(VK_MENU as u32),
    });

    thread::spawn(|| unsafe {
        let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), null_mut(), 0);
        if hook.is_null() {
            return;
        }

        let mut message = MSG::default();
        while GetMessageW(&mut message, null_mut(), 0, 0) > 0 {}
    });
}

pub fn configure(enabled: bool, key: &str) -> Result<(), String> {
    let Some(state) = HOOK_STATE.get() else {
        return Err("Keyboard hook is not available.".to_string());
    };

    let vk = hold_key_to_vk(key).ok_or_else(|| format!("Unsupported hold key: {key}"))?;

    state.hold_vk.store(vk, Ordering::SeqCst);
    state.pressed.store(false, Ordering::SeqCst);
    state.generation.fetch_add(1, Ordering::SeqCst);
    state.enabled.store(enabled, Ordering::SeqCst);

    if state.active.swap(false, Ordering::SeqCst) {
        let _ = state
            .app
            .emit("voice-stop", VoiceTriggerEvent { source: "hold_key" });
    }

    Ok(())
}

fn hold_key_to_vk(key: &str) -> Option<u32> {
    let normalized = key.trim().to_ascii_uppercase();

    match normalized.as_str() {
        "ALT" => Some(VK_MENU as u32),
        "LEFTALT" => Some(VK_LMENU as u32),
        "RIGHTALT" => Some(VK_RMENU as u32),
        "CONTROL" | "CTRL" => Some(VK_CONTROL as u32),
        "LEFTCONTROL" | "LEFTCTRL" => Some(VK_LCONTROL as u32),
        "RIGHTCONTROL" | "RIGHTCTRL" => Some(VK_RCONTROL as u32),
        "SHIFT" => Some(VK_SHIFT as u32),
        "LEFTSHIFT" => Some(VK_LSHIFT as u32),
        "RIGHTSHIFT" => Some(VK_RSHIFT as u32),
        "F1" => Some(0x70),
        "F2" => Some(0x71),
        "F3" => Some(0x72),
        "F4" => Some(0x73),
        "F5" => Some(0x74),
        "F6" => Some(0x75),
        "F7" => Some(0x76),
        "F8" => Some(0x77),
        "F9" => Some(0x78),
        "F10" => Some(0x79),
        "F11" => Some(0x7A),
        "F12" => Some(0x7B),
        "CAPSLOCK" => Some(0x14),
        _ => None,
    }
}

fn vk_matches(configured: u32, actual: u32) -> bool {
    configured == actual
        || (configured == VK_MENU as u32
            && (actual == VK_LMENU as u32 || actual == VK_RMENU as u32))
        || (configured == VK_CONTROL as u32
            && (actual == VK_LCONTROL as u32 || actual == VK_RCONTROL as u32))
        || (configured == VK_SHIFT as u32
            && (actual == VK_LSHIFT as u32 || actual == VK_RSHIFT as u32))
}

unsafe extern "system" fn keyboard_proc(code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
    if code >= 0 {
        if let Some(state) = HOOK_STATE.get() {
            if state.enabled.load(Ordering::SeqCst) {
                let keyboard = unsafe { &*(l_param as *const KBDLLHOOKSTRUCT) };
                let hold_vk = state.hold_vk.load(Ordering::SeqCst);

                if vk_matches(hold_vk, keyboard.vkCode) {
                    match w_param as u32 {
                        WM_KEYDOWN | WM_SYSKEYDOWN => {
                            if !state.pressed.swap(true, Ordering::SeqCst) {
                                let generation =
                                    state.generation.fetch_add(1, Ordering::SeqCst) + 1;
                                let app = state.app.clone();

                                thread::spawn(move || {
                                    thread::sleep(Duration::from_millis(HOLD_START_DELAY_MS));

                                    let Some(state) = HOOK_STATE.get() else {
                                        return;
                                    };

                                    if state.enabled.load(Ordering::SeqCst)
                                        && state.pressed.load(Ordering::SeqCst)
                                        && state.generation.load(Ordering::SeqCst) == generation
                                        && !state.active.swap(true, Ordering::SeqCst)
                                    {
                                        let _ = app.emit(
                                            "voice-start",
                                            VoiceTriggerEvent { source: "hold_key" },
                                        );
                                    }
                                });
                            }
                        }
                        WM_KEYUP | WM_SYSKEYUP => {
                            state.pressed.store(false, Ordering::SeqCst);
                            state.generation.fetch_add(1, Ordering::SeqCst);

                            if state.active.swap(false, Ordering::SeqCst) {
                                let _ = state
                                    .app
                                    .emit("voice-stop", VoiceTriggerEvent { source: "hold_key" });
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    unsafe { CallNextHookEx(null_mut(), code, w_param, l_param) }
}
