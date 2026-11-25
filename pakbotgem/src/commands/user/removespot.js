const favSpotManager = require('../../systems/FavSpotManager');
const { Colors } = require('../../core/Colors');

module.exports = {
    name: 'removespot',
    aliases: ['delspot', 'deletespot'],
    description: 'Remove one of your saved favourite spots',
    role: 'user',
    async execute(bot, user, message) {
        const spotName = favSpotManager.extractArgText(message);
        if (!spotName) {
            await bot.message.send(`${Colors.ERROR}Usage: \`!removespot <name>\``);
            return;
        }

        const res = favSpotManager.removeSpot(user.id, spotName);
        if (!res.ok) {
            await bot.message.send(`${Colors.ERROR}❌ ${res.error}`);
            return;
        }

        await bot.message.send(`🗑️ ${Colors.SUCCESS}Removed favourite spot **${res.removed.name}** for @${user.username}.`);
    }
};
