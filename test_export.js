const trim = require('licia/trim');
const result = "package:/data/app/~~xxxxx==/com.example/base.apk\r\npackage:/data/app/~~xxxxx==/com.example/split_config.apk\r\naya_separator\r\n";
const lines = result.split('\n').map(l => trim(l)).filter(l => l.startsWith('package:'));
const paths = lines.map(l => l.replace('package:', ''));
console.log(paths);
