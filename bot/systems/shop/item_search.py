import json
import os
from typing import List, Dict, Optional

class ItemSearch:
    def __init__(self):
        self.items_database = {}
        self.last_updated = None
        self.items_loaded_from_api = False
    
    async def load_items_from_api(self, webapi):
        """Load all items from Highrise Web API using raw HTTP request"""
        try:
            print("📡 Fetching items from Highrise Web API...")
            
            # Make raw HTTP request to bypass SDK's strict enum validation
            import aiohttp
            
            async with aiohttp.ClientSession() as session:
                url = "https://webapi.highrise.game/items"
                async with session.get(url) as response:
                    if response.status != 200:
                        print(f"⚠️ API returned status {response.status}")
                        return self.load_items_from_files()
                    
                    data = await response.json()
            
            self.items_database = {}
            
            # Parse raw JSON response
            items = data.get('items', [])
            if not items:
                print("⚠️ No items in API response")
                return self.load_items_from_files()
            
            # Build searchable database
            item_count = 0
            for item in items:
                try:
                    # Get item details from raw JSON
                    item_id = item.get('item_id') or item.get('id')
                    item_name = item.get('item_name') or item.get('name', 'Unknown Item')
                    
                    if not item_id:
                        continue
                    
                    # Determine category from ID prefix
                    category = self._get_category_from_id(item_id)
                    
                    self.items_database[item_id] = {
                        'id': item_id,
                        'name': item_name,
                        'category': category
                    }
                    item_count += 1
                except Exception as e:
                    continue
            
            if item_count > 0:
                print(f"✅ Loaded {item_count} items from API")
                import datetime
                self.last_updated = datetime.datetime.now()
                self.items_loaded_from_api = True
                return True
            else:
                print("⚠️ No items parsed from API, falling back to files")
                return self.load_items_from_files()
            
        except Exception as e:
            print(f"❌ Failed to load items from API: {e}")
            print("📦 Falling back to local JSON files...")
            return self.load_items_from_files()
    
    def load_items_from_files(self):
        """Load all items from JSON files"""
        try:
            print("📦 Loading items from inventory files...")
            
            # Get the correct path to inventory folder
            current_dir = os.path.dirname(os.path.abspath(__file__))
            parent_dir = os.path.dirname(current_dir)
            
            # Try parent directory first (when running from shop/)
            if os.path.exists(os.path.join(parent_dir, 'inventory')):
                inventory_path = os.path.join(parent_dir, 'inventory')
            else:
                inventory_path = "inventory"
            
            item_files = {
                'shirt': 'shirt_items.json',
                'bottoms': 'bottoms_items.json',
                'shoes': 'shoes_items.json',
                'accessories': 'accessories_items.json',
                'freckle': 'freckle_items.json',
                'hair': 'hair_items.json'
            }
            
            for category, filename in item_files.items():
                filepath = os.path.join(inventory_path, filename)
                if os.path.exists(filepath):
                    try:
                        with open(filepath, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                            
                            if category == 'hair':
                                self._load_hair_items(data)
                            elif category == 'freckle':
                                self._load_freckle_items(data)
                            else:
                                self._load_regular_items(data, category)
                        
                        print(f"✅ Loaded {category} items")
                    except Exception as e:
                        print(f"⚠️ Could not load {filename}: {e}")
            
            print(f"📦 Total items loaded: {len(self.items_database)}")
            import datetime
            self.last_updated = datetime.datetime.now()
            return True
            
        except Exception as e:
            print(f"❌ Failed to load items: {e}")
            return False
    
    def _load_regular_items(self, data: dict, category: str):
        """Load regular item format (shirt, bottoms, shoes, accessories)"""
        for item_id, item_info in data.items():
            if isinstance(item_info, dict) and 'item_name' in item_info:
                self.items_database[item_id] = {
                    'id': item_id,
                    'name': item_info['item_name'],
                    'category': category
                }
    
    def _load_hair_items(self, data: dict):
        """Load hair items (different structure)"""
        for category_key, items in data.items():
            if isinstance(items, dict):
                for item_id, item_name in items.items():
                    if item_id.startswith('hair_') or item_id.startswith('eye') or item_id.startswith('mouth') or item_id.startswith('nose') or item_id.startswith('face_hair'):
                        self.items_database[item_id] = {
                            'id': item_id,
                            'name': item_name,
                            'category': 'facial'
                        }
    
    def _load_freckle_items(self, data: dict):
        """Load freckle/face decoration items"""
        for item_id, item_info in data.items():
            if isinstance(item_info, dict) and 'item_name' in item_info:
                self.items_database[item_id] = {
                    'id': item_id,
                    'name': item_info['item_name'],
                    'category': 'freckle'
                }
    
    def _get_category_from_id(self, item_id: str) -> str:
        """Determine category from item ID prefix"""
        if item_id.startswith('shirt-'):
            return 'shirt'
        elif item_id.startswith('pants-') or item_id.startswith('shorts-') or item_id.startswith('skirt-'):
            return 'bottoms'
        elif item_id.startswith('shoes-'):
            return 'shoes'
        elif item_id.startswith('hair_front-') or item_id.startswith('hair_back-'):
            return 'hair'
        elif item_id.startswith('eye-') or item_id.startswith('eyebrow-') or item_id.startswith('nose-') or item_id.startswith('mouth-') or item_id.startswith('face_hair-'):
            return 'facial'
        elif item_id.startswith('freckle-'):
            return 'freckle'
        elif item_id.startswith('watch-') or item_id.startswith('gloves-') or item_id.startswith('handbag-') or item_id.startswith('hat-'):
            return 'accessories'
        else:
            return 'other'
    
    def search_items(self, query: str, limit: int = 5) -> List[Dict]:
        """
        Search for items by name (fuzzy matching)
        Returns list of matching items with their IDs
        """
        query = query.lower().strip()
        
        if not query:
            return []
        
        matches = []
        
        for item_id, item_info in self.items_database.items():
            item_name = item_info['name'].lower()
            
            # Exact match (highest priority)
            if query == item_name:
                matches.append({
                    'score': 100,
                    'id': item_info['id'],
                    'name': item_info['name'],
                    'category': item_info['category'],
                    'rarity': item_info.get('rarity')
                })
            # Starts with query
            elif item_name.startswith(query):
                matches.append({
                    'score': 80,
                    'id': item_info['id'],
                    'name': item_info['name'],
                    'category': item_info['category'],
                    'rarity': item_info.get('rarity')
                })
            # Contains query
            elif query in item_name:
                matches.append({
                    'score': 60,
                    'id': item_info['id'],
                    'name': item_info['name'],
                    'category': item_info['category'],
                    'rarity': item_info.get('rarity')
                })
            # Words match (for multi-word searches)
            else:
                query_words = query.split()
                item_words = item_name.split()
                matching_words = sum(1 for word in query_words if any(word in item_word for item_word in item_words))
                
                if matching_words > 0:
                    score = (matching_words / len(query_words)) * 40
                    matches.append({
                        'score': score,
                        'id': item_info['id'],
                        'name': item_info['name'],
                        'category': item_info['category'],
                        'rarity': item_info.get('rarity')
                    })
        
        # Sort by score (highest first) and limit results
        matches.sort(key=lambda x: x['score'], reverse=True)
        return matches[:limit]
    
    def get_item_by_id(self, item_id: str) -> Optional[Dict]:
        """Get item details by exact ID"""
        if item_id in self.items_database:
            return self.items_database[item_id]
        return None
    
    def get_total_items(self) -> int:
        """Get total number of items in database"""
        return len(self.items_database)
