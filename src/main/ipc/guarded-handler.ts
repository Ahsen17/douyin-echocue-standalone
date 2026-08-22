// Wraps a plain handler so every IPC registration enforces the trusted-sender
// check before touching domain logic. Decouples the guard from electron's
// WebContents so the rejection path is unit-testable without ipcMain.
export function createGuardedHandler<S, T>(
  isTrustedSender: (sender: S) => boolean,
  handler: (raw: unknown) => T | Promise<T>,
) {
  return (event: { sender: S }, raw: unknown): T | Promise<T> => {
    if (!isTrustedSender(event.sender)) {
      throw new Error('rejected: untrusted sender');
    }
    return handler(raw);
  };
}
