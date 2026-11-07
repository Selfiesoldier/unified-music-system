"""
Beautiful Color Formatter for Bot Messages
Supports Highrise color codes for visually stunning output
"""

class Colors:
    """Color palette for beautiful bot messages"""

    # Primary Colors
    PINK = "<#FF69B4>"
    LIGHT_PINK = "<#FFB6C1>"
    SOFT_PINK = "<#FFC0CB>"
    ROSE = "<#FF1493>"

    # Purple & Lavender
    PURPLE = "<#9370DB>"
    LAVENDER = "<#E6E6FA>"
    VIOLET = "<#8A2BE2>"
    MAGENTA = "<#FF00FF>"

    # Blue & Cyan
    SKY_BLUE = "<#87CEEB>"
    CYAN = "<#00CED1>"
    LIGHT_BLUE = "<#ADD8E6>"
    BLUE = "<#4169E1>"
    ROYAL_BLUE = "<#4682B4>"

    # Gold & Yellow
    GOLD = "<#FFD700>"
    YELLOW = "<#FFEB3B>"
    LIGHT_YELLOW = "<#FFFFE0>"
    AMBER = "<#FFC107>"

    # Green
    MINT = "<#98FF98>"
    LIGHT_GREEN = "<#90EE90>"
    GREEN = "<#00FF00>"
    LIME = "<#32CD32>"

    # Orange & Peach
    ORANGE = "<#FFA500>"
    PEACH = "<#FFDAB9>"
    CORAL = "<#FF7F50>"

    # Red
    RED = "<#FF6B6B>"
    LIGHT_RED = "<#FFB6B6>"
    CRIMSON = "<#DC143C>"

    # Neutrals
    WHITE = "<#FFFFFF>"
    LIGHT_GRAY = "<#D3D3D3>"
    SILVER = "<#C0C0C0>"
    GRAY = "<#808080>"

    # Special
    RAINBOW_1 = "<#FF6B9D>"
    RAINBOW_2 = "<#C44569>"
    RAINBOW_3 = "<#F8B500>"


class MessageFormatter:
    """Create beautiful, modular messages with color codes"""

    # Message length limits
    PUBLIC_LIMIT = 256  # Public chat limit
    WHISPER_LIMIT = 256  # Whisper limit
    DM_LIMIT = 2000  # DM limit

    @staticmethod
    def header(text: str, color=Colors.PINK) -> str:
        """Create a beautiful header"""
        return f"{color}✨ {text} ✨"

    @staticmethod
    def success(text: str) -> str:
        """Success message in green"""
        return f"{Colors.MINT}✅ {text}"

    @staticmethod
    def error(text: str) -> str:
        """Error message in red"""
        return f"{Colors.RED}❌ {text}"

    @staticmethod
    def info(text: str) -> str:
        """Info message in blue"""
        return f"{Colors.SKY_BLUE}ℹ️ {text}"

    @staticmethod
    def warning(text: str) -> str:
        """Warning message in orange"""
        return f"{Colors.ORANGE}⚠️ {text}"

    @staticmethod
    def music(title: str, artist: str = "", duration: str = "") -> str:
        """Beautiful music info"""
        msg = f"{Colors.PURPLE}🎵 {Colors.PINK}{title}"
        if artist:
            msg += f"\n{Colors.LAVENDER}👤 {artist}"
        if duration:
            msg += f"\n{Colors.SKY_BLUE}⏱️ {duration}"
        return msg

    @staticmethod
    def balance(points: int) -> str:
        """Beautiful balance display"""
        return (
            f"{Colors.GOLD}💰 Balance: {Colors.YELLOW}{points} pts\n"
            f"{Colors.SKY_BLUE}💡 Tip gold to earn • !packs for deals"
        )

    @staticmethod
    def pack_display(name: str, gold: int, points: int, desc: str, color=Colors.GOLD) -> str:
        """Beautiful package display"""
        return (
            f"{color}💎 {name} {Colors.LIGHT_GRAY}• {desc}\n"
            f"{Colors.YELLOW}   {gold}G → {points}pts"
        )

    @staticmethod
    def queue_item(position: int, title: str, artist: str = "", duration: str = "") -> str:
        """Beautiful queue item"""
        msg = f"{Colors.LAVENDER}{position}. {Colors.PINK}{title}"
        if artist:
            msg += f" {Colors.LIGHT_GRAY}- {artist}"
        if duration:
            msg += f" {Colors.CYAN}({duration})"
        return msg

    @staticmethod
    def command_cost(cmd: str, cost: int) -> str:
        """Beautiful command cost display"""
        return f"{Colors.LAVENDER}• {cmd} {Colors.YELLOW}- {cost} pts"

    @staticmethod
    def item_found(num: int, name: str, category: str, emoji: str) -> str:
        """Beautiful item display for shop"""
        return f"{Colors.LAVENDER}{num}. {emoji} {Colors.PINK}{name} {Colors.LIGHT_GRAY}({category})"

    @staticmethod
    def outfit_item(category: str, name: str, is_free: bool = False) -> str:
        """Beautiful outfit item display"""
        free_tag = f"{Colors.MINT}🆓 " if is_free else ""
        return f"{Colors.PURPLE}• {category.title()}: {Colors.PINK}{free_tag}{name}"

    @staticmethod
    def split_message(text: str, limit: int = PUBLIC_LIMIT) -> list:
        """Split long message into chunks that fit the limit"""
        if len(text) <= limit:
            return [text]

        chunks = []
        lines = text.split('\n')
        current_chunk = ""

        for line in lines:
            if len(current_chunk) + len(line) + 1 <= limit:
                current_chunk += line + '\n'
            else:
                if current_chunk:
                    chunks.append(current_chunk.rstrip())
                current_chunk = line + '\n'

        if current_chunk:
            chunks.append(current_chunk.rstrip())

        return chunks

    @staticmethod
    def divider(color=Colors.LAVENDER) -> str:
        """Create a visual divider"""
        return f"{color}━━━━━━━━━━━━━━━━"

    @staticmethod
    def cooldown(seconds: float) -> str:
        """Beautiful cooldown message"""
        return f"{Colors.ORANGE}⏰ Wait {seconds:.1f}s before trying again"

    @staticmethod
    def vip_badge() -> str:
        """VIP badge"""
        return f"{Colors.GOLD}⭐ VIP Access - Free!"

    @staticmethod
    def free_mode_badge() -> str:
        """Free mode badge"""
        return f"{Colors.GREEN}🎉 Free Music Mode!"


