// Display-only list capping. Shared by leaves.js and punch-corrections.js to
// render only the latest N rows of a (possibly filtered) list with an in-place
// "Show all" / "Show less" toggle. Pure + import-free so it is unit-testable
// under Node (see tests/test-list-cap.mjs) and pre-cacheable in the SW.

export const LIST_CAP = 15;

// Decide how many rows to render and whether a toggle control is needed.
// total    — number of rows in the current (filtered) view
// limit    — cap before the fold (LIST_CAP)
// expanded — whether the user has clicked "Show all"
export function capView(total, limit, expanded) {
  const showToggle = total > limit;
  const isExpanded = !!expanded;
  const visible = !showToggle || isExpanded ? total : limit;
  return { visible, showToggle, expanded: isExpanded };
}

// Append a single toggle control to a list container. Label resolution is
// injected (t) so this module stays import-free.
export function appendShowAll(containerEl, { total, expanded, t, onToggle }) {
  const li = document.createElement('li');
  li.className = 'show-all';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'show-all-btn';
  btn.textContent = expanded ? t('list.showLess') : t('list.showAll', { n: total });
  btn.addEventListener('click', onToggle);
  li.appendChild(btn);
  containerEl.appendChild(li);
  return li;
}
