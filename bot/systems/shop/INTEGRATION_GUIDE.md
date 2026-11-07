# How to Integrate Shop System into Your Bot

## ✨ NEW: Uses Highrise Web API!

This shop system now fetches **real-time item data** from the Highrise Web API (`self.webapi.get_items()`), so items are always up-to-date!

## Step 1: Import ShopManager

Add this to the top of `bot.py`:

```python
from shop import ShopManager
```

## Step 2: Initialize ShopManager

In the `__init__` method of your `MusicBot` class, add:

```python
self.shop = ShopManager()
```

This should go with your other manager initializations (around line 150).

## Step 3: Update Command Handler

In your `on_chat` method, **replace** the old `!buy` section with this new code:

### Find and Replace the OLD buy command

**OLD CODE** (around line 1174-1246):
```python
if message.startswith("!buy "):
    item_id = message[5:].strip()
    # ... old buy logic ...
```

**REPLACE WITH NEW CODE**:
```python
if message.startswith("!buy "):
    query = message[5:].strip()
    
    # Check if user is selecting from search results (e.g., "!buy 1")
    if query.isdigit():
        await self.shop.handle_select(
            user_id,
            query,
            self.highrise,
            self.inventory_manager,
            lambda msg: self.highrise.chat(msg)
        )
    else:
        # Search for item by name
        await self.shop.handle_buy_command(
            user_id,
            query,
            self.highrise,
            self.webapi,  # Pass webapi for fetching items
            self.inventory_manager,
            lambda msg: self.highrise.chat(msg)
        )
    return

elif message == "!confirm":
    await self.shop.handle_confirm(
        user_id,
        self.highrise,
        self.inventory_manager,
        lambda msg: self.highrise.chat(msg)
    )
    return

elif message == "!cancel":
    await self.shop.handle_cancel(
        user_id,
        lambda msg: self.highrise.chat(msg)
    )
    return
```

## Step 4: Test the System

1. Restart your bot
2. Try these commands:
   - `!buy tank white` - Search for tank white
   - `!buy 1` - Select first result
   - `!confirm` - Confirm purchase
   - `!cancel` - Cancel if needed

## Example User Flow

```
👤 User: !buy red jacket
🤖 Bot: 📡 Fetching items from Highrise Web API...
        ✅ Loaded 500+ items from API
        🔍 Found 3 items:
        1. 👕 Red Off-shoulder Track Jacket
        2. 👕 Red Raglan Hoodie
        3. 👕 Red Puffer and T
        Type: !buy [number] to select

👤 User: !buy 1
🤖 Bot: 🛍️ Item Details:
        👕 Name: Red Off-shoulder Track Jacket
        🆔 ID: shirt-n_room32019slouchyredtrackjacket
        📦 Category: shirt
        Type !confirm to buy or !cancel

👤 User: !confirm
🤖 Bot: 🛒 Purchasing Red Off-shoulder Track Jacket...
        ✅ Successfully bought!
        🎉 Red Off-shoulder Track Jacket added!
        🔄 Refreshing inventory...
        📦 Inventory updated!
```

## Benefits Over Old System

✅ **Real-time data** - Items fetched from Highrise API (always current)
✅ **No need to know exact item IDs** - Just type the name  
✅ **Smart search** - Finds items even with partial names  
✅ **Confirmation step** - See details before buying
✅ **Better error messages** - Clear feedback on what went wrong
✅ **Cleaner code** - Separated from main bot file

## Quick Commands Reference

- `!buy [item name]` - Search for items (e.g., `!buy tank white`)
- `!buy [number]` - Select from search results (e.g., `!buy 1`)
- `!confirm` - Confirm purchase
- `!cancel` - Cancel purchase or search

## Technical Details

### Web API Integration

The system uses `self.webapi.get_items()` to fetch all available items from Highrise. Items are cached in memory and automatically loaded when needed.

### Item Categories Detected

The system automatically categorizes items based on ID prefix:
- `shirt-*` → Shirts/Tops (👕)
- `pants-*`, `shorts-*`, `skirt-*` → Bottoms (👖)
- `shoes-*` → Shoes (👟)
- `hair_front-*`, `hair_back-*` → Hair (💇)
- `eye-*`, `eyebrow-*`, `nose-*`, `mouth-*`, `face_hair-*` → Facial (💇)
- `freckle-*` → Freckles/Decorations (✨)
- `watch-*`, `gloves-*`, `handbag-*`, `hat-*` → Accessories (⌚)
