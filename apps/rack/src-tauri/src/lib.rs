//! The Rack: one host running every device's engine (DH-1's agent server, EH-1's grader,
//! and ES-1's flowctl bridge), so the devices sit side by side in one window. Everything native is the shared host
//! crate, crates/dh-host.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dh_host::run(&[dh_host::Engine::Dh1, dh_host::Engine::Eh1, dh_host::Engine::Es1, dh_host::Engine::Pb1], tauri::generate_context!());
}
