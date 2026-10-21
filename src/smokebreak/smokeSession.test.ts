// Unit and integration tests for 2-digit code Smoke Sessions, 3-2-1 countdown clock start, and ranked session scoreboards.

import { describe, expect, it } from 'vitest';
import { handleApiRequest } from '../../server/shiftApi.js';
import { verifyShiftReplay } from '../../server/shiftVerifier.js';
import { createSqliteStore, openSqliteDb } from '../../server/sqliteDb.js';
import { resetShiftClientStateForTests, setStoredToken, type FetchLike } from './shiftStorage';
import {
  createSmokeSession,
  fetchSmokeSession,
  joinSmokeSessionByCode,
  startSmokeSessionById,
} from './smokeSessionClient';
import { freshShiftSession, recordShiftDrag, remainingMs } from './smokeBreak';

async function createTestPlayer(
  store: ReturnType<typeof createSqliteStore>,
  callsign: string,
  nowUnix = 1_700_000_000
) {
  const createRes = await handleApiRequest(
    {
      method: 'POST',
      pathname: '/api/v1/players',
      rawBody: JSON.stringify({ callsign, platform: 'web' }),
      clientIp: `10.0.0.${Math.floor(Math.random() * 200) + 1}`,
    },
    store,
    { nowUnix }
  );
  expect(createRes.status).toBe(201);
  return {
    playerId: String(createRes.body.playerId),
    callsign: String(createRes.body.callsign),
    token: String(createRes.body.playerToken),
  };
}

