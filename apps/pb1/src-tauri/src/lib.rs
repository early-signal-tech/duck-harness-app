//! PB-1 as a standalone app. For now the panel runs on a fake engine inside the web view, so
//! the host starts no engines; wiring it to Parkbench (cli-bridge) adds `Engine::Pb1` here.
//! Everything native is the shared host crate, crates/dh-host.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dh_host::run(&[], tauri::generate_context!());
}
