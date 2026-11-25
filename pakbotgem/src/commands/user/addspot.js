const favSpotManager = require('../../systems/FavSpotManager');
const { Colors } = require('../../core/Colors');

module.exports = {
    name: 'addspot',
    aliases: ['savespot'],
    description: 'Save your exact current 3D position as a personal favourite spot',
    role: 'user',
    async execute(bot, user, message) {
        const spotName = favSpotManager.extractArgText(message);
        if (!spotName) {
            await bot.message.send(`${Colors.ERROR}Usage: \`!addspot <name>\` (stand at the exact spot you want to save).`);
            return;
        }

        const pos = await favSpotManager.captureLivePosition(bot, user.id);
        if (!pos) {
            await bot.message.send(`${Colors.ERROR}❌ Could not read your current position. Try taking a step and running \`!addspot ${spotName}\` again.`);
            return;
        }

        const res = favSpotManager.addSpot(user.id, spotName, pos);
        if (!res.ok) {
            await bot.message.send(`${Colors.ERROR}❌ ${res.error}`);
            return;
        }

        const { spot } = res;
        await bot.message.send(
            `📍 ${Colors.SUCCESS}Saved spot **${spot.name}** for @${user.username} at ` +
            `(${spot.x.toFixed(2)}, ${spot.y.toFixed(2)}, ${spot.z.toFixed(2)}). ` +
            `Use \`!activespot ${spot.name}\` to spawn here on join!`
        );
    }
};
