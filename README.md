# node-csgo-image-cdn

Retrieves the Steam CDN URLs for CS:GO Item Images

## Why?

Steam hosts all of the CS:GO resource images on their CDN, but unfortunately finding the URL for them was
difficult in the past and would require scraping the market or inventories.

This library allows you to retrieve the needed CDN URLs given the sticker name, which can save you lots in bandwidth
and prevents you from having to scrape it or host it yourself.


## How?

Most of the graphical resources for CSGO are stored in [VDF](https://developer.valvesoftware.com/wiki/VPK_File_Format)
files which include the sticker and graffiti images.

The root of a VDF contains a `dir` file (`pak01_dir.vpk`) that specifies where files are located over multiple packages. If you look in
the install directory of CS:GO, you'll see `pak01_003.vpk`, `pak01_004.vpk`, etc... where these files are located.

Thankfully, Valve was kind enough (as of writing this) to include all of the sticker and graffiti images in packages 57
and 83 which is only ~270MB.

This library, using node-steam-user, checks the manifest for any updates to the public branch of CS:GO, and if so,
downloads only the required VPK packages that contain all sticker and graffiti images if they have changed from the
content servers.

When trying to retrieve a CDN image URL for a given item, the library takes the SHA1 hash of the file and the VDF
path that links to it to generate the corresponding URL.

Example URL: https://steamcdn-a.akamaihd.net/apps/730/icons/econ/stickers/cologne2015/mousesports.3e75da497d9f75fa56f463c22db25f29992561ce.png

## Methods

### Constructor(client, options)

* `client` - [node-steam-user](https://github.com/DoctorMcKay/node-steam-user) Client **The account MUST own CS:GO**
* `options` - Options
    ```javascript
    {
        directory: 'data', // relative data directory for VPK files
        updateInterval: 30000, // seconds between update checks
    }
    ```
    
### getItemNameURL(marketHashName)

* `marketHashName` - The market hash name of a sticker or weapon (ex. "Sticker | Robo" or "AWP | Redline (Field-Tested)")

**Note: If the item is a weapon, it MUST have an associated wear**


### getStickerURL(stickerName, large=false)

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

## Events

### ready

Emitted when node-csgo-image-cdn is ready, this must be emitted before using the object