describe('Smoke Session 2-digit room code flow & 3-2-1 countdown clock', () => {
  it('starts the 15-second break clock automatically after the 3-2-1 countdown and replays cleanly', () => {
    let session = freshShiftSession();
    const countdownEndMs = 3_000;

    session = recordShiftDrag(session, { type: 'start_clock', now: countdownEndMs });
    expect(session.state.startedAt).toBe(countdownEndMs);
    expect(session.pressOffsetsMs).toEqual([]);
    expect(remainingMs(session.state, countdownEndMs + 5_000)).toBe(10_000);

    // 24 drags spaced 100ms apart starting 250ms after countdown finishes -> 2 cigarettes smoked
    for (let i = 0; i < 24; i++) {
      session = recordShiftDrag(session, countdownEndMs + 250 + i * 100);
    }
    expect(session.state.smoked).toBe(2);
    expect(session.pressOffsetsMs).toHaveLength(24);
    expect(session.pressOffsetsMs[0]).toBe(250);

    const replay = verifyShiftReplay(session.pressOffsetsMs);
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.smoked).toBe(2);
      expect(replay.tapCount).toBe(24);
    }
  });

  it('creates a 2-digit code Smoke Session, lets coworkers join by code, enforces host-only start, and ranks the scoreboard on finish', async () => {
    const db = openSqliteDb(':memory:');
    const store = createSqliteStore(db);
    const nowUnix = 1_700_000_000;

    const host = await createTestPlayer(store, 'HOST-01', nowUnix);
    const peerA = await createTestPlayer(store, 'CREW-02', nowUnix);
    const peerB = await createTestPlayer(store, 'CREW-03', nowUnix);

    // 1. Host creates a Smoke Session
    const createSessionRes = await handleApiRequest(
      {
        method: 'POST',
        pathname: '/api/v1/sessions',
        authHeader: `Bearer ${host.token}`,
        rawBody: JSON.stringify({ environmentId: 'alleyway' }),
      },
      store,
      { nowUnix }
    );
    expect(createSessionRes.status).toBe(201);
    const createdSession = createSessionRes.body.session as Record<string, unknown>;
    const sessionId = String(createdSession.sessionId);
    const code = String(createdSession.code);
    expect(code).toMatch(/^\d{2}$/);
    expect(createdSession.status).toBe('waiting');
    expect((createdSession.participants as unknown[]).length).toBe(1);

    // 2. Reject invalid or unknown 2-digit codes
    const badFormatRes = await handleApiRequest(
      {
        method: 'POST',
        pathname: '/api/v1/sessions/join',
        authHeader: `Bearer ${peerA.token}`,
        rawBody: JSON.stringify({ code: '7' }),
      },
      store,
      { nowUnix }
    );
    expect(badFormatRes.status).toBe(400);

    const unknownCode = code === '99' ? '98' : '99';
    const notFoundRes = await handleApiRequest(
      {
        method: 'POST',
        pathname: '/api/v1/sessions/join',
        authHeader: `Bearer ${peerA.token}`,
        rawBody: JSON.stringify({ code: unknownCode }),
      },
      store,
      { nowUnix }
    );
    expect(notFoundRes.status).toBe(404);

    // 3. Peer A and Peer B join with the 2-digit code
    const joinARes = await handleApiRequest(
      {
        method: 'POST',
        pathname: '/api/v1/sessions/join',
        authHeader: `Bearer ${peerA.token}`,
        rawBody: JSON.stringify({ code }),
      },
      store,
      { nowUnix: nowUnix + 2 }
    );
    expect(joinARes.status).toBe(200);

    const joinBRes = await handleApiRequest(
      {
        method: 'POST',
        pathname: '/api/v1/sessions/join',
        authHeader: `Bearer ${peerB.token}`,
        rawBody: JSON.stringify({ code }),
      },
      store,
      { nowUnix: nowUnix + 3 }
    );
    expect(joinBRes.status).toBe(200);
    const waitingSession = joinBRes.body.session as {
      participants: Array<{ callsign: string; isHost: boolean }>;
    };
    expect(waitingSession.participants.map(p => p.callsign)).toEqual([
      'HOST-01',
      'CREW-02',
      'CREW-03',
    ]);

    // 4. Non-host cannot start the Smoke Session
    const nonHostStartRes = await handleApiRequest(
      {
        method: 'POST',
        pathname: `/api/v1/sessions/${sessionId}/start`,
        authHeader: `Bearer ${peerA.token}`,
        rawBody: JSON.stringify({}),
      },
      store,
      { nowUnix: nowUnix + 5 }
    );
    expect(nonHostStartRes.status).toBe(403);

    // 5. Host starts the Smoke Session
    const hostStartRes = await handleApiRequest(
      {
        method: 'POST',
        pathname: `/api/v1/sessions/${sessionId}/start`,
        authHeader: `Bearer ${host.token}`,
        rawBody: JSON.stringify({}),
      },
      store,
      { nowUnix: nowUnix + 6 }
    );
    expect(hostStartRes.status).toBe(200);
    expect((hostStartRes.body.session as { status: string }).status).toBe('active');

    // Latecomer cannot join after session started
    const outsider = await createTestPlayer(store, 'LATE-04', nowUnix);
    const lateJoinRes = await handleApiRequest(
      {
        method: 'POST',
        pathname: '/api/v1/sessions/join',
        authHeader: `Bearer ${outsider.token}`,
        rawBody: JSON.stringify({ code }),
      },
      store,
      { nowUnix: nowUnix + 7 }
    );
    expect(lateJoinRes.status).toBe(400);

    // 6. All 3 players finish their 15s shifts with different drag counts
    const makeOffsets = (count: number) => Array.from({ length: count }, (_, i) => i * 40);

    // Host smokes 2 cigarettes (26 drags)
    const finishHost = await handleApiRequest(
      {
        method: 'POST',
        pathname: '/api/v1/shifts/finish',
        authHeader: `Bearer ${host.token}`,
        rawBody: JSON.stringify({
          environmentId: 'alleyway',
          sessionId,
          pressOffsetsMs: makeOffsets(26),
        }),
      },
      store,
      { nowUnix: nowUnix + 22 }
    );
    expect(finishHost.status).toBe(200);
    expect((finishHost.body.smokeSession as { status: string }).status).toBe('active');

    // Peer A smokes 4 cigarettes (48 drags) -> Winner!
    const finishPeerA = await handleApiRequest(
      {
        method: 'POST',
        pathname: '/api/v1/shifts/finish',
        authHeader: `Bearer ${peerA.token}`,
        rawBody: JSON.stringify({
          environmentId: 'alleyway',
          sessionId,
          pressOffsetsMs: makeOffsets(48),
        }),
      },
      store,
      { nowUnix: nowUnix + 23 }
    );
    expect(finishPeerA.status).toBe(200);

    // Peer B smokes 2 cigarettes (30 drags) -> Beats Host on drag count tie-breaker!
    const finishPeerB = await handleApiRequest(
      {
        method: 'POST',
        pathname: '/api/v1/shifts/finish',
        authHeader: `Bearer ${peerB.token}`,
        rawBody: JSON.stringify({
          environmentId: 'alleyway',
          sessionId,
          pressOffsetsMs: makeOffsets(30),
        }),
      },
      store,
      { nowUnix: nowUnix + 24 }
    );
    expect(finishPeerB.status).toBe(200);

    const finalSession = finishPeerB.body.smokeSession as {
      status: string;
      participants: Array<{
        rank: number;
        callsign: string;
        smoked: number;
        tapCount: number;
        finished: boolean;
      }>;
    };
    expect(finalSession.status).toBe('completed');
    expect(
      finalSession.participants.map(p => ({
        rank: p.rank,
        callsign: p.callsign,
        smoked: p.smoked,
        tapCount: p.tapCount,
        finished: p.finished,
      }))
    ).toEqual([
      { rank: 1, callsign: 'CREW-02', smoked: 4, tapCount: 48, finished: true },
      { rank: 2, callsign: 'CREW-03', smoked: 2, tapCount: 30, finished: true },
      { rank: 3, callsign: 'HOST-01', smoked: 2, tapCount: 26, finished: true },
    ]);

    db.close();
  });

  it('exercises smokeSessionClient create, join, poll, and start helpers', async () => {
    resetShiftClientStateForTests();
    const db = openSqliteDb(':memory:');
    const store = createSqliteStore(db);
    const nowUnix = 1_700_000_500;
    const host = await createTestPlayer(store, 'HOST-99', nowUnix);
    const peer = await createTestPlayer(store, 'PEER-88', nowUnix);

    const fetchApi: FetchLike = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      const pathname = url.startsWith('http') ? new URL(url).pathname : url;
      const headers = new Headers(init?.headers);
      const result = await handleApiRequest(
        {
          method: init?.method ?? 'GET',
          pathname,
          authHeader: headers.get('Authorization'),
          rawBody: typeof init?.body === 'string' ? init.body : undefined,
        },
        store,
        { nowUnix }
      );
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    setStoredToken(host.token);
    const created = await createSmokeSession('alleyway', fetchApi);
    expect(created.code).toMatch(/^\d{2}$/);
    expect(created.status).toBe('waiting');

    setStoredToken(peer.token);
    const joined = await joinSmokeSessionByCode(created.code, fetchApi);
    expect(joined.participants).toHaveLength(2);

    setStoredToken(host.token);
    const polled = await fetchSmokeSession(created.sessionId, fetchApi);
    expect(polled?.participants.map(p => p.callsign)).toEqual(['HOST-99', 'PEER-88']);

    const started = await startSmokeSessionById(created.sessionId, fetchApi);
    expect(started.status).toBe('active');

    resetShiftClientStateForTests();
    db.close();
  });
});
