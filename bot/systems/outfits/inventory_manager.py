import json
import os
from datetime import datetime

class InventoryManager:
    def __init__(self):
        self.inventory_file = "inventory/bot_inventory.json"
        self.last_fetched = None
        self.items = []
    
    async def fetch_inventory(self, highrise_client):
        """Fetch bot's inventory from Highrise"""
        try:
            inventory_response = await highrise_client.get_inventory()
            
            self.items = []
            
            if hasattr(inventory_response, 'items'):
                inventory_items = inventory_response.items
            else:
                inventory_items = []
            
            for item in inventory_items:
                item_data = {
                    'id': item.id if hasattr(item, 'id') else str(item),
                    'type': item.type if hasattr(item, 'type') else 'clothing',
                    'category': item.category if hasattr(item, 'category') else 'unknown'
                }
                self.items.append(item_data)
            
            self.last_fetched = datetime.now().isoformat()
            self.save_inventory()
            return True
        except Exception as e:
            print(f"Error fetching inventory: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def save_inventory(self):
        """Save inventory to JSON file"""
        try:
            data = {
                'last_fetched': self.last_fetched,
                'total_items': len(self.items),
                'items': self.items
            }
            
            os.makedirs(os.path.dirname(self.inventory_file), exist_ok=True)
            with open(self.inventory_file, 'w') as f:
                json.dump(data, f, indent=2)
            return True
        except Exception as e:
            print(f"Error saving inventory: {e}")
            return False
    
    def load_inventory(self):
        """Load inventory from JSON file"""
        try:
            if os.path.exists(self.inventory_file):
                with open(self.inventory_file, 'r') as f:
                    data = json.load(f)
                    self.items = data.get('items', [])
                    self.last_fetched = data.get('last_fetched')
                return True
            return False
        except Exception as e:
            print(f"Error loading inventory: {e}")
            return False
    
    def get_items_by_category(self, category):
        """Get items filtered by category"""
        return [item for item in self.items if item.get('category') == category]
    
    def get_item_count(self):
        """Get total number of items"""
        return len(self.items)
    
    def get_categories(self):
        """Get list of unique categories"""
        categories = set()
        for item in self.items:
            cat = item.get('category', 'unknown')
            categories.add(cat)
        return sorted(list(categories))
    
    def generate_random_outfit(self):
        """Generate a completely random outfit from inventory items"""
        import random
        from highrise.models import Item
        
        if not self.items:
            return None
        
        outfit = []
        
        # Group items by their ID prefix to understand item types
        categories = {}
        for item in self.items:
            item_id = item.get('id', '')
            item_type = item.get('type', 'clothing')
            
            # Extract category from item ID (e.g., 'shirt-', 'pants-', 'hair-', etc.)
            if '-' in item_id:
                prefix = item_id.split('-')[0]
                if prefix not in categories:
                    categories[prefix] = []
                categories[prefix].append(item)
        
        # Prioritize essential clothing items and add random accessories
        essential_prefixes = ['body', 'eye', 'eyebrow', 'nose', 'mouth']
        clothing_prefixes = ['shirt', 'pants', 'shoes', 'dress', 'jacket', 'top', 'bottom']
        hair_prefixes = ['hair_front', 'hair_back', 'hair']
        accessory_prefixes = ['glasses', 'hat', 'earrings', 'necklace', 'bag', 'watch', 'freckle', 'mole']
        
        # Add essential items (body parts)
        for prefix in essential_prefixes:
            if prefix in categories and categories[prefix]:
                chosen = random.choice(categories[prefix])
                outfit.append(Item(
                    type=chosen.get('type', 'clothing'),
                    amount=1,
                    id=chosen.get('id', ''),
                    active_palette=random.randint(0, 7)  # Random color palette
                ))
        
        # Add hair items
        for prefix in hair_prefixes:
            if prefix in categories and categories[prefix]:
                chosen = random.choice(categories[prefix])
                outfit.append(Item(
                    type=chosen.get('type', 'clothing'),
                    amount=1,
                    id=chosen.get('id', ''),
                    active_palette=random.randint(0, 7)
                ))
        
        # Add clothing items
        for prefix in clothing_prefixes:
            if prefix in categories and categories[prefix]:
                chosen = random.choice(categories[prefix])
                outfit.append(Item(
                    type=chosen.get('type', 'clothing'),
                    amount=1,
                    id=chosen.get('id', ''),
                    active_palette=random.randint(0, 7)
                ))
        
        # Randomly add accessories (50% chance for each category)
        for prefix in accessory_prefixes:
            if prefix in categories and categories[prefix] and random.random() > 0.5:
                chosen = random.choice(categories[prefix])
                outfit.append(Item(
                    type=chosen.get('type', 'clothing'),
                    amount=1,
                    id=chosen.get('id', ''),
                    active_palette=random.randint(0, 7)
                ))
        
        return outfit if outfit else None
