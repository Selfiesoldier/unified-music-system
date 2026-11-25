const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');

class BotDatabase {
    constructor() {
        const dataDir = path.dirname(config.dbPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        this.db = new Database(config.dbPath);
        this.db.pragma('journal_mode = WAL'); // Blazing fast concurrency & safety
        this.initSchema();
    }

    initSchema() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                username TEXT NOT NULL,
                coins INTEGER DEFAULT 0,
                bank_coins INTEGER DEFAULT 0,
                active_title TEXT DEFAULT NULL,
                xp INTEGER DEFAULT 0,
                level INTEGER DEFAULT 1,
                streak INTEGER DEFAULT 0,
                last_daily INTEGER DEFAULT 0,
                created_at INTEGER,
                updated_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS inventory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                item_id TEXT NOT NULL,
                item_type TEXT NOT NULL,
                item_name TEXT NOT NULL,
                purchased_at INTEGER,
                UNIQUE(user_id, item_id)
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_id TEXT NOT NULL,
                to_id TEXT,
                type TEXT NOT NULL,
                amount INTEGER NOT NULL,
                details TEXT,
                created_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS vips (
                user_id TEXT PRIMARY KEY,
                tier TEXT DEFAULT 'vip',
                expires_at INTEGER,
                granted_by TEXT,
                created_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS teleports (
                name TEXT PRIMARY KEY COLLATE NOCASE,
                x REAL NOT NULL,
                y REAL NOT NULL,
                z REAL NOT NULL,
                created_by TEXT,
                created_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS protected_users (
                user_id TEXT PRIMARY KEY,
                username TEXT,
                protected_by TEXT,
                created_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS configured_rooms (
                name TEXT PRIMARY KEY COLLATE NOCASE,
                room_id TEXT NOT NULL,
                added_by TEXT,
                created_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS favourite_spots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL COLLATE NOCASE,
                x REAL NOT NULL,
                y REAL NOT NULL,
                z REAL NOT NULL,
                facing TEXT DEFAULT 'FrontRight',
                is_active INTEGER DEFAULT 0,
                created_at INTEGER,
                UNIQUE(user_id, name)
            );

            CREATE TABLE IF NOT EXISTS favourite_spot_prefs (
                user_id TEXT PRIMARY KEY,
                enabled INTEGER DEFAULT 1,
                updated_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS portals (
                name TEXT PRIMARY KEY COLLATE NOCASE,
                src_x REAL NOT NULL,
                src_z REAL NOT NULL,
                radius REAL DEFAULT 1.0,
                dest_name TEXT NOT NULL,
                created_by TEXT,
                created_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS dance_floors (
                name TEXT PRIMARY KEY COLLATE NOCASE,
                x1 REAL NOT NULL,
                z1 REAL NOT NULL,
                x2 REAL NOT NULL,
                z2 REAL NOT NULL,
                y REAL DEFAULT 0,
                emote_id TEXT DEFAULT 'dance-macarena',
                emotes TEXT DEFAULT '[]',
                points TEXT DEFAULT '[]',
                is_active INTEGER DEFAULT 1,
                created_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS outfit_presets (
                name TEXT PRIMARY KEY COLLATE NOCASE,
                outfit TEXT NOT NULL,
                created_by TEXT,
                created_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS scenes (
                name TEXT PRIMARY KEY COLLATE NOCASE,
                data TEXT NOT NULL,
                created_by TEXT,
                created_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS stats (
                user_id TEXT PRIMARY KEY,
                messages_sent INTEGER DEFAULT 0,
                emotes_played INTEGER DEFAULT 0,
                games_won INTEGER DEFAULT 0,
                tips_given INTEGER DEFAULT 0,
                tips_received INTEGER DEFAULT 0,
                first_seen INTEGER,
                last_seen INTEGER
            );

            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER,
                category TEXT,
                actor_id TEXT,
                actor_name TEXT,
                action TEXT,
                details TEXT
            );

            CREATE TABLE IF NOT EXISTS broadcasts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message TEXT NOT NULL,
                enabled INTEGER DEFAULT 1,
                created_by TEXT,
                created_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS bot_owners (
                user_id TEXT,
                username TEXT PRIMARY KEY COLLATE NOCASE,
                added_by TEXT,
                added_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS profiles (
                user_id TEXT PRIMARY KEY,
                username TEXT NOT NULL COLLATE NOCASE,
                conversation_id TEXT NOT NULL,
                registered_at INTEGER NOT NULL,
                last_dm_at INTEGER NOT NULL,
                invites_sent INTEGER DEFAULT 0,
                custom_intro TEXT DEFAULT NULL
            );

            CREATE TABLE IF NOT EXISTS user_auto_emotes (
                user_id TEXT PRIMARY KEY,
                username TEXT,
                emotes TEXT NOT NULL,
                configured_by TEXT,
                created_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );

            CREATE TABLE IF NOT EXISTS active_emote_loops (
                user_id TEXT PRIMARY KEY,
                username TEXT,
                emote_id TEXT NOT NULL,
                emote_name TEXT,
                emote_number INTEGER,
                is_rest_pose INTEGER DEFAULT 0,
                started_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS mod_alert_targets (
                user_id TEXT PRIMARY KEY,
                username TEXT NOT NULL COLLATE NOCASE,
                added_by TEXT,
                added_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS moderation_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                moderator_id TEXT,
                moderator_name TEXT,
                target_id TEXT,
                target_name TEXT,
                action_type TEXT,
                duration INTEGER,
                source TEXT,
                timestamp INTEGER
            );

            CREATE TABLE IF NOT EXISTS custom_emotes (
                emote_id   TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                duration   REAL NOT NULL DEFAULT 3.5,
                aliases    TEXT NOT NULL DEFAULT '',
                added_by   TEXT,
                added_at   INTEGER
            );

            CREATE TABLE IF NOT EXISTS emote_alias_overrides (
                emote_id   TEXT PRIMARY KEY,
                aliases    TEXT NOT NULL DEFAULT '',
                updated_by TEXT,
                updated_at INTEGER
            );
        `);

        // Safe column additions for existing databases
        try {
            this.db.exec(`ALTER TABLE users ADD COLUMN id TEXT;`);
        } catch (e) {}

        try {
            this.db.exec(`ALTER TABLE users ADD COLUMN user_id TEXT;`);
        } catch (e) {}

        try {
            this.db.exec(`UPDATE users SET id = user_id WHERE id IS NULL AND user_id IS NOT NULL;`);
        } catch (e) {}

        try {
            this.db.exec(`UPDATE users SET user_id = id WHERE user_id IS NULL AND id IS NOT NULL;`);
        } catch (e) {}

        try {
            this.db.exec(`
                ALTER TABLE profiles ADD COLUMN custom_intro TEXT DEFAULT NULL;
            `);
        } catch (e) {}

        try {
            this.db.exec(`
                ALTER TABLE users ADD COLUMN bank_coins INTEGER DEFAULT 0;
            `);
        } catch (e) {}

        try {
            this.db.exec(`
                ALTER TABLE users ADD COLUMN active_title TEXT DEFAULT NULL;
            `);
        } catch (e) {}

        try {
            this.db.exec(`
                ALTER TABLE teleports ADD COLUMN facing TEXT DEFAULT 'FrontRight';
            `);
        } catch (e) {}

        try {
            this.db.exec(`
                ALTER TABLE stats ADD COLUMN total_time_seconds INTEGER DEFAULT 0;
            `);
        } catch (e) {}

        try {
            this.db.exec(`
                ALTER TABLE stats ADD COLUMN total_visits INTEGER DEFAULT 0;
            `);
        } catch (e) {}

        try {
            this.db.exec(`
                ALTER TABLE stats ADD COLUMN username TEXT DEFAULT NULL;
            `);
        } catch (e) {}

        try {
            this.db.exec(`
                ALTER TABLE stats ADD COLUMN longest_session_seconds INTEGER DEFAULT 0;
            `);
        } catch (e) {}

        try {
            this.db.exec(`
                ALTER TABLE dance_floors ADD COLUMN points TEXT DEFAULT '[]';
            `);
        } catch (e) {}

        try {
            this.db.exec(`
                ALTER TABLE dance_floors ADD COLUMN is_active INTEGER DEFAULT 1;
            `);
        } catch (e) {}

        try {
            this.db.exec(`
                ALTER TABLE dance_floors ADD COLUMN emotes TEXT DEFAULT '[]';
            `);
        } catch (e) {}

        try {
            this.db.exec(`
                ALTER TABLE dance_floors ADD COLUMN switch_interval REAL DEFAULT 3.5;
            `);
        } catch (e) {}

        // Weekly leaderboard columns (IST Monday-based resets)
        try {
            this.db.exec(`ALTER TABLE stats ADD COLUMN weekly_messages INTEGER DEFAULT 0;`);
        } catch (e) {}

        try {
            this.db.exec(`ALTER TABLE stats ADD COLUMN weekly_time_seconds INTEGER DEFAULT 0;`);
        } catch (e) {}

        try {
            this.db.exec(`ALTER TABLE stats ADD COLUMN week_start_ts INTEGER DEFAULT 0;`);
        } catch (e) {}
    }

    // Helper to log audit events
    logAudit(category, actorId, actorName, action, details = '') {
        const stmt = this.db.prepare(`
            INSERT INTO audit_logs (timestamp, category, actor_id, actor_name, action, details)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        stmt.run(Date.now(), category, actorId, actorName, action, typeof details === 'object' ? JSON.stringify(details) : String(details));
    }
}

module.exports = new BotDatabase();
