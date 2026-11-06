//! The Rack: one host running both engines, DH-1's agent server and EH-1's grader, so
//! the two devices sit side by side in one window. Everything native is the shared host
//! crate, crates/dh-host.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dh_host::run(&[dh_host::Engine::Dh1, dh_host::Engine::Eh1], tauri::generate_context!());
}
