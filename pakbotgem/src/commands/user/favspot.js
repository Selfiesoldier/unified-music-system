const favSpotManager = require('../../systems/FavSpotManager');
const { Colors } = require('../../core/Colors');

module.exports = {
    name: 'favspot',
    aliases: ['favspots', 'spothelp'],
    description: 'View Favourite Spots info or toggle auto-teleport on/off (!favspot [on|off])',
    role: 'user',
    async execute(bot, user, message) {
        const arg = favSpotManager.extractArgText(message).toLowerCase();

        if (arg === 'on') {
            favSpotManager.setEnabled(user.id, true);
            const active = favSpotManager.getActiveSpot(user.id);
            const note = active
                ? `Active spot: **${active.name}**`
                : `Use \`!addspot <name>\` & \`!activespot <name>\` to pick your spawn spot.`;
            await bot.message.send(`📍 ${Colors.SUCCESS}Favourite Spots auto-teleport **ENABLED** for @${user.username}! ${note}`);
            return;
        }

        if (arg === 'off') {
            favSpotManager.setEnabled(user.id, false);
            await bot.message.send(`📍 ${Colors.WARNING}Favourite Spots auto-teleport **DISABLED** for @${user.username}. Your saved spots & active spot are preserved.`);
            return;
        }

        const enabled = favSpotManager.isEnabled(user.id);
        const active = favSpotManager.getActiveSpot(user.id);
        const statusStr = enabled ? `${Colors.SUCCESS}ON` : `${Colors.ERROR}OFF`;
        const activeStr = active ? active.name : 'None';

        await bot.message.send(
            `📍 ${Colors.GOLD}<b>Favourite Spots</b> ${Colors.WHITE}(Status: ${statusStr}${Colors.WHITE} | Active: ${Colors.CYAN}${activeStr}${Colors.WHITE})\n` +
            `• !addspot <name> — Save your exact standing spot\n` +
            `• !removespot <name> — Delete a saved spot\n` +
            `• !activespot <name> — Set your auto-spawn spot\n` +
            `• !favspot on/off — Toggle join auto-teleport\n` +
            `• !favspotlist — View your saved spots`
        );
    }
};
