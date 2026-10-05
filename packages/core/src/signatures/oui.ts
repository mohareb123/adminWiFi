/**
 * MAC OUI (vendor prefix) table.
 * A MAC alone is weak evidence, but combined with UI signals it disambiguates
 * rebranded hardware (extremely common: the same board ships as TP-Link,
 * Mercusys, ZTE, Huawei or a local ISP brand).
 *
 * © 2026 Mohamed Ibrahim Abu El-Ezz — All Rights Reserved.
 */

/** prefix (lowercase, 6 hex chars) → vendor */
export const OUI_TABLE: Record<string, string> = {
  // ASUS
  '000c6e': 'ASUS', '0011d8': 'ASUS', '001731': 'ASUS', '001bfc': 'ASUS', '001e8c': 'ASUS', '002215': 'ASUS',
  '002354': 'ASUS', '002618': 'ASUS', '04d4c4': 'ASUS', '08606e': 'ASUS', '107b44': 'ASUS', '14dae9': 'ASUS',
  '1c872c': 'ASUS', '2c56dc': 'ASUS', '305a3a': 'ASUS', '382c4a': 'ASUS', '38d547': 'ASUS', '40167e': 'ASUS',
  '4cedfb': 'ASUS', '50465d': 'ASUS', '54a050': 'ASUS', '6045cb': 'ASUS', '704d7b': 'ASUS', '74d02b': 'ASUS',
  '78d2e4': 'ASUS', '88d7f6': 'ASUS', '9c5c8e': 'ASUS', 'ac220b': 'ASUS', 'ac9e17': 'ASUS', 'b06ebf': 'ASUS',
  'bcae9c': 'ASUS', 'c86000': 'ASUS', 'd017c2': 'ASUS', 'd850e6': 'ASUS', 'e03f49': 'ASUS', 'e4ce8f': 'ASUS',
  'f46d04': 'ASUS', 'f832e4': 'ASUS', 'fc3497': 'ASUS',
  // ASUSTek
  '0018f3': 'ASUSTek',
  // Apple
  '0017f2': 'Apple', '00254b': 'Apple', 'a45e60': 'Apple', 'bc52b7': 'Apple', 'd83062': 'Apple', 'f0dbe2': 'Apple',
  'f4f15a': 'Apple',
  // Arris
  '000b82': 'Arris', '0015a2': 'Arris', '001dcd': 'Arris', '3c754a': 'Arris', '78b3b9': 'Arris', 'bc644b': 'Arris',
  'd404cd': 'Arris', 'f044d3': 'Arris', 'f88c21': 'Arris',
  // Cisco
  '000142': 'Cisco', '000c29': 'Cisco', '00179b': 'Cisco', '001a2f': 'Cisco', '001b2a': 'Cisco', '0021a0': 'Cisco',
  '0022bd': 'Cisco', '0024c3': 'Cisco', '00259c': 'Cisco', '0026ca': 'Cisco', '08cc68': 'Cisco', '0c6803': 'Cisco',
  '10bdf4': 'Cisco', '18e7f4': 'Cisco', '1c6a7a': 'Cisco', '1ce857': 'Cisco', '2894d2': 'Cisco', '2c3f38': 'Cisco',
  '3c0e23': 'Cisco', '44e4d9': 'Cisco', '5057a8': 'Cisco', '58971e': 'Cisco', '60735c': 'Cisco', '68bdab': 'Cisco',
  '6c416a': 'Cisco', '7079b3': 'Cisco', '7c69f6': 'Cisco', '84b517': 'Cisco', '8c604f': 'Cisco', '9c57ad': 'Cisco',
  'a4b239': 'Cisco', 'b000b4': 'Cisco', 'b4a4e3': 'Cisco', 'bc671c': 'Cisco', 'c47295': 'Cisco', 'cc7f75': 'Cisco',
  'd0574c': 'Cisco', 'd4eb68': 'Cisco', 'e02f6d': 'Cisco', 'e0acf1': 'Cisco', 'e8b748': 'Cisco', 'f02572': 'Cisco',
  'f0b2e5': 'Cisco', 'f4cfe2': 'Cisco',
  // D-Link
  '000d88': 'D-Link', '001195': 'D-Link', '0015e9': 'D-Link', '00179a': 'D-Link', '001b11': 'D-Link', '001cf0': 'D-Link',
  '001e58': 'D-Link', '002191': 'D-Link', '0022b0': 'D-Link', '002401': 'D-Link', '00265a': 'D-Link', '00a0c5': 'D-Link',
  '0cd502': 'D-Link', '102ab3': 'D-Link', '14d64d': 'D-Link', '1caafd': 'D-Link', '1cbd0e': 'D-Link', '2098d8': 'D-Link',
  '24ff9d': 'D-Link', '28107b': 'D-Link', '340804': 'D-Link', '3c1e04': 'D-Link', '408b07': 'D-Link', '54b80a': 'D-Link',
  '5cd998': 'D-Link', '6c7220': 'D-Link', '74da88': 'D-Link', '78542e': 'D-Link', '84c9b2': 'D-Link', '9094e4': 'D-Link',
  '949aa9': 'D-Link', 'a0ab1b': 'D-Link', 'acf1df': 'D-Link', 'b8a386': 'D-Link', 'c412f5': 'D-Link', 'c8be19': 'D-Link',
  'ccb255': 'D-Link', 'd8fee3': 'D-Link', 'e01c41': 'D-Link', 'e46f13': 'D-Link', 'f07d68': 'D-Link', 'f48ceb': 'D-Link',
  'fc7516': 'D-Link',
  // Edimax
  '000e2e': 'Edimax', '801f02': 'Edimax',
  // Google
  '001a11': 'Google', '3c5ab4': 'Google', '54dd4f': 'Google', 'a47733': 'Google', 'f4f5d8': 'Google',
  // Huawei
  '001882': 'Huawei', '002598': 'Huawei', '04b0e7': 'Huawei', '104d77': 'Huawei', '10c61f': 'Huawei', '204a6f': 'Huawei',
  '24dbac': 'Huawei', '30d17e': 'Huawei', '48ad08': 'Huawei', '48db50': 'Huawei', '5c7d5e': 'Huawei', '64a651': 'Huawei',
  '70723c': 'Huawei', '744d28': 'Huawei', '781dba': 'Huawei', '80b686': 'Huawei', '84a8e4': 'Huawei', '8c34fd': 'Huawei',
  '9c28ef': 'Huawei', 'a47174': 'Huawei', 'b41513': 'Huawei', 'c8d15e': 'Huawei', 'd02db3': 'Huawei', 'd4612e': 'Huawei',
  'e0247f': 'Huawei', 'e4c2d1': 'Huawei', 'f44c7f': 'Huawei', 'f83dff': 'Huawei',
  // Intelbras
  '1c8e5c': 'Intelbras', '247703': 'Intelbras', '64db8b': 'Intelbras', 'e8de27': 'Intelbras',
  // Linksys
  '000625': 'Linksys', '000c41': 'Linksys', '001217': 'Linksys', '001310': 'Linksys', '0014bf': 'Linksys', '0016b6': 'Linksys',
  '001839': 'Linksys', '001a70': 'Linksys', '001c10': 'Linksys', '001d7e': 'Linksys', '001e52': 'Linksys', '002129': 'Linksys',
  '0022b3': 'Linksys', '002369': 'Linksys', '141fba': 'Linksys', '20aa4b': 'Linksys', '48f8b3': 'Linksys', '58549d': 'Linksys',
  '58ef68': 'Linksys', '68a3c4': 'Linksys', '94103e': 'Linksys', 'b85510': 'Linksys', 'c0c1c0': 'Linksys', 'd8e743': 'Linksys',
  'e89f80': 'Linksys', 'ec1a59': 'Linksys',
  // MikroTik
  '000c42': 'MikroTik', '0418d6': 'MikroTik', '08ecf5': 'MikroTik', '0c9a42': 'MikroTik', '18fd74': 'MikroTik', '2cc81b': 'MikroTik',
  '48a98a': 'MikroTik', '4c5e0c': 'MikroTik', '64d154': 'MikroTik', '6c3b6b': 'MikroTik', '78b4d0': 'MikroTik', 'b869f4': 'MikroTik',
  'cc2de0': 'MikroTik', 'dc2c6e': 'MikroTik', 'e48d8c': 'MikroTik', 'e4c1f4': 'MikroTik',
  // NETGEAR
  '000fb5': 'NETGEAR', '0020e0': 'NETGEAR', '00222b': 'NETGEAR', '0024b2': 'NETGEAR', '0026f2': 'NETGEAR', '08bd43': 'NETGEAR',
  '0cd86e': 'NETGEAR', '100c6b': 'NETGEAR', '10da43': 'NETGEAR', '204e7f': 'NETGEAR', '20e52a': 'NETGEAR', '289401': 'NETGEAR',
  '28c68e': 'NETGEAR', '2c3033': 'NETGEAR', '30469a': 'NETGEAR', '388345': 'NETGEAR', '3c3786': 'NETGEAR', '3c37d4': 'NETGEAR',
  '405d82': 'NETGEAR', '4494fc': 'NETGEAR', '44a56e': 'NETGEAR', '4c60de': 'NETGEAR', '506a03': 'NETGEAR', '6c406d': 'NETGEAR',
  '6cb0ce': 'NETGEAR', '78d294': 'NETGEAR', '841b5e': 'NETGEAR', '9c3dcf': 'NETGEAR', 'a00460': 'NETGEAR', 'a06391': 'NETGEAR',
  'a42b8c': 'NETGEAR', 'b03956': 'NETGEAR', 'b0b98a': 'NETGEAR', 'c03f0e': 'NETGEAR', 'c43dc7': 'NETGEAR', 'cc40d0': 'NETGEAR',
  'dcef09': 'NETGEAR', 'e0469a': 'NETGEAR', 'e091f5': 'NETGEAR', 'e8fcaf': 'NETGEAR', 'f87394': 'NETGEAR', 'fc9fae': 'NETGEAR',
  // Ralink
  '000c43': 'Ralink', '001cdf': 'Ralink', '1c7ee5': 'Ralink',
  // Raspberry Pi
  'b827eb': 'Raspberry Pi', 'dca632': 'Raspberry Pi', 'e45f01': 'Raspberry Pi',
  // Sagemcom
  '001c4a': 'Sagemcom', '00e04c': 'Sagemcom', '2c3997': 'Sagemcom', '60a4d0': 'Sagemcom', '68179c': 'Sagemcom', 'b0958e': 'Sagemcom',
  'dc44b6': 'Sagemcom',
  // TP-Link
  '002719': 'TP-Link', '04ee91': 'TP-Link', '0c8063': 'TP-Link', '10feed': 'TP-Link', '14cc20': 'TP-Link', '1832a2': 'TP-Link',
  '1c3bf3': 'TP-Link', '30b5c2': 'TP-Link', '34e894': 'TP-Link', '3c46d8': 'TP-Link', '40ed00': 'TP-Link', '48ee0c': 'TP-Link',
  '50c7bf': 'TP-Link', '50fa84': 'TP-Link', '5c6289': 'TP-Link', '60a4b7': 'TP-Link', '6466b3': 'TP-Link', '6c5ab0': 'TP-Link',
  '7895eb': 'TP-Link', '7c8bca': 'TP-Link', '84d81b': 'TP-Link', '88dda8': 'TP-Link', '90f652': 'TP-Link', '98dac4': 'TP-Link',
  'a0f3c1': 'TP-Link', 'a42bb0': 'TP-Link', 'a8574e': 'TP-Link', 'b09575': 'TP-Link', 'b0be76': 'TP-Link', 'b4b024': 'TP-Link',
  'c025e9': 'TP-Link', 'c46e1f': 'TP-Link', 'c4e984': 'TP-Link', 'cc3dd8': 'TP-Link', 'd8f15b': 'TP-Link', 'dc9fdb': 'TP-Link',
  'e894f6': 'TP-Link', 'ec086b': 'TP-Link', 'f0f336': 'TP-Link', 'f4f26d': 'TP-Link',
  // Technicolor
  '18742e': 'Technicolor', '3462fd': 'Technicolor', '38643f': 'Technicolor', '9c1d58': 'Technicolor', 'c8c1b0': 'Technicolor', 'd8b12a': 'Technicolor',
  // Tenda
  '000cf6': 'Tenda', '001636': 'Tenda', '00184d': 'Tenda', '001fc7': 'Tenda', '00b00c': 'Tenda', '00c0ca': 'Tenda',
  '049dd6': 'Tenda', '08d833': 'Tenda', '0c72d9': 'Tenda', '105172': 'Tenda', '1c1b0d': 'Tenda', '20f77c': 'Tenda',
  '24a4d8': 'Tenda', '28c2dd': 'Tenda', '30894a': 'Tenda', '3822d6': 'Tenda', '3c3300': 'Tenda', '40a5ef': 'Tenda',
  '44b32d': 'Tenda', '4c2f9d': 'Tenda', '50d2f5': 'Tenda', '543d37': 'Tenda', '58d9d5': 'Tenda', '5cdd70': 'Tenda',
  '6092c6': 'Tenda', '7813e0': 'Tenda', '8857ee': 'Tenda', '8c882b': 'Tenda', '94d9b3': 'Tenda', '9856a1': 'Tenda',
  'ac5d10': 'Tenda', 'b8d9ce': 'Tenda', 'c83a35': 'Tenda', 'cc2d1b': 'Tenda', 'd43ded': 'Tenda', 'd8320e': 'Tenda',
  'd8af3b': 'Tenda', 'e0d55e': 'Tenda', 'f42a7d': 'Tenda', 'f8a963': 'Tenda',
  // Ubiquiti
  '002722': 'Ubiquiti', '0027e8': 'Ubiquiti', '00d0e8': 'Ubiquiti', '18e829': 'Ubiquiti', '245a4c': 'Ubiquiti', '24a43c': 'Ubiquiti',
  '44d9e7': 'Ubiquiti', '58d61f': 'Ubiquiti', '68866f': 'Ubiquiti', '74acb9': 'Ubiquiti', '78a351': 'Ubiquiti', '802aa8': 'Ubiquiti',
  '9c05d6': 'Ubiquiti', 'b4fbe4': 'Ubiquiti', 'e063da': 'Ubiquiti', 'f09fc2': 'Ubiquiti', 'f492bf': 'Ubiquiti',
  // Xiaomi
  '009ec8': 'Xiaomi', '0c1daf': 'Xiaomi', '185936': 'Xiaomi', '20826d': 'Xiaomi', '286c07': 'Xiaomi', '28e31f': 'Xiaomi',
  '34ce00': 'Xiaomi', '3cbd3e': 'Xiaomi', '44237c': 'Xiaomi', '4c49e3': 'Xiaomi', '50ec50': 'Xiaomi', '583f54': 'Xiaomi',
  '5ce5d3': 'Xiaomi', '64b473': 'Xiaomi', '64cc2e': 'Xiaomi', '6822f5': 'Xiaomi', '6cb4a7': 'Xiaomi', '743af4': 'Xiaomi',
  '78a8e4': 'Xiaomi', '7c1dd9': 'Xiaomi', '8cbebe': 'Xiaomi', '9441c6': 'Xiaomi', '9c99a0': 'Xiaomi', 'b0e235': 'Xiaomi',
  'c46ab7': 'Xiaomi', 'd4970b': 'Xiaomi', 'e0b94d': 'Xiaomi', 'ecfa5c': 'Xiaomi', 'f0b429': 'Xiaomi', 'f48b32': 'Xiaomi',
  'fc64ba': 'Xiaomi',
  // ZTE
  '0015eb': 'ZTE', '002293': 'ZTE', '044e5a': 'ZTE', '04c5a4': 'ZTE', '0c1262': 'ZTE', '146080': 'ZTE',
  '1836dc': 'ZTE', '24b2b9': 'ZTE', '30d386': 'ZTE', '344b50': 'ZTE', '34e0cf': 'ZTE', '4c09b4': 'ZTE',
  '4cac0a': 'ZTE', '542bad': 'ZTE', '5848cc': 'ZTE', '5c3a3d': 'ZTE', '6c8b2f': 'ZTE', '74c9a3': 'ZTE',
  '788102': 'ZTE', '8465fd': 'ZTE', '8c68c8': 'ZTE', '90d8f3': 'ZTE', '98f428': 'ZTE', '9c2ea1': 'ZTE',
  'a4c138': 'ZTE', 'b075d5': 'ZTE', 'b8bfc0': 'ZTE', 'c87b5b': 'ZTE', 'd0154a': 'ZTE', 'd0c1b1': 'ZTE',
  'd8be8e': 'ZTE', 'e0c3f3': 'ZTE', 'ec3eb3': 'ZTE', 'f4a14d': 'ZTE', 'f8dfa8': 'ZTE',
};

