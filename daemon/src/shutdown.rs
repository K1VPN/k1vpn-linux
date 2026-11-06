//! Consume service stop signals in ordinary Rust code, never in a signal handler.
use nix::sys::signal::{SigSet, Signal};
use nix::sys::signalfd::{SfdFlags, SignalFd};
use std::io;

pub struct ShutdownSignals {
    fd: SignalFd,
    previous: SigSet,
}

impl ShutdownSignals {
    /// Must run before any worker threads are created so all inherit the mask.
    pub fn new() -> io::Result<Self> {
        let previous = SigSet::thread_get_mask()?;
        let mut mask = SigSet::empty();
        mask.add(Signal::SIGTERM);
        mask.add(Signal::SIGINT);
        let fd = SignalFd::with_flags(&mask, SfdFlags::SFD_NONBLOCK | SfdFlags::SFD_CLOEXEC)?;
        mask.thread_block()?;
        Ok(Self { fd, previous })
    }

    pub fn requested(&self) -> io::Result<bool> {
        Ok(self.fd.read_signal()?.is_some())
    }
}

impl Drop for ShutdownSignals {
    fn drop(&mut self) {
        let _ = self.previous.thread_set_mask();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn consumes_a_thread_local_stop_signal_without_terminating_the_process() {
        let before = SigSet::thread_get_mask().unwrap();
        {
            let signals = ShutdownSignals::new().unwrap();
            assert!(!signals.requested().unwrap());
            nix::sys::signal::raise(Signal::SIGTERM).unwrap();
            let consumed = signals.requested().unwrap();
            assert!(consumed);
            assert!(!signals.requested().unwrap());
        }
        assert_eq!(SigSet::thread_get_mask().unwrap(), before);
    }
}
