//! The native side every Duck Harness app shares. A host is a window around one or more
//! devices; this crate runs their engines (engines.rs) and owns what all hosts have in
//! common: settings (the Keychain key, the traces file), preset and question set files,
//! and files picked in Open and Save dialogs. Each app's own crate only says which
//! engines it runs:
//!
//! ```ignore
//! dh_host::run(&[Engine::Dh1], tauri::generate_context!());
//! ```
//!
//! Every host registers every command, so a device works the same in any host.

pub mod discovery;
pub mod engines;
pub mod files;
pub mod pb1;
pub mod presets;
pub mod question_sets;
pub mod settings;

pub use engines::Engine;

use engines::Engines;
use tauri::{Manager, RunEvent};

/// Build and run the app with these engines, started when the window opens and stopped
/// when the app exits.
pub fn run(engines: &[Engine], context: tauri::Context) {
    let name = context.config().product_name.clone().unwrap_or_else(|| "the app".into());
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Engines::new(engines))
        .setup(|app| {
            app.state::<Engines>().start_all(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            engines::engine_send,
            engines::engine_send_confirmed,
            engines::engine_generation,
            engines::engine_restart,
            settings::settings_get,
            settings::api_key_set,
            settings::api_key_clear,
            settings::traces_db_set,
            settings::traces_shell_open,
            pb1::pb1_query_open,
            presets::preset_list,
            presets::preset_write,
            presets::preset_delete,
            files::file_read,
            files::file_write,
            question_sets::question_set_list,
            question_sets::question_set_write,
            question_sets::question_set_delete,
            question_sets::question_set_reveal,
        ])
        .build(context)
        .unwrap_or_else(|e| panic!("error while building {name}: {e}"))
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<Engines>().stop_all();
            }
        });
}