/** Look up a vendor from a MAC address in any common notation. */
export function lookupOui(mac: string | undefined): string | undefined {
  if (!mac) return undefined;
  const clean = mac.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (clean.length < 6) return undefined;
  return OUI_TABLE[clean.slice(0, 6)];
}

/** Best-effort device-class guess from a vendor name (Device Manager labels). */
export function guessDeviceKind(vendor: string | undefined, hostname: string | undefined): string | undefined {
  const text = `${vendor ?? ''} ${hostname ?? ''}`.toLowerCase();
  if (/(iphone|ipad|ipod|apple|macbook)/.test(text)) return 'Apple device';
  if (/(samsung|galaxy|sm-)/.test(text)) return 'Samsung device';
  if (/(xiaomi|redmi|mi-|poco)/.test(text)) return 'Xiaomi device';
  if (/(huawei|honor)/.test(text)) return 'Huawei device';
  if (/(oppo|vivo|realme|oneplus|infinix|tecno)/.test(text)) return 'Android phone';
  if (/(laptop|notebook|desktop|pc-|windows)/.test(text)) return 'Computer';
  if (/(tv|bravia|webos|tizen|roku|chromecast|firestick)/.test(text)) return 'Smart TV / media';
  if (/(printer|hp-|epson|canon|brother)/.test(text)) return 'Printer';
  if (/(camera|ipcam|hikvision|dahua|reolink)/.test(text)) return 'Camera';
  if (/(playstation|ps4|ps5|xbox|nintendo)/.test(text)) return 'Console';
  if (/(ecobee|thermostat|plug|bulb|switch|tuya|shelly|sonoff)/.test(text)) return 'Smart home';
  return undefined;
}