class BeautifulMessages:
    """Pre-built beautiful message templates"""

    @staticmethod
    def music_help_1() -> str:
        """Music help part 1"""
        return (
            f"{Colors.PINK}🎵 Music Commands\n\n"
            f"{Colors.LAVENDER}/play <song> {Colors.YELLOW}10pts {Colors.LIGHT_GRAY}• Play track\n"
            f"{Colors.LAVENDER}/dedicate @user <song> {Colors.YELLOW}10pts {Colors.LIGHT_GRAY}• Dedicate song\n"
            f"{Colors.LAVENDER}/skip {Colors.LIGHT_GRAY}or {Colors.LAVENDER}/s {Colors.CYAN}VOTE {Colors.LIGHT_GRAY}• Skip track\n"
            f"{Colors.LAVENDER}/next {Colors.MINT}FREE {Colors.LIGHT_GRAY}• View upcoming song\n"
            f"{Colors.LAVENDER}/instskip {Colors.YELLOW}1000pts {Colors.LIGHT_GRAY}• Instant skip\n"
            f"{Colors.LAVENDER}/clear {Colors.YELLOW}20pts/song {Colors.LIGHT_GRAY}• Clear queue\n"
            f"{Colors.LAVENDER}/current {Colors.MINT}FREE {Colors.LIGHT_GRAY}• Now playing\n"
            f"{Colors.LAVENDER}/queue {Colors.LIGHT_GRAY}or {Colors.LAVENDER}/q {Colors.MINT}FREE {Colors.LIGHT_GRAY}• View queue"
        )

    @staticmethod
    def music_help_2() -> str:
        """Music help part 2"""
        return (
            f"{Colors.PURPLE}🎛️ More Features\n\n"
            f"{Colors.LAVENDER}/autoplay {Colors.CYAN}• Auto-play on/off\n"
            f"{Colors.LAVENDER}/mode <type> {Colors.CYAN}• Change mode\n"
            f"{Colors.LAVENDER}/modes {Colors.CYAN}• View all modes\n"
            f"{Colors.LAVENDER}/tts {Colors.CYAN}• Voice announcements\n"
            f"{Colors.LAVENDER}/stream {Colors.CYAN}• Get stream link (DM)\n"
            f"{Colors.LAVENDER}/lyrics {Colors.CYAN}• Get lyrics link (DM)\n\n"
            f"{Colors.ORANGE}👑 Admin: /s free skip\n"
            f"{Colors.ORANGE}👑 Admin: /skipvote- cancel vote\n\n"
            f"{Colors.SKY_BLUE}💬 DM 'help' for more!"
        )

    @staticmethod
    def modes_list(current_mode: str, recent_count: int, modes_dict = None) -> str:
        """Beautiful modes list - dynamically loads from JSON files"""
        msg = f"{Colors.PINK}🎭 Auto-Play Modes\n\n"

        color_cycle = [
            Colors.CYAN, Colors.PURPLE, Colors.PINK, Colors.SKY_BLUE,
            Colors.MINT, Colors.VIOLET, Colors.PEACH, Colors.LAVENDER
        ]

        msg += f"{color_cycle[0]}recent {Colors.LIGHT_GRAY}• User songs ({recent_count})\n"

        if modes_dict:
            color_idx = 1
            for mode_id, mode_data in sorted(modes_dict.items()):
                if mode_id == 'recent':
                    continue

                color = color_cycle[color_idx % len(color_cycle)]
                description = mode_data.get('description', 'Music mode')
                song_count = len(mode_data.get('songs', []))

                msg += f"{color}{mode_id} {Colors.LIGHT_GRAY}• {description} ({song_count})\n"
                color_idx += 1

        msg += f"\n{Colors.GOLD}▶ Active: {Colors.YELLOW}{current_mode}"
        return msg

    @staticmethod
    def now_playing(title: str, artist: str, duration: str, views: str, queue_len: int,
                    is_autoplay: bool = False, requester = None, 
                    dedicated_to = None, dedicated_by = None) -> str:
        """Beautiful now playing with request type info"""
        msg = (
            f"{Colors.PINK}🎧 Now Playing\n"
            f"{Colors.PURPLE}{title}\n"
            f"{Colors.LAVENDER}👤 {artist} {Colors.CYAN}⏱ {duration}\n"
            f"{Colors.LIGHT_GRAY}👁 {views} {Colors.YELLOW}• 📋 {queue_len} queued\n"
        )

        if dedicated_to and dedicated_by:
            msg += f"{Colors.PEACH}💝 Dedicated to @{dedicated_to} by @{dedicated_by}"
        elif requester:
            msg += f"{Colors.SKY_BLUE}🎤 Requested by @{requester}"
        elif is_autoplay:
            msg += f"{Colors.MINT}🤖 Autoplay"

        return msg.rstrip('\n')

    @staticmethod
    def cost_menu() -> str:
        """Beautiful cost menu"""
        return (
            f"{Colors.GOLD}💵 Command Costs\n\n"
            f"{Colors.LAVENDER}!play {Colors.YELLOW}10pts {Colors.LIGHT_GRAY}!next {Colors.YELLOW}10pts\n"
            f"{Colors.LAVENDER}!clear {Colors.YELLOW}20pts/song\n\n"
            f"{Colors.SKY_BLUE}💡 !balance • Tip gold to earn"
        )

    @staticmethod
    def dm_help() -> str:
        """Beautiful DM help message"""
        return (
            f"{Colors.PINK}🎵 Music Bot Help\n\n"
            f"{Colors.PURPLE}📬 DM Commands:\n"
            f"{Colors.CYAN}stream {Colors.LIGHT_GRAY}• Get link {Colors.CYAN}lyrics {Colors.LIGHT_GRAY}• Lyrics\n"
            f"{Colors.CYAN}help {Colors.LIGHT_GRAY}• Show this\n\n"
            f"{Colors.GOLD}🎤 Room Commands:\n"
            f"{Colors.LAVENDER}!music {Colors.LIGHT_GRAY}• All commands\n"
            f"{Colors.LAVENDER}!play <song> {Colors.LIGHT_GRAY}• Play music\n"
            f"{Colors.LAVENDER}!queue {Colors.LIGHT_GRAY}• View queue\n"
            f"{Colors.LAVENDER}!balance {Colors.LIGHT_GRAY}• Check points\n\n"
            f"{Colors.SKY_BLUE}💡 Use in room chat!"
        )