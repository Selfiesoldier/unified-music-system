# 👔 Simple Wardrobe System - User Guide

## New Simplified Commands

### 1. **!wardrobe** or **!clothes**
Shows help for all wardrobe commands

### 2. **!list [type]**
View all items in a category with numbers

**Available Types:**
- `shirt` - All shirts and tops
- `pants` - All pants  
- `skirt` - All skirts
- `shoes` - All footwear
- `sock` - All socks
- `glasses` - All eyewear
- `bag` - All bags
- `watch` - All watches
- `necklace` - All necklaces
- `earring` - All earrings
- `freckle` - All face decorations/makeup

**Examples:**
```
!list shirt
!list shoes
!list skirt
```

**Legend:**
- 🆓 = Free items (can wear without owning)
- ✅ = Items you own
- No symbol = Need to buy

### 3. **!wear [type] [number/name]**
Wear a specific item from a category

**By Number:**
```
!wear shirt 1
!wear shoes 3
!wear skirt 5
```

**By Name (partial match):**
```
!wear shirt white
!wear shoes converse
!wear skirt black
```

### 4. **!buy [item_id]**
Buy a new item for your bot using gold

**How to get item ID:**
1. Use `!list [type]` to see items
2. Look at the ID shown (first 10 items show IDs)
3. Copy the full item ID
4. Use `!buy [item_id]`

**Example:**
```
!buy shirt-n_starteritems2019tankwhite
!buy pants-n_starteritems2019cuffedjeansblack
```

**Note:** 
- Only purchasable items can be bought
- Requires gold in your bot account
- Collectible/grab items cannot be purchased
- Inventory auto-refreshes after purchase

## Quick Start

1. **See what shirts are available:**
   ```
   !list shirt
   ```

2. **Wear shirt #1:**
   ```
   !wear shirt 1
   ```

3. **See what shoes are available:**
   ```
   !list shoes
   ```

4. **Wear shoes with "converse" in name:**
   ```
   !wear shoes converse
   ```

5. **Buy a specific item:**
   ```
   !buy shirt-n_starteritems2019tankblack
   ```

## Important Notes

### Free Items (🆓)
Only **20 items** in Highrise are free:
- 5 shoes
- 7 skirts  
- 7 socks
- 1 watch

See `FREE_ITEMS_INFO.md` for complete list.

### Owned Items (✅)
Items in your bot's inventory can be worn anytime.

### Items to Buy
All other items must be purchased with gold first using `!buy`.

## Categories Explained

**Tops:** `shirt`
- Includes: t-shirts, tanks, raglans, pullovers, jackets, hoodies, etc.

**Bottoms:** `pants` or `skirt`
- Pants: shorts, jeans, slacks, etc.
- Skirts: basic skirts, pleated skirts, etc.

**Footwear:** `shoes` or `sock`
- Shoes: flats, converse, dans, sneakers, etc.
- Socks: knee-length, thigh-highs, tights, etc.

**Accessories:** `glasses`, `bag`, `watch`, `necklace`, `earring`
- Optional items to complete your look

**Face:** `freckle`
- Includes freckles, makeup, decorations, etc.

## Examples

```
!list shirt          → See all 37 shirts
!wear shirt 5        → Wear shirt #5
!wear shirt tank     → Wear first shirt with "tank" in name

!list skirt          → See all 9 skirts  
!wear skirt 1        → Wear basic white skirt (FREE!)

!list shoes          → See all 22 shoes
!wear shoes white    → Wear first shoes with "white"

!buy shirt-n_starteritems2019tankblack → Buy black tank top
```

## Removed Features

The old preset system (!outfits, !saveoutfit, !randomwear) has been removed for simplicity. 
Now you directly wear items by category!
