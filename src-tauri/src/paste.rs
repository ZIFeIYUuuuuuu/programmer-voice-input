#[cfg(target_os = "windows")]
pub fn simulate_ctrl_v() -> Result<(), String> {
    use std::{thread, time::Duration};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        keybd_event, KEYEVENTF_KEYUP, VK_CONTROL, VK_V,
    };

    unsafe {
        keybd_event(VK_CONTROL as u8, 0, 0, 0);
        keybd_event(VK_V as u8, 0, 0, 0);
        thread::sleep(Duration::from_millis(25));
        keybd_event(VK_V as u8, 0, KEYEVENTF_KEYUP, 0);
        keybd_event(VK_CONTROL as u8, 0, KEYEVENTF_KEYUP, 0);
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn simulate_ctrl_v() -> Result<(), String> {
    Err("Automatic paste is only implemented on Windows. Text was copied instead.".to_string())
}
