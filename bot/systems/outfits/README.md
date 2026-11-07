# Highrise Bot Inventory & Outfit System

This folder contains the inventory management and outfit preset system for the Highrise Music Bot.

## Structure

- `inventory_manager.py` - Handles fetching and storing the bot's clothing inventory
- `outfit_presets.py` - Manages outfit presets for different occasions
- `bot_inventory.json` - Cached inventory data (auto-generated)
- `hair_items.json` - Complete reference of all facial feature items in Highrise:
  - 93 hair_front items
  - 106 hair_back items  
  - 27 face_hair items
  - 35 eyebrow items
  - 65 eye items
  - 25 nose items
  - 52 mouth items
  - Total: 403 facial feature items (hair, eyes, eyebrows, nose, mouth, face hair)
- `freckle_items.json` - Complete reference of all freckle and face decoration items:
  - 18 freckle variations (pink freckles, cheek/all over/scattered freckles)
  - 4 makeup items (face glitter, sparkle cheeks, rosy cheeks, blush)
  - 2 moles (chin mole, cheek mole)
  - 2 bandaids (purple, plain)
  - 4 decorations (cheek star, cheek heart, white face jewels, pink heart freckles, cheek hearts)
  - 3 under eye shadows (white, pink, black)
  - 6 wrinkles/folds (forehead, under eye, nasal folds, cheekbone, face shadow)
  - Total: 31 freckle/face decoration items
- `FREE_ITEMS_INFO.md` - **IMPORTANT**: List of the only 20 items that are free (can be worn without owning). Only 7 skirts, 5 shoes, 7 socks, and 1 watch are free!
- `shirt_items.json` - Complete reference of all shirt/top items in Highrise:
  - 10 starter items (tanks, raglans, pullovers, basic t-shirts)
  - 8 room 3 2019 collection items (jackets, hoodies, jerseys, puffer jackets)
  - 6 room 2 collection items (jackets, shirts, overalls, bra tops, dresses)
  - 4 room 1 2019 items (sweaters, button-downs)
  - 5 special collection items (Philippine Day, flashy suit, flower shirt, bombers)
  - 4 female collection items (skull sweater, punk lace, plaid shirt, marching band top)
  - Total: 37 shirt/top items
- `bottoms_items.json` - Complete reference of all pants and skirt items in Highrise:
  - **Pants (29 items):**
    - 10 starter items (basic shorts, cuffed shorts, cuffed jeans in white/blue/black)
    - 8 room 3 2019 items (ripped jeans, track shorts/pants, long shorts)
    - 5 room 2 2019 items (undies, tech pants, denim cut-offs)
    - 6 room 1 2019 items (ripped denim, formal slacks, acid wash jeans)
  - **Skirts (9 items):**
    - 3 starter items (basic skirts in white/blue/black)
    - 2 room 2 2019 items (skirts with socks - plaid/black)
    - 3 room 1 2019 items (pleated skirts in pink/grey/black)
    - 1 female collection item (giant tutu)
  - Total: 38 bottoms items
- `shoes_items.json` - Complete reference of all shoes and sock items in Highrise:
  - **Shoes (22 items):**
    - 5 starter items (flats in white/pink/black, white converse, white dans)
    - 4 room 3 2019 items (sock sneakers grey/black, white chunky sneaks)
    - 2 room 2 2019 items (black knee high boots, pink heels)
    - 6 room 1 2019 items (sneakers pink/black, grey sandals, high tops red/black, black boots)
    - 5 special items (black platform sneakers, Dr. Stomp boots in yellow/white/cherry, black converse, converse sneakers)
  - **Socks (1 item):**
    - Tall Socks
  - Total: 23 footwear items
- `accessories_items.json` - Complete reference of all accessory items in Highrise:
  - **Gloves (1 item):**
    - Standard Basketball
  - **Glasses (12 items):**
    - 4 starter items (round/square frames in brown/black)
    - 3 room 3 2019 items (tiny shades, black shield glasses, yellow aviator shields)
    - 1 room 2 2019 item (basic aviators)
    - 4 room 1 2019 items (half rim white/black, circular shades, circular frames)
  - **Bags (9 items):**
    - 5 room 3 2019 items (sweater wrap, mini packs, flannel wrap, fanny pack)
    - 3 room 1 2019 items (purse, messenger bag, backpack)
    - 1 special item (sunflower purse)
  - **Earrings (2 items):**
    - Chain earrings, gold hoops
  - **Necklaces (7 items):**
    - 1 room 3 2019 item (padlock necklace)
    - 2 room 2 2019 items (fashion scarves grey/black)
    - 2 room 1 2019 items (gold necklace, plain gold chain)
    - 2 special items (retro camera, goth necklace)
  - **Watches (2 items):**
    - Classic black watch, basic watch
  - **Handbags (6 items):**
    - 2 room 3 2019 items (skateboards - XOXO/camo)
    - 3 room 2 2019 items (red sucker, white rose, banana)
    - 1 special item (cupcake bear)
  - Total: 39 accessory items

