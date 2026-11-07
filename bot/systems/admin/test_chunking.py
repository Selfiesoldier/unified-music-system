"""
Test Commands for Auto-Chunking System
ADMIN-ONLY test commands to verify message chunking works correctly
"""
from core.color_formatter import Colors


def register(bot):
    """Register test commands"""
    
    @bot.command("testchunk")
    async def testchunk_cmd(user, message):
        """Test auto-chunking with a very long message"""
        if not bot.admin.has_admin_access(user.username):
            return
        
        # Create a message that definitely exceeds 240 characters
        long_message = (
            f"{Colors.CYAN}📋 Auto-Chunking Test Message\n\n"
            f"{Colors.PINK}This is a test message to demonstrate the automatic message chunking system. "
            f"This message is intentionally long to exceed the 240-character limit that Highrise imposes. "
            f"The system should automatically split this into multiple messages and send them with small delays between each chunk. "
            f"If you see this message split across multiple chat bubbles with a short delay between them, "
            f"then the auto-chunking system is working correctly! ✅\n\n"
            f"{Colors.LAVENDER}Message length: {len('test')} characters"
        )
        
        # Calculate actual length
        long_message = long_message.replace('{len("test")}', str(len(long_message)))
        
        # Use the new auto-chunking send_message method
        chunks_sent = await bot.send_message(long_message)
        
        # Notify how many chunks were sent
        await bot.highrise.send_whisper(user.id, 
            f"{Colors.MINT}✅ Test complete! Sent {chunks_sent} chunk(s)")
    
    @bot.command("testwhisper")
    async def testwhisper_cmd(user, message):
        """Test auto-chunking with a long whisper message"""
        if not bot.admin.has_admin_access(user.username):
            return
        
        # Create a very long whisper
        long_whisper = (
            f"{Colors.GOLD}🔒 Private Long Message Test\n\n"
            f"{Colors.LAVENDER}Line 1: This is a test of the whisper chunking system.\n"
            f"{Colors.LAVENDER}Line 2: Whispers should also be automatically chunked.\n"
            f"{Colors.LAVENDER}Line 3: This helps when sending long private messages.\n"
            f"{Colors.LAVENDER}Line 4: Like detailed command help or user profiles.\n"
            f"{Colors.LAVENDER}Line 5: The system preserves newlines when possible.\n"
            f"{Colors.LAVENDER}Line 6: And adds delays between chunks to avoid spam.\n"
            f"{Colors.LAVENDER}Line 7: You should see this split across multiple whispers.\n"
            f"{Colors.LAVENDER}Line 8: If you do, the system works perfectly! ✅"
        )
        
        # Send using auto-chunking
        chunks_sent = await bot.send_message(long_whisper, user_id=user.id)
        
        # Follow-up notification
        await bot.highrise.send_whisper(user.id,
            f"{Colors.MINT}✅ Whisper test complete! {chunks_sent} chunk(s) sent")
