import SteamUser from 'steam-user';
import SteamTotp from 'steam-totp';
import CSGOCdn from './index.js';

const cred = {
    username: 'your_username',
    password: 'your_password',
    shared_secret: 'your_optional_shared_secret'
};

const user = new SteamUser();
const cdn = new CSGOCdn(
    user,
    {
        logLevel: 'debug'
    }
);

cdn.on('ready', () => {
    console.log('cologne2016/astr_gold', cdn.getStickerURL('cologne2016/astr_gold', false));
    console.log('cologne2016/astr_gold large', cdn.getStickerURL('cologne2016/astr_gold', true));
    console.log('case01/patch_phoenix', cdn.getPatchURL('case01/patch_phoenix', false));
    console.log('case01/patch_phoenix', cdn.getPatchURL('case01/patch_phoenix', true));
    console.log('case01/patch_hydra large', cdn.getPatchURL('case01/patch_hydra', true));
    console.log('case_skillgroups/patch_supreme large', true, cdn.getPatchURL('case_skillgroups/patch_supreme', true));
    console.log('Patch | Phoenix', cdn.getPatchNameURL('Patch | Phoenix'));
    console.log('Patch | Hydra', cdn.getPatchNameURL('Patch | Hydra'));
    console.log('Patch | Phoenix', cdn.getItemNameURL('Patch | Phoenix'));
    console.log('Patch | Sustenance!', cdn.getItemNameURL('Patch | Sustenance!'));
    console.log('M4A4 | 龍王 (Dragon King) (Field-Tested)', cdn.getItemNameURL('M4A4 | 龍王 (Dragon King) (Field-Tested)'));
    console.log('AWP | Redline (Field-Tested)', cdn.getItemNameURL('AWP | Redline (Field-Tested)'));
    console.log('MP7 | Army Recon (Minimal Wear)', cdn.getItemNameURL('MP7 | Army Recon (Minimal Wear)'));
    console.log('Sticker | Robo', cdn.getItemNameURL('Sticker | Robo'));
    console.log('Chroma 3 Case Key', cdn.getItemNameURL('Chroma 3 Case Key'));
    console.log('Operation Phoenix Weapon Case', cdn.getItemNameURL('Operation Phoenix Weapon Case'));
    console.log('Operation Phoenix Pass', cdn.getItemNameURL('Operation Phoenix Pass'));
    console.log('Music Kit | Kelly Bailey, Hazardous Environments', cdn.getItemNameURL('Music Kit | Kelly Bailey, Hazardous Environments'));
    console.log('StatTrak™ AWP | Redline (Field-Tested)', cdn.getItemNameURL('StatTrak™ AWP | Redline (Field-Tested)'));
    console.log('StatTrak™ Music Kit | Noisia, Sharpened', cdn.getItemNameURL('StatTrak™ Music Kit | Noisia, Sharpened'));
    console.log('Sealed Graffiti | X-Axes (Tracer Yellow)', cdn.getItemNameURL('Sealed Graffiti | X-Axes (Tracer Yellow)'));
    console.log('★ Karambit | Gamma Doppler (Factory New)', cdn.phase.phase1, cdn.getItemNameURL('★ Karambit | Gamma Doppler (Factory New)', cdn.phase.phase1));
    console.log('★ Karambit | Gamma Doppler (Factory New)', cdn.phase.emerald, cdn.getItemNameURL('★ Karambit | Gamma Doppler (Factory New)', cdn.phase.emerald));
    console.log('★ Flip Knife | Doppler (Minimal Wear)', cdn.phase.ruby, cdn.getItemNameURL('★ Flip Knife | Doppler (Minimal Wear)', cdn.phase.ruby));
    console.log('★ Flip Knife | Doppler (Minimal Wear)', cdn.phase.sapphire, cdn.getItemNameURL('★ Flip Knife | Doppler (Minimal Wear)', cdn.phase.sapphire));
    console.log('★ Huntsman Knife | Doppler (Factory New)', cdn.phase.blackpearl, cdn.getItemNameURL('★ Huntsman Knife | Doppler (Factory New)', cdn.phase.blackpearl));
    console.log('AK-47 | Black Laminate (Field-Tested)', cdn.getItemNameURL('AK-47 | Black Laminate (Field-Tested)'));
    console.log('Boston 2018 Inferno Souvenir Package', cdn.getItemNameURL('Boston 2018 Inferno Souvenir Package'));
    console.log('CS:GO Case Key', cdn.getItemNameURL('CS:GO Case Key'));
    console.log('★ Karambit', cdn.getItemNameURL('★ Karambit'));
    console.log('AK-47', cdn.getItemNameURL('AK-47'));
    console.log('★ Karambit | Forest DDPAT', cdn.getItemNameURL('★ Karambit | Forest DDPAT'));
    console.log('AWP | Redline', cdn.getItemNameURL('AWP | Redline'));
    console.log('econ/status_icons/cologne_prediction_gold', cdn.getStatusIconURL('econ/status_icons/cologne_prediction_gold'));
    console.log('econ/status_icons/cologne_prediction_gold large', cdn.getStatusIconURL('econ/status_icons/cologne_prediction_gold', true));
});

if (cred.shared_secret === undefined) {
    const loginDetails = {
        accountName: cred.username,
        password: cred.password,
        rememberPassword: true,
        logonID: 2121,
    };

    console.log('Logging into Steam....');

    user.logOn(loginDetails);
} else {
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
}

user.on('loggedOn', () => {
    console.log('Logged onto Steam');
});

user.on('contentServersReady', () => {
    console.log('Content servers ready');
});
