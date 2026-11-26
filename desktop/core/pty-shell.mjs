import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

// Interactive streaming shell manager supporting live stdin input, streaming UTF-8 stdout/stderr,
// Ctrl+C interrupt, and persistent PowerShell / sh sessions for the Studio Terminal.
export class InteractiveTerminalManager extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map();
  }

  create({ cwd = process.cwd(), title = 'PowerShell' } = {}) {
    const id = 'term-' + crypto.randomUUID().slice(0, 8);
    const isWin = process.platform === 'win32';
    const exe = isWin ? 'powershell.exe' : (process.env.SHELL || 'sh');
    const args = isWin
      ? ['-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', '[Console]::InputEncoding = [Text.Encoding]::UTF8; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8']
      : ['-i'];

    const child = spawn(exe, args, {
      cwd: cwd || process.cwd(),
      env: { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '1' },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const session = {
      id,
      title,
      cwd: cwd || process.cwd(),
      pid: child.pid || null,
      status: 'running',
      exitCode: null,
      buffer: '',
      createdAt: new Date().toISOString(),
      child,
    };

    const append = (chunk, stream) => {
      const text = chunk.toString('utf8');
      session.buffer = (session.buffer + text).slice(-120000);
      this.emit('data', { id, stream, chunk: text });
    };

    child.stdout?.on('data', d => append(d, 'stdout'));
    child.stderr?.on('data', d => append(d, 'stderr'));
    child.on('error', err => {
      append(`\r\n[Terminal error: ${err.message}]\r\n`, 'stderr');
      session.status = 'error';
      this.emit('exit', { id, exitCode: 1 });
    });
    child.on('close', code => {
      session.status = 'exited';
      session.exitCode = code;
      this.emit('exit', { id, exitCode: code });
    });

    this.sessions.set(id, session);
    return this.serialize(session, true);
  }

  write(id, data) {
    const session = this.sessions.get(id);
    if (!session) throw new Error('Terminal session not found: ' + id);
    if (session.status !== 'running' || !session.child?.stdin?.writable) {
      throw new Error('Terminal session is not running.');
    }
    session.child.stdin.write(String(data));
    return { ok: true };
  }

  interrupt(id) {
    const session = this.sessions.get(id);
    if (!session) throw new Error('Terminal session not found: ' + id);
    if (session.status === 'running' && session.child?.stdin?.writable) {
      try { session.child.stdin.write('\x03'); } catch {}
    }
    return { ok: true };
  }

  clearBuffer(id) {
    const session = this.sessions.get(id);
    if (!session) throw new Error('Terminal session not found: ' + id);
    session.buffer = '';
    return { ok: true };
  }

  get(id) {
    const session = this.sessions.get(id);
    if (!session) throw new Error('Terminal session not found: ' + id);
    return this.serialize(session, true);
  }

  list() {
    return [...this.sessions.values()].map(s => this.serialize(s, false));
  }

  close(id) {
    const session = this.sessions.get(id);
    if (!session) return { closed: false };
    if (session.status === 'running' && session.child) {
      session.status = 'closed';
      if (process.platform === 'win32' && session.pid) {
        spawn('taskkill', ['/PID', String(session.pid), '/T', '/F'], { windowsHide: true });
      } else {
        try { session.child.kill('SIGKILL'); } catch {}
      }
    }
    this.sessions.delete(id);
    return { closed: true, id };
  }

  closeAll() {
    for (const id of [...this.sessions.keys()]) this.close(id);
  }

  serialize(session, includeBuffer = false) {
    return {
      id: session.id,
      title: session.title,
      cwd: session.cwd,
      pid: session.pid,
      status: session.status,
      exitCode: session.exitCode,
      createdAt: session.createdAt,
      ...(includeBuffer ? { buffer: session.buffer } : {}),
    };
  }
}
