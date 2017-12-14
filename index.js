const Promise = require('bluebird');
const EventEmitter = require('events');
const fs = Promise.promisifyAll(require('fs'));
const vpk = require('vpk');
const vdf = require('simple-vdf');
const hasha = require('hasha');

const defaultConfig = {
    directory: 'data',
    updateInterval: 30000,
    stickers: true,
    musicKits: true,
};

const wears = ['Factory New', 'Minimal Wear', 'Field-Tested', 'Well-Worn', 'Battle-Scarred'];

const neededDirectories = {
    stickers: 'resource/flash/econ/stickers',
    musicKits: 'resource/flash/econ/music_kits',
    cases: 'resource/flash/econ/weapon_cases',
    tools: 'resource/flash/econ/tools',
    statusIcons: 'resource/flash/econ/status_icons',
};

function bytesToMB(bytes) {
    return (bytes/1000000).toFixed(2);
}

class CSGOImageCdn extends EventEmitter {
    get ready() {
        return this.ready_ || false;
    }

    get steamReady() {
        return this.user.client.connected;
    }

    set ready(r) {
        const old = this.ready;
        this.ready_ = r;

        if (r !== old && r) {
            this.emit('ready');
        }
    }

    constructor(steamUser, config={}) {
        super();

        this.config = Object.assign(defaultConfig, config);

        this.createDataDirectory();

        this.user = Promise.promisifyAll(steamUser, {multiArgs: true});

        if (!this.steamReady) {
            this.user.once('loggedOn', () => {
                this.updateLoop();
            })
        }
        else {
            this.updateLoop();
        }
    }

