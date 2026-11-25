require('dotenv').config({ override: true });
const path = require('path');
const { Highrise, Logger } = require('highrise.bot');
const config = require('./src/config');
const registerEventHandlers = require('./src/handlers');
const movement = require('./src/systems/MovementManager');
const broadcast = require('./src/systems/BroadcastManager');
const autoTip = require('./src/systems/AutoTipManager');

// 🎭 Monkey-patch Actions.prototype.emote for Highrise Self-Emotes:
// Highrise gateway requires target_user_id to be null (or omitted) to play ANY emote (including
// unowned / legendary / mythic) directly on the bot avatar.
// Default highrise.bot SDK hardcodes `userId = this.botId`, which causes Highrise to check inventory and fail.
try {
    const hrDir = path.dirname(require.resolve('highrise.bot'));
    const Actions = require(path.join(hrDir, 'src/Api/Player/Actions'));
    const AcknowledgmentResponse = require(path.join(hrDir, 'src/Models/ResponseModels/AcknowledgmentResponse'));

    const originalEmote = Actions.prototype.emote;
    Actions.prototype.emote = async function (emoteId, userId = null) {
        const currentBotId = this.state?.get('metadata')?.botId;
        if (!userId || userId === currentBotId || userId === 'bot') {
            try {
                this.validator.required(emoteId, 'emoteId').string(emoteId, 'emoteId');
                await this.sender.request({
                    _type: 'EmoteRequest',
                    emote_id: emoteId,
                    target_user_id: null
                });
                return new AcknowledgmentResponse();
            } catch (error) {
                return new AcknowledgmentResponse({ error });
            }
        }
        return originalEmote.call(this, emoteId, userId);
    };
} catch (e) {
    console.error('Failed to monkey-patch Actions.prototype.emote:', e.message);
}

const log = new Logger(config.botName, 'debug');

// Check for required credentials
if (!config.token || config.token === 'your_bot_token_here' || !config.roomId || config.roomId === 'your_room_id_here') {
    log.error('Config', 'Missing BOT_TOKEN or ROOM_ID in .env file!');
    log.info('Config', 'Please open .env and add your valid Highrise bot credentials.');
    process.exit(1);
}

log.info('Init', `Starting ${config.botName} (Node.js + highrise.bot with Resilient Supervisor)...`);
log.info('Config', `Target Room ID: ${config.roomId}`);

class BotSupervisor {
    constructor() {
        this.bot = null;
        this.attempt = 0;
        this.isReconnecting = false;
        this.isCheckingPresence = false;
        this.lastHeartbeat = Date.now();
        this.watchdogInterval = null;
        this.connectedSince = 0;
        this.activeHumanIds = new Set();
        this.ignoredBotUsernames = new Set(
            (process.env.BOT_USERNAMES || '')
                .split(',')
                .map(s => s.trim().toLowerCase())
                .filter(Boolean)
        );
    }

    extractUser(item) {
        return Array.isArray(item) ? item[0] : (item?.user || item);
    }

    isHumanUser(u, botId) {
        if (!u?.id || u.id === botId) return false;
        const uname = u.username ? String(u.username).toLowerCase() : '';
        if (uname && this.ignoredBotUsernames.has(uname)) return false;
        return true;
    }

    noteUserJoined(user) {
        const botId = this.bot?.metadata?.botId;
        if (this.isHumanUser(user, botId)) {
            this.activeHumanIds.add(user.id);
        }
    }

    noteUserLeft(user) {
        if (user?.id) {
            this.activeHumanIds.delete(user.id);
        }
    }

    start() {
        this.setupProcessGuards();
        this.spawnBot();
        this.startWatchdog();
    }

    setupProcessGuards() {
        process.on('unhandledRejection', (reason) => {
            log.error('ProcessGuard', `Unhandled Rejection: ${reason?.message || reason}`);
        });

        process.on('uncaughtException', (err) => {
            log.error('ProcessGuard', `Uncaught Exception: ${err?.message || err}`);
            this.scheduleReconnect('Uncaught Exception');
        });

        const shutdown = (sig) => {
            log.info('Shutdown', `Received ${sig}. Cleaning up persistent state and shutting down...`);
            this.teardown();
            process.exit(0);
        };
        process.once('SIGINT', () => shutdown('SIGINT'));
        process.once('SIGTERM', () => shutdown('SIGTERM'));
    }

