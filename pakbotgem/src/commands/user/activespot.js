const favSpotManager = require('../../systems/FavSpotManager');
const { Colors } = require('../../core/Colors');

module.exports = {
    name: 'activespot',
    aliases: ['setspot'],
    description: 'Set one of your saved favourite spots as your active join spawn',
    role: 'user',
    async execute(bot, user, message) {
        const spotName = favSpotManager.extractArgText(message);
        if (!spotName) {
            await bot.message.send(`${Colors.ERROR}Usage: \`!activespot <name>\``);
            return;
        }

        const res = favSpotManager.setActiveSpot(user.id, spotName);
        if (!res.ok) {
            await bot.message.send(`${Colors.ERROR}❌ ${res.error}`);
            return;
        }

        const enabledNote = favSpotManager.isEnabled(user.id)
            ? 'Auto-teleport is ON.'
            : 'Auto-teleport is currently OFF — run `!favspot on` to enable.';
        await bot.message.send(`⭐ ${Colors.SUCCESS}Active spot set to **${res.spot.name}** for @${user.username}! ${enabledNote}`);
    }
};
