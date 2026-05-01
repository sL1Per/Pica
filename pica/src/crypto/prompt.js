import readline from 'node:readline';

/**
 * Read a passphrase from stdin without echoing it.
 *
 * On a TTY: enters raw mode, accepts characters one at a time, handles
 * backspace and Ctrl-C/Ctrl-D, finishes on Enter.
 *
 * On a non-TTY (piped stdin, no terminal): reads a line normally. Echo
 * suppression isn't meaningful without a terminal, so we don't try.
 */
export function readPassphrase(prompt = 'Passphrase: ') {
  if (process.stdin.isTTY) {
    return readPassphraseTTY(prompt);
  }
  return readPassphraseLine(prompt);
}

function readPassphraseTTY(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    stdout.write(prompt);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let buffer = '';

    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
    };

    const onData = (chunk) => {
      // A single 'data' event may contain multiple characters (paste,
      // escape sequences). Iterate so we don't miss any.
      for (const ch of chunk) {
        switch (ch) {
          case '\u0003': // Ctrl-C
            cleanup();
            stdout.write('\n');
            reject(new Error('Cancelled'));
            return;
          case '\u0004': // Ctrl-D (EOF)
            cleanup();
            stdout.write('\n');
            if (buffer.length === 0) {
              reject(new Error('EOF on empty input'));
            } else {
              resolve(buffer);
            }
            return;
          case '\r':
          case '\n':
            cleanup();
            stdout.write('\n');
            resolve(buffer);
            return;
          case '\u007f': // Backspace (DEL)
          case '\b':
            buffer = buffer.slice(0, -1);
            break;
          default:
            // Ignore other control characters (arrow keys etc. emit escape seqs).
            if (ch >= ' ') buffer += ch;
        }
      }
    };

    stdin.on('data', onData);
  });
}

function readPassphraseLine(prompt) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
    rl.on('close', () => {
      // Covers the case where stdin EOFs without a line.
      reject(new Error('Input closed'));
    });
  });
}