    spawnBot() {
        if (this.bot) this.teardownBot();

        this.bot = new Highrise({
            roles: {
                persistPath: config.rolesPersistPath,
                fileSaveInterval: 5 * 60 * 1000,
                roomFetchInterval: 10 * 60 * 1000
            }
        });

        // Expose supervisor on bot so handlers can trigger reconnect
        this.bot._supervisor = this;

        // Register all modular handlers and commands
        registerEventHandlers(this.bot, log);

        // Activity and heartbeat tracking
        this.bot.on('Ready', (metadata) => {
            this.lastHeartbeat = Date.now();
            this.connectedSince = Date.now();
            this.activeHumanIds.clear();
            this.isCheckingPresence = false;
            log.info('Supervisor', '✅ Bot session established and verified in room.');
            // Only reset attempt counter after 60s of sustained connection
            setTimeout(() => {
                if (this.connectedSince && (Date.now() - this.connectedSince >= 60000)) {
                    this.attempt = 0;
                }
            }, 60000);
        });

        this.bot.on('Chat', () => { this.lastHeartbeat = Date.now(); });
        this.bot.on('Movement', () => { this.lastHeartbeat = Date.now(); });
        this.bot.on('UserJoined', (user) => {
            this.lastHeartbeat = Date.now();
            this.noteUserJoined(user);
        });
        this.bot.on('UserLeft', (user) => {
            this.lastHeartbeat = Date.now();
            this.noteUserLeft(user);
        });
        this.bot.on('Emote', () => { this.lastHeartbeat = Date.now(); });
        this.bot.on('Tip', () => { this.lastHeartbeat = Date.now(); });
        this.bot.on('Whisper', () => { this.lastHeartbeat = Date.now(); });

        try {
            this.bot.login(config.token, config.roomId);
        } catch (err) {
            log.error('Supervisor', `Login failed: ${err.message}`);
            this.scheduleReconnect(`Login failure: ${err.message}`);
        }
    }

    startWatchdog() {
        if (this.watchdogInterval) clearInterval(this.watchdogInterval);
        this.watchdogInterval = setInterval(async () => {
            if (!this.connectedSince || !this.bot || this.isReconnecting || this.isCheckingPresence) return;

            const botId = this.bot.metadata?.botId;
            if (!botId) return;

            this.isCheckingPresence = true;
            try {
                const response = await Promise.race([
                    this.bot.room.users.get(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('room probe timeout')), 8000))
                ]);

                // highrise.bot SDK returns GetRoomUsersResponse instance where users are in response.users
                // Or if raw array: response itself
                const usersList = Array.isArray(response) ? response : (response?.users || []);
                let botInRoom = false;
                const nextHumanIds = new Set();

                for (const item of usersList) {
                    const u = this.extractUser(item);
                    if (!u?.id) continue;
                    if (u.id === botId) {
                        botInRoom = true;
                    } else if (this.isHumanUser(u, botId)) {
                        nextHumanIds.add(u.id);
                    }
                }
                this.activeHumanIds = nextHumanIds;

                if (!botInRoom) {
                    if (this.activeHumanIds.size >= 1) {
                        log.warn('Watchdog', `⚠️ Bot evicted from room with ${this.activeHumanIds.size} active user(s) — reconnecting`);
                        this.scheduleReconnect('Bot evicted from room (watchdog heartbeat)');
                    } else {
                        log.debug('Watchdog', 'Room has 0 active non-bot users (hibernating) — skipping reconnect, checking again in 30s');
                    }
                }
                // Bot found — socket healthy, nothing to do
            } catch (err) {
                // Probe failed or timed out — only reconnect if room had active non-bot users
                if (this.activeHumanIds.size >= 1) {
                    log.warn('Watchdog', `⚠️ Room presence probe failed (${err.message}) with ${this.activeHumanIds.size} active user(s) — reconnecting`);
                    this.scheduleReconnect('Watchdog room probe failed');
                } else {
                    log.debug('Watchdog', `Room probe failed (${err.message}) with 0 active non-bot users — staying idle, checking again in 30s`);
                }
            } finally {
                this.isCheckingPresence = false;
            }
        }, 30000); // Every 30 seconds
    }

    scheduleReconnect(reason) {
        if (this.isReconnecting) return;
        this.isReconnecting = true;
        this.connectedSince = 0;

        log.warn('Supervisor', `Initiating backoff reconnection [Reason: ${reason}]`);
        this.teardownBot();

        this.attempt++;
        const backoff = Math.min(2000 * Math.pow(1.8, this.attempt - 1), 60000);
        const jitter = Math.random() * 1500;
        const delay = Math.round(backoff + jitter);

        log.info('Supervisor', `⏳ Reconnecting in ${(delay / 1000).toFixed(1)}s (Attempt #${this.attempt})...`);
        setTimeout(() => {
            this.isReconnecting = false;
            this.spawnBot();
        }, delay);
    }

    teardownBot() {
        try { movement.stopAnchorGuardian(); } catch (e) { }
        try { broadcast.stop(); } catch (e) { }
        try { autoTip.stop(); } catch (e) { }
        if (this.bot) {
            try { this.bot.destroy(); } catch (e) { }
            this.bot = null;
        }
    }

    teardown() {
        if (this.watchdogInterval) {
            clearInterval(this.watchdogInterval);
            this.watchdogInterval = null;
        }
        this.teardownBot();
    }
}

new BotSupervisor().start();
