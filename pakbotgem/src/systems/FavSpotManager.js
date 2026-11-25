const db = require('../core/Database').db;
const movement = require('./MovementManager');
const teleports = require('./TeleportManager');

const VALID_FACINGS = new Set(['FrontRight', 'FrontLeft', 'BackRight', 'BackLeft']);
const MAX_SPOT_NAME_LEN = 32;
const MAX_SPOTS_PER_USER = 25;

class FavSpotManager {
    extractArgText(message) {
        if (!message) return '';
        const raw = message.content ?? message.text ?? message.raw ?? '';
        if (typeof raw === 'string' && raw.trim()) {
            const parts = raw.trim().split(/\s+/);
            return parts.slice(1).join(' ').trim();
        }
        if (typeof message.args === 'function') {
            const tokens = [];
            for (let i = 0; i < 8; i++) {
                const a = message.args(i);
                if (!a || typeof a !== 'string') break;
                tokens.push(a);
            }
            return tokens.join(' ').trim();
        }
        return '';
    }

    normalizeName(rawName) {
        if (typeof rawName !== 'string') return '';
        return rawName.trim().replace(/\s+/g, ' ');
    }

    isValidName(name) {
        if (!name || name.length > MAX_SPOT_NAME_LEN) return false;
        // Allow letters, numbers, spaces, underscores, hyphens
        return /^[A-Za-z0-9 _-]+$/.test(name);
    }

    cleanFacing(facing) {
        return VALID_FACINGS.has(facing) ? facing : 'FrontRight';
    }

    isEnabled(userId) {
        if (!userId) return false;
        const row = db.prepare('SELECT enabled FROM favourite_spot_prefs WHERE user_id = ?').get(userId);
        // Enabled by default once user has an active spot
        return row ? row.enabled === 1 : true;
    }

    setEnabled(userId, enabled) {
        const val = enabled ? 1 : 0;
        db.prepare(`
            INSERT INTO favourite_spot_prefs (user_id, enabled, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
        `).run(userId, val, Date.now());
        return Boolean(val);
    }

    listSpots(userId) {
        if (!userId) return [];
        return db.prepare(`
            SELECT id, user_id, name, x, y, z, facing, is_active, created_at
            FROM favourite_spots
            WHERE user_id = ?
            ORDER BY is_active DESC, name ASC
        `).all(userId);
    }

    getSpot(userId, name) {
        const clean = this.normalizeName(name);
        if (!userId || !clean) return null;
        return db.prepare(`
            SELECT id, user_id, name, x, y, z, facing, is_active, created_at
            FROM favourite_spots
            WHERE user_id = ? AND name = ?
        `).get(userId, clean);
    }

    getActiveSpot(userId) {
        if (!userId) return null;
        return db.prepare(`
            SELECT id, user_id, name, x, y, z, facing, is_active, created_at
            FROM favourite_spots
            WHERE user_id = ? AND is_active = 1
            LIMIT 1
        `).get(userId);
    }

    async captureLivePosition(bot, userId) {
        // Query live SDK position first for exact unrounded current X, Y, Z
        try {
            const pos = await bot.room.users.position(userId);
            if (pos && typeof pos.x === 'number' && typeof pos.y === 'number' && typeof pos.z === 'number') {
                return {
                    x: Number(pos.x),
                    y: Number(pos.y),
                    z: Number(pos.z),
                    facing: this.cleanFacing(pos.facing)
                };
            }
        } catch (_) {}

        // Fallback to cached real-time movement position
        const cached = movement.userPositions.get(userId);
        if (cached && typeof cached.x === 'number' && typeof cached.y === 'number' && typeof cached.z === 'number') {
            return {
                x: Number(cached.x),
                y: Number(cached.y),
                z: Number(cached.z),
                facing: this.cleanFacing(cached.facing)
            };
        }

        return null;
    }

    addSpot(userId, rawName, pos) {
        const name = this.normalizeName(rawName);
        if (!this.isValidName(name)) {
            return { ok: false, error: 'Invalid spot name. Use 1-32 letters, numbers, spaces, _ or -.' };
        }
        if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) {
            return { ok: false, error: 'Could not read a valid 3D position.' };
        }

