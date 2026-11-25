const favSpotManager = require('../../systems/FavSpotManager');
const { Colors } = require('../../core/Colors');

module.exports = {
    name: 'favspotlist',
    aliases: ['spotlist', 'myspots'],
    description: 'List all of your saved favourite spots and show which one is active',
    role: 'user',
    async execute(bot, user) {
        const spots = favSpotManager.listSpots(user.id);
        if (!spots.length) {
            await bot.message.send(`📍 ${Colors.WARNING}@${user.username} has no saved favourite spots yet. Stand somewhere and type \`!addspot <name>\`!`);
            return;
        }

        const enabled = favSpotManager.isEnabled(user.id);
        const lines = spots.map((s) => {
            const mark = s.is_active ? '⭐ [ACTIVE] ' : '• ';
            return `${mark}${s.name} (${s.x.toFixed(1)}, ${s.y.toFixed(1)}, ${s.z.toFixed(1)})`;
        });

        await bot.message.send(
            `📍 ${Colors.GOLD}<b>@${user.username}'s Favourite Spots</b> (${enabled ? 'ON' : 'OFF'}):\n` +
            lines.join('\n')
        );
    }
};
