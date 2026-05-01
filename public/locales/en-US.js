// Pica — English (US) translations.
//
// Keys are namespaced by feature/page. The {param} placeholder syntax
// matches the i18n.js interpolation. Keep translations short and
// stable; if a string changes meaningfully, add a new key rather than
// silently changing the existing one (callers may have context-specific
// expectations that the new wording would break).

export default {
  // ---- App-shell chrome -----------------------------------------------
  'app.suffix': 'Time management',

  // ---- Navigation labels ----------------------------------------------
  'nav.employees':   'Employees',
  'nav.calendar':    'Calendar',
  'nav.leaves':      'Leaves',
  'nav.corrections': 'Corrections',
  'nav.punches':     'Punches',
  'nav.reports':     'Reports',
  'nav.settings':    'Settings',

  // ---- Avatar menu ----------------------------------------------------
  'menu.profile':     'View my profile',
  'menu.preferences': 'Preferences',
  'menu.signOut':     'Sign out',

  // ---- Dashboard (/) --------------------------------------------------
  'dashboard.welcome':   'Welcome to {name}',
  'dashboard.signedIn':  'Signed in as {name} ({role}). Use the top menu to navigate.',
  'dashboard.dashboardTitle': 'Dashboard',
  'dashboard.dashboardBody':  "This space will be filled with at-a-glance widgets in a future milestone — today's punches, pending leaves, upcoming time-off, and company KPIs. For now, pick a section from the top menu.",

  'dashboard.card.employees.title':   'Employees',
  'dashboard.card.employees.desc':    'Manage the team',
  'dashboard.card.calendar.title':    'Calendar',
  'dashboard.card.calendar.desc':     'Who is on approved leave',
  'dashboard.card.leaves.title':      'Leaves',
  'dashboard.card.leaves.desc':       'Approve and review requests',
  'dashboard.card.leavesEmployee.desc':  'Your leaves and balances',
  'dashboard.card.corrections.title': 'Corrections',
  'dashboard.card.correctionsEmployer.desc': 'Approve manual time entries',
  'dashboard.card.correctionsEmployee.desc': 'Manual time entries and bank',
  'dashboard.card.punches.title':     'Punches',
  'dashboard.card.punches.desc':      'Clock in / out and see today',
  'dashboard.card.reports.title':     'Reports',
  'dashboard.card.reportsEmployer.desc': 'Hours and leaves across the team',
  'dashboard.card.reportsEmployee.desc': 'Your hours and time-off',
  'dashboard.card.settings.title':    'Settings',
  'dashboard.card.settings.desc':     'Company, organization, backups',

  // ---- Footer ---------------------------------------------------------
  'footer.releaseDateUnknown': 'release date unknown',

  // ---- Login page -----------------------------------------------------
  'login.title':       'Sign in',
  'login.username':    'Username',
  'login.password':    'Password',
  'login.submit':      'Sign in',
  'login.signingIn':   'Signing in…',
  'login.invalid':     'Invalid username or password',

  // ---- Preferences page -----------------------------------------------
  'prefs.title':         'Preferences',
  'prefs.subtitle':      'These settings apply just to you.',
  'prefs.language':      'Language',
  'prefs.languageHint':  'The page will reload after saving so the new language takes effect everywhere.',
  'prefs.colorMode':     'Color mode',
  'prefs.colorModeSystem': 'Match system',
  'prefs.colorModeLight':  'Light',
  'prefs.colorModeDark':   'Dark',
  'prefs.save':          'Save preferences',
  'prefs.saving':        'Saving…',
  'prefs.saved':         'Preferences saved.',
};
