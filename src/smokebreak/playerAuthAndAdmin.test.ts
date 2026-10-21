// Integration tests for player password auth, RS256 OAuth JWKS verification, account deletion, and admin tagline routes.

import { describe, expect, it } from 'vitest';
import { createSqliteStore, openSqliteDb } from '../../server/sqliteDb.js';
import { handleApiRequest } from '../../server/shiftApi.js';

function makeOffsets(count: number, stepMs = 40): number[] {
  return Array.from({ length: count }, (_, idx) => idx * stepMs);
}

describe('Player Authentication, OAuth, Account Deletion & Admin Taglines API', () => {
  it('registers and authenticates Callsign + Password across devices via POST /api/v1/auth/login while keeping both devices active and blocking callsign hijacking', async () => {
    const db = openSqliteDb(':memory:');
    try {
      const store = createSqliteStore(db);

      // Device A starts as a guest and smokes 5 cigarettes (unlocking 'restaurant')
      const { body: guestA } = await handleApiRequest(
        { method: 'POST', pathname: '/api/v1/players', rawBody: JSON.stringify({ platform: 'web' }) },
        store
      );
      const tokenA = String((guestA as Record<string, unknown>).playerToken);
      const playerIdA = String((guestA as Record<string, unknown>).playerId);

      await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/shifts/finish',
          authHeader: `Bearer ${tokenA}`,
          rawBody: JSON.stringify({
            environmentId: 'alleyway',
            pressOffsetsMs: makeOffsets(60, 100),
          }),
        },
        store
      );

      // Signing in before registering an account fails with 401 (does not auto-register)
      const unregisteredLoginRes = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/auth/login',
          authHeader: `Bearer ${tokenA}`,
          rawBody: JSON.stringify({
            callsign: 'mullet-king',
            password: 'smoke-break-secret',
            mode: 'login',
            platform: 'web',
          }),
        },
        store
      );
      expect(unregisteredLoginRes.status).toBe(401);

      // Device A claims callsign 'MULLET-KING' with password 'smoke-break-secret' via mode: 'register'
      const claimRes = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/auth/login',
          authHeader: `Bearer ${tokenA}`,
          rawBody: JSON.stringify({
            callsign: 'mullet-king',
            password: 'smoke-break-secret',
            mode: 'register',
            platform: 'web',
          }),
        },
        store
      );
      expect(claimRes.status).toBe(200);
      expect(claimRes.body).toMatchObject({
        playerId: playerIdA,
        callsign: 'MULLET-KING',
        lifetimeSmoked: 5,
        unlockedEnvironments: ['alleyway', 'restaurant'],
      });

      // Attempting to register an already-existing account fails with 409
      const duplicateRegRes = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/auth/login',
          rawBody: JSON.stringify({
            callsign: 'MULLET-KING',
            password: 'another-password',
            mode: 'register',
            platform: 'ios',
          }),
        },
        store
      );
      expect(duplicateRegRes.status).toBe(409);

      // Device B (iOS) tries wrong password -> 401
      const wrongPassRes = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/auth/login',
          rawBody: JSON.stringify({
            callsign: 'MULLET-KING',
            password: 'wrong-password',
            platform: 'ios',
          }),
        },
        store
      );
      expect(wrongPassRes.status).toBe(401);

      // Device B (iOS) logs in with correct password -> gets a session token for playerIdA with 5 butts & restaurant unlocked
      const loginBRes = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/auth/login',
          rawBody: JSON.stringify({
            callsign: 'MULLET-KING',
            password: 'smoke-break-secret',
            platform: 'ios',
          }),
        },
        store
      );
      expect(loginBRes.status).toBe(200);
      const bodyB = loginBRes.body as Record<string, unknown>;
      expect(bodyB.playerId).toBe(playerIdA);
      expect(bodyB.callsign).toBe('MULLET-KING');
      expect(bodyB.lifetimeSmoked).toBe(5);
      expect(bodyB.unlockedEnvironments).toEqual(['alleyway', 'restaurant']);
      expect(typeof bodyB.playerToken).toBe('string');
      const tokenB = String(bodyB.playerToken);

      // Both Device A (tokenA) and Device B (tokenB) remain authenticated simultaneously
      const meA = await handleApiRequest(
        { method: 'GET', pathname: '/api/v1/players/me', authHeader: `Bearer ${tokenA}` },
        store
      );
      const meB = await handleApiRequest(
        { method: 'GET', pathname: '/api/v1/players/me', authHeader: `Bearer ${tokenB}` },
        store
      );
      expect(meA.status).toBe(200);
      expect(meB.status).toBe(200);
      expect((meB.body as Record<string, unknown>).playerId).toBe(playerIdA);

      // Another anonymous player (Device C) cannot hijack 'MULLET-KING' via PATCH /api/v1/players/me
      const { body: guestC } = await handleApiRequest(
        { method: 'POST', pathname: '/api/v1/players', rawBody: '{}' },
        store
      );
      const tokenC = String((guestC as Record<string, unknown>).playerToken);
      const hijackRes = await handleApiRequest(
        {
          method: 'PATCH',
          pathname: '/api/v1/players/me',
          authHeader: `Bearer ${tokenC}`,
          rawBody: JSON.stringify({ callsign: 'MULLET-KING' }),
        },
        store
      );
      expect(hijackRes.status).toBe(409);
    } finally {
      db.close();
    }
  });

  it('verifies Apple and Google RS256 ID tokens against JWKS on POST /api/v1/auth/oauth, links accounts across devices, and rejects forged tokens', async () => {
    const db = openSqliteDb(':memory:');
    try {
      const store = createSqliteStore(db);

      // Generate an RS256 keypair to simulate Apple/Google JWKS signing
      const keyPair = await globalThis.crypto.subtle.generateKey(
        {
          name: 'RSASSA-PKCS1-v1_5',
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256',
        },
        true,
        ['sign', 'verify']
      );
      const publicJwk = await globalThis.crypto.subtle.exportKey('jwk', keyPair.publicKey);
      const jwksPayload = {
        keys: [{ ...publicJwk, kid: 'test-key-1', alg: 'RS256', use: 'sig' }],
      };

      const toBase64Url = (input: string | Uint8Array) => {
        const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
        return Buffer.from(bytes)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
      };

      const signJwt = async (claims: Record<string, unknown>, key = keyPair.privateKey) => {
        const header = toBase64Url(JSON.stringify({ alg: 'RS256', kid: 'test-key-1', typ: 'JWT' }));
        const payload = toBase64Url(JSON.stringify(claims));
        const signingInput = `${header}.${payload}`;
        const sig = await globalThis.crypto.subtle.sign(
          'RSASSA-PKCS1-v1_5',
          key,
          new TextEncoder().encode(signingInput)
        );
        return `${signingInput}.${toBase64Url(new Uint8Array(sig))}`;
      };

      const jwksFetch = async () =>
        new Response(JSON.stringify(jwksPayload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });

      const nowUnix = 1760550000;

      // Device A smokes 5 cigarettes as guest, then clicks "Continue with Apple"
      const { body: guestA } = await handleApiRequest(
        { method: 'POST', pathname: '/api/v1/players', rawBody: JSON.stringify({ platform: 'web' }) },
        store,
        { nowUnix }
      );
      const tokenA = String((guestA as Record<string, unknown>).playerToken);
      const playerIdA = String((guestA as Record<string, unknown>).playerId);

      await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/shifts/finish',
          authHeader: `Bearer ${tokenA}`,
          rawBody: JSON.stringify({
            environmentId: 'alleyway',
            pressOffsetsMs: makeOffsets(60, 100),
          }),
        },
        store,
        { nowUnix }
      );

      const appleIdToken = await signJwt({
        iss: 'https://appleid.apple.com',
        sub: 'apple-user-001',
        aud: 'com.idlemullet.smokebreak.web',
        email: 'austin@idlemullet.com',
        exp: nowUnix + 3600,
      });

      const appleLoginA = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/auth/oauth',
          authHeader: `Bearer ${tokenA}`,
          rawBody: JSON.stringify({
            provider: 'apple',
            idToken: appleIdToken,
            platform: 'web',
          }),
        },
        store,
        { nowUnix, jwksFetch }
      );
      expect(appleLoginA.status).toBe(200);
      expect(appleLoginA.body).toMatchObject({
        playerId: playerIdA,
        callsign: 'AUSTIN',
        lifetimeSmoked: 5,
        unlockedEnvironments: ['alleyway', 'restaurant'],
      });

      // Device B (iOS) logs in with the same Apple identity -> receives playerIdA and 5 smoked butts
      const appleLoginB = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/auth/oauth',
          rawBody: JSON.stringify({
            provider: 'apple',
            idToken: appleIdToken,
            platform: 'ios',
          }),
        },
        store,
        { nowUnix, jwksFetch }
      );
      expect(appleLoginB.status).toBe(200);
      const bodyB = appleLoginB.body as Record<string, unknown>;
      expect(bodyB.playerId).toBe(playerIdA);
      expect(bodyB.lifetimeSmoked).toBe(5);
      expect(typeof bodyB.playerToken).toBe('string');

      // Forged signature token -> 401
      const forgedToken = `${appleIdToken.slice(0, -4)}AAAA`;
      const forgedRes = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/auth/oauth',
          rawBody: JSON.stringify({
            provider: 'apple',
            idToken: forgedToken,
            platform: 'ios',
          }),
        },
        store,
        { nowUnix, jwksFetch }
      );
      expect(forgedRes.status).toBe(401);
    } finally {
      db.close();
    }
  });

  it('permanently deletes a player account, linked player_auth identities, and shift_fact leaderboard rows via DELETE /api/v1/players/me', async () => {
    const db = openSqliteDb(':memory:');
    try {
      const store = createSqliteStore(db);

      // Register player, smoke 5 butts, and link password credential
      const { body: created } = await handleApiRequest(
        { method: 'POST', pathname: '/api/v1/players', rawBody: JSON.stringify({ platform: 'web' }) },
        store
      );
      const tokenA = String((created as Record<string, unknown>).playerToken);
      const playerId = String((created as Record<string, unknown>).playerId);

      await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/shifts/finish',
          authHeader: `Bearer ${tokenA}`,
          rawBody: JSON.stringify({
            environmentId: 'alleyway',
            pressOffsetsMs: makeOffsets(60, 100),
          }),
        },
        store
      );

      const loginRes = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/auth/login',
          authHeader: `Bearer ${tokenA}`,
          rawBody: JSON.stringify({
            callsign: 'ASH-KING',
            password: 'delete-me-123',
            mode: 'register',
            platform: 'web',
          }),
        },
        store
      );
      expect(loginRes.status).toBe(200);
      expect((loginRes.body as Record<string, unknown>).authProvider).toBe('password');

      // Second device logs in and gets a session token
      const deviceB = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/auth/login',
          rawBody: JSON.stringify({
            callsign: 'ASH-KING',
            password: 'delete-me-123',
            mode: 'login',
            platform: 'ios',
          }),
        },
        store
      );
      const tokenB = String((deviceB.body as Record<string, unknown>).playerToken);

      // Unauthenticated DELETE -> 401
      const unauthDel = await handleApiRequest(
        { method: 'DELETE', pathname: '/api/v1/players/me' },
        store
      );
      expect(unauthDel.status).toBe(401);

      // Authenticated DELETE -> 200 and purges player_dim, player_auth, and shift_fact
      const delRes = await handleApiRequest(
        {
          method: 'DELETE',
          pathname: '/api/v1/players/me',
          authHeader: `Bearer ${tokenB}`,
        },
        store
      );
      expect(delRes.status).toBe(200);
      expect(delRes.body).toMatchObject({
        deleted: true,
        playerId,
        callsign: 'ASH-KING',
      });
      const lbAfter = (delRes.body as Record<string, unknown>).leaderboard as {
        entries: unknown[];
      };
      expect(lbAfter.entries).toEqual([]);

      // Both tokenA and tokenB are now invalid (401)
      const meAAfter = await handleApiRequest(
        { method: 'GET', pathname: '/api/v1/players/me', authHeader: `Bearer ${tokenA}` },
        store
      );
      const meBAfter = await handleApiRequest(
        { method: 'GET', pathname: '/api/v1/players/me', authHeader: `Bearer ${tokenB}` },
        store
      );
      expect(meAAfter.status).toBe(401);
      expect(meBAfter.status).toBe(401);

      // Database tables have 0 rows for this player
      expect(
        db.prepare('SELECT COUNT(*) AS c FROM player_dim WHERE id = ?').get(playerId)
      ).toEqual({ c: 0 });
      expect(
        db.prepare('SELECT COUNT(*) AS c FROM player_auth WHERE player_id = ?').get(playerId)
      ).toEqual({ c: 0 });
      expect(
        db.prepare('SELECT COUNT(*) AS c FROM shift_fact WHERE player_id = ?').get(playerId)
      ).toEqual({ c: 0 });
    } finally {
      db.close();
    }
  });

  it('serves active taglines on GET /api/v1/taglines and supports Admin CRUD + bulk import on /api/v1/admin/taglines', async () => {
    const db = openSqliteDb(':memory:', { now: new Date('2026-10-16T15:00:00Z') });
    const store = createSqliteStore(db);

    try {
      const publicGet = await handleApiRequest(
        { method: 'GET', pathname: '/api/v1/taglines' },
        store
      );
      expect(publicGet.status).toBe(200);
      expect(publicGet.body.cadence).toBe('60s');
      const initialTaglines = publicGet.body.taglines as Array<{ id: number; jokeText: string; isActive: boolean }>;
      expect(initialTaglines.length).toBe(12);

      const ephemeralPasscode = globalThis.crypto.randomUUID();
      const ephemeralAdminEmail = `operator-${globalThis.crypto.randomUUID().slice(0, 8)}@example.test`;
      const ephemeralWrongSecret = globalThis.crypto.randomUUID();

      // Unauthorized admin request -> 403
      const forbidden = await handleApiRequest(
        { method: 'GET', pathname: '/api/v1/admin/taglines' },
        store,
        { env: { ADMIN_PASSCODE: ephemeralPasscode } }
      );
      expect(forbidden.status).toBe(403);

      // Bulk-import 2 new jokes via newline-separated string
      const bulkAdd = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/admin/taglines',
          adminPasscode: ephemeralPasscode,
          rawBody: JSON.stringify({
            jokeText: '1. the fire marshal already gave up on Sector 03.\n2. your 15-minute break is now entering its fourth fiscal quarter.',
          }),
        },
        store,
        { env: { ADMIN_PASSCODE: ephemeralPasscode } }
      );
      expect(bulkAdd.status).toBe(201);
      expect(bulkAdd.body.addedCount).toBe(2);
      expect((bulkAdd.body.taglines as unknown[]).length).toBe(14);

      // Update cadence to daily
      const patchCadence = await handleApiRequest(
        {
          method: 'PATCH',
          pathname: '/api/v1/admin/taglines',
          adminPasscode: ephemeralPasscode,
          rawBody: JSON.stringify({ cadence: 'daily' }),
        },
        store,
        { env: { ADMIN_PASSCODE: ephemeralPasscode } }
      );
      expect(patchCadence.status).toBe(200);
      expect(patchCadence.body.cadence).toBe('daily');

      // Pause tagline #1 and delete tagline #2
      const pauseOne = await handleApiRequest(
        {
          method: 'PATCH',
          pathname: '/api/v1/admin/taglines',
          adminPasscode: ephemeralPasscode,
          rawBody: JSON.stringify({ id: 1, isActive: false }),
        },
        store,
        { env: { ADMIN_PASSCODE: ephemeralPasscode } }
      );
      expect(pauseOne.status).toBe(200);

      const deleteTwo = await handleApiRequest(
        {
          method: 'DELETE',
          pathname: '/api/v1/admin/taglines',
          adminPasscode: ephemeralPasscode,
          rawBody: JSON.stringify({ id: 2 }),
        },
        store,
        { env: { ADMIN_PASSCODE: ephemeralPasscode } }
      );
      expect(deleteTwo.status).toBe(200);
      expect((deleteTwo.body.taglines as unknown[]).length).toBe(13);

      // Public GET reflects only active taglines (12 active out of 13 remaining) and 'daily' cadence
      const publicAfter = await handleApiRequest(
        { method: 'GET', pathname: '/api/v1/taglines' },
        store
      );
      expect(publicAfter.body.cadence).toBe('daily');
      expect((publicAfter.body.taglines as unknown[]).length).toBe(12);

      // Public registration of an allowlisted admin email is blocked (403)
      const blockedAdminReg = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/auth/login',
          rawBody: JSON.stringify({
            callsign: ephemeralAdminEmail,
            password: ephemeralPasscode,
            mode: 'register',
            platform: 'web',
          }),
        },
        store,
        { env: { ADMIN_EMAILS: ephemeralAdminEmail, ADMIN_PASSCODE: ephemeralPasscode } }
      );
      expect(blockedAdminReg.status).toBe(403);

      // Signing in with an admin email and the wrong password fails with 401
      const wrongAdminPass = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/auth/login',
          rawBody: JSON.stringify({
            callsign: ephemeralAdminEmail,
            password: ephemeralWrongSecret,
            mode: 'login',
            platform: 'web',
          }),
        },
        store,
        { env: { ADMIN_EMAILS: ephemeralAdminEmail, ADMIN_PASSCODE: ephemeralPasscode } }
      );
      expect(wrongAdminPass.status).toBe(401);

      // Signing in via /api/v1/auth/login with an allowlisted admin email + Doppler ADMIN_PASSCODE grants isAdmin and unlocks all sectors/phases
      const adminEnv = { ADMIN_EMAILS: ephemeralAdminEmail, ADMIN_PASSCODE: ephemeralPasscode };
      const adminEmailLogin = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/auth/login',
          rawBody: JSON.stringify({
            callsign: ephemeralAdminEmail,
            password: ephemeralPasscode,
            mode: 'login',
            platform: 'web',
          }),
        },
        store,
        { env: adminEnv }
      );
      expect(adminEmailLogin.status).toBe(200);
      expect(adminEmailLogin.body).toMatchObject({
        isAdmin: true,
        authEmail: ephemeralAdminEmail,
        lifetimeSmoked: 0,
        unlockedPhase: 3,
        promotionRoundsCleared: 9,
        isChairman: true,
        unlockedEnvironments: [
          'alleyway',
          'restaurant',
          'parking-garage',
          'dumpster',
          'office-sidewalk',
          'breakroom-patio',
          'strip-mall-median',
          'designated-gazebo',
          'executive-balcony',
          'concert-side-stage',
          'superyacht-aft-deck',
          'penthouse-helipad',
        ],
      });
      const adminToken = String(adminEmailLogin.body.playerToken);

      // Admin can immediately start and finish a shift in Phase 3 Sector 12 ('penthouse-helipad') with 0 prior butts
      const adminStartShift = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/shifts/start',
          authHeader: `Bearer ${adminToken}`,
          rawBody: JSON.stringify({ environmentId: 'penthouse-helipad', platform: 'web' }),
        },
        store,
        { env: adminEnv }
      );
      expect(adminStartShift.status).toBe(201);
      expect(adminStartShift.body.environmentId).toBe('penthouse-helipad');

      const adminFinishShift = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/shifts/finish',
          authHeader: `Bearer ${adminToken}`,
          rawBody: JSON.stringify({
            shiftId: adminStartShift.body.shiftId,
            environmentId: 'penthouse-helipad',
            pressOffsetsMs: makeOffsets(12, 100),
          }),
        },
        store,
        { env: adminEnv }
      );
      expect(adminFinishShift.status).toBe(200);
      expect(adminFinishShift.body.verified).toBe(true);

      // Admin can immediately host a Smoke Session in 'penthouse-helipad'
      const adminSessionRes = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/sessions',
          authHeader: `Bearer ${adminToken}`,
          rawBody: JSON.stringify({ environmentId: 'penthouse-helipad' }),
        },
        store,
        { env: adminEnv }
      );
      expect(adminSessionRes.status).toBe(201);

      const adminGetViaBearer = await handleApiRequest(
        {
          method: 'GET',
          pathname: '/api/v1/admin/taglines',
          authHeader: `Bearer ${adminToken}`,
        },
        store,
        { env: adminEnv }
      );
      expect(adminGetViaBearer.status).toBe(200);
    } finally {
      db.close();
    }
  });

  it('handles auth/login and admin/taglines in a Cloudflare Worker runtime where globalThis.process is undefined and options.env is {}', async () => {
    const db = openSqliteDb(':memory:');
    const store = createSqliteStore(db);
    const origProcess = globalThis.process;
    try {
      (globalThis as Record<string, unknown>).process = undefined;

      const regRes = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/auth/login',
          rawBody: JSON.stringify({
            callsign: 'test1',
            password: 'password123',
            mode: 'register',
            platform: 'web',
          }),
        },
        store,
        { env: {} }
      );
      expect(regRes.status).toBe(200);

      const emailLoginRes = await handleApiRequest(
        {
          method: 'POST',
          pathname: '/api/v1/auth/login',
          rawBody: JSON.stringify({
            callsign: 'admin@example.com',
            password: 'password123',
            mode: 'login',
            platform: 'web',
          }),
        },
        store,
        { env: { ADMIN_EMAILS: 'admin@example.com' } }
      );
      expect(emailLoginRes.status).toBe(401);

      const adminRes = await handleApiRequest(
        {
          method: 'GET',
          pathname: '/api/v1/admin/taglines',
          adminPasscode: 'wrong',
        },
        store,
        { env: {} }
      );
      expect(adminRes.status).toBe(403);
    } finally {
      globalThis.process = origProcess;
      db.close();
    }
  });
});

