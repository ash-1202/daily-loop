import { strings } from '../strings';

export type Tab = 'today' | 'leaders' | 'me';

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'today', icon: '📝', label: strings.tabToday },
  { id: 'leaders', icon: '🏆', label: strings.tabLeaders },
  { id: 'me', icon: '👤', label: strings.tabMe },
];

export function TabBar({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav className="tabbar">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`tab${tab === t.id ? ' tab--active' : ''}`}
          aria-current={tab === t.id ? 'page' : undefined}
          onClick={() => onChange(t.id)}
        >
          <span className="tab__icon" aria-hidden="true">
            {t.icon}
          </span>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