        const existing = this.getSpot(userId, name);
        if (existing) {
            return { ok: false, error: `You already have a spot named "${existing.name}". Remove it first or pick another name.` };
        }

        const currentCount = db.prepare('SELECT COUNT(*) AS cnt FROM favourite_spots WHERE user_id = ?').get(userId)?.cnt || 0;
        if (currentCount >= MAX_SPOTS_PER_USER) {
            return { ok: false, error: `Maximum of ${MAX_SPOTS_PER_USER} favourite spots reached. Remove one first.` };
        }

        const facing = this.cleanFacing(pos.facing);
        db.prepare(`
            INSERT INTO favourite_spots (user_id, name, x, y, z, facing, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?)
        `).run(userId, name, Number(pos.x), Number(pos.y), Number(pos.z), facing, Date.now());

        return {
            ok: true,
            spot: { name, x: Number(pos.x), y: Number(pos.y), z: Number(pos.z), facing }
        };
    }

    removeSpot(userId, rawName) {
        const name = this.normalizeName(rawName);
        const existing = this.getSpot(userId, name);
        if (!existing) {
            return { ok: false, error: `No favourite spot named "${name}" found.` };
        }
        db.prepare('DELETE FROM favourite_spots WHERE id = ? AND user_id = ?').run(existing.id, userId);
        return { ok: true, removed: existing };
    }

    setActiveSpot(userId, rawName) {
        const name = this.normalizeName(rawName);
        const existing = this.getSpot(userId, name);
        if (!existing) {
            return { ok: false, error: `No favourite spot named "${name}" found.` };
        }

        const activateTx = db.transaction((uid, spotId) => {
            db.prepare('UPDATE favourite_spots SET is_active = 0 WHERE user_id = ?').run(uid);
            db.prepare('UPDATE favourite_spots SET is_active = 1 WHERE id = ? AND user_id = ?').run(spotId, uid);
        });
        activateTx(userId, existing.id);

        return { ok: true, spot: { ...existing, is_active: 1 } };
    }

    async teleportExact(bot, userId, spot) {
        if (!bot || !userId || !spot) return false;
        const x = Number(spot.x);
        const y = Number(spot.y);
        const z = Number(spot.z);
        const facing = this.cleanFacing(spot.facing);

        // 1. Wait for Highrise client avatar spawn & ground physics initialization
        await new Promise(r => setTimeout(r, 1200));

        // 2. Verify player is still in the room and initialized (retry briefly up to 3 times)
        let initialized = false;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const currentPos = await bot.room.users.position(userId);
                if (currentPos && typeof currentPos.x === 'number') {
                    initialized = true;
                    break;
                }
            } catch (_) {
                // Player may have left or still initializing
            }
            await new Promise(r => setTimeout(r, 500));
        }

        if (!initialized) return false;

        // 3. Teleport to the exact unrounded X, Y, Z & facing
        await teleports.teleportUser(bot, userId, { x, y, z, facing }, facing);

        // 4. Anti-floor-clipping verification: verify actual Y matches saved Y after physics settle
        await new Promise(r => setTimeout(r, 600));
        try {
            const settledPos = await bot.room.users.position(userId);
            if (settledPos && typeof settledPos.y === 'number') {
                const yDiff = Math.abs(Number(settledPos.y) - y);
                if (yDiff > 0.25) {
                    // Re-sync with tiny +0.02 vertical lift so avatar rests cleanly on top of the surface
                    await teleports.teleportUser(bot, userId, { x, y: y + 0.02, z, facing }, facing);
                }
            }
        } catch (_) {}

        return true;
    }

    async handleUserJoin(bot, user) {
        try {
            if (!user?.id || user.id === bot.metadata?.botId) return;
            if (!this.isEnabled(user.id)) return;
            const activeSpot = this.getActiveSpot(user.id);
            if (!activeSpot) return;

            await this.teleportExact(bot, user.id, activeSpot);
        } catch (err) {
            console.warn(`⚠️ [FavSpot] Failed join teleport for ${user?.username}: ${err.message}`);
        }
    }
}

module.exports = new FavSpotManager();
