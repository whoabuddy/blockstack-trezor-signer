'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getMultiSigInfo = getMultiSigInfo;
exports.getCoinName = getCoinName;
exports.pathToPathArray = pathToPathArray;
exports.configureTestnet = configureTestnet;

var _bitcoinjsLib = require('bitcoinjs-lib');

var _bitcoinjsLib2 = _interopRequireDefault(_bitcoinjsLib);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var bsk = require('blockstack');

function getMultiSigInfo(publicKeys, signersRequired) {
  var redeem = _bitcoinjsLib2.default.payments.p2ms({ m: signersRequired, pubkeys: publicKeys.map(function (pk) {
      return Buffer.from(pk, 'hex');
    }) });
  var script = _bitcoinjsLib2.default.payments.p2sh({ redeem: redeem });
  var address = script.address;
  return {
    address: bsk.config.network.coerceAddress(address),
    redeemScript: redeem.output.toString('hex')
  };
}

function getCoinName() {
  var network = bsk.config.network.layer1;
  if (network.pubKeyHash === 0) {
    return 'bitcoin';
  } else if (network.pubKeyHash === 111) {
    return 'testnet';
  }
  throw new Error('Unknown layer 1 network');
}

function pathToPathArray(path) {
  var harden = 0x80000000;
  var pieces = path.split('/');
  if (pieces.length === 1 || pieces[0] !== 'm') {
    throw new Error('Invalid path ' + path);
  }
  return pieces.slice(1).map(function (x) {
    if (x.endsWith('\'')) {
      return (parseInt(x.slice(0)) | harden) >>> 0;
    } else {
      return parseInt(x);
    }
  });
}

function configureTestnet() {
  var blockstackTestnet = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 'testnet.blockstack.org';

  bsk.config.network = bsk.network.defaults.LOCAL_REGTEST;
  bsk.config.network.blockstackAPIUrl = 'http://' + blockstackTestnet + ':16268';
  bsk.config.network.broadcastServiceUrl = 'http://' + blockstackTestnet + ':16269';
  bsk.config.network.btc = new bsk.network.InsightClient('https://test-insight.bitpay.com/api');
  bsk.config.network.getFeeRate = function () {
    return Promise.resolve(1);
  };
}