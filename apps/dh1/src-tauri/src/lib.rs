//! DH-1 as a standalone app: a host with one engine, DH-1's agent server. Everything
//! native (the engine process, settings, presets, question sets) is the shared host
//! crate, crates/dh-host, which the rack uses too.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dh_host::run(&[dh_host::Engine::Dh1], tauri::generate_context!());
}
