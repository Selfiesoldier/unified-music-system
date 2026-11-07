"""
Personalized Messaging System - Creative role-based messages
Provides unique, stylish messages for Owner, Admins, VIPs, and Normal Users
"""

from .color_formatter import Colors
import random

class PersonalizedMessages:
    """Create personalized messages based on user role with creative styles"""
    
    # ═══════════════════════════════════════════════════════════════
    # GREETING MESSAGES
    # ═══════════════════════════════════════════════════════════════
    
    @staticmethod
    def greeting(username: str, role: str) -> str:
        """
        Get a personalized greeting based on user role
        
        Args:
            username: The user's username
            role: 'owner', 'admin', 'vip', or 'normal'
        """
        greetings = {
            'owner': [
                f"{Colors.GOLD}👑 {Colors.AMBER}★═══════════════★\n{Colors.GOLD}  Welcome back, {Colors.YELLOW}{username}{Colors.GOLD}!\n  Supreme Commander 🌟\n{Colors.AMBER}★═══════════════★",
                f"{Colors.RAINBOW_1}✨ {Colors.GOLD}THE LEGEND ARRIVES{Colors.RAINBOW_1} ✨\n{Colors.YELLOW}👑 {username} {Colors.GOLD}• Owner Supreme\n{Colors.AMBER}All systems at your command!",
                f"{Colors.GOLD}╔══════════════════╗\n║ {Colors.YELLOW}👑 OWNER {username.upper()[:10]} {Colors.GOLD}║\n╚══════════════════╝\n{Colors.AMBER}The realm bows to you! ✨",
            ],
            'admin': [
                f"{Colors.PURPLE}⚡ {Colors.VIOLET}━━━━━━━━━━━━━━━━━\n{Colors.MAGENTA}  Admin {Colors.LAVENDER}{username} {Colors.MAGENTA}Online!\n  Command Authority Active 🛡️\n{Colors.VIOLET}━━━━━━━━━━━━━━━━━",
                f"{Colors.VIOLET}🔱 {Colors.PURPLE}ADMIN PRESENCE DETECTED\n{Colors.LAVENDER}Welcome, {username}!\n{Colors.MAGENTA}Management Level: {Colors.PINK}Elite ✨",
                f"{Colors.PURPLE}╭───────────────╮\n│ {Colors.LAVENDER}⚡ {username} {Colors.PURPLE}│\n│ {Colors.MAGENTA}Admin Powers ON {Colors.PURPLE}│\n╰───────────────╯",
            ],
            'vip': [
                f"{Colors.PINK}💎 {Colors.ROSE}~~~~~~~~~~~~~~~~~\n{Colors.LIGHT_PINK}  VIP {Colors.PINK}{username} {Colors.ROSE}has arrived!\n  Premium Access Granted 🌟\n{Colors.ROSE}~~~~~~~~~~~~~~~~~",
                f"{Colors.ROSE}✨ {Colors.PINK}VIP ENTRANCE{Colors.ROSE} ✨\n{Colors.LIGHT_PINK}💎 {username}\n{Colors.SOFT_PINK}Living the premium life! 🎉",
                f"{Colors.PINK}┌──────────────┐\n│ {Colors.ROSE}💎 VIP MEMBER {Colors.PINK}│\n│ {Colors.LIGHT_PINK}{username[:12]} {Colors.PINK}│\n└──────────────┘\n{Colors.SOFT_PINK}You're special! ✨",
            ],
            'normal': [
                f"{Colors.SKY_BLUE}🎵 {Colors.CYAN}·············\n{Colors.LIGHT_BLUE}  Hey {Colors.SKY_BLUE}{username}{Colors.LIGHT_BLUE}!\n  Welcome to the vibe! 🎶\n{Colors.CYAN}·············",
                f"{Colors.CYAN}✨ {Colors.SKY_BLUE}Welcome back, {username}!\n{Colors.LIGHT_BLUE}Let's make some memories! 🎉",
                f"{Colors.SKY_BLUE}🌟 {username} {Colors.CYAN}joined the party!\n{Colors.LIGHT_BLUE}Ready for some fun? Let's go! 🎊",
            ]
        }
        
        role_greetings = greetings.get(role.lower(), greetings['normal'])
        return random.choice(role_greetings)
    
    # ═══════════════════════════════════════════════════════════════
    # SUCCESS MESSAGES
    # ═══════════════════════════════════════════════════════════════
    
    @staticmethod
    def success(message: str, role: str) -> str:
        """Personalized success message"""
        templates = {
            'owner': f"{Colors.GOLD}👑 ✨ {message} {Colors.AMBER}• Owner Privilege",
            'admin': f"{Colors.PURPLE}⚡ ✅ {message} {Colors.MAGENTA}• Admin Power",
            'vip': f"{Colors.PINK}💎 ✨ {message} {Colors.ROSE}• VIP Status",
            'normal': f"{Colors.MINT}✅ {message}"
        }
        return templates.get(role.lower(), templates['normal'])
    
    # ═══════════════════════════════════════════════════════════════
    # ERROR MESSAGES
    # ═══════════════════════════════════════════════════════════════
    
    @staticmethod
    def error(message: str, role: str) -> str:
        """Personalized error message"""
        templates = {
            'owner': f"{Colors.ORANGE}👑 ⚠️ {message}\n{Colors.GOLD}Even legends face challenges!",
            'admin': f"{Colors.ORANGE}⚡ ⚠️ {message}\n{Colors.PURPLE}Admin override available!",
            'vip': f"{Colors.ORANGE}💎 ⚠️ {message}\n{Colors.PINK}VIP support is here!",
            'normal': f"{Colors.RED}❌ {message}"
        }
        return templates.get(role.lower(), templates['normal'])
    
    # ═══════════════════════════════════════════════════════════════
    # COMMAND RESPONSES
    # ═══════════════════════════════════════════════════════════════
    
    @staticmethod
    def command_response(command: str, result: str, role: str) -> str:
        """Personalized command response"""
        headers = {
            'owner': f"{Colors.GOLD}👑 {Colors.AMBER}═══════════════",
            'admin': f"{Colors.PURPLE}⚡ {Colors.VIOLET}━━━━━━━━━━━━━━",
            'vip': f"{Colors.PINK}💎 {Colors.ROSE}~~~~~~~~~~~~~",
            'normal': f"{Colors.SKY_BLUE}🎵 {Colors.CYAN}·············"
        }
        
        header = headers.get(role.lower(), headers['normal'])
        return f"{header}\n{result}\n{header}"
    
    # ═══════════════════════════════════════════════════════════════
    # MUSIC MESSAGES
    # ═══════════════════════════════════════════════════════════════
    
    @staticmethod
    def music_added(title: str, username: str, role: str, position = None) -> str:
        """Personalized music added message"""
        if role == 'owner':
            msg = f"{Colors.GOLD}👑 {Colors.AMBER}ROYAL SELECTION\n{Colors.YELLOW}🎵 {title}\n{Colors.GOLD}Added by Supreme Leader {username}"
        elif role == 'admin':
            msg = f"{Colors.PURPLE}⚡ {Colors.VIOLET}ADMIN OVERRIDE\n{Colors.LAVENDER}🎵 {title}\n{Colors.MAGENTA}Admin {username} takes control!"
        elif role == 'vip':
            msg = f"{Colors.PINK}💎 {Colors.ROSE}VIP SELECTION\n{Colors.LIGHT_PINK}🎵 {title}\n{Colors.SOFT_PINK}Premium choice by {username}!"
        else:
            msg = f"{Colors.SKY_BLUE}🎵 {Colors.CYAN}Now queued!\n{Colors.LIGHT_BLUE}{title}\n{Colors.SKY_BLUE}Added by {username}"
        
        if position:
            msg += f"\n{Colors.LIGHT_GRAY}Queue position: #{position}"
        
        return msg
    
    @staticmethod
    def now_playing(title: str, artist: str, requested_by: str, role: str) -> str:
        """Personalized now playing message"""
        if role == 'owner':
            return (
                f"{Colors.GOLD}👑 {Colors.AMBER}═══ NOW PLAYING ═══\n"
                f"{Colors.YELLOW}🎵 {title}\n"
                f"{Colors.GOLD}👤 {artist}\n"
                f"{Colors.AMBER}Requested by the Supreme {requested_by}\n"
                f"{Colors.GOLD}═══════════════════════"
            )
        elif role == 'admin':
            return (
                f"{Colors.PURPLE}⚡ {Colors.VIOLET}━━━ NOW PLAYING ━━━\n"
                f"{Colors.LAVENDER}🎵 {title}\n"
                f"{Colors.MAGENTA}👤 {artist}\n"
                f"{Colors.PURPLE}Admin {requested_by} commanding the vibe!\n"
                f"{Colors.VIOLET}━━━━━━━━━━━━━━━━━━━━"
            )
        elif role == 'vip':
            return (
                f"{Colors.PINK}💎 {Colors.ROSE}~~~ NOW PLAYING ~~~\n"
                f"{Colors.LIGHT_PINK}🎵 {title}\n"
                f"{Colors.PINK}👤 {artist}\n"
                f"{Colors.SOFT_PINK}VIP {requested_by}'s premium pick!\n"
                f"{Colors.ROSE}~~~~~~~~~~~~~~~~~~~~"
            )
        else:
            return (
                f"{Colors.SKY_BLUE}🎵 {Colors.CYAN}NOW PLAYING\n"
                f"{Colors.LIGHT_BLUE}♪ {title}\n"
                f"{Colors.SKY_BLUE}👤 {artist}\n"
                f"{Colors.CYAN}Requested by {requested_by}"
            )
    
    # ═══════════════════════════════════════════════════════════════
    # BALANCE & ECONOMY MESSAGES
    # ═══════════════════════════════════════════════════════════════
    
    @staticmethod
    def balance_display(username: str, balance: int, role: str) -> str:
        """Personalized balance display"""
        if role == 'owner':
            return (
                f"{Colors.GOLD}👑 {Colors.AMBER}ROYAL TREASURY\n"
                f"{Colors.YELLOW}💰 {balance:,} points\n"
                f"{Colors.GOLD}Owner {username}\n"
                f"{Colors.AMBER}Infinite power at your command!"
            )
        elif role == 'admin':
            return (
                f"{Colors.PURPLE}⚡ {Colors.VIOLET}ADMIN WALLET\n"
                f"{Colors.LAVENDER}💳 {balance:,} points\n"
                f"{Colors.MAGENTA}Admin {username}\n"
                f"{Colors.PURPLE}Management perks active!"
            )
        elif role == 'vip':
            return (
                f"{Colors.PINK}💎 {Colors.ROSE}VIP ACCOUNT\n"
                f"{Colors.LIGHT_PINK}💰 {balance:,} points\n"
                f"{Colors.SOFT_PINK}VIP {username}\n"
                f"{Colors.PINK}Premium benefits included! ✨"
            )
        else:
            return (
                f"{Colors.SKY_BLUE}💰 {Colors.CYAN}Your Balance\n"
                f"{Colors.LIGHT_BLUE}{balance:,} points\n"
                f"{Colors.SKY_BLUE}💡 Tip gold to earn more!"
            )
    
    # ═══════════════════════════════════════════════════════════════
    # PERMISSION DENIED MESSAGES
    # ═══════════════════════════════════════════════════════════════
    
    @staticmethod
    def permission_denied(required_role: str, current_role: str) -> str:
        """Creative permission denied message"""
        messages = {
            'owner_required': [
                f"{Colors.ORANGE}👑 {Colors.GOLD}OWNER ACCESS REQUIRED\n{Colors.AMBER}This command is reserved for the Supreme Leader!",
                f"{Colors.RED}⚠️ {Colors.GOLD}Whoa there! Only the Owner can use this!\n{Colors.AMBER}You need the crown for this one! 👑",
            ],
            'admin_required': [
                f"{Colors.ORANGE}⚡ {Colors.PURPLE}ADMIN ACCESS REQUIRED\n{Colors.VIOLET}This command needs management clearance!",
                f"{Colors.RED}⚠️ {Colors.MAGENTA}Sorry! Admin powers needed for this!\n{Colors.PURPLE}Contact an Admin for help! 🛡️",
            ],
            'vip_required': [
                f"{Colors.ORANGE}💎 {Colors.PINK}VIP ACCESS REQUIRED\n{Colors.ROSE}Upgrade to VIP for premium features!",
                f"{Colors.RED}⚠️ {Colors.LIGHT_PINK}This is a VIP exclusive!\n{Colors.PINK}Ask an Admin about VIP status! ✨",
            ]
        }
        
        key = f"{required_role.lower()}_required"
        options = messages.get(key, [f"{Colors.RED}❌ Access Denied"])
        return random.choice(options)
    
    # ═══════════════════════════════════════════════════════════════
    # THANK YOU MESSAGES
    # ═══════════════════════════════════════════════════════════════
    
    @staticmethod
    def thank_you(username: str, role: str, action: str = "support") -> str:
        """Personalized thank you message"""
        if role == 'owner':
            return f"{Colors.GOLD}👑 {Colors.AMBER}Thank you, Supreme Leader {username}!\n{Colors.YELLOW}Your {action} keeps the kingdom thriving! ✨"
        elif role == 'admin':
            return f"{Colors.PURPLE}⚡ {Colors.VIOLET}Thanks, Admin {username}!\n{Colors.MAGENTA}Your {action} powers the system! 🛡️"
        elif role == 'vip':
            return f"{Colors.PINK}💎 {Colors.ROSE}Thank you, VIP {username}!\n{Colors.LIGHT_PINK}Your {action} means everything! ✨"
        else:
            return f"{Colors.MINT}✨ {Colors.SKY_BLUE}Thanks, {username}!\n{Colors.CYAN}Your {action} is appreciated! 🎉"
    
    # ═══════════════════════════════════════════════════════════════
    # UTILITY: Get User Role
    # ═══════════════════════════════════════════════════════════════
    
    @staticmethod
    def get_user_role(admin_manager, username: str) -> str:
        """
        Determine user's role using the admin manager
        
        Args:
            admin_manager: Instance of AdminManager
            username: User's username
            
        Returns:
            'owner', 'admin', 'vip', or 'normal'
        """
        if admin_manager.is_owner(username):
            return 'owner'
        elif admin_manager.is_admin(username):
            return 'admin'
        elif admin_manager.is_vip(username):
            return 'vip'
        else:
            return 'normal'
    
    # ═══════════════════════════════════════════════════════════════
    # ROLE BADGES
    # ═══════════════════════════════════════════════════════════════
    
    @staticmethod
    def get_role_badge(role: str) -> str:
        """Get a decorative badge for the user's role"""
        badges = {
            'owner': f"{Colors.GOLD}👑",
            'admin': f"{Colors.PURPLE}⚡",
            'vip': f"{Colors.PINK}💎",
            'normal': f"{Colors.SKY_BLUE}🎵"
        }
        return badges.get(role.lower(), badges['normal'])
    
    @staticmethod
    def get_role_name(role: str, colored: bool = True) -> str:
        """Get formatted role name"""
        if not colored:
            return role.upper()
        
        names = {
            'owner': f"{Colors.GOLD}OWNER",
            'admin': f"{Colors.PURPLE}ADMIN",
            'vip': f"{Colors.PINK}VIP",
            'normal': f"{Colors.SKY_BLUE}MEMBER"
        }
        return names.get(role.lower(), names['normal'])
