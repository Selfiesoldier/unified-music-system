import asyncio
from typing import Optional, Dict
from .item_search import ItemSearch
from core.cooldowns import check_cd
from core.color_formatter import Colors, MessageFormatter

class ShopManager:
    def __init__(self):
        self.item_search = ItemSearch()
        self.pending_purchases = {}
    
    async def ensure_items_loaded(self, webapi):
        """Ensure items are loaded from API"""
        if not self.item_search.items_loaded_from_api:
            await self.item_search.load_items_from_api(webapi)
    
    async def handle_buy_command(self, user_id: str, query: str, highrise_client, webapi, inventory_manager, chat_callback):
        """
        Handle buy command with item search
        Returns True if purchase flow was initiated, False otherwise
        """
        remaining = check_cd(user_id, "buy", 10)
        if remaining > 0:
            await chat_callback(MessageFormatter.cooldown(remaining))
            return False
        
        if not query or query.strip() == "":
            msg = f"{Colors.RED}❌ Use: {Colors.LAVENDER}!buy [item name]\n{Colors.CYAN}Ex: !buy tank white"
            await chat_callback(msg)
            return False
        
        # Ensure items are loaded from API
        await self.ensure_items_loaded(webapi)
        
        # Search for items matching the query
        results = self.item_search.search_items(query, limit=5)
        
        if not results:
            msg = f"{Colors.RED}❌ No items: {Colors.PINK}{query}\n{Colors.SKY_BLUE}Try different search"
            await chat_callback(msg)
            return False
        
        # If only one result with high confidence, show it
        if len(results) == 1 and results[0]['score'] >= 60:
            item = results[0]
            await self._show_purchase_confirmation(user_id, item, highrise_client, inventory_manager, chat_callback)
            return True
        
        # Multiple results - show options
        await self._show_search_results(user_id, results, chat_callback)
        return True
    
    async def handle_select(self, user_id: str, selection: str, highrise_client, inventory_manager, chat_callback):
        """Handle selection from search results (e.g., !buy 1)"""
        # Check if there's a pending search result
        if user_id not in self.pending_purchases:
            msg = f"{Colors.RED}❌ No results\n{Colors.SKY_BLUE}Use !buy [item] first"
            await chat_callback(msg)
            return False
        
        # Get stored search results
        stored_data = self.pending_purchases[user_id]
        
        # Check if this is search results or confirmation
        if stored_data.get('type') == 'search_results':
            results = stored_data.get('results', [])
            
            try:
                index = int(selection) - 1
                if index < 0 or index >= len(results):
                    msg = f"{Colors.RED}❌ Invalid selection\n{Colors.SKY_BLUE}Choose 1-{len(results)}"
                    await chat_callback(msg)
                    return False
                
                # Get selected item
                item = results[index]
                await self._show_purchase_confirmation(user_id, item, highrise_client, inventory_manager, chat_callback)
                return True
                
            except ValueError:
                msg = f"{Colors.RED}❌ Invalid number\n{Colors.CYAN}Example: !buy 1"
                await chat_callback(msg)
                return False
        else:
            await chat_callback(MessageFormatter.error("No search results to select from"))
            return False
    
    async def _show_search_results(self, user_id: str, results: list, chat_callback):
        """Display search results to user"""
        msg = f"{Colors.CYAN}🔍 Found {Colors.PINK}{len(results)} items"
        await chat_callback(msg)
        await asyncio.sleep(0.2)
        
        for i, item in enumerate(results, 1):
            category_emoji = self._get_category_emoji(item['category'])
            item_msg = MessageFormatter.item_found(i, item['name'], item['category'], category_emoji)
            await chat_callback(item_msg)
            await asyncio.sleep(0.2)
        
        msg = f"{Colors.SKY_BLUE}Type {Colors.LAVENDER}!buy [#] {Colors.SKY_BLUE}to pick\n{Colors.CYAN}Ex: !buy 1"
        await chat_callback(msg)
        
        # Store search results for later selection
        self.pending_purchases[user_id] = {
            'type': 'search_results',
            'results': results
        }
    
    async def _show_purchase_confirmation(self, user_id: str, item: Dict, highrise_client, inventory_manager, chat_callback):
        """Show item details and ask for confirmation"""
        category_emoji = self._get_category_emoji(item['category'])
        
        # Check if already owned
        owned_items = inventory_manager.items
        already_owned = any(owned_item.get('id') == item['id'] for owned_item in owned_items)
        
        if already_owned:
            msg = f"{Colors.ORANGE}⚠️ Already own: {Colors.PINK}{item['name']}"
            await chat_callback(msg)
            # Clear pending data
            if user_id in self.pending_purchases:
                del self.pending_purchases[user_id]
            return
        
        # Store pending purchase
        self.pending_purchases[user_id] = {
            'type': 'confirmation',
            'item': item
        }
        
        # Show confirmation
        await chat_callback(f"{Colors.PINK}🛍️ Item Preview")
        await asyncio.sleep(0.2)
        await chat_callback(f"{category_emoji} {Colors.PINK}{item['name']}")
        await asyncio.sleep(0.2)
        await chat_callback(f"{Colors.PURPLE}{item['category']} {Colors.LIGHT_GRAY}• ID: {item['id'][:8]}...")
        await asyncio.sleep(0.2)
        msg = f"{Colors.MINT}!confirm {Colors.SKY_BLUE}to buy • {Colors.RED}!cancel"
        await chat_callback(msg)
    
    async def handle_confirm(self, user_id: str, highrise_client, inventory_manager, chat_callback):
        """Handle purchase confirmation"""
        if user_id not in self.pending_purchases:
            msg = f"{Colors.RED}❌ No pending buy\n{Colors.SKY_BLUE}Use !buy [item] first"
            await chat_callback(msg)
            return False
        
        stored_data = self.pending_purchases[user_id]
        
        # Make sure we have a confirmation pending, not search results
        if stored_data.get('type') != 'confirmation':
            msg = f"{Colors.RED}❌ No item selected\n{Colors.SKY_BLUE}Pick one first"
            await chat_callback(msg)
            return False
        
        item = stored_data.get('item')
        if not item:
            msg = f"{Colors.RED}❌ Data lost\n{Colors.SKY_BLUE}Search again"
            await chat_callback(msg)
            del self.pending_purchases[user_id]
            return False
        
        item_id = item['id']
        
        try:
            msg = f"{Colors.PURPLE}🛒 Purchasing {Colors.PINK}{item['name']}{Colors.PURPLE}..."
            await chat_callback(msg)
            await asyncio.sleep(0.3)
            
            # Call Highrise API to purchase
            result = await highrise_client.buy_item(item_id)
            
            # Check for errors
            if hasattr(result, 'message'):
                error_msg = result.message if hasattr(result, 'message') else str(result)
                print(f"❌ Purchase failed: {error_msg}")
                
                # User-friendly error messages
                if "not enough" in error_msg.lower() or "insufficient" in error_msg.lower():
                    await chat_callback(MessageFormatter.error("Not enough gold!"))
                elif "not found" in error_msg.lower():
                    await chat_callback(MessageFormatter.error("Item not available!"))
                else:
                    await chat_callback(MessageFormatter.error(f"Purchase failed: {error_msg[:50]}"))
                
                # Clear pending purchase
                del self.pending_purchases[user_id]
                return False
            
            # Success!
            await chat_callback(f"{Colors.MINT}✅ Purchased!")
            await asyncio.sleep(0.3)
            msg = f"{Colors.PINK}🎉 {item['name']}"
            await chat_callback(msg)
            
            # Refresh inventory
            await asyncio.sleep(0.3)
            await chat_callback(f"{Colors.CYAN}🔄 Updating inventory...")
            await inventory_manager.fetch_inventory(highrise_client)
            await chat_callback(f"{Colors.MINT}📦 Done!")
            
            # Clear pending purchase
            del self.pending_purchases[user_id]
            return True
            
        except Exception as e:
            error_msg = str(e)
            print(f"❌ Purchase exception: {error_msg}")
            
            if "not enough" in error_msg.lower() or "insufficient" in error_msg.lower():
                await chat_callback(MessageFormatter.error("Not enough gold!"))
            else:
                await chat_callback(MessageFormatter.error(f"Error: {error_msg[:50]}"))
            
            # Clear pending purchase
            del self.pending_purchases[user_id]
            return False
    
    async def handle_cancel(self, user_id: str, chat_callback):
        """Cancel pending purchase"""
        if user_id in self.pending_purchases:
            stored_data = self.pending_purchases[user_id]
            
            if stored_data.get('type') == 'confirmation':
                item = stored_data.get('item')
                msg = f"{Colors.RED}❌ Cancelled: {Colors.PINK}{item['name']}"
                await chat_callback(msg)
            else:
                await chat_callback(f"{Colors.ORANGE}❌ Cancelled")
            
            del self.pending_purchases[user_id]
            return True
        else:
            await chat_callback(MessageFormatter.error("Nothing to cancel"))
            return False
    
    def _get_category_emoji(self, category: str) -> str:
        """Get emoji for item category"""
        emoji_map = {
            'shirt': '👕',
            'bottoms': '👖',
            'shoes': '👟',
            'accessories': '⌚',
            'facial': '💇',
            'freckle': '✨',
            'hair': '💇',
            'other': '📦'
        }
        return emoji_map.get(category, '📦')
    
    def has_pending_purchase(self, user_id: str) -> bool:
        """Check if user has a pending purchase"""
        return user_id in self.pending_purchases
    
    def get_pending_item(self, user_id: str) -> Optional[Dict]:
        """Get pending purchase item for user"""
        if user_id in self.pending_purchases:
            stored_data = self.pending_purchases[user_id]
            return stored_data.get('item')
        return None
