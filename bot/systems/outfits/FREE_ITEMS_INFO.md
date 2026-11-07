# FREE Items in Highrise - Important Information

## Critical Discovery

Only **20 items** in all of Highrise are FREE (can be equipped without owning them).

## Complete List of FREE Items

### Shoes (5 items)
- `shoes-n_whitedans`: White Dans ✅
- `shoes-n_starteritems2019flatswhite`: White Flats ✅
- `shoes-n_starteritems2019flatspink`: Pink Flats ✅
- `shoes-n_starteritems2019flatsblack`: Black Flats ✅
- `shoes-n_starteritems2018conversewhite`: White Converse ✅

### Skirts (7 items)
- `skirt-n_starteritems2018whiteskirt`: Basic Skirt - White ✅
- `skirt-n_starteritems2018blueskirt`: Basic Skirt - Blue ✅
- `skirt-n_starteritems2018blackskirt`: Basic Skirt - Black ✅
- `skirt-n_room22019skirtwithsocksplaid`: Plaid Skirt With Socks ✅
- `skirt-n_room12019pleatedskirtpink`: Pleated Pink Skirt ✅
- `skirt-n_room12019pleatedskirtgrey`: Pleated Skirt Grey ✅
- `skirt-n_room12019pleatedskirtblack`: Pleated Black Skirt ✅

### Socks (7 items)
- `sock-n_starteritems2020whitethighhighs`: White Thigh High Socks ✅
- `sock-n_starteritems2020whitesocks`: White Socks ✅
- `sock-n_starteritems2020whitekneelength`: White Knee Length Socks ✅
- `sock-n_starteritems2020blackthighhighs`: Black Thigh High Socks ✅
- `sock-n_starteritems2020blacksocks`: Black Socks ✅
- `sock-n_starteritems2020blackkneelength`: Black Knee Length Socks ✅
- `sock-n_basic2021opaquetightswhite`: Opaque White Tights ✅

### Watch (1 item)
- `watch-n_room32019blackwatch`: Classic Black Watch ✅

## What is NOT Free

All other items from the reference files are **NOT free**, including:
- ❌ All shirts/tops
- ❌ All pants (male bottoms)
- ❌ All glasses
- ❌ All bags
- ❌ All earrings
- ❌ All necklaces (except the watch above)
- ❌ Most accessories

## How to Use Non-Free Items

Your bot can wear non-free items if:
1. **The bot owns them** - Items must be in the bot's inventory
2. **The bot buys them** - Using `buy_item("item_id")` with gold (only for purchasable items)

## Reference Files Purpose

The reference files I created (`shirt_items.json`, `bottoms_items.json`, etc.) are:
- A **catalog** of ALL items that exist in Highrise (571 total)
- Useful for knowing item IDs and names
- **NOT** a list of what your bot can wear without owning

## Current Bot Inventory

Your bot currently owns only **11 items**:
- Basic facial features (hair, eyes, eyebrows, nose, mouth, freckle)
- 1 shirt: `shirt-n_room32019denimjackethoodie` (Yellow Hoodie Denim Jacket)
- 1 pants: `pants-n_starteritems2019cuffedjeanswhite` (Cuffed Jeans - White)
- 1 shoes: `shoes-n_room32019socksneakersgrey` (Grey Sock Sneakers)

## Updated Outfit Presets

I've updated these presets to use FREE items:
- **Party** - Uses free black skirt, white converse, black thigh high socks
- **Casual** - Uses free white skirt, white flats, white socks, black watch
- **Beach** - Uses free pink pleated skirt, pink flats, white knee length socks
- **Sports** - Uses free black pleated skirt, white dans shoes, black knee length socks

## Testing

Try these commands now:
```
!wear party
!wear casual
!wear beach
!wear sports
```

These should now work and change the full outfit (including bottoms, shoes, and accessories)!

## Source

Free items verified from: https://webapi.highrise.game/items?rarity=none
