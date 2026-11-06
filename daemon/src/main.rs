#![forbid(unsafe_code)]

#[cfg(unix)]
mod dns;
mod killswitch;
#[cfg(unix)]
mod network_manager;
#[cfg(unix)]
mod paths;
mod protocol;
mod recovery;
#[cfg(unix)]
mod tunnel;
mod tunnel_config;

#[cfg(unix)]
mod authorization;
#[cfg(unix)]
mod service;
#[cfg(unix)]
mod shutdown;
#[cfg(unix)]
mod snap;

use std::process::ExitCode;

fn main() -> ExitCode {
    if std::env::args().any(|argument| argument == "--version") {
        println!("k1vpnd {}", env!("CARGO_PKG_VERSION"));
        return ExitCode::SUCCESS;
    }

    #[cfg(unix)]
    {
        match service::run() {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => {
                eprintln!("k1vpnd: {error}");
                ExitCode::from(70)
            }
        }
    }

    #[cfg(not(unix))]
    {
        eprintln!("k1vpnd: this service is supported only on Linux");
        ExitCode::from(78)
    }
}
