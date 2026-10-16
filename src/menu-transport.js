// Private parent/child pipes, with no listening port or browser surface.
class MenuBarTransport {
  constructor({ input = process.stdin, output = process.stdout, onAction, onClose } = {}) {
    this.output = output; this.closed = false;
    this.lines = require('node:readline').createInterface({ input, crlfDelay: Infinity });
    this.lines.on('line', line => {
      if (line.length > 1024) return;
      try {
        const message = JSON.parse(line);
        if (['connect', 'disconnect', 'refresh', 'read', 'wake', 'stop'].includes(message.action)) {
          Promise.resolve(onAction(message.action)).catch(() => {});
        }
      } catch {}
    });
    this.lines.once('close', () => { this.closed = true; onClose?.(); });
    output.on('error', () => { this.closed = true; onClose?.(); });
  }
  update(snapshot) {
    if (!this.closed && !this.output.destroyed) this.output.write(JSON.stringify({ type: 'snapshot', ...snapshot }) + '\n');
  }
  close() { this.closed = true; this.lines.close(); }
}