    /**
     * Creates the data directory specified in the config if it doesn't exist
     */
    createDataDirectory() {
        const dir = `./${this.config.directory}`;

        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir);
        }
    }

    /**
     * Runs the update loop at the specified config interval
     * @return {Promise<undefined>}
     */
    updateLoop() {
        return this.update().then(() => Promise.delay(this.config.updateInterval*1000)).then(() => this.updateLoop());
    }

    /**
     * Returns the product info for CSGO, with its depots and packages
     */
    getProductInfo() {
        return new Promise((resolve, reject) => {
            this.user.getProductInfo([730], [], (apps, packages, unknownApps, unknownPackages) => {
                resolve([apps, packages, unknownApps, unknownPackages]);
            });
        });
    }

    /**
     * Returns the latest CSGO manifest ID for the public 731 depot
     * @return {*|PromiseLike<*[]>|Promise<*[]>} 731 Depot Manifest ID
     */
    getLatestManifestId() {
        return this.getProductInfo().then(([apps, packages, unknownApps, unknownPackages]) => {
            const csgo = apps['730'].appinfo;
            const commonDepot = csgo.depots['731'];

            return commonDepot.manifests.public;
        });
    }

    /**
     * Retrieves and updates the sticker file directory from Valve
     *
     * Ensures that only the required VPK files are downloaded and that files with the same SHA1 aren't
     * redownloaded
     *
     * @return {Promise<void>}
     */
    async update() {
        if (!this.steamReady) return;

        const manifestId = await this.getLatestManifestId();

        const [manifest] = await this.user.getManifestAsync(730, 731, manifestId);
        const manifestFiles = manifest.files;

        const dirFile = manifest.files.find((file) => file.filename.endsWith("pak01_dir.vpk"));
        const itemsGameFile = manifest.files.find((file) => file.filename.endsWith("items_game.txt"));
        const itemsGameCDNFile = manifest.files.find((file) => file.filename.endsWith("items_game_cdn.txt"));
        const csgoEnglishFile = manifest.files.find((file) => file.filename.endsWith("csgo_english.txt"));

        await this.downloadFiles([dirFile, itemsGameFile, itemsGameCDNFile, csgoEnglishFile]);

        this.loadResources();
        this.loadVPK();

        await this.downloadVPKFiles(this.vpkDir, manifestFiles);

        this.ready = true;
    }

    loadResources() {
        this.itemsGame = vdf.parse(fs.readFileSync(`${this.config.directory}/items_game.txt`, 'utf8'))['items_game'];
        this.csgoEnglish = vdf.parse(fs.readFileSync(`${this.config.directory}/csgo_english.txt`, 'ucs2'))['lang']['Tokens'];
        this.itemsGameCDN = this.parseItemsCDN(fs.readFileSync(`${this.config.directory}/items_game_cdn.txt`, 'utf8'));

        this.invertDictionary(this.csgoEnglish);
    }

    /**
     * Inverts the key mapping of a dictionary recursively while preserving the original keys
     * @param dict Dictionary to invert
     */
    invertDictionary(dict) {
        for (const prop in dict) {
            if (!dict.hasOwnProperty(prop)) continue;

            const val = dict[prop];

            if (typeof val === 'object') {
                this.invertDictionary(val);
            }
            else {
                dict[val] = prop;
            }
        }
    }

    parseItemsCDN(data) {
        let lines = data.split('\n');

        const items_game_cdn = {};

        for (let line of lines) {
            let kv = line.split('=');

            if (kv[1]) {
                items_game_cdn[kv[0]] = kv[1];
            }
        }

        return items_game_cdn;
    }

    async downloadFiles(files) {
        const promises = [];

        for (const file of files) {
            let name = file.filename.split('\\');
            name = name[name.length-1];

            const path = `${this.config.directory}/${name}`;

            const isDownloaded = await this.isFileDownloaded(path, file.sha_content);

            if (isDownloaded) {
                continue;
            }

            const promise = this.user.downloadFileAsync(730, 731, file, `${this.config.directory}/${name}`);
            promises.push(promise);
        }

        return Promise.all(promises);
    }

    /**
     * Loads the CSGO dir VPK specified in the config
     */
    loadVPK() {
        this.vpkDir = new vpk(this.config.directory + '/pak01_dir.vpk');
        this.vpkDir.load();

        this.vpkFiles = this.vpkDir.files.filter((f) => f.startsWith('resource/flash/econ/stickers'));
    }

    /**
     * Given the CSGO VPK Directory, returns the necessary indices for the chosen options
     * @param vpkDir CSGO VPK Directory
     * @return {Array} Necessary Sticker VPK Indices
     */
    getRequiredVPKFiles(vpkDir) {
        const requiredIndices = [];

        const neededDirs = Object.keys(neededDirectories).filter((f) => !!this.config[f]).map((f) => neededDirectories[f]);

        console.log(neededDirs);

        for (const fileName of vpkDir.files) {
            for (const dir of neededDirs) {
                if (fileName.startsWith(dir)) {
                    const archiveIndex = vpkDir.tree[fileName].archiveIndex;

                    if (!requiredIndices.includes(archiveIndex)) {
                        requiredIndices.push(archiveIndex);
                    }

                    break;
                }
            }
        }

        return requiredIndices.sort();
    }

    /**
     * Downloads the required VPK files
     * @param vpkDir CSGO VPK Directory
     * @param manifestFiles Manifest files
     * @return {Promise<void>}
     */
    async downloadVPKFiles(vpkDir, manifestFiles) {
        const requiredIndices = this.getRequiredVPKFiles(vpkDir);

        for (let index in requiredIndices) {
            index = parseInt(index);

            // pad to 3 zeroes
            const archiveIndex = requiredIndices[index];
            const paddedIndex = '0'.repeat(3-archiveIndex.toString().length) + archiveIndex;
            const fileName = `pak01_${paddedIndex}.vpk`;

            const file = manifestFiles.find((f) => f.filename.endsWith(fileName));
            const filePath = `${this.config.directory}/${fileName}`;

            const isDownloaded = await this.isFileDownloaded(filePath, file.sha_content);

            if (isDownloaded) {
                console.log(`Already downloaded ${filePath}`);
                continue;
            }

            const status = `[${index+1}/${requiredIndices.length}]`;

            console.log(`${status} Downloading ${fileName} - ${bytesToMB(file.size)} MB`);

            const promise = new Promise((resolve, reject) => {
                const ee = this.user.downloadFile(730, 731, file, filePath, () => {
                    resolve();
                });

                ee.on('progress', (bytesDownloaded, totalSize) => {
                     console.log(`${status} ${(bytesDownloaded*100/totalSize).toFixed(2)}% - ${bytesToMB(bytesDownloaded)}/${bytesToMB(totalSize)} MB`);
                });
            });

            await promise;

            console.log(`${status} Downloaded ${fileName}`);
        }
    }

    /**
     * Returns whether a file at the given path has the given sha1
     * @param path File path
     * @param sha1 File SHA1 hash
     * @return {Promise<boolean>} Whether the file has the hash
     */
    async isFileDownloaded(path, sha1) {
        try {
            const hash = await hasha.fromFile(path, {algorithm: 'sha1'});

            return hash === sha1;
        }
        catch (e) {
            return false;
        }
    }

    /**
     * Returns the item Steam CDN URL for the specified name
     *
     * Example Sticker Names: cologne2016/nv, cologne2016/fntc_holo, cologne2016/fntc_foil, cluj2015/sig_olofmeister_gold
     *
     * You can find the sticker names from their relevant "sticker_material" fields in items_game.txt
     *      items_game.txt can be found in the core game files of CS:GO or as itemsGame here
     *
     * @param name The item name (the sticker_material field in items_game.txt, or the cdn file format)
     * @param large Whether to obtain the "large" CDN version of the item
     * @return {string|void} If successful, the HTTPS CDN URL for the item
     */
    getStickerURL(name, large=true) {
        if (!this.ready) {
            return;
        }

        const fileName = large ? `${name}_large.png` : `${name}.png`;

        let path = this.vpkFiles.find((t) => t.endsWith(fileName));

        if (!path) return;

        const file = this.vpkDir.getFile(path);

        const sha1 = hasha(file, {
            'algorithm': 'sha1'
        });

        path = path.replace('resource/flash', 'icons');
        path = path.replace('.png', `.${sha1}.png`);

        return `https://steamcdn-a.akamaihd.net/apps/730/${path}`;
    }

    /**
     * Given the specified defindex and paintindex, returns the CDN URL
     *
     * The item properties can be found in items_game.txt
     *
     * @param defindex Item Definition Index (weapon type)
     * @param paintindex Item Paint Index (skin type)
     * @return {*}
     */
    getWeaponURL(defindex, paintindex) {
        if (!this.ready) return;

        const paintKits = this.itemsGame.paint_kits;

        // Get the skin name
        let skinName = '';

        if (paintindex in paintKits) {
            skinName = paintKits[iteminfo.paintindex].name;

            if (skinName === 'default') {
                skinName = '';
            }
        }

        // Get the weapon name
        let weaponName;

        const items = this.itemsGame.items;

        if (defindex in items) {
            weaponName = items[iteminfo.defindex].name;
        }

        // Get the image url
        const cdnName = `${weaponName}_${skinName}`;

        return this.itemsGameCDN[cdnName];
    }

    isWeapon(marketHashName) {
        for (const wear of wears) {
            if (marketHashName.includes(wear)) return true;
        }

        return false;
    }

    /**
     * Retrieves the given weapon or sticker CDN URL given its market_hash_name
     *
     * Examples: M4A4 | 龍王 (Dragon King) (Field-Tested), Sticker | Robo, AWP | Redline (Field-Tested)
     *
     * Note: For a weapon, the name MUST have the associated wear
     *
     * @param marketHashName
     */
    getItemNameURL(marketHashName) {
        marketHashName = marketHashName.trim();

        if (marketHashName.startsWith('Sticker |')) {
            const reg = /Sticker \| (.*)/;

            const match = marketHashName.match(reg);

            if (!match) return;

            const stickerName = match[1];
            const stickerTag = `#${this.csgoEnglish[stickerName]}`;

            const stickerKits = this.itemsGame.sticker_kits;

            const kitIndex = Object.keys(stickerKits).find((n) => {
                const k = stickerKits[n];

                return k.item_name === stickerTag;
            });

            return this.getStickerURL(stickerKits[kitIndex].name, true);
        }
        else if (this.isWeapon(marketHashName)) {
            const reg = /(.*) \| (.*) \(.*\)/;

            const match = marketHashName.match(reg);

            if (!match) return;

            const weaponName = match[1];
            const skinName = match[2];

            const weaponTag = `#${this.csgoEnglish[weaponName]}`;
            const skinTag = `#${this.csgoEnglish[skinName]}`;

            const paintKits = this.itemsGame.paint_kits;

            const paintindex = Object.keys(paintKits).find((n) => {
                const kit = paintKits[n];

                return kit.description_tag === skinTag;
            });

            const paintKit = paintKits[paintindex].name;

            const prefabs = this.itemsGame.prefabs;

            const prefab = Object.keys(prefabs).find((n) => {
                 const fab = prefabs[n];

                 return fab.item_name === weaponTag
            });

            let weaponClass;

            if (!prefab) {
                // special knives aren't in the prefab (karambits, etc...)
                const items = this.itemsGame.items;

                const item = Object.keys(items).find((n) => {
                    const i = items[n];

                    return i.item_name === weaponTag;
                });

                weaponClass = items[item].name;
            }
            else {
                weaponClass = prefabs[prefab].item_class;
            }

            const path = paintKit ? `${weaponClass}_${paintKit}` : weaponClass;

            return this.itemsGameCDN[path];
        } else if (marketHashName.startsWith('Music Kit |')) {
            const reg = /Music Kit \| (.*)/;

            const match = marketHashName.match(reg);

            if (!match) return;

            const kitName = match[1];
            const tag = `#${this.csgoEnglish[kitName]}`;

            const musicDefs = this.itemsGame.music_definitions;

            const kit = Object.keys(musicDefs).find((n) => {
                const k = musicDefs[n];

                return k.loc_name === tag;
            });

            let path = `resource/flash/${musicDefs[kit].image_inventory}.png`;

            const file = this.vpkDir.getFile(path);

            if (!file) return;

            const sha1 = hasha(file, {
                'algorithm': 'sha1'
            });

            path = path.replace('resource/flash', 'icons');
            path = path.replace('.png', `.${sha1}.png`);

            return `https://steamcdn-a.akamaihd.net/apps/730/${path}`;
        }
        else {
            const tag = `#${this.csgoEnglish[marketHashName]}`;

            const items = this.itemsGame.items;

            const item = Object.keys(items).find((n) => {
                const i = items[n];

                return i.item_name === tag;
            });


            let path = `resource/flash/${items[item].image_inventory}.png`;

            const file = this.vpkDir.getFile(path);

            if (!file) return;

            const sha1 = hasha(file, {
                'algorithm': 'sha1'
            });

            path = path.replace('resource/flash', 'icons');
            path = path.replace('.png', `.${sha1}.png`);

            return `https://steamcdn-a.akamaihd.net/apps/730/${path}`;
        }
    }
}

module.exports = CSGOImageCdn;
