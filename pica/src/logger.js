import util from 'node:util';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function format(args) {
  return args
    .map((a) => (typeof a === 'string' ? a : util.inspect(a, { depth: 4, breakLength: 120 })))
    .join(' ');
}

export function createLogger(level = 'info') {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function emit(lvl, args) {
    if (LEVELS[lvl] < threshold) return;
    const ts = new Date().toISOString();
    const tag = lvl.toUpperCase().padEnd(5);
    const line = `${ts} ${tag} ${format(args)}\n`;
    const stream = lvl === 'error' || lvl === 'warn' ? process.stderr : process.stdout;
    stream.write(line);
  }

  return {
    debug: (...a) => emit('debug', a),
    info:  (...a) => emit('info',  a),
    warn:  (...a) => emit('warn',  a),
    error: (...a) => emit('error', a),
  };
}
