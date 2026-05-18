/**
 * src/mail/templates.js — server-side email copy for M14 notifications.
 *
 * i18n.js is browser-only (absolute-path imports, not importable in Node),
 * so email copy lives here independently.  Plain text only; no HTML.
 *
 * Supported categories and their var shapes:
 *
 *   leaveDecision
 *     { status, type, start, end, unit }
 *     status : 'approved' | 'rejected'
 *     type   : 'vacation' | 'sick' | 'appointment' | 'other'
 *     start  : YYYY-MM-DD (days) or ISO timestamp (hours)
 *     end    : same format as start
 *     unit   : 'days' | 'hours'
 *
 *   correctionDecision
 *     { status, date }
 *     status : 'approved' | 'rejected'
 *     date   : YYYY-MM-DD of the corrected day
 *
 *   leaveReminder
 *     { type, start, end, unit }
 *     Same date/unit semantics as leaveDecision; fires ~24 h before leave.
 *
 *   passwordResetNotice
 *     {} — no vars; purely informational.
 *     Must NOT include any token, link, or new password value.
 *
 * Any interpolated scalar is sanitised with s() before use: CR/LF
 * collapsed to a space, trimmed.  This is defence-in-depth; smtp.js
 * also strips headers.  Missing vars render as '' (never 'undefined').
 */

// ---------------------------------------------------------------------------
// Sanitiser — collapse CR/LF in any interpolated value.
// Applied to every variable before it enters a template literal.
// ---------------------------------------------------------------------------

function s(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[\r\n]+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Template map
// ---------------------------------------------------------------------------

const T = {

  // --------------------------------------------------------------------------
  leaveDecision: {
    'en-US': ({ status, type, start, end, unit } = {}) => {
      const st = s(status) || 'decided';
      const ty = s(type)   || 'leave';
      const s1 = s(start)  || '';
      const s2 = s(end)    || '';
      const un = s(unit)   || 'days';
      return {
        subject: `Your ${ty} request was ${st}`,
        text:
          `Your ${ty} request has been ${st}.\n\n` +
          `Period: ${s1} to ${s2} (${un})\n\n` +
          `If you have questions, contact your employer directly.`,
      };
    },
    'pt-PT': ({ status, type, start, end, unit } = {}) => {
      // Map status and type to pt-PT terminology used throughout the app.
      const statusMap = { approved: 'aprovado', rejected: 'rejeitado' };
      const typeMap   = {
        vacation:    'férias',
        sick:        'doença',
        appointment: 'consulta',
        other:       'ausência',
      };
      const st = statusMap[s(status)] || s(status) || 'decidido';
      const ty = typeMap[s(type)]     || s(type)   || 'ausência';
      const s1 = s(start) || '';
      const s2 = s(end)   || '';
      const un = s(unit) === 'hours' ? 'horas' : 'dias';
      return {
        subject: `O seu pedido de ${ty} foi ${st}`,
        text:
          `O seu pedido de ${ty} foi ${st}.\n\n` +
          `Período: ${s1} a ${s2} (${un})\n\n` +
          `Em caso de dúvidas, contacte diretamente a sua entidade empregadora.`,
      };
    },
  },

  // --------------------------------------------------------------------------
  correctionDecision: {
    'en-US': ({ status, date } = {}) => {
      const st = s(status) || 'decided';
      const dt = s(date)   || '';
      return {
        subject: `Your time correction was ${st}`,
        text:
          `Your time correction request for ${dt} has been ${st}.\n\n` +
          `If you have questions, contact your employer directly.`,
      };
    },
    'pt-PT': ({ status, date } = {}) => {
      const statusMap = { approved: 'aprovada', rejected: 'rejeitada' };
      const st = statusMap[s(status)] || s(status) || 'decidida';
      const dt = s(date) || '';
      return {
        subject: `A sua correção de tempo foi ${st}`,
        text:
          `O seu pedido de correção de tempo para ${dt} foi ${st}.\n\n` +
          `Em caso de dúvidas, contacte diretamente a sua entidade empregadora.`,
      };
    },
  },

  // --------------------------------------------------------------------------
  leaveReminder: {
    'en-US': ({ type, start, end, unit } = {}) => {
      const ty = s(type)  || 'leave';
      const s1 = s(start) || '';
      const s2 = s(end)   || '';
      const un = s(unit)  || 'days';
      return {
        subject: `Reminder: your ${ty} starts tomorrow`,
        text:
          `This is a reminder that your ${ty} is scheduled to start tomorrow.\n\n` +
          `Period: ${s1} to ${s2} (${un})`,
      };
    },
    'pt-PT': ({ type, start, end, unit } = {}) => {
      const typeMap = {
        vacation:    'férias',
        sick:        'doença',
        appointment: 'consulta',
        other:       'ausência',
      };
      const ty = typeMap[s(type)] || s(type) || 'ausência';
      const s1 = s(start) || '';
      const s2 = s(end)   || '';
      const un = s(unit) === 'hours' ? 'horas' : 'dias';
      return {
        subject: `Lembrete: o seu pedido de ${ty} começa amanhã`,
        text:
          `Este é um lembrete de que o seu pedido de ${ty} começa amanhã.\n\n` +
          `Período: ${s1} a ${s2} (${un})`,
      };
    },
  },

  // --------------------------------------------------------------------------
  // No vars; a fixed probe message confirming SMTP delivery works.
  // Used exclusively by POST /api/mail/test (Task 8) — not a user-facing
  // notification, so it carries no personal or account-specific content.
  testEmail: {
    'en-US': () => ({
      subject: 'Pica email configuration test',
      text:
        'This message confirms that Pica can reach your SMTP server.\n\n' +
        'If you received it, your email configuration is working correctly.',
    }),
    'pt-PT': () => ({
      subject: 'Teste de configuração de correio eletrónico do Pica',
      text:
        'Esta mensagem confirma que o Pica consegue comunicar com o seu servidor SMTP.\n\n' +
        'Se a recebeu, a configuração de correio eletrónico está a funcionar corretamente.',
    }),
  },

  // --------------------------------------------------------------------------
  // No vars; purely informational.  No token, no link, no new password.
  passwordResetNotice: {
    'en-US': () => ({
      subject: 'Your account password has been reset',
      text:
        'An administrator has reset your account password.\n\n' +
        'You will be required to set a new password the next time you sign in to Pica.\n\n' +
        'If you did not expect this, contact your employer.',
    }),
    'pt-PT': () => ({
      subject: 'A sua palavra-passe foi redefinida',
      text:
        'Um administrador redefiniu a sua palavra-passe.\n\n' +
        'Ser-lhe-á pedido que defina uma nova palavra-passe no próximo início de sessão no Pica.\n\n' +
        'Se não estava à espera disto, contacte a sua entidade empregadora.',
    }),
  },

};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * renderEmail(category, locale, vars) → { subject, text }
 *
 * - Unknown category → throws Error('unknown email category <category>')
 * - Unknown locale   → falls back to 'en-US' (no throw)
 * - vars             → defaults to {} when absent/undefined
 */
export function renderEmail(category, locale, vars) {
  const c = T[category];
  if (!c) throw new Error('unknown email category ' + category);
  const fn = c[locale] || c['en-US'];
  return fn(vars || {});
}
