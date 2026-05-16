use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};

pub fn create_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let show_floating = MenuItem::with_id(
        app,
        "show_floating",
        "Show Floating HUD",
        true,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(app, "show_settings", "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_floating, &settings, &quit])?;

    let mut builder = TrayIconBuilder::new()
        .tooltip("Programmer Voice Input")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show_floating" => {
                let _ = crate::commands::show_floating(app.clone());
            }
            "show_settings" => {
                let _ = crate::commands::reveal_settings_window(app);
            }
            "quit" => app.exit(0),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}
