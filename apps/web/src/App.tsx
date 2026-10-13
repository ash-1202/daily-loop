import { useState } from 'react';
import { TabBar, type Tab } from './components/TabBar';
import { TopBar } from './components/TopBar';
import { LeadersScreen } from './screens/LeadersScreen';
import { MeScreen } from './screens/MeScreen';
import { TodayScreen } from './screens/TodayScreen';
import { strings } from './strings';
import { useGame } from './useGame';

export function App() {
  const { state, answer, retry, reload, setDisplayName, requestCode, verifyCode, logout } =
    useGame();
  const [tab, setTab] = useState<Tab>('today');
  const { load, today, me } = state;

  let body;
  if (load.kind === 'loading') {
    body = <p className="screen-body center">{strings.loading}</p>;
  } else if (load.kind === 'error' || !today || !me) {
    body = (
      <div className="screen-body center">
        <p>📶 {load.kind === 'error' && load.offline ? strings.offline : strings.serverError}</p>
        <button type="button" className="primary" onClick={() => void reload()}>
          {strings.retry}
        </button>
      </div>
    );
  } else if (tab === 'leaders') {
    body = <LeadersScreen />;
  } else if (tab === 'me') {
    body = (
      <MeScreen
        me={me}
        onSaveName={setDisplayName}
        onRequestCode={requestCode}
        onVerifyCode={verifyCode}
        onLogout={logout}
      />
    );
  } else {
    body = (
      <TodayScreen
        today={today}
        me={me}
        rewardsByTask={state.rewardsByTask}
        newBadges={state.newBadges}
        submitting={state.submitting}
        submitFailed={state.submitFailed}
        onAnswer={(taskId, option) => {
          const card = today.cards.find((c) => c.taskId === taskId);
          if (card) answer(card, option);
        }}
        onRetry={retry}
        onShowLeaders={() => setTab('leaders')}
        onShowMe={() => setTab('me')}
      />
    );
  }

  return (
    <div className="app">
      <TopBar me={me} />
      <main className="main">{body}</main>
      {load.kind === 'ready' && <TabBar tab={tab} onChange={setTab} />}
    </div>
  );
}
