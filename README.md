# node-csgo-cdn

Retrieves the Steam CDN URLs for CS:GO Item Images from their `market_hash_name` or properties.

Can retrieve CDN images for:
* Stickers
* Graffiti (without tint)
* Weapons (and doppler phases)
* Music Kits
* Tools (Crate Keys, Cases, Stattrak Swap Tool, etc...)
* Status Icons (Pins, ESports Trophies, Map Contribution Tokens, Service Medals, etc...)


## Table of Contents
  * [Why?](https://github.com/Step7750/node-csgo-cdn#why)
  * [How?](https://github.com/Step7750/node-csgo-cdn#how)
  * [How to Install](https://github.com/Step7750/node-csgo-cdn#how-to-install)
  * [Methods](https://github.com/Step7750/node-csgo-cdn#methods)
    * [Constructor(client, options)](https://github.com/Step7750/node-csgo-cdn#constructorclient-options)
    * [getItemNameURL(marketHashName, phase)](https://github.com/Step7750/node-csgo-cdn#getitemnameurlmarkethashname-phase)
    * [getStickerURL(stickerName, large=true)](https://github.com/Step7750/node-csgo-cdn#getstickerurlstickername-largetrue)
    * [getWeaponURL(defindex, paintindex)](https://github.com/Step7750/node-csgo-cdn#getweaponurldefindex-paintindex)
  * [Properties](https://github.com/Step7750/node-csgo-cdn#properties)
    * [itemsGame](https://github.com/Step7750/node-csgo-cdn#itemsgame)
    * [csgoEnglish](https://github.com/Step7750/node-csgo-cdn#csgoenglish)
    * [itemsGameCDN](https://github.com/Step7750/node-csgo-cdn#itemsgamecdn)
    * [phase](https://github.com/Step7750/node-csgo-cdn#phase)
  * [Events](https://github.com/Step7750/node-csgo-cdn#events)
    * [ready](https://github.com/Step7750/node-csgo-cdn#ready)
    

## Why?

Steam hosts all of the CS:GO resource images on their CDN, but unfortunately finding the URL for them was
difficult in the past and would require scraping the market or inventories.

This library allows you to retrieve the needed CDN URLs given the sticker name, which can save you lots in bandwidth
and prevents you from having to scrape it or host it yourself.


## How?

Most of the graphical resources for CSGO are stored in [VDF](https://developer.valvesoftware.com/wiki/VPK_File_Format)
files which include the sticker, music kit, tools, and status icon images.

The root of a VDF contains a `dir` file (`pak01_dir.vpk`) that specifies where files are located over multiple packages. If you look in
the install directory of CS:GO, you'll see `pak01_003.vpk`, `pak01_004.vpk`, etc... where these files are located.

Thankfully, Valve was kind enough (as of writing this) to include all of the relevant images in a few packages
which are only ~400MB.

This library, using node-steam-user, checks the manifest for any updates to the public branch of CS:GO, and if so,
downloads only the required VPK packages that contain all relevant images if they have changed from the
content servers.

When trying to retrieve a CDN image URL for a given item, the library takes the SHA1 hash of the file and the VDF
path that links to it to generate the corresponding URL.

Example URL: https://steamcdn-a.akamaihd.net/apps/730/icons/econ/stickers/cologne2015/mousesports.3e75da497d9f75fa56f463c22db25f29992561ce.png

## How to Install

### `npm install csgo-cdn`

#### See example.js
```javascript
const SteamUser = require('steam-user');
const csgoCDN = require('csgo-cdn');

const user = new SteamUser();
const cdn = new csgoCDN(user, {logLevel: 'debug'});

cdn.on('ready', () => {
   console.log(cdn.getItemNameURL('M4A4 | 龍王 (Dragon King) (Field-Tested)'));
   console.log(cdn.getItemNameURL('★ Karambit | Gamma Doppler (Factory New)', cdn.phase.emerald));
});
```

## Methods

### Constructor(client, options)

* `client` - [node-steam-user](https://github.com/DoctorMcKay/node-steam-user) Client **The account MUST own CS:GO**
* `options` - Options
    ```javascript
    {
        directory: 'data', // relative data directory for VPK files
        updateInterval: 30000, // seconds between update checks, -1 to disable auto-updates
        logLevel: 'info', // logging level, (error, warn, info, verbose, debug, silly)
        stickers: true, // whether to obtain the vpk for stickers
        graffiti: true, // whether to obtain the vpk for graffiti
        musicKits: true, // whether to obtain the vpk for music kits
        cases: true, // whether to obtain the vpk for cases
        tools: true, // whether to obtain the vpk for tools
        statusIcons: true, // whether to obtain the vpk for status icons
    }
    ```
    
### getItemNameURL(marketHashName, phase)

* `marketHashName` - The market hash name of an item (ex. "Sticker | Robo" or "AWP | Redline (Field-Tested)")
* `phase` - Optional weapon phase for doppler skins from the `phase` enum property

**Note: If the item is a weapon, it MUST have an associated wear**

Ensure that you have enabled the relevant VPK downloading for the item category by using the options in the constructor.

Returns the 'large' version of the image.

### getStickerURL(stickerName, large=true)

* `stickerName` - Name of the sticker path from `items_game.txt` (ex. cluj2015/sig_olofmeister_gold)
* `large` - Whether to obtain the large version of the image


### getWeaponURL(defindex, paintindex)

* `defindex` - Definition index of the item (ex. 7 for AK-47)
* `paintindex` - Paint index of the item (ex. 490 for Frontside Misty)

## Properties

### itemsGame

Parsed items_game.txt file as a dictionary

### csgoEnglish

Parsed csgo_english file as a dictionary. Also contains all inverted keys, such that the values are also keys themselves
for O(1) retrieval.

### itemsGameCDN

Parsed items_game_cdn.txt file as a dictionary

### phase

Doppler phase enum used to specify the phase of a knife

```javascript
cdn.getItemNameURL('★ Karambit | Gamma Doppler (Factory New)', cdn.phase.emerald);
cdn.getItemNameURL('★ Huntsman Knife | Doppler (Factory New)', cdn.phase.blackpearl);
cdn.getItemNameURL('★ Huntsman Knife | Doppler (Factory New)', cdn.phase.phase1);
cdn.getItemNameURL('★ Flip Knife | Doppler (Minimal Wear)', cdn.phase.ruby);
cdn.getItemNameURL('★ Flip Knife | Doppler (Minimal Wear)', cdn.phase.sapphire);
```

## Events

### ready

Emitted when csgo-cdn is ready, this must be emitted before using the object