## Features

### Inventory Management
The bot automatically fetches its inventory when it starts and caches it locally. The inventory includes all clothing items the bot owns.

### Outfit Presets
18 pre-configured outfit presets for different occasions:

1. **party** - Party Outfit
2. **music** - Music Festival
3. **casual** - Casual Day
4. **formal** - Formal Event
5. **sports** - Sports Mode
6. **beach** - Beach Vibes
7. **winter** - Winter Cozy
8. **gothic** - Gothic Style
9. **kawaii** - Kawaii Cute
10. **streetwear** - Street Style
11. **retro** - Retro Vibes
12. **rave** - Rave Party
13. **elegant** - Elegant Night
14. **punk** - Punk Rock
15. **cozy** - Cozy Comfort
16. **business** - Business Pro
17. **cyberpunk** - Cyberpunk Future
18. **hippie** - Hippie Peace

## Commands

### View Commands
- `!outfits` or `!presets` - List all available outfit presets
- `!inventory` - Check bot's inventory stats

### Action Commands
- `!wear <preset_name>` - Change to a specific outfit preset
- `!randomwear` - Start random outfit loop (cycles through saved outfits)
- `!randomgen` - Generate completely random outfits with accessories
- `!stopwear` - Stop all random loops and keep current outfit
- `!saveoutfit <name>` - Save current outfit as a custom preset
- `!refreshinv` - Refresh inventory from Highrise

## Usage Examples

```
!outfits
!wear party
!saveoutfit mycoolgym
!wear mycoolgym
!randomwear
!randomgen
!stopwear
!inventory
!refreshinv
```

## How to Use Outfit Presets

The outfit presets start empty and act as placeholders. To customize them:

### Method 1: Save Outfits from Highrise (Recommended)
1. Go to Highrise and manually change your bot's outfit
2. In the Highrise room, use: `!saveoutfit <preset_name>`
   - Example: Change bot to party outfit → `!saveoutfit party`
3. The outfit is now saved and can be worn with `!wear party`

### Method 2: Create Custom Presets
1. Change bot's outfit in Highrise to what you want
2. Use: `!saveoutfit mycustomname` to create a new preset
3. Use: `!wear mycustomname` to wear it later

### Workflow Example
```
1. Change bot outfit in Highrise to a cool party outfit
2. In chat: !saveoutfit party
3. Change bot outfit in Highrise to sporty clothes
4. In chat: !saveoutfit sports
5. Now you can switch between them:
   !wear party  → Bot wears party outfit
   !wear sports → Bot wears sports outfit
```

### Random Outfit Modes

#### 1. Random Preset Loop (!randomwear)
Once you have at least 2 saved outfits:
```
1. Type: !randomwear
2. Bot will cycle through your saved presets every 3 seconds
3. Each outfit is randomly selected from your saved collection
4. Type: !stopwear to stop and keep current outfit
```

#### 2. Random Outfit Generator (!randomgen)
Creates completely unique outfits from your inventory:
```
1. Type: !randomgen
2. Bot generates fresh random outfits every 5 seconds
3. Changes ALL clothes: shirts, pants, shoes, dresses, jackets, etc.
4. Adds random accessories (glasses, hats, jewelry, bags, etc.)
5. Uses random color palettes for maximum variation
6. Keeps going until you stop it
7. Type: !stopwear to stop and keep current outfit
```

**Key Differences:**
- `!randomwear` - Cycles through your saved, designed outfits
- `!randomgen` - Creates completely new, random combinations with accessories

All saved presets persist in `inventory/outfit_presets.json`

## Technical Details

The inventory system:
- Fetches inventory on bot startup
- Caches inventory to `bot_inventory.json`
- Can be manually refreshed with `!refreshinv`
- Stores item IDs, types, and categories

The outfit system:
- Maintains 18+ presets
- Allows custom user-created presets
- Preserves current outfit structure when changing
- Uses Highrise SDK's `get_my_outfit()` and `set_outfit()` methods
