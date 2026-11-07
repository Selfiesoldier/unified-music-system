# Shop System

A clean item search and purchase system for the Highrise bot.

## Features

- **Smart Item Search**: Search items by name instead of needing exact IDs
- **Fuzzy Matching**: Finds items even with partial names
- **Purchase Confirmation**: Shows item details and asks for confirmation before buying
- **User-Friendly**: Clear error messages and step-by-step guidance

## Usage

### Search and Buy Items

```
!buy tank white          → Search for "tank white"
!buy 1                   → Select first result from search
!confirm                 → Confirm the purchase
!cancel                  → Cancel the purchase
```

## How It Works

1. **Item Search** (`item_search.py`)
   - Loads all items from JSON files (shirts, bottoms, shoes, accessories, hair, freckles)
   - Provides fuzzy search with scoring
   - Returns best matches with IDs and categories

2. **Shop Manager** (`shop_manager.py`)
   - Handles the purchase flow
   - Manages pending purchases (one per user)
   - Shows confirmation with item details
   - Integrates with Highrise API for actual purchases

## Integration with Bot

Add to your bot's `__init__`:
```python
from shop import ShopManager
self.shop = ShopManager()
```

Handle commands in `on_chat`:
```python
if message.startswith("!buy "):
    query = message[5:].strip()
    await self.shop.handle_buy_command(
        user_id, 
        query, 
        self.highrise, 
        self.inventory_manager,
        lambda msg: self.highrise.chat(msg)
    )

elif message == "!confirm":
    await self.shop.handle_confirm(
        user_id,
        self.highrise,
        self.inventory_manager,
        lambda msg: self.highrise.chat(msg)
    )

elif message == "!cancel":
    await self.shop.handle_cancel(
        user_id,
        lambda msg: self.highrise.chat(msg)
    )
```

## Example Flow

```
User: !buy tank white
Bot: 🔍 Found 2 items:
     1. 👕 Tank - White
     2. 👕 Tank - Black
     Type: !buy [number] to select
     Example: !buy 1

User: !buy 1
Bot: 🛍️ Item Details:
     👕 Name: Tank - White
     🆔 ID: shirt-n_starteritems2019tankwhite
     📦 Category: shirt
     Type !confirm to buy or !cancel

User: !confirm
Bot: 🛒 Purchasing Tank - White...
     ✅ Successfully bought!
     🎉 Tank - White added!
     🔄 Refreshing inventory...
     📦 Inventory updated!
```
