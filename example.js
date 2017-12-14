const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
const CSGOStickers = require('./index');

const cred = {
    username: 'USERNAME',
    password: 'PASSWORD',
    shared_secret: 'SHARED_SECRET',
};

const user = new SteamUser({enablePicsCache: true});
const csgo = new CSGOStickers(user, {musicKits: true, cases: true, tools: true, statusIcons: true, logLevel: 'debug'});

csgo.on('ready', () => {
    console.log(csgo.getStickerURL('cologne2016/astr_gold', false));
    console.log(csgo.getStickerURL('cologne2016/astr_gold', true));
    console.log(csgo.getItemNameURL('M4A4 | 龍王 (Dragon King) (Field-Tested)'));
    console.log(csgo.getItemNameURL('AWP | Redline (Field-Tested)'));
    console.log(csgo.getItemNameURL('Sticker | Robo'));
    console.log(csgo.getItemNameURL('Chroma 3 Case Key'));
    console.log(csgo.getItemNameURL('Operation Phoenix Weapon Case'));
    console.log(csgo.getItemNameURL('Operation Phoenix Pass'));
    console.log(csgo.getItemNameURL('Music Kit | Kelly Bailey, Hazardous Environments'));
    console.log(csgo.getItemNameURL('StatTrak™ AWP | Redline (Field-Tested)'));
    console.log(csgo.getItemNameURL('StatTrak™ Music Kit | Noisia, Sharpened'));
    console.log(csgo.getItemNameURL('Sealed Graffiti | X-Axes (Tracer Yellow)'));
});

SteamTotp.getAuthCode(cred.shared_secret, (err, code) => {
    if (err) {
        throw err;
    }

    const loginDetails = {
        accountName: cred.username,
        password: cred.password,
        rememberPassword: true,
        twoFactorCode: code,
        logonID: 2121,
    };

    console.log('Logging into Steam....');

    user.logOn(loginDetails);
});

user.on('loggedOn', () => {
    console.log('Logged onto Steam');
});

user.on('contentServersReady', () => {
    console.log('Content servers ready');
});
