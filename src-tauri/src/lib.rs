//! CommandDeck backend.
//!
//! Phase 1 only hosts the window. Execution, terminal sessions, security and
//! persistence modules arrive in later phases (see docs/ARCHITECTURE.md).

pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to start the CommandDeck window");
}
