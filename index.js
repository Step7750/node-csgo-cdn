const Promise = require('bluebird');
const fs = require('fs');


const defaultConfig = {
    directory: 'data',
    updateInterval: 30000,
};

class CSGOStickers {
    constructor(steamUser, config={}) {
        this.config = Object.assign(defaultConfig, config);

        this.createDataDirectory();

        this.user = Promise.promisifyAll(steamUser, {multiArgs: true});

        this.updateLoop().catch((err) => {
            throw err;
        });
    }

    createDataDirectory() {
        const dir = `./${this.config.directory}`;

        console.log(fs.existsSync(dir));
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir);
        }
    }

    updateLoop() {
        return this.update().then(() => Promise.delay(this.config.updateInterval*1000)).then(() => this.updateLoop());
    }

    getProductInfo() {
        return new Promise((resolve, reject) => {
            this.user.getProductInfo([730], [], (apps, packages, unknownApps, unknownPackages) => {
                resolve([apps, packages, unknownApps, unknownPackages]);
            });
        });
    }

    getLatestManifestId() {
        return this.getProductInfo().then(([apps, packages, unknownApps, unknownPackages]) => {
            const csgo = apps['730'].appinfo;
            console.log(csgo);
            const commonDepot = csgo.depots['731'];

            return commonDepot.manifests.public;
        });
    }

    update() {
        return this.getLatestManifestId().then((manifestId) => {
            console.log(manifestId);
            return this.user.getManifestAsync(730, 731, manifestId);
        }).then(([manifest]) => {
            // download the VPK directory
            const dirFile = manifest.files.find((file) => file.filename.includes("pak01_dir.vpk"));

            if (!dirFile) {
                throw new Error('Failed to find VPK directory file in manifest');
            }

            return this.user.downloadFileAsync(730, 731, dirFile, this.config.directory + '/pak01_dir.vpk');
        }).then(() => {
            console.log("Downloaded manifest");
        });
    }

    getStickerURL(stickerName) {

    }
}

module.exports = CSGOStickers;

