import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  istDate,
  type Badge,
  type Card,
  type MeResponse,
  type Reward,
  type SubmitRequest,
  type TodayResponse,
} from '@daily-loop/shared';
import { api } from './api';
import { getDeviceToken, randomId } from './device';

export type LoadState =
  { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; offline: boolean };

export interface GameState {
  load: LoadState;
  today: TodayResponse | null;
  me: MeResponse | null;
  /** Rewards earned per card in this visit, to show "+10" on the result. */
  rewardsByTask: Record<string, Reward[]>;
  /** Badges earned in this visit, to celebrate on the Done screen. */
  newBadges: Badge[];
  /** An answer that failed to send. Retrying reuses its idempotency key, so it can't count twice. */
  pending: SubmitRequest | null;
  submitting: boolean;
  submitFailed: boolean;
}

const isOffline = (err: unknown) => !(err instanceof ApiError) || err.status >= 500;

/**
 * All game state and actions for the web app. Screens stay simple: they read state and call
 * `answer`, `retry`, `reload` or `setDisplayName`.
 */
export function useGame() {
  const [state, setState] = useState<GameState>({
    load: { kind: 'loading' },
    today: null,
    me: null,
    rewardsByTask: {},
    newBadges: [],
    pending: null,
    submitting: false,
    submitFailed: false,
  });
  // Latest state for event handlers, without re-creating them on every render.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  /** Starts (or restores) the guest session, then loads today's cards and the user's progress. */
  const reload = useCallback(async () => {
    try {
      await api.createSession({ deviceToken: getDeviceToken() });
      const [today, me] = await Promise.all([api.today(), api.me()]);
      setState((s) => ({
        ...s,
        load: { kind: 'ready' },
        today,
        me,
        pending: null,
        submitFailed: false,
      }));
    } catch (err) {
      setState((s) => ({ ...s, load: { kind: 'error', offline: isOffline(err) } }));
    }
  }, []);

  const send = useCallback(
    async (body: SubmitRequest) => {
      setState((s) => ({ ...s, pending: body, submitting: true, submitFailed: false }));
      try {
        const res = await api.submit(body);
        setState((s) => {
          if (!s.today || !s.me) return s;
          const earned = new Set(res.newBadges.map((b) => b.id));
          return {
            ...s,
            today: {
              ...s.today,
              cards: s.today.cards.map((c) => (c.taskId === res.card.taskId ? res.card : c)),
              progress: res.progress,
              completed: res.completed,
            },
            me: {
              ...s.me,
              points: res.totalPoints,
              streak: res.streak,
              badges: s.me.badges.map((b) =>
                earned.has(b.id) ? res.newBadges.find((n) => n.id === b.id)! : b,
              ),
            },
            rewardsByTask: { ...s.rewardsByTask, [res.card.taskId]: res.rewards },
            newBadges: [...s.newBadges, ...res.newBadges],
            pending: null,
            submitting: false,
          };
        });
      } catch (err) {
        if (isOffline(err)) {
          // Keep `pending` so the user can retry with the same idempotency key.
          setState((s) => ({ ...s, submitting: false, submitFailed: true }));
        } else {
          // e.g. already answered on another device, or the day just ended: reload the truth.
          setState((s) => ({ ...s, submitting: false, pending: null }));
          await reload();
        }
      }
    },
    [reload],
  );

  const answer = useCallback(
    (card: Card, option: string) => {
      const { today, submitting } = stateRef.current;
      if (!today || submitting || card.result) return;
      void send({
        challengeDate: today.date,
        taskId: card.taskId,
        answer: option,
        idempotencyKey: randomId(),
      });
    },
    [send],
  );

  const retry = useCallback(() => {
    const { pending } = stateRef.current;
    if (pending) void send(pending);
  }, [send]);

  const setDisplayName = useCallback(async (displayName: string) => {
    const me = await api.updateMe({ displayName });
    setState((s) => ({ ...s, me }));
  }, []);

  // First load.
  useEffect(() => {
    void reload();
  }, [reload]);

  // When the app comes back to the foreground on a new IST day, load the new challenge.
  useEffect(() => {
    const onVisible = () => {
      const { today } = stateRef.current;
      if (document.visibilityState === 'visible' && today && istDate(new Date()) !== today.date) {
        void reload();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  return { state, answer, retry, reload, setDisplayName };
}
