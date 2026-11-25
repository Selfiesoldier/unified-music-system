const economy = require('../systems/EconomyManager');
const health = require('../systems/HealthMonitor');
const vip = require('../systems/VIPManager');
const movement = require('../systems/MovementManager');
const tracking = require('../systems/TrackingManager');
const autoTip = require('../systems/AutoTipManager');
const favSpotManager = require('../systems/FavSpotManager');
const profileManager = require('../systems/ProfileManager');
const autoEmote = require('../systems/AutoEmoteManager');
const emoteAI = require('../systems/EmoteAIManager');
const danceSystem = require('../systems/DanceFloorSystem');
const ownerManager = require('../systems/OwnerManager');
const { getWelcomeMessage } = require('../messages/pakistanMessages');

module.exports = async function handleJoin(bot, user, position, log) {
    if (!user) return;

    // Trigger persistent auto-emote playlist or saved persistent emote loop
    const autoEmoteConfig = autoEmote.getAutoEmotes(user.id);
    if (autoEmoteConfig && autoEmoteConfig.emotes && autoEmoteConfig.emotes.length) {
        autoEmote.handleUserJoin(bot, user);
    } else {
        const activeLoop = emoteAI.getActiveLoop(user.id);
        if (activeLoop && activeLoop.emote_id) {
            setTimeout(async () => {
                try {
                    await emoteAI.startLoop(bot, user, activeLoop.emote_id, { persist: false });
                } catch (e) {}
            }, 1200);
        }
    }

    // When the bot itself joins the room grid, place it at its saved home spot
    if (user.id === bot.metadata?.botId) {
        setTimeout(async () => {
            await movement.ensureHomePosition(bot);
        }, 300);
        return;
    }

    // On human joins: verify bot is still present in room (single-flight guard prevents bursts when multiple users join at once)
    const sup = bot._supervisor;
    if (sup) {
        sup.noteUserJoined(user);
    }
    if (!sup || (!sup.isReconnecting && !sup.isCheckingPresence)) {
        if (sup) sup.isCheckingPresence = true;
        try {
            const response = await bot.room.users.get();
            const botId = bot.metadata?.botId;
            const usersList = Array.isArray(response) ? response : (response?.users || []);
            const botInRoom = usersList.some(item => {
                const u = Array.isArray(item) ? item[0] : (item?.user || item);
                return u?.id === botId;
            });
            if (!botInRoom && botId && sup) {
                log.warn('JoinCheck', `⚠️ Bot not found in room after ${user.username} joined — reconnecting (post-hibernation eviction)`);
                sup.scheduleReconnect('Bot evicted from room (detected on user join)');
                return;
            }
        } catch (e) {
            // Non-fatal: room query failed, continue normally
        } finally {
            if (sup) sup.isCheckingPresence = false;
        }
    }

    health.recordEvent('joins');
    log.info('Join', `${user.username} (${user.id}) joined the room`);

    // Initialize user session and stats tracking
    tracking.startSession(user.id, user.username);
    economy.getUser(user.id, user.username);
    autoTip.handleFirstVisit(bot, user);
    favSpotManager.handleUserJoin(bot, user);

    // Initial position cache & dance floor entry check
    if (position && 'x' in position) {
        movement.updateUserPosition(user.id, position);
        danceSystem.handleMovement(bot, user, position);
    }

    // 1. Check for player's custom entrance greeting intro
    const customIntro = profileManager.getCustomIntro(user.id);
    if (customIntro) {
        try {
            await bot.message.send(`🇵🇰 <#00FF7F><b>[ENTRANCE]</b> <#39FF14><b>@${user.username}:</b> <#FFFFFF>"${customIntro}"`);
        } catch (e) {}
        return;
    }

    // 2. Default dynamic Pakistan-centric greeting + custom intro promotion
    let role = 'user';
    if (ownerManager.isOwner(user, bot)) {
        role = 'owner';
    } else if (vip.isVIP(bot, user.id) || bot.roles.hasRole(user.id, 'vip')) {
        role = 'vip';
    }

    const welcomeText = getWelcomeMessage(user.username, role);
    const promo = `\n<#FFD700>💡 Tip: Set your custom entrance intro with \`!custom <msg>\`!`;

    try {
        await bot.message.send(`${welcomeText}${promo}`);
    } catch (e) {}
};
