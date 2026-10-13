const path = require('node:path');
module.exports = require(path.resolve(__dirname, process.platform === 'win32' ? '../.build/TiboReset-Windows/app.cjs' : '../.build/TiboReset/app.cjs'));
