//! PB-1 as a standalone app: a host with one engine, the Parkbench bridge (cli-bridge's
//! pb1-serve). Everything native is the shared host crate, crates/dh-host.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dh_host::run(&[dh_host::Engine::Pb1], tauri::generate_context!());
}
