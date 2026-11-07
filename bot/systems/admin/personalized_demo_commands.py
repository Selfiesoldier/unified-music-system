"""
Personalized Demo Commands - Showcase the creative messaging system
"""

from core.personalized_messages import PersonalizedMessages
from core.cooldowns import check_cd

def register(bot):
    """Register personalized demo commands"""
    
    @bot.command('greet', 'hello', 'hi')
    async def cmd_greet(bot, user, message):
        """Get a personalized greeting based on your role"""
        remaining = check_cd(user.id, "greet", 10)
        if remaining > 0:
            return
        
        # Get user's role
        role = PersonalizedMessages.get_user_role(bot.admin, user.username)
        
        # Send personalized greeting
        greeting = PersonalizedMessages.greeting(user.username, role)
        await bot.send_message(greeting, user.id)
    
    @bot.command('whoami')
    async def cmd_whoami(bot, user, message):
        """Check your role and status"""
        remaining = check_cd(user.id, "whoami", 10)
        if remaining > 0:
            return
        
        # Get user's role
        role = PersonalizedMessages.get_user_role(bot.admin, user.username)
        badge = PersonalizedMessages.get_role_badge(role)
        role_name = PersonalizedMessages.get_role_name(role)
        
        # Create role info message
        from core.color_formatter import Colors
        
        msg = f"{badge} {role_name}\n"
        msg += f"{Colors.LAVENDER}Username: {Colors.CYAN}{user.username}\n"
        
        if role == 'owner':
            msg += f"{Colors.GOLD}━━━━━━━━━━━━━━━━━\n"
            msg += f"{Colors.AMBER}Supreme Commander\n"
            msg += f"{Colors.YELLOW}All systems under your control!\n"
            msg += f"{Colors.GOLD}Full access to everything! ✨"
        elif role == 'admin':
            msg += f"{Colors.PURPLE}━━━━━━━━━━━━━━━━━\n"
            msg += f"{Colors.VIOLET}Management Level\n"
            msg += f"{Colors.MAGENTA}Admin powers active!\n"
            msg += f"{Colors.PURPLE}Can manage VIPs & commands! 🛡️"
        elif role == 'vip':
            msg += f"{Colors.PINK}━━━━━━━━━━━━━━━━━\n"
            msg += f"{Colors.ROSE}Premium Member\n"
            msg += f"{Colors.LIGHT_PINK}VIP benefits unlocked!\n"
            msg += f"{Colors.SOFT_PINK}Free music commands! 💎"
        else:
            msg += f"{Colors.SKY_BLUE}━━━━━━━━━━━━━━━━━\n"
            msg += f"{Colors.CYAN}Community Member\n"
            msg += f"{Colors.LIGHT_BLUE}Enjoying the vibe!\n"
            msg += f"{Colors.SKY_BLUE}Tip gold to earn points! 🎵"
        
        await bot.send_message(msg, user.id)
    
    @bot.command('testmsg')
    async def cmd_testmsg(user, message):
        """Test different personalized message styles (Admin only)"""
        if not bot.admin.has_admin_access(user.username):
            return
        
        from core.color_formatter import Colors
        
        # Get user's role
        role = PersonalizedMessages.get_user_role(bot.admin, user.username)
        
        # Test different message types
        msg = f"{Colors.CYAN}📋 Personalized Message Styles\n\n"
        
        # Success message
        success = PersonalizedMessages.success("Test successful!", role)
        msg += f"✅ Success:\n{success}\n\n"
        
        # Error message
        error = PersonalizedMessages.error("Test error", role)
        msg += f"❌ Error:\n{error}\n\n"
        
        # Thank you message
        thanks = PersonalizedMessages.thank_you(user.username, role, "testing")
        msg += f"💝 Thanks:\n{thanks}\n\n"
        
        # Balance display
        balance_msg = PersonalizedMessages.balance_display(user.username, 1000, role)
        msg += f"💰 Balance:\n{balance_msg}"
        
        await bot.send_message(msg, user.id)
    
    print("✅ Registered personalized demo commands: greet, whoami, testmsg")
